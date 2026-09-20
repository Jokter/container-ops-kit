@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"
set "PLATFORM_PORT=8080"
set "LOG_ROOT=%PROJECT_ROOT%data\logs"
set "LOG_RUNNER=%PROJECT_ROOT%scripts\run-logged.ps1"
if not exist "%LOG_ROOT%\startup" mkdir "%LOG_ROOT%\startup"

where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major===24 && minor>=15 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node

echo Installing locked dependencies...
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm ci"
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm run migrate"
if errorlevel 1 goto migration_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm run build"
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\startup\startup.log" -LoggedCommand "npm ci --prefix frontend"
if errorlevel 1 goto install_failed

start "Container Ops Kit Backend" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%" -LogFile "%LOG_ROOT%\backend\process.log" -LoggedCommand "npm start"
echo Waiting for backend on http://127.0.0.1:8080...
for /l %%I in (1,1,90) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto backend_ready
  timeout /t 1 /nobreak >nul
)
echo Backend startup failed. Check the backend window; do not start a second copy.
pause
exit /b 1

:backend_ready
start "Container Ops Kit Frontend" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%LOG_RUNNER%" -WorkingDirectory "%PROJECT_ROOT%frontend" -LogFile "%LOG_ROOT%\frontend\frontend.log" -LoggedCommand "npm run dev -- --host 127.0.0.1 --strictPort"
for /l %%I in (1,1,60) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto frontend_ready
  timeout /t 1 /nobreak >nul
)
echo Frontend startup failed. Check the frontend window.
pause
exit /b 1

:frontend_ready
start "" "http://127.0.0.1:5173"
exit /b 0

:missing_node
echo Node.js 24.15 or newer within the 24.x line, with npm, is required.
pause
exit /b 1

:migration_failed
echo Legacy data migration failed. Your H2 file was not deleted. Read docs\typescript-migration.md.
pause
exit /b 1

:install_failed
echo Dependency installation or TypeScript build failed. No backend was started.
pause
exit /b 1
