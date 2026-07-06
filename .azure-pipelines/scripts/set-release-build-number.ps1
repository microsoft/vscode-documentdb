<#
.SYNOPSIS
    Sets a descriptive ADO run (build) number that encodes the package, version
    and run mode, e.g. npm-vscode-ext-webview-0.9.0-preview-esrptest-12345.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PackageName,
    [Parameter(Mandatory = $true)] [string]$PublishVersion,
    [Parameter(Mandatory = $true)] [string]$Mode,
    [Parameter(Mandatory = $true)] [string]$BuildId
)

$ErrorActionPreference = 'Stop'

$modeSuffix = switch ($Mode) {
    'validate-only'  { '-validate' }
    'test-esrp-auth' { '-esrptest' }
    'publish'        { '' }
    default          { "-$Mode" }
}

$newBuildNumber = "npm-${PackageName}-${PublishVersion}${modeSuffix}-${BuildId}"
Write-Output "Mode: $Mode"
Write-Output "Setting build number to: $newBuildNumber"
Write-Output "##vso[build.updatebuildnumber]$newBuildNumber"
