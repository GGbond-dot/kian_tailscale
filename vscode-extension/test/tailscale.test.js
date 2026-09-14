"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEVICES, deviceProfile, sshAuthority, sshDisplayTarget } = require("../devices");
const { emptyOverview, isTailscaleIPv4, parseStatusJson } = require("../tailscale");

test("parses the Windows self node and DK2500 peer", () => {
  const overview = parseStatusJson(JSON.stringify({
    BackendState: "Running",
    Self: {
      HostName: "desktop-ltuqmcm",
      Online: true,
      OS: "windows",
      TailscaleIPs: ["100.90.202.5", "fd7a:115c:a1e0::1"],
    },
    Peer: {
      first: {
        HostName: "dk2500",
        Online: true,
        OS: "linux",
        TailscaleIPs: ["100.68.98.65"],
      },
    },
  }));

  assert.equal(overview.tailscaleConnected, true);
  assert.deepEqual(
    overview.devices.map(({ id, online, ip, os, sshPort }) => ({ id, online, ip, os, sshPort })),
    [
      { id: "dk2500", online: true, ip: "100.68.98.65", os: "linux", sshPort: 22 },
      { id: "desktop-5060", online: true, ip: "100.90.202.5", os: "windows", sshPort: 2222 },
      { id: "desktop-5060-windows", online: true, ip: "100.90.202.5", os: "windows", sshPort: 2224 },
    ],
  );
});

test("keeps a configured node visible when it is absent", () => {
  const overview = parseStatusJson('{"BackendState":"Stopped","Peer":{}}');

  assert.equal(overview.tailscaleConnected, false);
  assert.equal(overview.devices.length, DEVICES.length);
  assert.equal(overview.devices[0].deviceFound, false);
  assert.equal(overview.devices[1].ip, null);
});

test("only accepts Tailscale CGNAT IPv4 addresses", () => {
  assert.equal(isTailscaleIPv4("100.64.0.1"), true);
  assert.equal(isTailscaleIPv4("100.127.255.254"), true);
  assert.equal(isTailscaleIPv4("100.128.0.1"), false);
  assert.equal(isTailscaleIPv4("192.168.1.2"), false);
  assert.equal(isTailscaleIPv4("not-an-address"), false);
});

test("device IDs are allowlisted and SSH authorities include nonstandard ports", () => {
  const server = deviceProfile("dk2500");
  const gpu = deviceProfile("desktop-5060");
  assert.deepEqual(
    JSON.parse(Buffer.from(sshAuthority(server, "100.68.98.65"), "hex").toString("utf8")),
    { hostName: "100.68.98.65", user: "kian" },
  );
  assert.deepEqual(
    JSON.parse(Buffer.from(sshAuthority(gpu, "100.90.202.5"), "hex").toString("utf8")),
    { hostName: "100.90.202.5", user: "kian", port: 2222 },
  );
  assert.equal(
    sshDisplayTarget(gpu, "100.90.202.5"),
    "kian@100.90.202.5:2222",
  );
  assert.throws(() => deviceProfile("untrusted"), /Unknown device/);
});

test("empty overview carries an operational error", () => {
  const overview = emptyOverview("Tailscale Not Found");
  assert.equal(overview.tailscaleInstalled, true);
  assert.equal(overview.error, "Tailscale Not Found");
});
