use serde::Serialize;
use std::{env, net::IpAddr, path::PathBuf, process::Command};

use crate::tailscale;

const SSH_USER: &str = "kian";
const REMOTE_FOLDER: &str = "/home/kian";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VsCodeLaunchInfo {
    target: String,
    folder: String,
}

fn code_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Microsoft VS Code")
                .join("Code.exe"),
        );
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("Microsoft VS Code")
                .join("Code.exe"),
        );
    }
    candidates
}

fn remote_folder_uri(ip: &str) -> String {
    format!("vscode-remote://ssh-remote+{SSH_USER}@{ip}{REMOTE_FOLDER}")
}

#[tauri::command]
pub(crate) fn open_in_vscode() -> Result<VsCodeLaunchInfo, String> {
    let code_path = code_candidates()
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Visual Studio Code was not found".to_string())?;

    let status = tailscale::read_lab_status();
    if !status.tailscale_connected {
        return Err(status
            .error
            .unwrap_or_else(|| "Tailscale is disconnected".to_string()));
    }
    if !status.device_found || !status.online {
        return Err("DK2500 is offline".to_string());
    }
    let ip = status
        .ip
        .ok_or_else(|| "DK2500 has no Tailscale IP".to_string())?;
    ip.parse::<IpAddr>()
        .map_err(|_| "DK2500 returned an invalid Tailscale IP".to_string())?;

    let uri = remote_folder_uri(&ip);
    Command::new(code_path)
        .args(["--new-window", "--folder-uri", &uri])
        .spawn()
        .map_err(|error| format!("Unable to open Visual Studio Code: {error}"))?;

    Ok(VsCodeLaunchInfo {
        target: format!("{SSH_USER}@{ip}"),
        folder: REMOTE_FOLDER.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_remote_ssh_folder_uri() {
        assert_eq!(
            remote_folder_uri("100.68.98.65"),
            "vscode-remote://ssh-remote+kian@100.68.98.65/home/kian"
        );
    }
}
