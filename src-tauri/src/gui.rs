use std::{
    env,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

const X_SERVER_PORT: u16 = 6000;

pub(crate) struct GuiState {
    owned_server: Mutex<Option<Child>>,
}

impl Default for GuiState {
    fn default() -> Self {
        Self {
            owned_server: Mutex::new(None),
        }
    }
}

fn vcxsrv_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("VcXsrv")
                .join("vcxsrv.exe"),
        );
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(program_files_x86)
                .join("VcXsrv")
                .join("vcxsrv.exe"),
        );
    }
    candidates
}

fn x_server_ready() -> bool {
    TcpStream::connect(("127.0.0.1", X_SERVER_PORT)).is_ok()
}

pub(crate) fn ensure_x_server(state: &GuiState) -> Result<(), String> {
    if x_server_ready() {
        return Ok(());
    }

    let path = vcxsrv_candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "VcXsrv is not installed. Install it with: winget install --id marha.VcXsrv".to_string()
        })?;

    let mut command = Command::new(path);
    // VcXsrv's installed X0.hosts permits localhost only. Do not use -ac:
    // Windows OpenSSH reaches the display locally and proxies remote clients.
    command
        .args([
            ":0",
            "-multiwindow",
            "-clipboard",
            "-wgl",
            "-silent-dup-error",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start VcXsrv: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if x_server_ready() {
            *state
                .owned_server
                .lock()
                .map_err(|_| "GUI forwarding state is unavailable".to_string())? = Some(child);
            return Ok(());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Unable to inspect VcXsrv: {error}"))?
        {
            return Err(format!("VcXsrv exited with {status}"));
        }
        thread::sleep(Duration::from_millis(100));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("VcXsrv did not become ready in time".to_string())
}

pub(crate) fn close_owned(state: &GuiState) {
    if let Ok(mut owned) = state.owned_server.lock() {
        if let Some(mut child) = owned.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub(crate) fn supports_device(device_id: &str) -> bool {
    matches!(device_id, "dk2500" | "desktop-5060")
}

pub(crate) fn display_value() -> &'static str {
    "127.0.0.1:0.0"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_forwarding_is_linux_only() {
        assert!(supports_device("dk2500"));
        assert!(supports_device("desktop-5060"));
        assert!(!supports_device("desktop-5060-windows"));
        assert!(!supports_device("unknown"));
    }

    #[test]
    fn x_display_is_local_only() {
        assert_eq!(display_value(), "127.0.0.1:0.0");
    }
}
