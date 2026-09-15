/**
 * xterm.js 6.0 can leave committed text in its hidden textarea. A later
 * Windows CJK IME key event may diff against that stale value and emit the
 * entire old line again. Track real composition state and clear only text
 * that xterm has already emitted through onData.
 */
export function installTerminalInputResidueGuard(workspace) {
  const textarea = workspace.terminal.textarea;
  if (!textarea) throw new Error("Terminal input textarea is unavailable");

  const compositionStart = () => { workspace.composing = true; };
  const compositionEnd = () => { workspace.composing = false; };
  textarea.addEventListener("compositionstart", compositionStart);
  textarea.addEventListener("compositionend", compositionEnd);

  workspace.clearCommittedInput = () => {
    if (!workspace.composing && textarea.value) textarea.value = "";
  };
  workspace.disposeInputGuard = () => {
    textarea.removeEventListener("compositionstart", compositionStart);
    textarea.removeEventListener("compositionend", compositionEnd);
  };
}

/**
 * Windows OpenSSH/ConPTY can echo xterm focus-in/focus-out reports as literal
 * shell input after the remote enables DECSET 1004. Linux TUIs consume these
 * reports correctly, so suppress only the two exact protocol packets for the
 * allowlisted Windows endpoint. Text typed by a user ("[I" or "[O" without
 * the leading ESC) is intentionally not matched.
 */
export function isWindowsFocusReport(deviceId, data) {
  return deviceId === "desktop-5060-windows" && /^(?:\x1b\[[IO])+$/.test(data);
}

/**
 * Windows OpenSSH passes VT navigation sequences to legacy ConPTY as an
 * Escape key followed by printable characters. The app's Windows PowerShell
 * bootstrap binds these control characters to the matching PSReadLine
 * actions, so translate only unmodified navigation keys for that endpoint.
 */
export function windowsNavigationInput(deviceId, event) {
  if (deviceId !== "desktop-5060-windows" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return null;
  }
  return {
    ArrowUp: "\x10", // Ctrl+P -> PreviousHistory
    ArrowDown: "\x0e", // Ctrl+N -> NextHistory
    ArrowLeft: "\x02", // Ctrl+B -> BackwardChar
    ArrowRight: "\x06", // Ctrl+F -> ForwardChar
    Home: "\x01", // Ctrl+A -> BeginningOfLine
    End: "\x05", // Ctrl+E -> EndOfLine
    Delete: "\x04", // Ctrl+D -> DeleteChar
  }[event.key] ?? null;
}
