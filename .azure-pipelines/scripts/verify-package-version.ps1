<#
.SYNOPSIS
    Verifies the packed package.json version matches the intended publish
    version, validates semver, and refuses private packages.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PackageName,
    [Parameter(Mandatory = $true)] [string]$PublishVersion,
    # System.DefaultWorkingDirectory (where the build artifact was downloaded).
    [Parameter(Mandatory = $true)] [string]$WorkingDirectory
)

$ErrorActionPreference = 'Stop'

$packageJsonPath = Join-Path $WorkingDirectory "packages/$PackageName/package.json"
if (-not (Test-Path $packageJsonPath)) {
    Write-Error "[Error] package.json not found at $packageJsonPath"
    Write-Output "Available files:"
    Get-ChildItem -Path $WorkingDirectory -Recurse -Filter "package.json" | ForEach-Object { Write-Output $_.FullName }
    exit 1
}

$packageJson = Get-Content $packageJsonPath | ConvertFrom-Json
$actualVersion = $packageJson.version
$fullPackageName = $packageJson.name

Write-Output "Package: $fullPackageName"
Write-Output "Version in package.json: $actualVersion"
Write-Output "Expected publish version: $PublishVersion"

# Validate semantic version format
$semverPattern = '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
if ($actualVersion -notmatch $semverPattern) {
    Write-Error "[Error] Version in package.json ($actualVersion) is not a valid semantic version"
    exit 1
}
if ($PublishVersion -notmatch $semverPattern) {
    Write-Error "[Error] Publish version ($PublishVersion) is not a valid semantic version"
    exit 1
}

if ($actualVersion -eq $PublishVersion) {
    Write-Output "[Success] Version matches. Proceeding with release of $fullPackageName@$PublishVersion"
} else {
    Write-Error "[Error] Publish version '$PublishVersion' does not match version in package.json '$actualVersion'. Cancelling release."
    exit 1
}

# ESRP Release cannot publish private packages
if ($packageJson.private -eq $true) {
    Write-Error "[Error] Package $fullPackageName is marked as private in package.json. Cannot publish to npm."
    exit 1
}
