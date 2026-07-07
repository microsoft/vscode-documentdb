<#
.SYNOPSIS
    Packs the release-bound workspace packages into .tgz archives and emits an
    ADO run-summary box listing what was packed.

.DESCRIPTION
    Used by .azure-pipelines/build-npm-packages.yml. Only the packages listed in
    $publishablePackages are packed and shipped as release artifacts. The list
    MUST stay in sync with the release picklist in release-npm-packages.yml.
#>
[CmdletBinding()]
param(
    # Repository root (Build.SourcesDirectory).
    [Parameter(Mandatory = $true)]
    [string]$SourcesDirectory,

    # Base output directory (ob_outputDirectory). The .tgz files are written to
    # <OutputDirectory>\npm-packages.
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

# Only pack the packages that we actually release via ESRP.
# See release-npm-packages.yml for the matching picklist.
$publishablePackages = @(
    'vscode-ext-webview'
)

$npmPackagesDir = Join-Path $OutputDirectory 'npm-packages'
New-Item -ItemType Directory -Force -Path $npmPackagesDir | Out-Null

Write-Output "Packing release-bound workspace packages..."
Write-Output ""

foreach ($pkgDirName in $publishablePackages) {
    $packageDir = Join-Path (Join-Path $SourcesDirectory 'packages') $pkgDirName
    $packageJsonPath = Join-Path $packageDir 'package.json'

    if (-not (Test-Path $packageJsonPath)) {
        Write-Error "[Error] Configured publishable package '$pkgDirName' not found at $packageJsonPath"
        exit 1
    }

    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    $pkgName = $packageJson.name
    $pkgVersion = $packageJson.version

    if ($packageJson.private -eq $true) {
        Write-Error "[Error] Configured publishable package '$pkgName' is marked private in package.json"
        exit 1
    }

    Write-Output "Packing $pkgName@$pkgVersion from $pkgDirName..."
    npm pack --pack-destination $npmPackagesDir --workspace "packages/$pkgDirName"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "[Error] Failed to pack $pkgName"
        exit 1
    }

    Write-Output "[OK] Packed $pkgName@$pkgVersion"
    Write-Output ""
}

Write-Output "=== Generated .tgz files ==="
Get-ChildItem -Path $npmPackagesDir -Filter "*.tgz" | ForEach-Object {
    $sizeKB = [math]::Round($_.Length / 1KB, 2)
    Write-Output "  $($_.Name) (${sizeKB} KB)"
}

$tgzCount = (Get-ChildItem -Path $npmPackagesDir -Filter "*.tgz").Count
Write-Output ""
Write-Output "Total packages: $tgzCount"

if ($tgzCount -ne $publishablePackages.Count) {
    Write-Error "[Error] Expected $($publishablePackages.Count) .tgz file(s), found $tgzCount"
    exit 1
}
