"use strict";

const DEVICES = Object.freeze([
  Object.freeze({
    id: "dk2500",
    displayName: "DK2500",
    role: "Linux Server",
    tailscaleHostname: "dk2500",
    sshUser: "kian",
    sshPort: 22,
    remoteFolder: "/home/kian",
  }),
  Object.freeze({
    id: "desktop-5060",
    displayName: "Desktop 5060",
    role: "GPU / WSL2",
    tailscaleHostname: "desktop-ltuqmcm",
    sshUser: "kian",
    sshPort: 2222,
    remoteFolder: "/home/kian",
  }),
]);

function deviceProfile(deviceId) {
  const profile = DEVICES.find((device) => device.id === deviceId);
  if (!profile) throw new Error("Unknown device identifier");
  return profile;
}

function sshAuthority(profile, ip) {
  const hostInfo = { hostName: ip, user: profile.sshUser };
  if (profile.sshPort !== 22) hostInfo.port = profile.sshPort;
  return Buffer.from(JSON.stringify(hostInfo), "utf8").toString("hex");
}

function sshDisplayTarget(profile, ip) {
  return `${profile.sshUser}@${ip}${profile.sshPort === 22 ? "" : `:${profile.sshPort}`}`;
}

module.exports = { DEVICES, deviceProfile, sshAuthority, sshDisplayTarget };
