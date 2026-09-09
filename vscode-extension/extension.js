"use strict";

const vscode = require("vscode");
const { execFile } = require("child_process");
const { isIP } = require("node:net");
const { promisify } = require("util");
const { emptyStatus, parseStatusJson } = require("./tailscale");

const execFileAsync = promisify(execFile);
const TAILSCALE_PATH = "C:\\Program Files\\Tailscale\\tailscale.exe";
const SSH_PATH = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
const SSH_USER = "kian";
const REMOTE_FOLDER = "/home/kian";
const REFRESH_INTERVAL_MS = 4_000;

class LabViewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.status = emptyStatus();
    this.refreshTimer = undefined;
    this.refreshPromise = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => {
      if (message?.type === "refresh") this.refresh();
      if (message?.type === "openRemote") this.openRemote();
      if (message?.type === "openTerminal") this.openTerminal();
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
        this.status = parseStatusJson(stdout);
      } catch (error) {
        this.status = emptyStatus(error.code === "ENOENT" ? "Tailscale Not Found" : String(error.message || error));
        this.status.tailscaleInstalled = error.code !== "ENOENT";
      }
      this.postStatus();
      return this.status;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  postStatus() {
    this.view?.webview.postMessage({ type: "status", value: this.status });
  }

  validatedTarget() {
    if (!this.status.tailscaleConnected) throw new Error("Tailscale is disconnected");
    if (!this.status.deviceFound || !this.status.online) throw new Error("DK2500 is offline");
    if (!this.status.ip || isIP(this.status.ip) !== 4 || !this.status.ip.startsWith("100.")) {
      throw new Error("DK2500 has no valid Tailscale IPv4 address");
    }
    return `${SSH_USER}@${this.status.ip}`;
  }

  async openRemote() {
    try {
      await this.refresh();
      const target = this.validatedTarget();
      const uri = vscode.Uri.parse(`vscode-remote://ssh-remote+${target}${REMOTE_FOLDER}`);
      await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Kian Remote Lab: ${error.message || error}`);
    }
  }

  async openTerminal() {
    try {
      await this.refresh();
      const target = this.validatedTarget();
      const remoteFolder = vscode.workspace.workspaceFolders?.find(
        (folder) => folder.uri.scheme === "vscode-remote"
          && decodeURIComponent(folder.uri.authority).toLowerCase() === `ssh-remote+${target}`.toLowerCase(),
      );

      let terminal;
      if (vscode.env.remoteName) {
        if (!remoteFolder) {
          throw new Error("This VS Code window is connected to a different remote host");
        }
        terminal = vscode.window.createTerminal({
          name: `DK2500 · ${this.status.ip}`,
          cwd: remoteFolder.uri,
          iconPath: new vscode.ThemeIcon("remote"),
        });
      } else {
        terminal = vscode.window.createTerminal({
          name: `DK2500 · ${this.status.ip}`,
          shellPath: SSH_PATH,
          shellArgs: ["-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", target],
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
  *{box-sizing:border-box}body{padding:14px;color:var(--vscode-foreground);font-family:var(--vscode-font-family)}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}.mark{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--vscode-focusBorder);border-radius:8px;color:var(--vscode-testing-iconPassed);font-weight:800}.eyebrow{color:var(--vscode-descriptionForeground);font-size:10px;letter-spacing:.13em}.title{font-size:16px;font-weight:700}
  .card{border:1px solid var(--vscode-widget-border);border-radius:8px;background:var(--vscode-sideBar-background);overflow:hidden}.row{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid var(--vscode-widget-border)}.row:last-child{border-bottom:0}.row>div{min-width:0}.label{color:var(--vscode-descriptionForeground);font-size:9px;letter-spacing:.12em}.value{overflow:hidden;margin-top:3px;font-family:var(--vscode-editor-font-family);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:var(--vscode-disabledForeground)}.dot.online{background:var(--vscode-testing-iconPassed)}.dot.offline{background:var(--vscode-testing-iconFailed)}
  .actions{display:grid;gap:8px;margin-top:12px}button{width:100%;padding:9px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}button:disabled{opacity:.5;cursor:not-allowed}.message{margin-top:12px;color:var(--vscode-descriptionForeground);font-size:10px;line-height:1.45}
</style></head><body>
  <div class="brand"><div class="mark">K</div><div><div class="eyebrow">REMOTE CONTROL</div><div class="title">Kian Remote Lab</div></div></div>
  <div class="card">
    <div class="row"><span id="tailscale-dot" class="dot"></span><div><div class="label">TAILSCALE</div><div id="tailscale" class="value">Checking...</div></div></div>
    <div class="row"><span id="device-dot" class="dot"></span><div><div class="label">DK2500</div><div id="device" class="value">Checking...</div></div></div>
    <div class="row"><div><div class="label">TAILSCALE IP</div><div id="ip" class="value">—</div></div></div>
    <div class="row"><div><div class="label">HOST / OS</div><div id="details" class="value">—</div></div></div>
  </div>
  <div class="actions"><button id="open" disabled>Open /home/kian</button><button id="terminal" class="secondary" disabled>New SSH Terminal</button><button id="refresh" class="secondary">Refresh</button></div>
  <div id="message" class="message">Reads status from the local Tailscale CLI every 4 seconds.</div>
  <script nonce="${nonce}">
    const vscode=acquireVsCodeApi();
    const byId=(id)=>document.getElementById(id);
    byId('open').addEventListener('click',()=>vscode.postMessage({type:'openRemote'}));
    byId('terminal').addEventListener('click',()=>vscode.postMessage({type:'openTerminal'}));
    byId('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
    addEventListener('message',({data})=>{if(data.type!=='status')return;const s=data.value;const ready=s.tailscaleConnected&&s.online&&s.ip;byId('tailscale').textContent=!s.tailscaleInstalled?'Not Found':s.tailscaleConnected?'Connected':'Disconnected';byId('device').textContent=!s.deviceFound?'Not Found':s.online?'Online':'Offline';byId('ip').textContent=s.ip||'—';byId('details').textContent=[s.hostname,s.os].filter(Boolean).join(' · ')||'—';byId('tailscale-dot').className='dot '+(s.tailscaleConnected?'online':'offline');byId('device-dot').className='dot '+(s.online?'online':'offline');byId('open').disabled=!ready;byId('terminal').disabled=!ready;byId('message').textContent=s.error||'Auto refresh · 4s';});
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
