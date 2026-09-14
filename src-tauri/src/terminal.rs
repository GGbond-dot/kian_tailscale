use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::{device, tailscale};

const SSH_PATH: &str = r"C:\Windows\System32\OpenSSH\ssh.exe";
const DEFAULT_COLS: u16 = 100;
const DEFAULT_ROWS: u16 = 28;
const MAX_INPUT_BYTES: usize = 64 * 1024;

pub(crate) struct TerminalState {
    sessions: Mutex<HashMap<u64, Arc<PtySession>>>,
    next_session_id: AtomicU64,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
        }
    }
}

struct PtySession {
    window_label: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: u64,
    terminal_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: u64,
    terminal_id: String,
    exit_code: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionInfo {
    session_id: u64,
    target: String,
}

fn lock_sessions(
    state: &TerminalState,
) -> Result<std::sync::MutexGuard<'_, HashMap<u64, Arc<PtySession>>>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())
}

fn get_session(
    state: &TerminalState,
    session_id: u64,
    window_label: &str,
) -> Result<Arc<PtySession>, String> {
    let session = lock_sessions(state)?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "No active SSH session".to_string())?;
    if session.window_label != window_label {
        return Err("SSH session belongs to another window".to_string());
    }
    Ok(session)
}

fn stop_session(session: &PtySession) -> Result<(), String> {
    session
        .killer
        .lock()
        .map_err(|_| "Terminal process is unavailable".to_string())?
        .kill()
        .map_err(|error| format!("Unable to stop ssh.exe: {error}"))
}

fn remove_session(app: &AppHandle, session_id: u64) {
    let state = app.state::<TerminalState>();
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&session_id);
    };
}

#[tauri::command]
pub(crate) fn connect_ssh(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, TerminalState>,
    terminal_id: String,
    device_id: String,
) -> Result<ConnectionInfo, String> {
    if terminal_id.is_empty() || terminal_id.len() > 128 {
        return Err("Invalid terminal identifier".to_string());
    }
    if !Path::new(SSH_PATH).is_file() {
        return Err("Windows OpenSSH was not found".to_string());
    }

    let profile = device::profile(&device_id)?;
    let overview = tailscale::read_lab_overview();
    if !overview.tailscale_installed {
        return Err("Tailscale Not Found".to_string());
    }
    if !overview.tailscale_connected {
        return Err(overview
            .error
            .unwrap_or_else(|| "Tailscale is disconnected".to_string()));
    }
    let status = overview.device(profile.id)?;
    if !status.device_found || !status.online {
        return Err(format!("{} is offline", profile.display_name));
    }

    let ip = status
        .ip
        .clone()
        .ok_or_else(|| format!("{} has no Tailscale IP", profile.display_name))?;
    if ip.parse::<std::net::IpAddr>().is_err() {
        return Err("DK2500 returned an invalid Tailscale IP".to_string());
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to create ConPTY: {error}"))?;

    let mut command = CommandBuilder::new(SSH_PATH);
    command.args(["-o", "ServerAliveInterval=30"]);
    command.args(["-o", "ServerAliveCountMax=3"]);
    if profile.ssh_port != 22 {
        command.args(["-p", &profile.ssh_port.to_string()]);
    }
    let target = format!("{}@{ip}", profile.ssh_user);
    command.arg(&target);
    command.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Unable to start ssh.exe: {error}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Unable to open terminal output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Unable to open terminal input: {error}"))?;
    let killer = child.clone_killer();
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    let window_label = window.label().to_string();

    {
        let mut sessions = lock_sessions(&state)?;
        sessions.insert(
            session_id,
            Arc::new(PtySession {
                window_label: window_label.clone(),
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                killer: Mutex::new(killer),
            }),
        );
    }

    let output_app = app.clone();
    let output_window_label = window_label.clone();
    let output_terminal_id = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let _ = output_app.emit_to(
                        output_window_label.as_str(),
                        "terminal-output",
                        TerminalOutput {
                            session_id,
                            terminal_id: output_terminal_id.clone(),
                            data: buffer[..count].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    std::thread::spawn(move || {
        let exit_code = child.wait().map(|status| status.exit_code()).unwrap_or(1);
        remove_session(&app, session_id);
        let _ = app.emit_to(
            window_label.as_str(),
            "terminal-exit",
            TerminalExit {
                session_id,
                terminal_id,
                exit_code,
            },
        );
    });

    Ok(ConnectionInfo {
        session_id,
        target: if profile.ssh_port == 22 {
            target
        } else {
            format!("{target}:{}", profile.ssh_port)
        },
    })
}

#[tauri::command]
pub(crate) fn terminal_write(
    session_id: u64,
    data: String,
    window: WebviewWindow,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    if data.len() > MAX_INPUT_BYTES {
        return Err("Terminal input is too large".to_string());
    }

    let session = get_session(&state, session_id, window.label())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Terminal input is unavailable".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("Unable to write to terminal: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Unable to flush terminal input: {error}"))
}

#[tauri::command]
pub(crate) fn terminal_resize(
    session_id: u64,
    cols: u16,
    rows: u16,
    window: WebviewWindow,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    if !(2..=500).contains(&cols) || !(2..=500).contains(&rows) {
        return Err("Terminal size is outside the supported range".to_string());
    }

    let session = get_session(&state, session_id, window.label())?;
    let result = session
        .master
        .lock()
        .map_err(|_| "Terminal resize is unavailable".to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to resize terminal: {error}"));
    result
}

#[tauri::command]
pub(crate) fn disconnect_ssh(
    session_id: u64,
    window: WebviewWindow,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let session = get_session(&state, session_id, window.label())?;
    lock_sessions(&state)?.remove(&session_id);
    stop_session(&session)
}

pub(crate) fn close_window_sessions(
    state: &TerminalState,
    window_label: &str,
) -> Result<(), String> {
    let active = {
        let mut sessions = lock_sessions(state)?;
        let ids = sessions
            .iter()
            .filter_map(|(id, session)| (session.window_label == window_label).then_some(*id))
            .collect::<Vec<_>>();
        ids.into_iter()
            .filter_map(|id| sessions.remove(&id))
            .collect::<Vec<_>>()
    };
    for session in active {
        let _ = stop_session(&session);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires local Tailscale, DK2500, and Desktop 5060"]
    fn live_conpty_ssh_probe() {
        let overview = tailscale::read_lab_overview();
        for device_id in ["dk2500", "desktop-5060"] {
            let profile = device::profile(device_id).expect("known profile");
            println!("Probing {} through ConPTY", profile.display_name);
            let ip = overview
                .device(profile.id)
                .expect("device status")
                .ip
                .clone()
                .expect("device must have a Tailscale IP");
            probe_profile(profile, &ip);
        }
    }

    fn probe_profile(profile: &device::DeviceProfile, ip: &str) {
        use std::{sync::mpsc, time::Duration};

        let pair = native_pty_system()
            .openpty(PtySize::default())
            .expect("ConPTY must open");
        pair.master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("ConPTY must resize");

        let mut command = CommandBuilder::new(SSH_PATH);
        command.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]);
        if profile.ssh_port != 22 {
            command.args(["-p", &profile.ssh_port.to_string()]);
        }
        command.args([
            &format!("{}@{ip}", profile.ssh_user),
            "printf KIAN_REMOTE_LAB_SSH_OK",
        ]);
        let mut child = pair
            .slave
            .spawn_command(command)
            .expect("ssh.exe must start in ConPTY");
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("ConPTY output must open");
        let mut writer = pair.master.take_writer().expect("ConPTY input must open");
        let (output_sender, output_receiver) = mpsc::channel();
        std::thread::spawn(move || loop {
            let mut bytes = vec![0_u8; 8192];
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => {
                    bytes.truncate(count);
                    if output_sender.send(bytes).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let mut output_bytes = Vec::new();
        loop {
            let remaining = deadline
                .checked_duration_since(std::time::Instant::now())
                .expect("ssh.exe must finish its terminal negotiation");
            let chunk = output_receiver
                .recv_timeout(remaining)
                .expect("ssh.exe must produce ConPTY output");
            output_bytes.extend_from_slice(&chunk);

            if output_bytes.windows(4).any(|bytes| bytes == b"\x1b[6n") {
                writer.write_all(b"\x1b[1;1R").expect("ConPTY input write");
                writer.flush().expect("ConPTY input flush");
            }

            let output = String::from_utf8_lossy(&output_bytes);
            if output.contains("KIAN_REMOTE_LAB_SSH_OK") || output.contains("Permission denied") {
                break;
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        drop(writer);
        drop(pair.master);
        let output = String::from_utf8_lossy(&output_bytes);
        assert!(
            output.contains("KIAN_REMOTE_LAB_SSH_OK"),
            "{} SSH failed: {output}",
            profile.display_name
        );
    }
}
