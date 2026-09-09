"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseStatusJson } = require("../tailscale");

test("finds DK2500 and prefers its Tailscale IPv4 address", () => {
  const status = parseStatusJson(JSON.stringify({
    BackendState: "Running",
    Peer: {
      abc: {
        HostName: "DK2500",
        OS: "linux",
        Online: true,
        TailscaleIPs: ["fd7a:115c:a1e0::1", "100.68.98.65"],
      },
    },
  }));
  assert.equal(status.tailscaleConnected, true);
  assert.equal(status.online, true);
  assert.equal(status.ip, "100.68.98.65");
  assert.equal(status.hostname, "DK2500");
  assert.equal(status.os, "linux");
});

test("reports a missing target without throwing", () => {
  const status = parseStatusJson('{"BackendState":"Running","Peer":{}}');
  assert.equal(status.deviceFound, false);
  assert.equal(status.ip, null);
});

test("rejects malformed addresses instead of constructing an SSH target", () => {
  const status = parseStatusJson(JSON.stringify({
    BackendState: "Running",
    Peer: {
      abc: {
        HostName: "dk2500",
        Online: true,
        TailscaleIPs: ["100.999.98.65", "not-an-ip"],
      },
    },
  }));
  assert.equal(status.deviceFound, true);
  assert.equal(status.ip, null);
});
