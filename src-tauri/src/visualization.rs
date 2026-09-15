use serde::Serialize;
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::State;

use crate::{device, tailscale};

const SSH_PATH: &str = r"C:\Windows\System32\OpenSSH\ssh.exe";
const REMOTE_BRIDGE_PORT: u16 = 8765;
const REMOTE_LAUNCHER: &str = "~/.local/share/kian-remote-lab/visualization/start-foxglove.sh";

pub(crate) struct VisualizationState {
    tunnels: Mutex<HashMap<String, Child>>,
}

impl Default for VisualizationState {
    fn default() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisualizationInfo {
    target: String,
    local_port: u16,
    url: String,
}

fn local_port(device_id: &str) -> Result<u16, String> {
    match device_id {
        "dk2500" => Ok(18_765),
        "desktop-5060" => Ok(18_766),
        "desktop-5060-windows" => {
            Err("ROS visualization runs on Desktop 5060 WSL; select the WSL node".to_string())
        }
        _ => Err("Unknown device identifier".to_string()),
    }
}

fn foxglove_url(port: u16) -> String {
    format!(
        "https://app.foxglove.dev/~/view?ds=foxglove-websocket&ds.url=ws%3A%2F%2F127.0.0.1%3A{port}"
    )
}

fn chrome_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(
            std::path::PathBuf::from(program_files)
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
        );
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        candidates.push(
            std::path::PathBuf::from(program_files_x86)
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
        );
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            std::path::PathBuf::from(local_app_data)
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
        );
    }
    candidates
}

fn ssh_args(profile: &device::DeviceProfile, ip: &str) -> Vec<String> {
    let mut args = vec![
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=8".to_string(),
    ];
    if profile.ssh_port != 22 {
        args.extend(["-p".to_string(), profile.ssh_port.to_string()]);
    }
    args.push(format!("{}@{ip}", profile.ssh_user));
    args
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
}

fn start_remote_bridge(profile: &device::DeviceProfile, ip: &str) -> Result<(), String> {
    let mut args = ssh_args(profile, ip);
    args.push(REMOTE_LAUNCHER.to_string());
    let mut command = Command::new(SSH_PATH);
    command.args(args);
    hidden(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Unable to start the ROS visualization service: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() {
        format!("ssh exited with {}", output.status)
    } else {
        stderr
    };
    Err(format!(
        "ROS visualization is not ready on {}: {detail}. Run scripts/visualization/setup-node.sh there first",
        profile.display_name
    ))
}

fn start_tunnel(profile: &device::DeviceProfile, ip: &str, port: u16) -> Result<Child, String> {
    let mut args = vec![
        "-N".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=6".to_string(),
        "-L".to_string(),
        format!("127.0.0.1:{port}:127.0.0.1:{REMOTE_BRIDGE_PORT}"),
    ];
    if profile.ssh_port != 22 {
        args.extend(["-p".to_string(), profile.ssh_port.to_string()]);
    }
    args.push(format!("{}@{ip}", profile.ssh_user));

    let mut command = Command::new(SSH_PATH);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hidden(&mut command);
    command
        .spawn()
        .map_err(|error| format!("Unable to create the SSH visualization tunnel: {error}"))
}

fn wait_for_tunnel(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Unable to inspect the SSH tunnel: {error}"))?
        {
            return Err(format!("SSH visualization tunnel exited with {status}"));
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    Err("The ROS visualization tunnel did not become ready in time".to_string())
}

#[tauri::command]
pub(crate) fn open_ros_visualization(
    state: State<'_, VisualizationState>,
    device_id: String,
) -> Result<VisualizationInfo, String> {
    if !Path::new(SSH_PATH).is_file() {
        return Err("Windows OpenSSH was not found".to_string());
    }
    let chrome_path = chrome_candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "Google Chrome was not found".to_string())?;

    let port = local_port(&device_id)?;
    let profile = device::profile(&device_id)?;
    let overview = tailscale::read_lab_overview();
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
        .as_deref()
        .ok_or_else(|| format!("{} has no Tailscale IP", profile.display_name))?;
    ip.parse::<IpAddr>()
        .map_err(|_| format!("{} returned an invalid Tailscale IP", profile.display_name))?;

    start_remote_bridge(profile, ip)?;

    let mut tunnels = state
        .tunnels
        .lock()
        .map_err(|_| "Visualization state is unavailable".to_string())?;
    if let Some(mut old) = tunnels.remove(&device_id) {
        let _ = old.kill();
        let _ = old.wait();
    }
    let mut child = start_tunnel(profile, ip, port)?;
    wait_for_tunnel(&mut child, port)?;
    tunnels.insert(device_id, child);

    let url = foxglove_url(port);
    Command::new(chrome_path)
        .args(["--new-window", &url])
        .spawn()
        .map_err(|error| format!("Unable to open Foxglove: {error}"))?;

    Ok(VisualizationInfo {
        target: profile.display_name.to_string(),
        local_port: port,
        url,
    })
}

pub(crate) fn close_all(state: &VisualizationState) {
    if let Ok(mut tunnels) = state.tunnels.lock() {
        for (_, mut child) in tunnels.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ports_are_fixed_and_windows_host_is_rejected() {
        assert_eq!(local_port("dk2500"), Ok(18_765));
        assert_eq!(local_port("desktop-5060"), Ok(18_766));
        assert!(local_port("desktop-5060-windows").is_err());
        assert!(local_port("arbitrary-host").is_err());
    }

    #[test]
    fn foxglove_url_targets_only_local_tunnel() {
        assert_eq!(
            foxglove_url(18_765),
            "https://app.foxglove.dev/~/view?ds=foxglove-websocket&ds.url=ws%3A%2F%2F127.0.0.1%3A18765"
        );
    }
}
