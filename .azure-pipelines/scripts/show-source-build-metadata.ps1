<#
.SYNOPSIS
    Prints the source build (npmBuild pipeline resource) metadata so an operator
    can confirm the release is coming from the intended commit/branch.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PipelineName,
    [Parameter(Mandatory = $true)] [string]$RunId,
    [Parameter(Mandatory = $true)] [string]$RunName,
    [Parameter(Mandatory = $true)] [string]$SourceBranch,
    [Parameter(Mandatory = $true)] [string]$SourceCommit,
    [Parameter(Mandatory = $true)] [string]$SourceProvider
)

$ErrorActionPreference = 'Stop'

Write-Output "Releasing from npmBuild pipeline run:"
Write-Output "  Pipeline           : $PipelineName"
Write-Output "  Run id             : $RunId"
Write-Output "  Run name           : $RunName"
Write-Output "  Source branch      : $SourceBranch"
Write-Output "  Source commit      : $SourceCommit"
Write-Output "  Source provider    : $SourceProvider"
