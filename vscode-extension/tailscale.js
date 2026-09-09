"use strict";

const { isIP } = require("node:net");

function emptyStatus(error = null) {
  return {
    tailscaleInstalled: true,
    tailscaleConnected: false,
    deviceFound: false,
    online: false,
    ip: null,
    hostname: null,
    os: null,
    error,
  };
}

function parseStatusJson(json, targetHostname = "dk2500") {
  const raw = JSON.parse(json);
  const peers = Object.values(raw.Peer || {});
  const peer = peers.find(
    (item) => String(item.HostName || "").toLowerCase() === targetHostname.toLowerCase(),
  );
  const base = emptyStatus();
  base.tailscaleConnected = String(raw.BackendState || "").toLowerCase() === "running";
  if (!peer) return base;

  const addresses = Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : [];
  return {
    ...base,
    deviceFound: true,
    online: peer.Online === true,
    ip: addresses.find((address) => isIP(address) === 4 && address.startsWith("100.")) || null,
    hostname: peer.HostName || null,
    os: peer.OS || null,
  };
}

module.exports = { emptyStatus, parseStatusJson };
