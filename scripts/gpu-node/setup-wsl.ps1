param(
    [switch] $KeepHostAwake
)

$ErrorActionPreference = "Stop"

$Distro = "Ubuntu-22.04"
$TailscalePath = "C:\Program Files\Tailscale\tailscale.exe"
$BridgeInstallDirectory = Join-Path $env:LOCALAPPDATA "KianRemoteLab\gpu-node"
$ConfigWindows = (Resolve-Path (Join-Path $PSScriptRoot "60-kian-remote-lab.conf")).Path
$ConfigDrive = $ConfigWindows.Substring(0, 1).ToLowerInvariant()
$ConfigRest = $ConfigWindows.Substring(2).Replace("\", "/")
$ConfigSource = "/mnt/$ConfigDrive$ConfigRest"
$ConfigTarget = "/etc/ssh/sshd_config.d/60-kian-remote-lab.conf"
$PublicKeyWindows = Join-Path $env:USERPROFILE ".ssh\id_ed25519.pub"

function Invoke-Wsl {
    param([string[]] $Arguments)
    & wsl.exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "wsl.exe failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Tailscale {
    param([string[]] $Arguments)
    & $TailscalePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "tailscale.exe failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath $TailscalePath)) {
    throw "Tailscale was not found at $TailscalePath"
}

Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "apt-get", "update")
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "openssh-server", "rsync", "git", "curl", "ca-certificates", "python3-venv", "python3-pip", "tmux")
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "install", "-m", "0644", $ConfigSource, $ConfigTarget)
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "install", "-d", "-m", "0755", "-o", "kian", "-g", "kian", "/home/kian/projects", "/home/kian/datasets", "/home/kian/checkpoints")
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "ln", "-sfn", "/usr/lib/wsl/lib/nvidia-smi", "/usr/local/bin/nvidia-smi")

if (Test-Path -LiteralPath $PublicKeyWindows) {
    $PublicKeyResolved = (Resolve-Path -LiteralPath $PublicKeyWindows).Path
    $PublicKeyDrive = $PublicKeyResolved.Substring(0, 1).ToLowerInvariant()
    $PublicKeyRest = $PublicKeyResolved.Substring(2).Replace("\", "/")
    $PublicKeySource = "/mnt/$PublicKeyDrive$PublicKeyRest"
    $AuthorizedKeys = "/home/kian/.ssh/authorized_keys"

    Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "install", "-d", "-m", "0700", "-o", "kian", "-g", "kian", "/home/kian/.ssh")
    Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "touch", $AuthorizedKeys)
    Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "sort", "-u", "-o", $AuthorizedKeys, $AuthorizedKeys, $PublicKeySource)
    Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "chown", "kian:kian", $AuthorizedKeys)
    Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "chmod", "0600", $AuthorizedKeys)
} else {
    Write-Warning "No id_ed25519.pub was found. SSH password login remains available for first-time key setup."
}

Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "/usr/sbin/sshd", "-t")
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "systemctl", "enable", "ssh")
Invoke-Wsl @("-d", $Distro, "-u", "root", "--", "systemctl", "restart", "ssh")

New-Item -ItemType Directory -Path $BridgeInstallDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "tcp-bridge.cjs") -Destination $BridgeInstallDirectory -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-bridge.ps1") -Destination $BridgeInstallDirectory -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-bridge-hidden.vbs") -Destination $BridgeInstallDirectory -Force

$BridgeLauncher = Join-Path $BridgeInstallDirectory "start-bridge.ps1"
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $BridgeLauncher
if ($LASTEXITCODE -ne 0) {
    throw "Unable to start the GPU node bridge"
}

$SilentLauncher = Join-Path $BridgeInstallDirectory "start-bridge-hidden.vbs"
$TaskCommand = "wscript.exe //B //NoLogo `"$SilentLauncher`""
& schtasks.exe /Create /F /TN "Kian Remote Lab GPU Bridge" /SC MINUTE /MO 1 /TR $TaskCommand
if ($LASTEXITCODE -ne 0) {
    throw "Unable to register the GPU node bridge startup task"
}

if ($KeepHostAwake) {
    # A sleeping Windows host cannot receive Tailscale traffic or keep WSL
    # sessions alive. Disable automatic sleep/hibernate only while on AC;
    # display timeout remains unchanged and manual sleep still works.
    & powercfg.exe /Change standby-timeout-ac 0
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to disable automatic sleep while the host is on AC power"
    }
    & powercfg.exe /Change hibernate-timeout-ac 0
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to disable automatic hibernation while the host is on AC power"
    }
    Write-Host "Automatic sleep and hibernation are disabled while this host is on AC power."
}

Invoke-Wsl @("-d", $Distro, "--", "nvidia-smi", "--query-gpu=name,driver_version,compute_cap,memory.total", "--format=csv,noheader")
Invoke-Tailscale @("serve", "status")
