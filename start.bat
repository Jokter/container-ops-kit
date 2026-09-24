@echo off
setlocal
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
set "PLATFORM_PORT=8080"
set "FRONTEND_PORT=5173"
set "STARTUP_FILE=%~f0"
set "LOG_ROOT=%PROJECT_ROOT%\data\logs"
set "LOG_RUNNER=%PROJECT_ROOT%\scripts\run-logged.ps1"
echo Checking previous application instance...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$text=[IO.File]::ReadAllText($env:STARTUP_FILE); $marker='# BEGIN EMBEDDED PROCESS CLEANUP'; $code=$text.Substring($text.LastIndexOf($marker)+$marker.Length); & ([scriptblock]::Create($code)) -ProjectRoot $env:PROJECT_ROOT -BackendPort ([int]$env:PLATFORM_PORT) -FrontendPort ([int]$env:FRONTEND_PORT)"
if errorlevel 1 goto stop_previous_failed
if exist "%LOG_ROOT%" rmdir /s /q "%LOG_ROOT%"
if exist "%LOG_ROOT%" goto log_reset_failed
mkdir "%LOG_ROOT%\startup"

where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major===24 && minor>=15 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node

echo Checking locked dependencies...
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "node scripts/install-locked.mjs ."
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm run migrate"
if errorlevel 1 goto migration_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm run build"
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "node scripts/install-locked.mjs frontend"
if errorlevel 1 goto frontend_install_failed

start "Container Ops Kit Backend" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\backend\process.log" -LoggedCommand "npm start"
echo Waiting for backend on http://127.0.0.1:%PLATFORM_PORT%...
for /l %%I in (1,1,90) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PLATFORM_PORT%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto backend_ready
  timeout /t 1 /nobreak >nul
)
echo Backend startup failed. Check the backend window; do not start a second copy.
pause
exit /b 1

:backend_ready
start "Container Ops Kit Frontend" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%\frontend" -LogFile "%LOG_ROOT%\frontend\frontend.log" -LoggedCommand "npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT% --strictPort"
for /l %%I in (1,1,60) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%FRONTEND_PORT%' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto frontend_ready
  timeout /t 1 /nobreak >nul
)
echo Frontend startup failed. Check the frontend window.
pause
exit /b 1

:frontend_ready
start "" "http://127.0.0.1:%FRONTEND_PORT%"
exit /b 0

:missing_node
echo Node.js 24.15 or newer within the 24.x line, with npm, is required.
pause
exit /b 1

:migration_failed
echo Legacy data migration failed. Your H2 file was not deleted.
echo Read data\logs\startup\startup.log for the complete command output.
pause
exit /b 1

:install_failed
echo Dependency installation or TypeScript build failed. No backend was started.
echo Read data\logs\startup\startup.log for the complete command output.
pause
exit /b 1

:frontend_install_failed
echo Frontend dependency check failed. No backend was started.
echo Close old Node or Vite processes, editors, or antivirus scans using frontend\node_modules, then retry.
echo Read data\logs\startup\startup.log for the exact locked file and complete npm output.
pause
exit /b 1

:log_reset_failed
echo Failed to reset data\logs. Close old backend/frontend windows and retry.
pause
exit /b 1

:stop_previous_failed
echo Could not stop the previous instance. No new backend or frontend was started.
pause
exit /b 1

# BEGIN EMBEDDED PROCESS CLEANUP
param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [ValidateRange(1,65535)][int]$BackendPort = 8080,
    [ValidateRange(1,65535)][int]$FrontendPort = 5173
)
$ErrorActionPreference = 'Stop'

function Test-ProjectProcess($Process, [string]$RootPath) {
    # Normalize separators, accept quoted and unquoted arguments, and require a
    # complete script path (not a substring such as another checkout's prefix).
    $line = ([string]$Process.CommandLine).Replace('/', '\')
    $runner = [regex]::Escape((Join-Path $RootPath 'scripts\run-logged.ps1'))
    if ($Process.Name -match '^(powershell|pwsh)\.exe$') {
        return ($line -match ('(?i)(?:^|\s)-File\s+"?' + $runner + '(?:"|\s|$)') -and
            $line -match '(?i)(?:^|\s)-LoggedCommand\s+"?npm\s+(?:start(?:"|\s|$)|run\s+dev(?:"|\s|$))')
    }
    if ($Process.Name -ne 'node.exe') { return $false }
    foreach ($entry in @('dist\backend-ts\src\main.js', 'frontend\node_modules\vite\bin\vite.js')) {
        $script = [regex]::Escape((Join-Path $RootPath $entry))
        if ($line -match ('(?i)(?:^|\s)"?' + $script + '(?:"|\s|$)')) { return $true }
    }
    return $false
}

# Legacy relative entry paths are considered only on the configured application
# ports, and only after the server identifies itself as this application.
# Generic vite/--host arguments alone never establish ownership.
function Test-LegacyPortOwner($Process, [int]$Port) {
    if ($Process.Name -ne 'node.exe') { return $false }
    $line = ([string]$Process.CommandLine).Replace('/', '\')
    try {
        if ($Port -eq $BackendPort -and $line -match '(?i)(?:^|\s)"?(?:\.\\)?dist\\backend-ts\\src\\main\.js(?:"|\s|$)') {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/api/platform/health" -TimeoutSec 2
            return ($health.status -eq 'UP' -and $health.backend -eq 'typescript' -and $health.migrationStage -eq 'complete')
        }
        if ($Port -eq $FrontendPort -and $line -match '(?i)(?:^|\s)"?(?:\.\\)?node_modules\\vite\\bin\\vite\.js(?:"|\s|$)') {
            $package = Invoke-RestMethod -Uri "http://127.0.0.1:$FrontendPort/package.json" -TimeoutSec 2
            return ($package.name -eq 'container-ops-kit' -and $package.scripts.start -eq 'node dist/backend-ts/src/main.js')
        }
    } catch { return $false }
    return $false
}

function Stop-VerifiedProcess($Previous) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($Previous.ProcessId)"
    if ($null -eq $current) { return }
    if ($current.CreationDate -ne $Previous.CreationDate -or $current.CommandLine -ne $Previous.CommandLine) {
        throw 'Process identity changed; refusing to stop an unrelated process.'
    }
    Write-Host "Stopping previous application process tree $($Previous.ProcessId)..."
    & taskkill.exe /PID $Previous.ProcessId /T /F
    if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $Previous.ProcessId -ErrorAction SilentlyContinue)) {
        throw "Could not stop previous application process $($Previous.ProcessId). Check its Windows user/administrator permissions."
    }
}

try {
    $root = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $processes = @(Get-CimInstance Win32_Process)
    $owned = @($processes | Where-Object { Test-ProjectProcess $_ $root })
    # Snapshot descendants before stopping launchers: taskkill can miss children
    # if their parent exits first. Creation times protect against reused PIDs.
    $ownedIds = @{}
    foreach ($process in $owned) { $ownedIds[[string]$process.ProcessId] = $process }
    do {
        $added = $false
        foreach ($process in $processes) {
            $parent = $ownedIds[[string]$process.ParentProcessId]
            if ($null -ne $parent -and !$ownedIds.ContainsKey([string]$process.ProcessId) -and
                $process.CreationDate -ge $parent.CreationDate) {
                $ownedIds[[string]$process.ProcessId] = $process
                $added = $true
            }
        }
    } while ($added)
    foreach ($previous in $owned) { Stop-VerifiedProcess $previous }
    foreach ($previous in @($ownedIds.Values)) { Stop-VerifiedProcess $previous }
    $portOwners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @($BackendPort,$FrontendPort) })
    $checked = @{}
    foreach ($listener in $portOwners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($null -eq $owner -or $checked.ContainsKey([string]$owner.ProcessId)) { continue }
        if ((Test-ProjectProcess $owner $root) -or (Test-LegacyPortOwner $owner $listener.LocalPort)) {
            $checked[[string]$owner.ProcessId] = $true
            Stop-VerifiedProcess $owner
        }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @($BackendPort,$FrontendPort) })
        if ($listeners.Count -eq 0) { exit 0 }
        Start-Sleep -Milliseconds 250
    }
    foreach ($listener in ($listeners | Sort-Object LocalPort,OwningProcess -Unique)) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        Write-Host "Port $($listener.LocalPort): PID $($listener.OwningProcess), process $($owner.Name)."
    }
    throw 'An unverified process still owns an application port. Close the old backend/frontend terminal, or use Task Manager to stop the listed PID after confirming its identity, then retry.'
} catch {
    Write-Host "Previous instance cleanup failed: $($_.Exception.Message)"
    exit 1
}
