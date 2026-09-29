@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "MIGRATION_ACCOUNT=w00789509"
if not "%~1"=="" set "MIGRATION_ACCOUNT=%~1"

echo Migrating legacy data to account: %MIGRATION_ACCOUNT%
echo Please stop Ops Studio backend before running this script.
echo The original database will be kept and backed up automatically.
echo.
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major===24 && minor>=15 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm >nul 2>nul
if errorlevel 1 goto missing_node

node scripts/install-locked.mjs .
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
node scripts/migrate-user-workspace.mjs "%MIGRATION_ACCOUNT%"
if errorlevel 1 goto failed

echo.
echo Migration complete. Run start.bat and log in with %MIGRATION_ACCOUNT%.
pause
exit /b 0

:missing_node
echo Node.js 24.15 or newer within the 24.x line, with npm, is required.
:failed
echo.
echo Migration stopped. The original database has not been deleted.
echo Check the error above. Do not delete an existing user database.
pause
exit /b 1
