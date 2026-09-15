@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"
set "PLATFORM_PORT=8080"
set "LEGACY_BACKEND_URL=http://127.0.0.1:8081"

where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major===24 && minor>=15 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node
where java >nul 2>nul
if errorlevel 1 goto missing_java
where mvn >nul 2>nul
if errorlevel 1 goto missing_java

echo Installing locked TypeScript backend dependencies...
call npm ci
if errorlevel 1 goto install_failed
call npm run build
if errorlevel 1 goto install_failed
echo Installing locked frontend dependencies...
call npm ci --prefix frontend
if errorlevel 1 goto install_failed

rem Preserve Maven's working directory and the existing H2 data location.
start "Container Ops Kit Java Compatibility" cmd /k "cd /d ""%PROJECT_ROOT%"" && mvn -pl backend spring-boot:run -Dspring-boot.run.arguments=""--server.port=8081 --server.address=127.0.0.1"""
start "Container Ops Kit TypeScript Backend" cmd /k "cd /d ""%PROJECT_ROOT%"" && npm start"

echo Waiting for both backends on http://127.0.0.1:8080...
for /l %%I in (1,1,120) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto backend_ready
  timeout /t 1 /nobreak >nul
)
echo Backend startup failed. Check both backend windows. Do not start a second copy.
pause
exit /b 1

:backend_ready
start "Container Ops Kit Frontend" cmd /k "cd /d ""%PROJECT_ROOT%frontend"" && npm run dev -- --host 127.0.0.1 --strictPort"
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

:missing_java
echo Migration stage 1 still requires Java 21 and Maven for existing workflows.
pause
exit /b 1

:install_failed
echo Dependency installation or TypeScript build failed. No new backend was started.
pause
exit /b 1
