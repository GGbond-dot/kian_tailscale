# Kian Remote Lab communication layer

## Current transport

The app uses Tailscale as the only network transport and connects to fixed,
allowlisted SSH endpoints:

- `dk2500`: Linux SSH on port 22
- `desktop-5060`: Ubuntu WSL SSH on port 2222
- `desktop-5060-windows`: Windows OpenSSH/PowerShell on port 2224

This is already an encrypted node-to-node channel. The app does not implement
the Tailscale protocol and does not expose an arbitrary shell API.

## Protocol boundary

The Rust command `get_node_catalog` exposes protocol version `0.1`, stable node
IDs, endpoint kinds, and a fixed capability list. Future Node Agent work should
implement only these named operations:

`status`, `capabilities`, `terminal`, `powershell`, `gpu`, `training-job`,
`file-browse`, and `sync-checkpoint`.

Each operation must use a structured request/response and be authorized by the
node ID and capability list. User-provided executable paths, shell fragments,
or raw command strings must not cross this boundary.

## Extension path

The current SSH transport can later be replaced or supplemented by a small
Node Agent on each host. The agent should listen only on its Tailscale address,
use the same node IDs and capability names, and expose health plus job APIs.
The UI and task model can then remain unchanged while adding Docker, systemd,
ROS2, Wake-on-LAN, queues, and checkpoint transfer.
