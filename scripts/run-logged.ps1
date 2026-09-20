param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogFile,
    [Parameter(Mandatory = $true)][string]$LoggedCommand
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $WorkingDirectory
$logDirectory = Split-Path -Parent $LogFile
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Add-Content -LiteralPath $LogFile -Encoding utf8 -Value "`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') · $LoggedCommand ====="

try {
    & cmd.exe /d /s /c $LoggedCommand 2>&1 | Tee-Object -FilePath $LogFile -Append
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    exit $code
} catch {
    $_ | Out-String | Tee-Object -FilePath $LogFile -Append
    exit 1
}
