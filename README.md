# Kian Remote Lab

Kian Remote Lab 是一个用于管理 DK2500 Linux 主机的 Windows 工具集，包含：

- Tauri 2 桌面 App
- VS Code 侧边栏扩展

两者都只调用本机 Tailscale CLI 和 Windows OpenSSH，不实现 Tailscale 协议，也不读取或保存 SSH 密码。

## 当前功能

### Windows 桌面 App V0.1

- 每 4 秒调用 `C:\Program Files\Tailscale\tailscale.exe status --json`
- 自动查找 hostname 为 `dk2500` 的设备
- 显示 Online、Tailscale IP、Hostname 和 OS
- 使用 `C:\Windows\System32\OpenSSH\ssh.exe` 和用户 `kian`
- xterm.js + `portable-pty`/ConPTY 内置交互式 SSH Terminal
- 支持 ANSI 颜色、Ctrl+C、窗口 resize 和多个终端标签
- 可直接用 VS Code Remote SSH 打开 DK2500 的 `/home/kian`

### VS Code 扩展 V0.1.1

- 在 Activity Bar 提供 Kian Remote Lab 状态视图
- 每 4 秒自动读取 DK2500 状态与当前 IP
- `Open /home/kian`：在新 VS Code Remote SSH 窗口打开远端目录
- `New SSH Terminal`：
  - 本地窗口通过 Windows `ssh.exe` 连接 DK2500
  - 已连接 DK2500 的 Remote SSH 窗口直接打开远端 Linux shell
- VS Code 不允许扩展强制指定 Secondary Side Bar。首次安装后，把 K 图标拖到右侧一次即可，VS Code 会记住布局

## 在另一台 Windows 电脑上搭建

### 1. 系统依赖

需要安装：

- Git
- Tailscale，并登录同一个 Tailnet
- Windows OpenSSH Client
- Visual Studio 2022 Build Tools：选择 `Desktop development with C++`、MSVC 工具集和 Windows SDK；不需要安装完整 Visual Studio IDE
- Rust stable MSVC toolchain
- Node.js `20.19+` 或 `22.12+`
- Microsoft Edge WebView2 Runtime（Windows 10/11 通常已经包含）
- VS Code
- VS Code 扩展 `Remote - SSH`（`ms-vscode-remote.remote-ssh`）

验证环境：

```powershell
git --version
rustc --version
cargo --version
node --version
npm --version
& 'C:\Program Files\Tailscale\tailscale.exe' status --json
& 'C:\Windows\System32\OpenSSH\ssh.exe' kian@100.68.98.65
```

SSH 命令中的 IP 仅用于首次人工验证；程序运行时会从 Tailscale JSON 自动读取当前 IP。

### 2. 克隆与安装依赖

```powershell
git clone https://github.com/GGbond-dot/kian_tailscale.git
cd kian_tailscale
npm ci
npm --prefix vscode-extension ci
```

### 3. 验证整个仓库

```powershell
npm run verify
```

该命令会运行前端语法检查、Rust fmt/clippy/test、VS Code 扩展 lint/test、前端构建和 VSIX 打包。

### 4. 运行和构建桌面 App

开发运行：

```powershell
npm run dev
```

构建 MSI：

```powershell
npm run build
```

主要产物：

- `src-tauri/target/release/kian-remote-lab.exe`
- `src-tauri/target/release/bundle/msi/`

### 5. 打包与安装 VS Code 扩展

```powershell
npm run extension:package
code --install-extension .\vscode-extension\kian-remote-lab-0.1.1.vsix --force
```

安装后执行一次 `Developer: Reload Window`。若想把扩展放到 Codex/Copilot 所在的右侧区域，将 Activity Bar 中的 K 图标拖到 Secondary Side Bar。

## 安全边界

- 不保存 SSH 密码，默认使用 Windows OpenSSH 的 key/agent 认证
- 前端不能传入任意可执行文件、用户名、IP 或 shell 参数
- Rust 后端只允许固定的 Tailscale 和 OpenSSH 路径
- SSH 目标 IP 必须来自 Tailscale JSON 并经过地址校验
- VS Code 扩展同样使用固定程序路径和固定用户 `kian`

## 目录结构

- `src/`：桌面 App HTML/CSS/JS 与 xterm.js 前端
- `src-tauri/src/tailscale.rs`：Tailscale CLI 调用与 JSON 解析
- `src-tauri/src/terminal.rs`：受控 OpenSSH/ConPTY 会话
- `src-tauri/src/vscode.rs`：打开 VS Code Remote SSH
- `vscode-extension/`：VS Code 侧边栏扩展、测试和图标
- `assets/`：桌面图标源文件

## 默认目标

- Hostname：`dk2500`（匹配时不区分大小写）
- SSH 用户：`kian`
- 远端目录：`/home/kian`
- 状态刷新：4 秒

当前机器已验证 Tailscale 状态读取与无密码 SSH key 登录成功。密钥属于每台 Windows 电脑的本地配置，不会提交到仓库；新电脑仍需自行配置 SSH key。
