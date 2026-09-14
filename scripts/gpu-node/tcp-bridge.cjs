"use strict";

const net = require("node:net");
const { execFileSync, spawn } = require("node:child_process");

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 2223;
const TARGET_PORT = 22;
const WSL_DISTRO = "Ubuntu-22.04";
const CONNECT_RETRY_MS = 250;
const MAX_CONNECT_ATTEMPTS = 40;
const KEEP_ALIVE_INITIAL_DELAY_MS = 15_000;
const WSL_KEEPER_RESTART_MS = 1_000;

let stopping = false;
let wslKeeper = null;
let wslKeeperRestart = null;

// systemd services do not keep a WSL distribution alive. Keep one process
// explicitly launched by Windows attached to this bridge so WSL does not
// idle-terminate underneath an established SSH connection.
function startWslKeeper() {
  if (stopping) return;
  const keeper = spawn(
    "wsl.exe",
    ["-d", WSL_DISTRO, "--exec", "/bin/sleep", "infinity"],
    { windowsHide: true, stdio: "ignore" },
  );
  wslKeeper = keeper;
  keeper.once("error", () => {});
  keeper.once("close", () => {
    if (wslKeeper === keeper) wslKeeper = null;
    if (!stopping) wslKeeperRestart = setTimeout(startWslKeeper, WSL_KEEPER_RESTART_MS);
  });
}

function wslAddress() {
  const output = execFileSync("wsl.exe", ["-d", WSL_DISTRO, "--", "hostname", "-I"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  const address = output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
  if (!address) throw new Error("Ubuntu-22.04 did not return a WSL IPv4 address");
  return address;
}

function connectUpstream(client, attempt = 1) {
  if (client.destroyed) return;
  let targetHost;
  try {
    targetHost = wslAddress();
  } catch {
    if (attempt < MAX_CONNECT_ATTEMPTS && !client.destroyed) {
      setTimeout(() => connectUpstream(client, attempt + 1), CONNECT_RETRY_MS);
    } else {
      client.destroy();
    }
    return;
  }
  const upstream = net.createConnection({ host: targetHost, port: TARGET_PORT });

  upstream.once("connect", () => {
    client.setKeepAlive(true, KEEP_ALIVE_INITIAL_DELAY_MS);
    client.setNoDelay(true);
    upstream.setKeepAlive(true, KEEP_ALIVE_INITIAL_DELAY_MS);
    upstream.setNoDelay(true);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once("error", () => {
    upstream.destroy();
    if (attempt < MAX_CONNECT_ATTEMPTS && !client.destroyed) {
      setTimeout(() => connectUpstream(client, attempt + 1), CONNECT_RETRY_MS);
    } else {
      client.destroy();
    }
  });
  client.once("error", () => upstream.destroy());
  client.once("close", () => upstream.destroy());
}

const server = net.createServer(
  { keepAlive: true, keepAliveInitialDelay: KEEP_ALIVE_INITIAL_DELAY_MS, noDelay: true },
  (client) => connectUpstream(client),
);
server.on("error", (error) => {
  process.stderr.write(`Kian Remote Lab TCP bridge failed: ${error.message}\n`);
  process.exitCode = 1;
});

function stop() {
  if (stopping) return;
  stopping = true;
  if (wslKeeperRestart) clearTimeout(wslKeeperRestart);
  if (wslKeeper && !wslKeeper.killed) wslKeeper.kill();
  server.close(() => process.exit(0));
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
startWslKeeper();
server.listen(LISTEN_PORT, LISTEN_HOST);
