# Kian Remote Lab

Kian Remote Lab 是一个面向 Windows 的 Tauri 2 桌面应用，用于通过 Tailscale 管理 DK2500 Linux 主机。

## V0.1

- 每 4 秒调用本机 `C:\Program Files\Tailscale\tailscale.exe status --json`
- 自动查找 hostname 为 `dk2500` 的设备并显示 Online、IP、Hostname 和 OS
- 使用固定的 `C:\Windows\System32\OpenSSH\ssh.exe` 与用户 `kian`
- 使用 xterm.js + `portable-pty`（Windows ConPTY）提供 App 内交互终端
- 支持 ANSI 颜色、Ctrl+C、键盘输入和窗口 resize
- 支持 New Window 多开；每个窗口拥有独立 SSH/PTY 会话
- 窗口最大化时 Terminal 自动填充剩余空间
- 不读取或保存 SSH 密码；认证由 Windows OpenSSH 处理，默认优先使用 SSH key

前端不能指定任意程序或启动参数。后端只允许启动固定的 OpenSSH，并且目标 IP 必须来自 Tailscale JSON。

## 开发

需要 Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK、WebView2、Node.js 和 npm。

```powershell
npm install
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
npm run dev
npm run build
```

构建产物位于：

- `src-tauri/target/release/kian-remote-lab.exe`
- `src-tauri/target/release/bundle/msi/Kian Remote Lab_0.1.0_x64_en-US.msi`

## 目录

- `src/`：HTML、CSS、状态刷新与 xterm.js 前端
- `src-tauri/src/tailscale.rs`：固定 Tailscale CLI 调用与 JSON 解析
- `src-tauri/src/terminal.rs`：受控 OpenSSH/ConPTY 会话
- `assets/app-icon-source.png`：桌面图标原始资产

当前机器的非交互 key 测试返回 `Permission denied (publickey,password)`。要实现点击后无需密码直接登录，需要先确保 `ssh kian@100.68.98.65` 能使用本机 SSH key 成功认证。
