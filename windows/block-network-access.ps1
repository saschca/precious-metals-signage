# Removes the firewall rule added by allow-network-access.ps1, so the signage
# is reachable only from the machine it runs on.

$ErrorActionPreference = 'Stop'

$RuleName = 'Precious Metals Signage'

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

$Existing = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
if ($Existing.Count -gt 0) {
    $Existing | Remove-NetFirewallRule
    Write-Host "Removed the '$RuleName' firewall rule." -ForegroundColor Green
    Write-Host 'The signage is now reachable only from this computer.'
} else {
    Write-Host "No '$RuleName' firewall rule is installed."
}
