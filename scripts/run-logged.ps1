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
    # Absolute entry paths let the next launch identify even orphaned Node processes.
    # Keep all other logged commands (install/build/migrate) unchanged.
    $executionCommand = $LoggedCommand
    if ($LoggedCommand -eq 'npm start') {
        $entry = Join-Path ([System.IO.Path]::GetFullPath($WorkingDirectory)) 'dist\backend-ts\src\main.js'
        $executionCommand = 'node "' + $entry + '"'
    } elseif ($LoggedCommand -eq 'npm run dev -- --host 127.0.0.1 --strictPort') {
        $entry = Join-Path ([System.IO.Path]::GetFullPath($WorkingDirectory)) 'node_modules\vite\bin\vite.js'
        $executionCommand = 'node "' + $entry + '" --host 127.0.0.1 --strictPort'
    }
    $commandWithRedirect = $executionCommand + ' 2>&1'
    & cmd.exe /d /s /c $commandWithRedirect | ForEach-Object { Write-LogLine ([string]$_) }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    exit $code
} catch {
    $errorText = $_ | Out-String
    Write-LogLine ($errorText.TrimEnd())
    exit 1
}
