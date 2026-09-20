param(
    [string]$WorkingDirectory = '',
    [string]$LogFile = '',
    [string]$LoggedCommand = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WorkingDirectory) -or
    [string]::IsNullOrWhiteSpace($LogFile) -or
    [string]::IsNullOrWhiteSpace($LoggedCommand)) {
    Write-Error '日志启动参数缺失，请更新 start.bat 与 scripts/run-logged.ps1 后重试。'
    exit 2
}
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
