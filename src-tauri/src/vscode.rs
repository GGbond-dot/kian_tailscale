use serde::Serialize;
use std::{env, net::IpAddr, path::PathBuf, process::Command};

use crate::{device, tailscale};

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

fn ssh_authority(profile: &device::DeviceProfile, ip: &str) -> String {
    let mut host_info = serde_json::json!({
        "hostName": ip,
        "user": profile.ssh_user,
    });
    if profile.ssh_port != 22 {
        host_info["port"] = serde_json::json!(profile.ssh_port);
    }
    serde_json::to_vec(&host_info)
        .expect("static SSH host information must serialize")
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn ssh_display_target(profile: &device::DeviceProfile, ip: &str) -> String {
    let port = if profile.ssh_port != 22 {
        format!(":{}", profile.ssh_port)
    } else {
        String::new()
    };
    format!("{}@{ip}{port}", profile.ssh_user)
}

fn remote_folder_uri(profile: &device::DeviceProfile, ip: &str) -> String {
    format!(
        "vscode-remote://ssh-remote+{}{folder}",
        ssh_authority(profile, ip),
        folder = profile.remote_folder
    )
}

#[tauri::command]
pub(crate) fn open_in_vscode(device_id: String) -> Result<VsCodeLaunchInfo, String> {
    let profile = device::profile(&device_id)?;
    let code_path = code_candidates()
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Visual Studio Code was not found".to_string())?;

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

    let uri = remote_folder_uri(profile, ip);
    Command::new(code_path)
        .args(["--new-window", "--folder-uri", &uri])
        .spawn()
        .map_err(|error| format!("Unable to open Visual Studio Code: {error}"))?;

    Ok(VsCodeLaunchInfo {
        target: ssh_display_target(profile, ip),
        folder: profile.remote_folder.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_server_and_gpu_remote_uris() {
        let server = device::profile("dk2500").expect("server profile");
        let server_uri = remote_folder_uri(server, "100.68.98.65");
        assert!(server_uri.starts_with("vscode-remote://ssh-remote+7b"));
        assert!(server_uri.ends_with("/home/kian"));

        let gpu = device::profile("desktop-5060").expect("gpu profile");
        let gpu_uri = remote_folder_uri(gpu, "100.90.202.5");
        assert!(gpu_uri.starts_with("vscode-remote://ssh-remote+7b"));
        assert!(gpu_uri.ends_with("/home/kian"));
        assert_ne!(server_uri, gpu_uri);
        assert_eq!(
            ssh_display_target(gpu, "100.90.202.5"),
            "kian@100.90.202.5:2222"
        );
    }
}
