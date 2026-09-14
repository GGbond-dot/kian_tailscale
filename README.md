# Kian Remote Lab

Kian Remote Lab is a Windows Tauri desktop app and VS Code companion extension for a private Tailscale lab.

Version 0.2.0 manages two fixed, allowlisted nodes:

| Node | Tailscale hostname | SSH | Purpose |
| --- | --- | --- | --- |
| DK2500 | `dk2500` | `kian@<current-ip>:22` | Linux server |
| Desktop 5060 WSL | `desktop-ltuqmcm` | `kian@<current-ip>:2222` | RTX 5060 / Ubuntu 22.04 on WSL2 |
| Desktop 5060 Windows | `desktop-ltuqmcm` | `kian@<current-ip>:2224` | Windows host / PowerShell |

The current Tailscale IP is always read from local `tailscale.exe status --json` output. No node IP is hardcoded into an SSH command.

## Features

- Refreshes both nodes every 4 seconds and shows Online, IP, hostname, OS, and role.
- Embedded xterm.js terminals backed by Windows ConPTY and `ssh.exe`.
- Multiple terminal tabs inside one App window.
- Interactive SSH, Ctrl+C, ANSI color, resize, and full-screen terminal programs.
- Opens a selected node with VS Code Remote - SSH.
- VS Code side panel with per-node Open Code and Terminal actions.
- Does not read, transmit, or store SSH passwords.
- Backends accept only fixed device IDs; the UI cannot submit an arbitrary executable, host, user, port, or shell command.

## Install on the laptop

Prebuilt 0.2.0 downloads are committed for machines that do not have the Tauri build toolchain:

- [Windows MSI](release/Kian%20Remote%20Lab_0.2.0_x64_en-US.msi)
- [VS Code VSIX](release/kian-remote-lab-0.2.0.vsix)
- [SHA-256 checksums](release/SHA256SUMS.txt)

Prerequisites:

- Tailscale, logged in to the same tailnet
- Windows OpenSSH Client
- Visual Studio Code plus `ms-vscode-remote.remote-ssh`
- Git, Node.js 20.19+ or 22.12+, Rust stable MSVC
- Visual Studio 2022 Build Tools with Desktop development with C++, MSVC, and a Windows SDK
- WebView2 Runtime

Visual Studio Build Tools supplies the compiler/linker used by Rust/Tauri; the full Visual Studio IDE is not required.

```powershell
git clone https://github.com/GGbond-dot/kian_tailscale.git
cd kian_tailscale
npm ci
npm --prefix vscode-extension ci
npm run verify
npm run build
npm run extension:package
```

Install the generated artifacts:

```powershell
Start-Process ".\release\Kian Remote Lab_0.2.0_x64_en-US.msi"
code --install-extension .\release\kian-remote-lab-0.2.0.vsix --force
```

The exact MSI filename can vary slightly; it is always under `src-tauri/target/release/bundle/msi/`.

### First laptop SSH key setup

The App supports an interactive password prompt, so the first connection works without saving a password. To switch the laptop to key authentication:

```powershell
if (-not (Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub)) {
  ssh-keygen -t ed25519
}
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub |
  ssh -p 2222 kian@desktop-ltuqmcm "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

Enter the WSL password once. Repeat the equivalent command for DK2500 on port 22 if needed. Never commit a private key.

## Desktop 5060 GPU node

The training environment is native Linux tooling inside Ubuntu 22.04 on WSL2. Windows keeps the NVIDIA driver and Tailscale client; WSL does not run a second Tailscale client.

On Desktop 5060, run from a normal PowerShell window:

```powershell
.\scripts\gpu-node\setup-wsl.ps1 -KeepHostAwake
```

`-KeepHostAwake` disables automatic sleep and hibernation while the PC is on
AC power. It does not change the display timeout, so the monitor can still turn
off. Omit the switch if the PC should retain its normal automatic sleep policy.

The idempotent setup:

- installs and enables OpenSSH Server, Git, rsync, Python venv/pip, and tmux in WSL;
- creates `~/projects`, `~/datasets`, and `~/checkpoints`;
- exposes WSL's NVIDIA `nvidia-smi`;
- imports the current Windows user's public Ed25519 key when present;
- installs a fixed local bridge at `%LOCALAPPDATA%\KianRemoteLab\gpu-node`;
- creates the silent current-user scheduled task `Kian Remote Lab GPU Bridge`;
- exposes only Tailscale TCP 2222 to that bridge.

The bridge listens only on Windows `127.0.0.1:2223`, discovers the current Ubuntu WSL NAT address, and forwards only to SSH port 22. Tailscale Serve is the only tailnet-facing entry point. The task checks the bridge once per minute while the Windows user is logged in, and a cold SSH request can start WSL automatically. The bridge also holds an explicit hidden WSL process because systemd services alone do not keep a WSL distribution alive. The desktop App does not need to be open: the hidden bridge task and the Tailscale Windows service provide the background path.

A Windows PC that is actually asleep cannot accept a Tailscale connection;
background residency cannot override system sleep. With `-KeepHostAwake`, leave
the PC signed in and connected to AC for unattended access. A manual sleep,
restart, Wi-Fi outage, or WSL restart can still interrupt an existing TCP/SSH
session. SSH keepalives tolerate interruptions of up to about ten minutes, but
long-running work should be started inside `tmux` so it survives a reconnect.

To expose the Windows host itself (PowerShell), run `scripts/gpu-node/setup-windows-ssh.ps1` once from an elevated PowerShell on Desktop 5060. It installs/configures Windows OpenSSH on Tailscale TCP 2224, sets PowerShell as the default shell, and enables password login for first-time key bootstrap. The app itself never stores the password; after confirming key login, set `PasswordAuthentication no` in `%ProgramData%\ssh\sshd_config` and restart `sshd`. The app then shows a separate **Desktop 5060 Windows** target; use WSL for Linux/GPU tools and Windows for host administration, filesystem, services, and PowerShell commands.

Health checks:

```powershell
schtasks /Query /TN "Kian Remote Lab GPU Bridge" /V /FO LIST
& 'C:\Program Files\Tailscale\tailscale.exe' serve status
ssh -p 2222 kian@desktop-ltuqmcm
```

If an existing terminal disconnects, check whether Windows or WSL restarted:

```powershell
powercfg /GetActiveScheme
Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,42,107} -MaxEvents 20
wsl -d Ubuntu-22.04 -- systemctl status ssh --no-pager
```

## Development

### Remote - SSH compatibility

If Open Code waits forever before `ssh.exe` starts, inspect `Remote - SSH: Show Log`. A `PendingMigrationError: navigator is now a global in nodejs` is an upstream VS Code/Remote-SSH compatibility issue, not an SSH authentication failure. Update VS Code and Remote - SSH (including its pre-release channel when appropriate). The embedded App terminal is independent of the VS Code extension host and remains available. Upstream tracking: [microsoft/vscode-remote-release#11741](https://github.com/Microsoft/vscode-remote-release/issues/11741).

```powershell
npm ci
npm --prefix vscode-extension ci
npm run verify
npm run dev
```

Release build:

```powershell
npm run build
npm run extension:package
```

Useful paths:

- `src/`: HTML/CSS/JS and xterm.js frontend
- `src-tauri/src/device.rs`: fixed node allowlist
- `src-tauri/src/tailscale.rs`: local Tailscale CLI and JSON parsing
- `src-tauri/src/terminal.rs`: controlled OpenSSH/ConPTY sessions
- `src-tauri/src/vscode.rs`: VS Code Remote - SSH launcher
- `vscode-extension/`: VS Code side panel extension
- `scripts/gpu-node/`: repeatable Desktop 5060 WSL setup

## VS Code placement

VS Code extensions cannot force themselves into the Secondary Side Bar. Drag the Kian Remote Lab Activity Bar icon to the right beside Codex/Copilot once; VS Code remembers the layout.
