<#
.SYNOPSIS
    Prints the release intent (package, version, mode, source build) to the step
    log so approvers can review it without opening other steps.

.NOTES
    Previously uploaded an ADO run-summary box via the task.uploadsummary
    logging command, but that command is blocked by OneBranch policy, so the
    same information is written to the log instead.
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
    [Parameter(Mandatory = $true)] [string]$SourceCommit
)

$ErrorActionPreference = 'Stop'

$modeNote = switch ($Mode) {
    'validate-only'  { 'Validation only - ESRP is NOT contacted and nothing is published.' }
    'test-esrp-auth' { 'Smoke test - exercises ESRP auth then fails at content validation. Nothing is published.' }
    'publish'        { 'REAL PUBLISH - this run pushes the package to npmjs.org.' }
    default          { "Unknown mode: $Mode" }
}

Write-Output "=== npm release run ==="
Write-Output "  Package        : $PackageName"
Write-Output "  Version        : $PublishVersion"
Write-Output "  Mode           : $Mode"
Write-Output "  .tgz           : $TgzFileName"
Write-Output "  Source build   : $SourceRunName (run $SourceRunId)"
Write-Output "  Source branch  : $SourceBranch"
Write-Output "  Source commit  : $SourceCommit"
Write-Output ""
Write-Output $modeNote
