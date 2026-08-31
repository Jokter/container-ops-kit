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

if not exist "%ROOT%frontend
ode_modules" (
  echo Installing frontend dependencies...
  call npm install --prefix "%ROOT%frontend"
  if errorlevel 1 (
    echo Frontend dependency installation failed.
    pause
    exit /b 1
  )
)

start "Container Ops Kit Backend" cmd /k "cd /d ""%ROOT%"" && mvn -pl backend spring-boot:run"
timeout /t 3 /nobreak >nul
start "Container Ops Kit Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev -- --host 0.0.0.0"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"
endlocal