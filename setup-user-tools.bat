@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "OPS_ACCOUNT=w00789509"
if not "%~1"=="" set "OPS_ACCOUNT=%~1"
echo Stop the Ops Studio backend before continuing.
echo Target account: %OPS_ACCOUNT%
call npm run build
if errorlevel 1 goto failed
node scripts/user-tools.mjs "%OPS_ACCOUNT%" check
if errorlevel 1 goto failed
echo.
echo 1. Import THIS Windows user's SSH keys, trusted hosts, Git identity and Agent config.
echo    Only choose this when the target account belongs to you. Existing files are kept.
echo 2. Log in to WeLink CLI for this account.
echo 3. Exit without changes.
choice /c 123 /n /m "Select [1/2/3]: "
if errorlevel 3 goto done
if errorlevel 2 goto login
node scripts/user-tools.mjs "%OPS_ACCOUNT%" import-local
if errorlevel 1 goto failed
goto done
:login
node scripts/user-tools.mjs "%OPS_ACCOUNT%" welink-login
if errorlevel 1 goto failed
:done
echo Restart start.bat when finished.
pause
exit /b 0
:failed
echo Setup stopped. Review the error above. No existing settings were overwritten.
pause
exit /b 1
