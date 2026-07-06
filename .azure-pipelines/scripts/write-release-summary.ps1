<#
.SYNOPSIS
    Emits the pre-publish run-summary box describing the release intent
    (package, version, mode, source build) for approvers.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PackageName,
    [Parameter(Mandatory = $true)] [string]$PublishVersion,
    [Parameter(Mandatory = $true)] [string]$Mode,
    [Parameter(Mandatory = $true)] [string]$TgzFileName,
    [Parameter(Mandatory = $true)] [string]$SourceRunName,
    [Parameter(Mandatory = $true)] [string]$SourceRunId,
    [Parameter(Mandatory = $true)] [string]$SourceBranch,
    [Parameter(Mandatory = $true)] [string]$SourceCommit,
    [Parameter(Mandatory = $true)] [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'

$modeNote = switch ($Mode) {
    'validate-only'  { 'Validation only - ESRP is NOT contacted and nothing is published.' }
    'test-esrp-auth' { 'Smoke test - exercises ESRP auth then fails at content validation. Nothing is published.' }
    'publish'        { '**REAL PUBLISH** - this run pushes the package to npmjs.org.' }
    default          { "Unknown mode: $Mode" }
}

$lines = @()
$lines += "## 🚀 npm release run"
$lines += ""
$lines += "| Field | Value |"
$lines += "| --- | --- |"
$lines += "| Package | ``$PackageName`` |"
$lines += "| Version | ``$PublishVersion`` |"
$lines += "| Mode | ``$Mode`` |"
$lines += "| .tgz | ``$TgzFileName`` |"
$lines += "| Source build | $SourceRunName (run $SourceRunId) |"
$lines += "| Source branch | $SourceBranch |"
$lines += "| Source commit | $SourceCommit |"
$lines += ""
$lines += "> $modeNote"

$lines -join "`n" | Out-File -FilePath $SummaryPath -Encoding utf8
Write-Host "##vso[task.uploadsummary]$SummaryPath"
