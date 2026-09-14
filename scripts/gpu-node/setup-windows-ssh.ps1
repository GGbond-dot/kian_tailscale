$ErrorActionPreference = "Stop"

# Run this script from an elevated PowerShell on Desktop 5060.
# It exposes a constrained, key-authenticated Windows OpenSSH endpoint on
# Tailscale TCP 2224. WSL remains on TCP 2222.
$SshdConfig = "$env:ProgramData\ssh\sshd_config"
$AuthorizedKeys = "$env:USERPROFILE\.ssh\authorized_keys"
$PublicKey = "$env:USERPROFILE\.ssh\id_ed25519.pub"
$Port = 2224

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run as Administrator." }

if (-not (Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0).State -eq "Installed") {
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
}
New-Item -ItemType Directory -Force -Path "$env:ProgramData\ssh", (Split-Path $AuthorizedKeys) | Out-Null
if (Test-Path $PublicKey) {
  $existing = if (Test-Path $AuthorizedKeys) { Get-Content $AuthorizedKeys } else { @() }
  $line = (Get-Content $PublicKey -Raw).Trim()
  if ($line -and $existing -notcontains $line) { Add-Content -Path $AuthorizedKeys -Value $line }
}
$lines = if (Test-Path $SshdConfig) { Get-Content $SshdConfig } else { @() }
$lines = @($lines | Where-Object { $_ -notmatch '^\s*(Port|PasswordAuthentication|PubkeyAuthentication|AllowUsers|Subsystem|Match)\b' })
$lines += @("Port $Port", "PubkeyAuthentication yes", "PasswordAuthentication yes", "AllowUsers $env:USERNAME", "Subsystem sftp sftp-server.exe")
Set-Content -Path $SshdConfig -Value $lines -Encoding ascii
& "$env:WINDIR\System32\OpenSSH\sshd.exe" -t -f $SshdConfig
New-Item -Path "HKLM:\SOFTWARE\OpenSSH" -Force | Out-Null
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force | Out-Null
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd -ErrorAction SilentlyContinue
New-NetFirewallRule -Name "OpenSSH-Server-In-TCP-2224-KianRemoteLab" -DisplayName "Kian Remote Lab Windows SSH" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any -ErrorAction SilentlyContinue | Out-Null

$tailscale = "C:\Program Files\Tailscale\tailscale.exe"
if (Test-Path $tailscale) { & $tailscale serve --bg --yes --tcp=$Port "tcp://127.0.0.1:$Port" }
Write-Host "Windows SSH is ready on Tailscale TCP $Port. Test: ssh -p $Port $env:USERNAME@<desktop-tailscale-ip>"
