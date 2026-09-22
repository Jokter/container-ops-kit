param([Parameter(Mandatory=$true)][string]$ProjectRoot)
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
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(8080,5173) })
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
