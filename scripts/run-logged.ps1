param(
    [string]$WorkingDirectory = '',
    [string]$LogFile = '',
    [string]$LoggedCommand = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WorkingDirectory) -or
    [string]::IsNullOrWhiteSpace($LogFile) -or
    [string]::IsNullOrWhiteSpace($LoggedCommand)) {
    Write-Error 'Missing log runner arguments. Update start.bat and scripts/run-logged.ps1, then retry.'
    exit 2
}
Set-Location -LiteralPath $WorkingDirectory
$logDirectory = Split-Path -Parent $LogFile
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
$env:TERM = 'dumb'
$ansiPattern = "$([char]27)\[[0-?]*[ -/]*[@-~]"
if (Test-Path -LiteralPath $LogFile) {
    $existingBytes = [System.IO.File]::ReadAllBytes($LogFile)
    if ($existingBytes -contains 0) {
        $backup = "$LogFile.encoding-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Move-Item -LiteralPath $LogFile -Destination $backup
        Write-Host "Previous mixed-encoding log moved to $backup"
    }
}

function Write-LogLine([string]$Line) {
    $cleanLine = [regex]::Replace($Line, $ansiPattern, '')
    Write-Host $cleanLine
    [System.IO.File]::AppendAllText($LogFile, $cleanLine + [Environment]::NewLine, $utf8)
}

Write-LogLine ""
Write-LogLine "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $LoggedCommand ====="

try {
    & cmd.exe /d /s /c $LoggedCommand 2>&1 | ForEach-Object { Write-LogLine ([string]$_) }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    exit $code
} catch {
    $errorText = $_ | Out-String
    Write-LogLine ($errorText.TrimEnd())
    exit 1
}
