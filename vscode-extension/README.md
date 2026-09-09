# Kian Remote Lab for VS Code

面向 DK2500 的本地 VS Code 侧边栏扩展。

- 每 4 秒通过本机 Tailscale CLI 刷新设备状态
- 自动读取 DK2500 当前 Tailscale IP、Hostname 和 OS
- 使用 VS Code Remote SSH 打开 `/home/kian`
- 从本地窗口创建 DK2500 SSH Terminal
- 在已经连接 DK2500 的窗口中直接创建远端 Linux Terminal
- 不读取或保存 SSH 密码

安装后，Kian Remote Lab 会显示在 Activity Bar。将 K 图标拖到右侧 Secondary Side Bar 一次后，VS Code 会记住位置。

## Build

```powershell
npm ci
npm run lint
npm test
npm run package
```

安装生成的 VSIX：

```powershell
code --install-extension .\kian-remote-lab-0.1.1.vsix --force
```
