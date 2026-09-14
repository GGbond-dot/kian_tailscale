"use strict";

const vscode = require("vscode");
const { execFile } = require("child_process");
const { isIP } = require("node:net");
const { promisify } = require("util");
const { DEVICES, deviceProfile, sshAuthority } = require("./devices");
const { emptyOverview, isTailscaleIPv4, parseStatusJson } = require("./tailscale");

const execFileAsync = promisify(execFile);
const TAILSCALE_PATH = "C:\\Program Files\\Tailscale\\tailscale.exe";
const SSH_PATH = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
const REFRESH_INTERVAL_MS = 4_000;

class LabViewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.overview = emptyOverview();
    this.refreshTimer = undefined;
    this.refreshPromise = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => {
      if (message?.type === "refresh") this.refresh();
      if (message?.type === "openRemote") this.openRemote(message.deviceId);
      if (message?.type === "openTerminal") this.openTerminal(message.deviceId);
    });
    view.onDidDispose(() => this.stopPolling());
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.startPolling();
        this.refresh();
      } else {
        this.stopPolling();
      }
    });
    this.startPolling();
    this.refresh();
  }

  startPolling() {
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
    }
  }

  stopPolling() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const { stdout } = await execFileAsync(TAILSCALE_PATH, ["status", "--json"], {
          windowsHide: true,
          timeout: 8_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        this.overview = parseStatusJson(stdout);
      } catch (error) {
        this.overview = emptyOverview(error.code === "ENOENT" ? "Tailscale Not Found" : String(error.message || error));
        this.overview.tailscaleInstalled = error.code !== "ENOENT";
      }
      this.view?.webview.postMessage({ type: "status", value: this.overview });
      return this.overview;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  async selectedProfile(deviceId) {
    if (deviceId) return deviceProfile(deviceId);
    const selection = await vscode.window.showQuickPick(
      DEVICES.map((profile) => ({ label: profile.displayName, description: profile.role, profile })),
      { placeHolder: "Select a Kian Remote Lab node" },
    );
    return selection?.profile;
  }

  validatedTarget(profile) {
    if (!this.overview.tailscaleConnected) throw new Error("Tailscale is disconnected");
    const status = this.overview.devices.find((device) => device.id === profile.id);
    if (!status?.deviceFound || !status.online) throw new Error(`${profile.displayName} is offline`);
    if (!status.ip || isIP(status.ip) !== 4 || !isTailscaleIPv4(status.ip)) {
      throw new Error(`${profile.displayName} has no valid Tailscale IPv4 address`);
    }
    return { status, authority: sshAuthority(profile, status.ip) };
  }

  async openRemote(deviceId) {
    try {
      const profile = await this.selectedProfile(deviceId);
      if (!profile) return;
      await this.refresh();
      const { authority } = this.validatedTarget(profile);
      const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${authority}${profile.remoteFolder}`);
      await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Kian Remote Lab: ${error.message || error}`);
    }
  }

  async openTerminal(deviceId) {
    try {
      const profile = await this.selectedProfile(deviceId);
      if (!profile) return;
      await this.refresh();
      const { status, authority } = this.validatedTarget(profile);
      const expectedRemoteAuthority = `ssh-remote+${authority}`.toLowerCase();
      const remoteFolder = vscode.workspace.workspaceFolders?.find(
        (folder) => folder.uri.scheme === "vscode-remote"
          && decodeURIComponent(folder.uri.authority).toLowerCase() === expectedRemoteAuthority,
      );

      let terminal;
      if (vscode.env.remoteName) {
        if (!remoteFolder) throw new Error("This VS Code window is connected to a different remote host");
        terminal = vscode.window.createTerminal({
          name: `${profile.displayName} · ${status.ip}`,
          cwd: remoteFolder.uri,
          iconPath: new vscode.ThemeIcon("remote"),
        });
      } else {
        const shellArgs = ["-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];
        if (profile.sshPort !== 22) shellArgs.push("-p", String(profile.sshPort));
        shellArgs.push(`${profile.sshUser}@${status.ip}`);
        terminal = vscode.window.createTerminal({
          name: `${profile.displayName} · ${status.ip}`,
          shellPath: SSH_PATH,
          shellArgs,
          iconPath: new vscode.ThemeIcon("remote"),
        });
      }
      terminal.show();
    } catch (error) {
      vscode.window.showErrorMessage(`Kian Remote Lab: ${error.message || error}`);
    }
  }

  html(webview) {
    const nonce = nonceValue();
    return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  *{box-sizing:border-box}body{padding:12px;color:var(--vscode-foreground);font-family:var(--vscode-font-family)}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:13px}.mark{display:grid;width:32px;height:32px;place-items:center;border:1px solid var(--vscode-focusBorder);border-radius:8px;color:var(--vscode-testing-iconPassed);font-weight:800}.eyebrow{color:var(--vscode-descriptionForeground);font-size:9px;letter-spacing:.13em}.title{font-size:15px;font-weight:700}
  .tailnet,.node{border:1px solid var(--vscode-widget-border);border-radius:7px;background:var(--vscode-sideBar-background)}.tailnet{display:flex;align-items:center;gap:9px;padding:9px 10px}.nodes{display:grid;gap:9px;margin-top:9px}.node{padding:10px}.node-head{display:flex;align-items:center;gap:9px}.node-title{font-size:12px;font-weight:700}.label{color:var(--vscode-descriptionForeground);font-size:9px;letter-spacing:.1em}.meta{display:grid;gap:4px;margin:9px 0;padding:8px;border-radius:5px;background:var(--vscode-editor-background);font-family:var(--vscode-editor-font-family);font-size:10px}.value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:var(--vscode-disabledForeground)}.dot.online{background:var(--vscode-testing-iconPassed)}.dot.offline{background:var(--vscode-testing-iconFailed)}
  .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}button{padding:7px 5px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer;font-size:10px}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}button:disabled{opacity:.45;cursor:not-allowed}.message{margin-top:10px;color:var(--vscode-descriptionForeground);font-size:9px;line-height:1.45}
</style></head><body>
  <div class="brand"><div class="mark">K</div><div><div class="eyebrow">MULTI-NODE LAB</div><div class="title">Kian Remote Lab</div></div></div>
  <div class="tailnet"><span id="tailscale-dot" class="dot"></span><div><div class="label">TAILSCALE</div><div id="tailscale">Checking...</div></div></div>
  <div class="nodes">
    <section class="node" data-node="dk2500"><div class="node-head"><span class="dot node-dot"></span><div><div class="node-title">DK2500</div><div class="label">LINUX SERVER</div></div></div><div class="meta"><div class="value node-state">Checking...</div><div class="value node-ip">—</div><div class="value node-details">—</div></div><div class="actions"><button data-action="openRemote">Open Code</button><button class="secondary" data-action="openTerminal">Terminal</button></div></section>
    <section class="node" data-node="desktop-5060"><div class="node-head"><span class="dot node-dot"></span><div><div class="node-title">Desktop 5060</div><div class="label">GPU / WSL2</div></div></div><div class="meta"><div class="value node-state">Checking...</div><div class="value node-ip">—</div><div class="value node-details">—</div></div><div class="actions"><button data-action="openRemote">Open Code</button><button class="secondary" data-action="openTerminal">Terminal</button></div></section>
    <section class="node" data-node="desktop-5060-windows"><div class="node-head"><span class="dot node-dot"></span><div><div class="node-title">Desktop 5060 Windows</div><div class="label">POWERSHELL / HOST</div></div></div><div class="meta"><div class="value node-state">Checking...</div><div class="value node-ip">—</div><div class="value node-details">—</div></div><div class="actions"><button data-action="openRemote">Open Code</button><button class="secondary" data-action="openTerminal">Terminal</button></div></section>
  </div>
  <div id="message" class="message">Reads local Tailscale status every 4 seconds.</div>
  <script nonce="${nonce}">
    const api=acquireVsCodeApi(),byId=(id)=>document.getElementById(id);
    document.body.addEventListener('click',(event)=>{const button=event.target.closest('button[data-action]');if(!button)return;const node=button.closest('[data-node]');api.postMessage({type:button.dataset.action,deviceId:node.dataset.node});});
    addEventListener('message',({data})=>{if(data.type!=='status')return;const o=data.value;byId('tailscale').textContent=!o.tailscaleInstalled?'Not Found':o.tailscaleConnected?'Connected':'Disconnected';byId('tailscale-dot').className='dot '+(o.tailscaleConnected?'online':'offline');for(const s of o.devices){const node=document.querySelector('[data-node="'+s.id+'"]');if(!node)continue;const ready=o.tailscaleConnected&&s.online&&s.ip;node.querySelector('.node-dot').className='dot node-dot '+(s.online?'online':'offline');node.querySelector('.node-state').textContent=!s.deviceFound?'Not Found':s.online?'Online':'Offline';node.querySelector('.node-ip').textContent=s.ip?(s.ip+(s.sshPort===22?'':':'+s.sshPort)):'—';node.querySelector('.node-details').textContent=[s.hostname,s.os].filter(Boolean).join(' · ')||'—';for(const button of node.querySelectorAll('button'))button.disabled=!ready;}byId('message').textContent=o.error||'Auto refresh · 4s';});
  </script>
</body></html>`;
  }
}

function nonceValue() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz9876543210";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function activate(context) {
  const provider = new LabViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("kianRemoteLab.dashboard", provider),
    vscode.commands.registerCommand("kianRemoteLab.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("kianRemoteLab.openRemote", () => provider.openRemote()),
    vscode.commands.registerCommand("kianRemoteLab.openTerminal", () => provider.openTerminal()),
    { dispose: () => provider.stopPolling() },
  );

  if (!context.globalState.get("secondarySidebarHintShown")) {
    context.globalState.update("secondarySidebarHintShown", true);
    vscode.window.showInformationMessage(
      "Kian Remote Lab is ready. Drag its Activity Bar icon to the right Secondary Side Bar to place it beside Copilot and Codex.",
    );
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
