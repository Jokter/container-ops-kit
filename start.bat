@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

where java >nul 2>nul
if errorlevel 1 (
  echo Java 21 is required.
  pause
  exit /b 1
)

where mvn >nul 2>nul
if errorlevel 1 (
  echo Maven is required.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
  echo Installing frontend dependencies...
  call npm install --prefix "%ROOT%frontend"
  if errorlevel 1 (
    echo Frontend dependency installation failed.
    pause
    exit /b 1
  )
)

start "Container Ops Kit Backend" cmd /k "cd /d ""%ROOT%"" && mvn -pl backend spring-boot:run"

echo Waiting for backend on http://localhost:8080...
for /l %%I in (1,1,90) do (
  powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/api/health' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto backend_ready
  timeout /t 1 /nobreak >nul
)

echo Backend failed to start within 90 seconds.
echo Check the Container Ops Kit Backend window for the Maven or Spring Boot error.
pause
exit /b 1

:backend_ready
echo Backend is ready.
start "Container Ops Kit Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev -- --host 0.0.0.0"

echo Waiting for frontend on http://localhost:5173...
for /l %%I in (1,1,60) do (
  powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
  if not errorlevel 1 goto frontend_ready
  timeout /t 1 /nobreak >nul
)

echo Frontend failed to start within 60 seconds.
echo Check the Container Ops Kit Frontend window for the Vite error.
pause
exit /b 1

:frontend_ready
start "" "http://localhost:5173"
endlocal
