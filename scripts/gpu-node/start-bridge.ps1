$ErrorActionPreference = "Stop"

$BridgeScript = (Resolve-Path (Join-Path $PSScriptRoot "tcp-bridge.cjs")).Path
$TailscalePath = "C:\Program Files\Tailscale\tailscale.exe"
$BridgePort = 2223

if (-not (Test-Path -LiteralPath $TailscalePath)) {
    throw "Tailscale was not found at $TailscalePath"
}

$listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (-not $listenerProcess -or $listenerProcess.CommandLine -notlike "*$BridgeScript*") {
        throw "Port $BridgePort is occupied by a process other than the Kian Remote Lab bridge."
    }
} else {
    $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $bridgeProcess = Start-Process -FilePath $NodePath -ArgumentList @("`"$BridgeScript`"") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru

    $ready = $false
    foreach ($attempt in 1..40) {
        Start-Sleep -Milliseconds 250
        if ($bridgeProcess.HasExited) {
            throw "The Kian Remote Lab bridge exited before opening port $BridgePort."
        }
        if (Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
        throw "The Kian Remote Lab bridge did not open port $BridgePort."
    }

    & $TailscalePath serve --bg --yes --tcp=2222 "tcp://127.0.0.1:$BridgePort"
    if ($LASTEXITCODE -ne 0) {
        throw "tailscale.exe failed with exit code $LASTEXITCODE"
    }
}
