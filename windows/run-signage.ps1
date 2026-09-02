param(
    [int]$StartupDelaySeconds = 0
)

$ErrorActionPreference = 'Stop'

if ($StartupDelaySeconds -gt 0) {
    Start-Sleep -Seconds $StartupDelaySeconds
}

$AppDirectory = Split-Path -Parent $PSScriptRoot
$Executable = Get-ChildItem -Path $AppDirectory -Filter 'PreciousMetalsSignage-v*.exe' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $Executable) {
    $StableExecutable = Join-Path $AppDirectory 'PreciousMetalsSignage.exe'
    if (Test-Path $StableExecutable) {
        $Executable = Get-Item $StableExecutable
    }
}

if (-not $Executable) {
    throw "No PreciousMetalsSignage executable was found in $AppDirectory"
}

$Process = Start-Process `
    -FilePath $Executable.FullName `
    -WorkingDirectory $AppDirectory `
    -PassThru `
    -Wait

exit $Process.ExitCode
