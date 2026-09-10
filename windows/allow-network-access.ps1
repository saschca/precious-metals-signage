# Opens the signage port to the local network and reports the URLs to use.
#
# The app already listens on every interface. What blocks a phone or tablet is
# the Windows Firewall, which denies unsolicited inbound connections by default.

$ErrorActionPreference = 'Stop'

$RuleName = 'Precious Metals Signage'

# Re-launch elevated if needed. Firewall rules require administrator rights.
$Identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object System.Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Administrator rights are required. Approve the prompt to continue...'
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit',
        '-File', "`"$PSCommandPath`""
    )
    return
}

# The port can be overridden by config.json sitting next to the executable.
$Port = 5000
$ConfigPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'config.json'
if (Test-Path $ConfigPath) {
    try {
        $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($Config.flask_port) { $Port = [int]$Config.flask_port }
    } catch {
        Write-Warning "Could not read $ConfigPath - assuming port $Port"
    }
}

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# Private profile only. This must not open the port on a public network such as
# a cafe or airport hotspot the machine might later join.
New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private `
    -Description 'Allows phones and tablets on the shop network to reach the signage admin panel.' | Out-Null

Write-Host ''
Write-Host "Opened TCP port $Port on private networks." -ForegroundColor Green
Write-Host ''

# A rule scoped to Private does nothing while Windows treats the network as
# Public, which is the default for a connection the user never classified.
$PublicNetworks = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })
if ($PublicNetworks.Count -gt 0) {
    Write-Host 'WARNING: these networks are classified as Public, so the rule will not apply:' -ForegroundColor Yellow
    $PublicNetworks | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  Fix: Settings > Network & Internet > (your network) > set to Private.' -ForegroundColor Yellow
    Write-Host '  Only do this on the shop network, never on public Wi-Fi.' -ForegroundColor Yellow
    Write-Host ''
}

$Addresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress

if ($Addresses) {
    Write-Host 'Reach the signage from any device on the same network:'
    foreach ($Address in $Addresses) {
        Write-Host "  Admin:   http://${Address}:${Port}/admin"
        Write-Host "  Display: http://${Address}:${Port}/display"
    }
    Write-Host ''
    Write-Host 'Set a static IP or a DHCP reservation on the router, or these' -ForegroundColor Cyan
    Write-Host 'addresses will change and the bookmark will stop working.' -ForegroundColor Cyan
} else {
    Write-Warning 'No network address found. Is this machine connected to the network?'
}

Write-Host ''
Write-Host 'NOTE: the admin panel has no password. Anyone who can reach this' -ForegroundColor Yellow
Write-Host 'address can control the signage. Do not forward this port through' -ForegroundColor Yellow
Write-Host 'the router to the internet.' -ForegroundColor Yellow
Write-Host ''
