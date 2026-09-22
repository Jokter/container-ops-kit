param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
try {
    $root = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $runner = [regex]::Escape((Join-Path $root 'scripts\run-logged.ps1'))
    # Match this checkout's launcher only; never terminate all node.exe processes.
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(powershell|pwsh)\.exe$' -and
        $_.CommandLine -match ('(?i)-File\s+"?' + $runner + '(?:"|\s|$)') -and
        $_.CommandLine -match '(?i)-LoggedCommand\s+"npm (start|run dev\b)'
    })
    foreach ($previous in $owned) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.ProcessId)"
        if ($null -eq $current) { continue }
        if ($current.CreationDate -ne $previous.CreationDate -or $current.CommandLine -ne $previous.CommandLine) {
            throw 'Process identity changed; refusing to stop an unrelated process.'
        }
        Write-Host "Stopping previous application process tree $($previous.ProcessId)..."
        & taskkill.exe /PID $previous.ProcessId /T /F
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $previous.ProcessId -ErrorAction SilentlyContinue)) {
            throw "Could not stop previous application process $($previous.ProcessId)."
        }
    }
    # Allow children to release SQLite and sockets before resetting logs or migrating.
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(8080,5173) })
        if ($listeners.Count -eq 0) { exit 0 }
        Start-Sleep -Milliseconds 250
    }
    throw 'Port 8080 or 5173 is still occupied. The owner could not be confirmed as this project; stop it manually and retry.'
} catch {
    Write-Host "Previous instance cleanup failed: $($_.Exception.Message)"
    exit 1
}
