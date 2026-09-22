param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [ValidateRange(1,65535)][int]$BackendPort = 8080,
    [ValidateRange(1,65535)][int]$FrontendPort = 5173
)
$ErrorActionPreference = 'Stop'
try {
    $startup = Join-Path $PSScriptRoot '..\start.bat'
    $text = [System.IO.File]::ReadAllText($startup)
    $marker = '# BEGIN EMBEDDED PROCESS CLEANUP'
    $offset = $text.LastIndexOf($marker)
    if ($offset -lt 0) { throw 'Embedded cleanup code is missing. Update start.bat and retry.' }
    & ([scriptblock]::Create($text.Substring($offset + $marker.Length))) -ProjectRoot $ProjectRoot -BackendPort $BackendPort -FrontendPort $FrontendPort
} catch {
    Write-Host "Previous instance cleanup failed: $($_.Exception.Message)"
    exit 1
}
