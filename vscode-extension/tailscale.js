"use strict";

const { isIP } = require("node:net");
const { DEVICES } = require("./devices");

function unavailableDevice(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    role: profile.role,
    deviceFound: false,
    online: false,
    ip: null,
    hostname: null,
    os: null,
    sshPort: profile.sshPort,
  };
}

function emptyOverview(error = null) {
  return {
    tailscaleInstalled: true,
    tailscaleConnected: false,
    devices: DEVICES.map(unavailableDevice),
    error,
  };
}

function isTailscaleIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

function parseStatusJson(json) {
  const raw = JSON.parse(json);
  const nodes = [raw.Self, ...Object.values(raw.Peer || {})].filter(Boolean);
  const overview = emptyOverview();
  overview.tailscaleConnected = String(raw.BackendState || "").toLowerCase() === "running";
  overview.devices = DEVICES.map((profile) => {
    const node = nodes.find(
      (item) => String(item.HostName || "").toLowerCase() === profile.tailscaleHostname.toLowerCase(),
    );
    if (!node) return unavailableDevice(profile);
    const addresses = Array.isArray(node.TailscaleIPs) ? node.TailscaleIPs : [];
    return {
      ...unavailableDevice(profile),
      deviceFound: true,
      online: node.Online === true,
      ip: addresses.find(isTailscaleIPv4) || null,
      hostname: node.HostName || null,
      os: node.OS || null,
    };
  });
  return overview;
}

module.exports = { emptyOverview, isTailscaleIPv4, parseStatusJson };
