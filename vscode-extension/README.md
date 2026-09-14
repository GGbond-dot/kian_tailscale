# Kian Remote Lab for VS Code

A local VS Code side panel for the DK2500 Linux server and Desktop 5060 WSL2 GPU node.

- Reads the local Tailscale CLI every 4 seconds.
- Resolves current node IPs from Tailscale JSON.
- Opens either node through VS Code Remote - SSH.
- Creates a Windows `ssh.exe` terminal from a local window.
- Creates a native remote shell when the current VS Code window is already connected to that node.
- Uses Remote - SSH's normalized authority format, including Desktop 5060 port 2222.
- Does not read or save SSH passwords.

After installation, drag the K icon to the right Secondary Side Bar once if you want it beside Codex and Copilot.

## Build and install

```powershell
npm ci
npm run lint
npm test
npm run package
code --install-extension .\kian-remote-lab-0.2.0.vsix --force
```

Install Microsoft's `ms-vscode-remote.remote-ssh` extension before using Open Code.
