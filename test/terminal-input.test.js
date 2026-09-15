import test from "node:test";
import assert from "node:assert/strict";

import {
  installTerminalInputResidueGuard,
  isWindowsFocusReport,
  windowsNavigationInput,
} from "../src/terminal-input.js";

function workspaceWithTextarea() {
  const textarea = new EventTarget();
  textarea.value = "";
  return { terminal: { textarea }, composing: false };
}

test("clears text already committed by xterm", () => {
  const workspace = workspaceWithTextarea();
  installTerminalInputResidueGuard(workspace);
  workspace.terminal.textarea.value = "old command";

  workspace.clearCommittedInput();

  assert.equal(workspace.terminal.textarea.value, "");
  workspace.disposeInputGuard();
});

test("does not clear an active IME composition", () => {
  const workspace = workspaceWithTextarea();
  installTerminalInputResidueGuard(workspace);
  workspace.terminal.textarea.dispatchEvent(new Event("compositionstart"));
  workspace.terminal.textarea.value = "中文";

  workspace.clearCommittedInput();
  assert.equal(workspace.terminal.textarea.value, "中文");

  workspace.terminal.textarea.dispatchEvent(new Event("compositionend"));
  workspace.clearCommittedInput();
  assert.equal(workspace.terminal.textarea.value, "");
  workspace.disposeInputGuard();
});

test("suppresses only exact xterm focus reports for the Windows endpoint", () => {
  assert.equal(isWindowsFocusReport("desktop-5060-windows", "\x1b[I"), true);
  assert.equal(isWindowsFocusReport("desktop-5060-windows", "\x1b[O"), true);
  assert.equal(isWindowsFocusReport("desktop-5060-windows", "\x1b[I\x1b[O"), true);
  assert.equal(isWindowsFocusReport("desktop-5060-windows", "[I"), false);
  assert.equal(isWindowsFocusReport("desktop-5060-windows", "hello\x1b[I"), false);
  assert.equal(isWindowsFocusReport("desktop-5060", "\x1b[I"), false);
  assert.equal(isWindowsFocusReport("dk2500", "\x1b[O"), false);
});

test("maps Windows navigation keys to app-scoped PSReadLine controls", () => {
  const plain = (key) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("ArrowUp")), "\x10");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("ArrowDown")), "\x0e");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("ArrowLeft")), "\x02");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("ArrowRight")), "\x06");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("Home")), "\x01");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("End")), "\x05");
  assert.equal(windowsNavigationInput("desktop-5060-windows", plain("Delete")), "\x04");
  assert.equal(windowsNavigationInput("dk2500", plain("ArrowUp")), null);
  assert.equal(windowsNavigationInput("desktop-5060-windows", { ...plain("ArrowUp"), ctrlKey: true }), null);
});
