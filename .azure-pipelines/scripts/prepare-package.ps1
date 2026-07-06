<#
.SYNOPSIS
    Copies only the selected .tgz into an isolated folder so ESRP publishes
    exactly one artifact and nothing else.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$TgzFileName,
    # System.DefaultWorkingDirectory (where the build artifact was downloaded).
    [Parameter(Mandatory = $true)] [string]$WorkingDirectory,
    # Folder to place the single .tgz into (handed to ESRP as folderlocation).
    [Parameter(Mandatory = $true)] [string]$PublishDir
)

$ErrorActionPreference = 'Stop'

$npmPackagesDir = Join-Path $WorkingDirectory 'npm-packages'
New-Item -ItemType Directory -Force -Path $PublishDir | Out-Null

$sourcePath = Join-Path $npmPackagesDir $TgzFileName
if (-not (Test-Path $sourcePath)) {
    Write-Error "[Error] .tgz file not found: $sourcePath"
    exit 1
}

Copy-Item -Path $sourcePath -Destination $PublishDir
Write-Output "Prepared for publishing:"
Get-ChildItem -Path $PublishDir | ForEach-Object {
    Write-Output "  $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)"
}
