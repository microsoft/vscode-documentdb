<#
.SYNOPSIS
    Emits the post-publish run-summary box describing the ESRP outcome.

.DESCRIPTION
    Invoked with condition: always() so the summary is present whether the ESRP
    task succeeded or failed. In 'test-esrp-auth' mode a failure is the EXPECTED
    result (ESRP rejects the Maven content-type), so it is framed accordingly.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$PackageName,
    [Parameter(Mandatory = $true)] [string]$PublishVersion,
    [Parameter(Mandatory = $true)] [string]$Mode,
    # Agent.JobStatus: Succeeded / SucceededWithIssues / Failed / Canceled.
    [Parameter(Mandatory = $true)] [string]$JobStatus,
    [Parameter(Mandatory = $true)] [string]$SummaryPath
)

$ErrorActionPreference = 'Stop'

$lines = @()
$lines += "## 📤 ESRP publish outcome"
$lines += ""
$lines += "| Field | Value |"
$lines += "| --- | --- |"
$lines += "| Package | ``$PackageName@$PublishVersion`` |"
$lines += "| Mode | ``$Mode`` |"
$lines += "| Job status | ``$JobStatus`` |"
$lines += ""

if ($Mode -eq 'test-esrp-auth') {
    $lines += "> Smoke test: NOTHING was published. A **failure** here is expected (ESRP rejects the Maven content-type at validation). Inspect the ESRP task log to confirm the failure was the content-type rejection and NOT an auth/cert/Key Vault error."
} elseif ($Mode -eq 'publish') {
    if ($JobStatus -eq 'Succeeded') {
        $lines += "> ✅ Published ``$PackageName@$PublishVersion`` to npmjs.org."
    } else {
        $lines += "> ❌ Publish did NOT complete successfully (status: $JobStatus). Check the ESRP task log."
    }
}

$lines -join "`n" | Out-File -FilePath $SummaryPath -Encoding utf8
Write-Host "##vso[task.uploadsummary]$SummaryPath"
