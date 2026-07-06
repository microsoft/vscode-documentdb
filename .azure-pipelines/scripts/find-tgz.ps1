<#
.SYNOPSIS
    Finds the single .tgz produced for the selected package and exposes its
    filename as the output variable 'tgzFileName'.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PackageName,
    # System.DefaultWorkingDirectory (where the build artifact was downloaded).
    [Parameter(Mandatory = $true)] [string]$WorkingDirectory
)

$ErrorActionPreference = 'Stop'

$npmPackagesDir = Join-Path $WorkingDirectory 'npm-packages'

Write-Output "Searching for .tgz files in: $npmPackagesDir"

if (-not (Test-Path $npmPackagesDir)) {
    Write-Error "[Error] npm-packages directory not found at $npmPackagesDir"
    Write-Output "Available directories:"
    Get-ChildItem -Path $WorkingDirectory -Directory | ForEach-Object { Write-Output $_.FullName }
    exit 1
}

# List all available .tgz files
Write-Output "Available .tgz files:"
Get-ChildItem -Path $npmPackagesDir -Filter "*.tgz" | ForEach-Object {
    $sizeKB = [math]::Round($_.Length / 1KB, 2)
    Write-Output "  $($_.Name) (${sizeKB} KB)"
}

# Find the .tgz file matching the selected package.
# npm pack writes scope-flattened filenames, e.g.:
#   documentdb-js-schema-analyzer-0.8.1.tgz
#   microsoft-vscode-ext-webview-0.9.0-preview.tgz
# The PackageName parameter matches the folder name under packages/,
# which appears in the .tgz filename for all packages here.
$tgzFiles = Get-ChildItem -Path $npmPackagesDir -Filter "*$PackageName*.tgz"

if ($tgzFiles.Count -eq 0) {
    Write-Error "[Error] No .tgz file found matching package '$PackageName'"
    exit 1
} elseif ($tgzFiles.Count -gt 1) {
    Write-Error "[Error] Multiple .tgz files found matching package '$PackageName': $($tgzFiles.Name -join ', ')"
    exit 1
}

$tgzFile = $tgzFiles[0]
$tgzSize = [math]::Round($tgzFile.Length / 1KB, 2)
Write-Output ""
Write-Output "[Success] Found .tgz file: $($tgzFile.Name) (${tgzSize} KB)"
Write-Output "##vso[task.setvariable variable=tgzFileName;isOutput=true]$($tgzFile.Name)"
