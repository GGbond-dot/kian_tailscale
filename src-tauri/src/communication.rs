use serde::Serialize;

/// Stable, allowlisted operations for the future node-agent protocol.
/// This is intentionally data-only: no user supplied command is accepted.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeCatalog {
    pub(crate) protocol_version: &'static str,
    pub(crate) transport: &'static str,
    pub(crate) nodes: Vec<NodeDescriptor>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeDescriptor {
    pub(crate) id: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) control_plane: &'static str,
    pub(crate) endpoint_kind: &'static str,
    pub(crate) capabilities: &'static [&'static str],
}

const SERVER_CAPABILITIES: &[&str] = &["status", "capabilities", "terminal", "file-browse"];
const WSL_CAPABILITIES: &[&str] = &[
    "status",
    "capabilities",
    "terminal",
    "gpu",
    "training-job",
    "file-browse",
];
const WINDOWS_CAPABILITIES: &[&str] = &[
    "status",
    "capabilities",
    "terminal",
    "powershell",
    "file-browse",
];

pub(crate) fn catalog() -> NodeCatalog {
    NodeCatalog {
        protocol_version: "0.1",
        transport: "tailscale-ssh",
        nodes: vec![
            NodeDescriptor {
                id: "dk2500",
                display_name: "DK2500",
                control_plane: "tailscale",
                endpoint_kind: "linux-ssh",
                capabilities: SERVER_CAPABILITIES,
            },
            NodeDescriptor {
                id: "desktop-5060",
                display_name: "Desktop 5060 WSL",
                control_plane: "tailscale",
                endpoint_kind: "linux-ssh",
                capabilities: WSL_CAPABILITIES,
            },
            NodeDescriptor {
                id: "desktop-5060-windows",
                display_name: "Desktop 5060 Windows",
                control_plane: "tailscale",
                endpoint_kind: "windows-ssh",
                capabilities: WINDOWS_CAPABILITIES,
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_fixed_and_has_no_shell_operation() {
        let catalog = catalog();
        assert_eq!(catalog.protocol_version, "0.1");
        assert_eq!(catalog.nodes.len(), 3);
        assert!(catalog
            .nodes
            .iter()
            .all(|node| !node.capabilities.contains(&"shell")));
    }
}
