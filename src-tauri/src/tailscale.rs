use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, process::Command};

const TAILSCALE_PATH: &str = r"C:\Program Files\Tailscale\tailscale.exe";
const TARGET_HOSTNAME: &str = "dk2500";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LabStatus {
    pub(crate) tailscale_installed: bool,
    pub(crate) tailscale_connected: bool,
    pub(crate) device_found: bool,
    pub(crate) online: bool,
    pub(crate) ip: Option<String>,
    pub(crate) hostname: Option<String>,
    pub(crate) os: Option<String>,
    pub(crate) error: Option<String>,
}

impl LabStatus {
    pub(crate) fn unavailable(tailscale_installed: bool, error: Option<String>) -> Self {
        Self {
            tailscale_installed,
            tailscale_connected: false,
            device_found: false,
            online: false,
            ip: None,
            hostname: None,
            os: None,
            error,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleStatus {
    backend_state: String,
    #[serde(default)]
    peer: HashMap<String, TailscalePeer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscalePeer {
    host_name: String,
    #[serde(rename = "OS")]
    os: String,
    #[serde(default)]
    online: bool,
    #[serde(default, rename = "TailscaleIPs")]
    tailscale_ips: Vec<String>,
}

fn parse_tailscale_status(json: &str) -> Result<LabStatus, serde_json::Error> {
    let status: TailscaleStatus = serde_json::from_str(json)?;
    let connected = status.backend_state.eq_ignore_ascii_case("running");
    let target = status
        .peer
        .values()
        .find(|peer| peer.host_name.eq_ignore_ascii_case(TARGET_HOSTNAME));

    Ok(match target {
        Some(peer) => LabStatus {
            tailscale_installed: true,
            tailscale_connected: connected,
            device_found: true,
            online: peer.online,
            ip: peer
                .tailscale_ips
                .iter()
                .find(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok())
                .cloned()
                .or_else(|| peer.tailscale_ips.first().cloned()),
            hostname: Some(peer.host_name.clone()),
            os: Some(peer.os.clone()),
            error: None,
        },
        None => LabStatus {
            tailscale_installed: true,
            tailscale_connected: connected,
            device_found: false,
            online: false,
            ip: None,
            hostname: None,
            os: None,
            error: None,
        },
    })
}

pub(crate) fn read_lab_status() -> LabStatus {
    if !Path::new(TAILSCALE_PATH).is_file() {
        return LabStatus::unavailable(false, None);
    }

    let mut command = Command::new(TAILSCALE_PATH);
    command.args(["status", "--json"]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let output = match command.output() {
        Ok(output) => output,
        Err(error) => return LabStatus::unavailable(true, Some(error.to_string())),
    };

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return LabStatus::unavailable(
            true,
            Some(if message.is_empty() {
                format!("tailscale exited with {}", output.status)
            } else {
                message
            }),
        );
    }

    parse_tailscale_status(&String::from_utf8_lossy(&output.stdout)).unwrap_or_else(|error| {
        LabStatus::unavailable(true, Some(format!("Invalid Tailscale status: {error}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_target_fields_and_prefers_ipv4() {
        let json = r#"{
          "BackendState": "Running",
          "Peer": {"node-key": {
            "HostName": "DK2500",
            "OS": "linux",
            "Online": true,
            "TailscaleIPs": ["100.68.98.65", "fd7a:115c:a1e0::4801:62d0"]
          }}
        }"#;

        let result = parse_tailscale_status(json).expect("valid Tailscale JSON");
        assert!(result.tailscale_connected);
        assert!(result.device_found);
        assert!(result.online);
        assert_eq!(result.ip.as_deref(), Some("100.68.98.65"));
        assert_eq!(result.hostname.as_deref(), Some("DK2500"));
        assert_eq!(result.os.as_deref(), Some("linux"));
    }

    #[test]
    fn handles_a_missing_target() {
        let result = parse_tailscale_status(r#"{"BackendState":"Stopped","Peer":{}}"#)
            .expect("valid Tailscale JSON");
        assert!(!result.tailscale_connected);
        assert!(!result.device_found);
        assert!(!result.online);
        assert!(result.ip.is_none());
        assert!(result.error.is_none());
    }
}
