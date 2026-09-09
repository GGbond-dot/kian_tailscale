import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const REFRESH_INTERVAL_MS = 4_000;
let refreshing = false;
let openingVsCode = false;
let currentStatus = null;
let activeTerminalId = null;
let terminalNumber = 0;
const workspaces = new Map();

const elements = {
  tailscaleDot: document.querySelector("#tailscale-dot"),
  tailscaleState: document.querySelector("#tailscale-state"),
  deviceDot: document.querySelector("#device-dot"),
  deviceState: document.querySelector("#device-state"),
  ip: document.querySelector("#ip-address"),
  hostname: document.querySelector("#hostname"),
  os: document.querySelector("#os"),
  message: document.querySelector("#status-message"),
  refresh: document.querySelector("#refresh"),
  newTerminal: document.querySelector("#new-terminal"),
  connect: document.querySelector("#connect"),
  connectLabel: document.querySelector(".connect-label"),
  openVsCode: document.querySelector("#open-vscode"),
  terminalTabs: document.querySelector("#terminal-tabs"),
  terminalStack: document.querySelector("#terminal-stack"),
  terminalTarget: document.querySelector("#terminal-target"),
};

function terminalOptions() {
  return {
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5_000,
    theme: {
      background: "#06090e", foreground: "#d9e1ec", cursor: "#62e6ac",
      cursorAccent: "#06090e", selectionBackground: "#314156", black: "#171d27",
      red: "#ef6c78", green: "#4bdd9d", yellow: "#dfb45f", blue: "#72a7f7",
      magenta: "#b89cf5", cyan: "#61d6e5", white: "#d9e1ec",
    },
  };
}

function setIndicator(dot, state) { dot.dataset.state = state; }
function canConnect() {
  return Boolean(currentStatus?.tailscaleConnected && currentStatus?.online && currentStatus?.ip);
}
function activeWorkspace() { return workspaces.get(activeTerminalId) ?? null; }

function updateActiveControls() {
  const workspace = activeWorkspace();
  const connected = workspace?.sessionId != null;
  elements.connectLabel.textContent = connected ? "Disconnect" : "Connect";
  elements.connect.classList.toggle("danger", connected);
  elements.connect.disabled = !workspace || workspace.connecting || (!connected && !canConnect());
  elements.openVsCode.disabled = openingVsCode || !canConnect();
  elements.terminalTarget.textContent = workspace?.target ?? "DISCONNECTED";
}

function render(status) {
  currentStatus = status;
  if (!status.tailscaleInstalled) {
    elements.tailscaleState.textContent = "Not Found";
    setIndicator(elements.tailscaleDot, "error");
  } else if (status.tailscaleConnected) {
    elements.tailscaleState.textContent = "Connected";
    setIndicator(elements.tailscaleDot, "online");
  } else {
    elements.tailscaleState.textContent = "Disconnected";
    setIndicator(elements.tailscaleDot, "offline");
  }
  if (!status.deviceFound) {
    elements.deviceState.textContent = "Not Found";
    setIndicator(elements.deviceDot, "offline");
  } else if (status.online) {
    elements.deviceState.textContent = "Online";
    setIndicator(elements.deviceDot, "online");
  } else {
    elements.deviceState.textContent = "Offline";
    setIndicator(elements.deviceDot, "offline");
  }
  elements.ip.textContent = status.ip ?? "--";
  elements.hostname.textContent = status.hostname ?? "--";
  elements.os.textContent = status.os ?? "--";
  elements.message.textContent = status.error
    ? status.error
    : `Status updated at ${new Date().toLocaleTimeString()}`;
  updateActiveControls();
}

async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;
  elements.refresh.disabled = true;
  try { render(await invoke("get_lab_status")); }
  catch (error) { elements.message.textContent = `Unable to read status: ${error}`; }
  finally { refreshing = false; elements.refresh.disabled = false; }
}

function resizeWorkspace(workspace) {
  if (!workspace.opened || workspace.clientId !== activeTerminalId || workspace.resizePending) return;
  workspace.resizePending = true;
  requestAnimationFrame(() => {
    workspace.resizePending = false;
    workspace.fitAddon.fit();
    if (workspace.sessionId != null && workspace.terminal.cols >= 2 && workspace.terminal.rows >= 2) {
      invoke("terminal_resize", {
        sessionId: workspace.sessionId,
        cols: workspace.terminal.cols,
        rows: workspace.terminal.rows,
      }).catch(() => {});
    }
  });
}

function activateTerminal(clientId) {
  if (!workspaces.has(clientId)) return;
  activeTerminalId = clientId;
  for (const workspace of workspaces.values()) {
    const active = workspace.clientId === clientId;
    workspace.container.classList.toggle("active", active);
    workspace.tab.classList.toggle("active", active);
    workspace.tab.setAttribute("aria-selected", String(active));
  }
  const workspace = workspaces.get(clientId);
  updateActiveControls();
  resizeWorkspace(workspace);
  if (workspace.opened) workspace.terminal.focus();
}

async function disconnectWorkspace(workspace, announce = true) {
  const sessionId = workspace.sessionId;
  if (sessionId == null) return;
  workspace.sessionId = null;
  workspace.target = "DISCONNECTED";
  workspace.tab.classList.remove("connected");
  if (workspace.clientId === activeTerminalId) updateActiveControls();
  try {
    await invoke("disconnect_ssh", { sessionId });
    if (announce) workspace.terminal.writeln("\r\n\x1b[90mSSH disconnected.\x1b[0m");
  } catch (error) {
    workspace.terminal.writeln(`\r\n\x1b[31mDisconnect error: ${error}\x1b[0m`);
  }
}

async function closeTerminal(clientId) {
  const workspace = workspaces.get(clientId);
  if (!workspace) return;
  await disconnectWorkspace(workspace, false);
  await workspace.ready;
  workspace.resizeObserver.disconnect();
  workspace.terminal.dispose();
  workspace.tab.remove();
  workspace.container.remove();
  workspaces.delete(clientId);
  if (activeTerminalId === clientId) {
    const replacement = Array.from(workspaces.keys()).at(-1);
    if (replacement) activateTerminal(replacement);
    else createTerminal();
  }
}

function createTerminal() {
  terminalNumber += 1;
  const clientId = crypto.randomUUID();
  for (const workspace of workspaces.values()) {
    workspace.container.classList.remove("active");
    workspace.tab.classList.remove("active");
  }
  activeTerminalId = clientId;
  const container = document.createElement("div");
  // xterm must be opened while its host is visible so it can measure glyphs
  // and create a correctly sized canvas.
  container.className = "terminal-pane active";
  container.setAttribute("role", "tabpanel");
  elements.terminalStack.append(container);

  const tab = document.createElement("button");
  tab.className = "terminal-tab";
  tab.type = "button";
  tab.setAttribute("role", "tab");
  const dot = document.createElement("span");
  dot.className = "terminal-tab-dot";
  const label = document.createElement("span");
  label.className = "terminal-tab-label";
  label.textContent = `Terminal ${terminalNumber}`;
  const close = document.createElement("span");
  close.className = "terminal-tab-close";
  close.textContent = "×";
  close.title = "Close terminal (Ctrl+Shift+W)";
  tab.append(dot, label, close);
  elements.terminalTabs.append(tab);

  const terminal = new Terminal(terminalOptions());
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const workspace = {
    clientId, sessionId: null, target: "DISCONNECTED", connecting: false,
    opened: false, resizePending: false, writeQueue: Promise.resolve(),
    terminal, fitAddon, container, tab,
  };
  workspace.resizeObserver = new ResizeObserver(() => resizeWorkspace(workspace));
  workspace.resizeObserver.observe(container);
  workspaces.set(clientId, workspace);

  terminal.onData((data) => {
    if (workspace.sessionId == null) return;
    const sessionId = workspace.sessionId;
    workspace.writeQueue = workspace.writeQueue
      .then(() => invoke("terminal_write", { sessionId, data }))
      .catch((error) => terminal.writeln(`\r\n\x1b[31mInput error: ${error}\x1b[0m`));
  });
  tab.addEventListener("click", (event) => {
    if (event.target === close) closeTerminal(clientId);
    else activateTerminal(clientId);
  });
  workspace.ready = new Promise((resolve) => {
    requestAnimationFrame(() => {
      terminal.open(container);
      workspace.opened = true;
      fitAddon.fit();
      terminal.writeln("\x1b[90mKian Remote Lab ready. Select Connect to start SSH.\x1b[0m");
      terminal.refresh(0, terminal.rows - 1);
      terminal.focus();
      resolve();
    });
  });
  activateTerminal(clientId);
  return workspace;
}

async function connectWorkspace(workspace) {
  if (workspace.connecting || workspace.sessionId != null || !canConnect()) return;
  workspace.connecting = true;
  if (workspace.clientId === activeTerminalId) updateActiveControls();
  await workspace.ready;
  workspace.terminal.reset();
  workspace.terminal.writeln("\x1b[90mStarting Windows OpenSSH through ConPTY...\x1b[0m");
  try {
    const connection = await invoke("connect_ssh", { terminalId: workspace.clientId });
    workspace.sessionId = connection.sessionId;
    workspace.target = connection.target.toUpperCase();
    workspace.tab.classList.add("connected");
    resizeWorkspace(workspace);
    workspace.terminal.focus();
  } catch (error) {
    workspace.terminal.writeln(`\r\n\x1b[31mConnection failed: ${error}\x1b[0m`);
  } finally {
    workspace.connecting = false;
    if (workspace.clientId === activeTerminalId) updateActiveControls();
  }
}

function createAndMaybeConnect() {
  const workspace = createTerminal();
  if (canConnect()) connectWorkspace(workspace);
}

async function toggleActiveConnection() {
  const workspace = activeWorkspace();
  if (!workspace || workspace.connecting) return;
  if (workspace.sessionId != null) await disconnectWorkspace(workspace);
  else await connectWorkspace(workspace);
}

async function openInVsCode() {
  if (openingVsCode || !canConnect()) return;
  openingVsCode = true;
  updateActiveControls();
  elements.message.textContent = "Opening DK2500 in VS Code...";
  try {
    const launch = await invoke("open_in_vscode");
    elements.message.textContent = `VS Code opening ${launch.target}:${launch.folder}`;
  } catch (error) {
    elements.message.textContent = `Unable to open VS Code: ${error}`;
  } finally {
    openingVsCode = false;
    updateActiveControls();
  }
}

function cycleTerminal(direction) {
  const ids = Array.from(workspaces.keys());
  if (ids.length < 2) return;
  const currentIndex = Math.max(0, ids.indexOf(activeTerminalId));
  activateTerminal(ids[(currentIndex + direction + ids.length) % ids.length]);
}

await listen("terminal-output", ({ payload }) => {
  const workspace = workspaces.get(payload.terminalId);
  if (workspace && (workspace.connecting || payload.sessionId === workspace.sessionId)) {
    workspace.terminal.write(Uint8Array.from(payload.data));
  }
});
await listen("terminal-exit", ({ payload }) => {
  const workspace = workspaces.get(payload.terminalId);
  if (!workspace || (!workspace.connecting && payload.sessionId !== workspace.sessionId)) return;
  workspace.terminal.writeln(`\r\n\x1b[90mSSH exited with code ${payload.exitCode}.\x1b[0m`);
  workspace.sessionId = null;
  workspace.connecting = false;
  workspace.target = "DISCONNECTED";
  workspace.tab.classList.remove("connected");
  if (workspace.clientId === activeTerminalId) updateActiveControls();
});

elements.connect.addEventListener("click", toggleActiveConnection);
elements.newTerminal.addEventListener("click", createAndMaybeConnect);
elements.openVsCode.addEventListener("click", openInVsCode);
elements.refresh.addEventListener("click", refreshStatus);
window.addEventListener("keydown", async (event) => {
  if (event.isComposing) return;
  const key = event.key.toLowerCase();

  if (event.ctrlKey && event.shiftKey && key === "t") {
    event.preventDefault();
    createAndMaybeConnect();
  } else if (event.ctrlKey && event.shiftKey && key === "w") {
    event.preventDefault();
    closeTerminal(activeTerminalId);
  } else if (event.ctrlKey && event.key === "Tab") {
    event.preventDefault();
    cycleTerminal(event.shiftKey ? -1 : 1);
  } else if (event.altKey && !event.ctrlKey && /^[1-9]$/.test(event.key)) {
    const workspace = Array.from(workspaces.values())[Number(event.key) - 1];
    if (workspace) {
      event.preventDefault();
      activateTerminal(workspace.clientId);
    }
  } else if (event.ctrlKey && event.shiftKey && key === "r") {
    event.preventDefault();
    refreshStatus();
  } else if (event.ctrlKey && event.shiftKey && key === "o") {
    event.preventDefault();
    openInVsCode();
  } else if (event.ctrlKey && event.shiftKey && event.key === "Enter") {
    event.preventDefault();
    toggleActiveConnection();
  } else if (event.ctrlKey && event.shiftKey && key === "c") {
    event.preventDefault();
    const selection = activeWorkspace()?.terminal.getSelection();
    if (selection) {
      try { await navigator.clipboard.writeText(selection); }
      catch (error) { elements.message.textContent = `Copy failed: ${error}`; }
    }
  } else if (event.ctrlKey && event.shiftKey && key === "v") {
    event.preventDefault();
    const workspace = activeWorkspace();
    if (workspace?.sessionId != null) {
      try { workspace.terminal.paste(await navigator.clipboard.readText()); }
      catch (error) { elements.message.textContent = `Paste failed: ${error}`; }
    }
  } else if (event.key === "F11") {
    event.preventDefault();
    invoke("toggle_fullscreen").catch((error) => {
      elements.message.textContent = `Fullscreen failed: ${error}`;
    });
  }
}, true);
window.addEventListener("beforeunload", () => {
  for (const workspace of workspaces.values()) {
    if (workspace.sessionId != null) {
      invoke("disconnect_ssh", { sessionId: workspace.sessionId }).catch(() => {});
    }
  }
});

createTerminal();
refreshStatus();
setInterval(refreshStatus, REFRESH_INTERVAL_MS);
