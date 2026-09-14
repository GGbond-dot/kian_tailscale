use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::Ipv4Addr, path::Path, process::Command};

use crate::device::{self, DEVICES};

const TAILSCALE_PATH: &str = r"C:\Program Files\Tailscale\tailscale.exe";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceStatus {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) role: String,
    pub(crate) device_found: bool,
    pub(crate) online: bool,
    pub(crate) ip: Option<String>,
    pub(crate) hostname: Option<String>,
    pub(crate) os: Option<String>,
    pub(crate) ssh_port: u16,
}

impl DeviceStatus {
    fn unavailable(profile: &device::DeviceProfile) -> Self {
        Self {
            id: profile.id.to_string(),
            display_name: profile.display_name.to_string(),
            role: profile.role.to_string(),
            device_found: false,
            online: false,
            ip: None,
            hostname: None,
            os: None,
            ssh_port: profile.ssh_port,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LabOverview {
    pub(crate) tailscale_installed: bool,
    pub(crate) tailscale_connected: bool,
    pub(crate) devices: Vec<DeviceStatus>,
    pub(crate) error: Option<String>,
}

impl LabOverview {
    pub(crate) fn unavailable(tailscale_installed: bool, error: Option<String>) -> Self {
        Self {
            tailscale_installed,
            tailscale_connected: false,
            devices: DEVICES.iter().map(DeviceStatus::unavailable).collect(),
            error,
        }
    }

    pub(crate) fn device(&self, device_id: &str) -> Result<&DeviceStatus, String> {
        self.devices
            .iter()
            .find(|status| status.id == device_id)
            .ok_or_else(|| "Unknown device identifier".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscaleStatus {
    backend_state: String,
    #[serde(rename = "Self")]
    self_node: Option<TailscalePeer>,
    #[serde(default)]
    peer: HashMap<String, TailscalePeer>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TailscalePeer {
    #[serde(default)]
    host_name: String,
    #[serde(default, rename = "OS")]
    os: String,
    #[serde(default)]
    online: bool,
    #[serde(default, rename = "TailscaleIPs")]
    tailscale_ips: Vec<String>,
}

fn is_tailscale_ipv4(value: &str) -> bool {
    value
        .parse::<Ipv4Addr>()
        .map(|address| {
            let octets = address.octets();
            octets[0] == 100 && (64..=127).contains(&octets[1])
        })
        .unwrap_or(false)
}

fn parse_tailscale_status(json: &str) -> Result<LabOverview, serde_json::Error> {
    let status: TailscaleStatus = serde_json::from_str(json)?;
    let connected = status.backend_state.eq_ignore_ascii_case("running");
    let nodes = status
        .self_node
        .iter()
        .chain(status.peer.values())
        .collect::<Vec<_>>();

    let devices = DEVICES
        .iter()
        .map(|profile| {
            let target = nodes.iter().find(|peer| {
                peer.host_name
                    .eq_ignore_ascii_case(profile.tailscale_hostname)
            });
            match target {
                Some(peer) => DeviceStatus {
                    id: profile.id.to_string(),
                    display_name: profile.display_name.to_string(),
                    role: profile.role.to_string(),
                    device_found: true,
                    online: peer.online,
                    ip: peer
                        .tailscale_ips
                        .iter()
                        .find(|ip| is_tailscale_ipv4(ip))
                        .cloned(),
                    hostname: Some(peer.host_name.clone()),
                    os: (!peer.os.is_empty()).then(|| peer.os.clone()),
                    ssh_port: profile.ssh_port,
                },
                None => DeviceStatus::unavailable(profile),
            }
        })
        .collect();

    Ok(LabOverview {
        tailscale_installed: true,
        tailscale_connected: connected,
        devices,
        error: None,
    })
}

pub(crate) fn read_lab_overview() -> LabOverview {
    if !Path::new(TAILSCALE_PATH).is_file() {
        return LabOverview::unavailable(false, None);
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
        Err(error) => return LabOverview::unavailable(true, Some(error.to_string())),
    };

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return LabOverview::unavailable(
            true,
            Some(if message.is_empty() {
                format!("tailscale exited with {}", output.status)
            } else {
                message
            }),
        );
    }

    parse_tailscale_status(&String::from_utf8_lossy(&output.stdout)).unwrap_or_else(|error| {
        LabOverview::unavailable(true, Some(format!("Invalid Tailscale status: {error}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_server_and_gpu_node_including_self() {
        let json = r#"{
          "BackendState": "Running",
          "Self": {
            "HostName": "DESKTOP-LTUQMCM",
            "OS": "windows",
            "Online": true,
            "TailscaleIPs": ["100.90.202.5"]
          },
          "Peer": {"node-key": {
            "HostName": "DK2500",
            "OS": "linux",
            "Online": true,
            "TailscaleIPs": ["100.68.98.65", "fd7a:115c:a1e0::4801:62d0"]
          }}
        }"#;

        let result = parse_tailscale_status(json).expect("valid Tailscale JSON");
        assert!(result.tailscale_connected);
        assert_eq!(result.devices.len(), 3);

        let server = result.device("dk2500").expect("server status");
        assert!(server.online);
        assert_eq!(server.ip.as_deref(), Some("100.68.98.65"));
        assert_eq!(server.ssh_port, 22);

        let gpu = result.device("desktop-5060").expect("gpu status");
        assert!(gpu.online);
        assert_eq!(gpu.ip.as_deref(), Some("100.90.202.5"));
        assert_eq!(gpu.ssh_port, 2222);

        let windows = result
            .device("desktop-5060-windows")
            .expect("windows status");
        assert!(windows.online);
        assert_eq!(windows.ip.as_deref(), Some("100.90.202.5"));
        assert_eq!(windows.ssh_port, 2224);
    }

    #[test]
    fn rejects_non_tailscale_ipv4_addresses() {
        assert!(is_tailscale_ipv4("100.64.0.1"));
        assert!(is_tailscale_ipv4("100.127.255.254"));
        assert!(!is_tailscale_ipv4("100.128.0.1"));
        assert!(!is_tailscale_ipv4("192.168.1.2"));
        assert!(!is_tailscale_ipv4("100.999.1.2"));
    }
}
