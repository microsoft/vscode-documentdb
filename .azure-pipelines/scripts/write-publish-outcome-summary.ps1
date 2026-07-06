<#
.SYNOPSIS
    Prints the ESRP publish outcome to the step log.

.DESCRIPTION
    Invoked with condition: always() so the outcome is reported whether the ESRP
    task succeeded or failed. In 'test-esrp-auth' mode a failure is the EXPECTED
    result (ESRP rejects the Maven content-type), so it is framed accordingly.

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
    # Agent.JobStatus: Succeeded / SucceededWithIssues / Failed / Canceled.
    [Parameter(Mandatory = $true)] [string]$JobStatus
)

$ErrorActionPreference = 'Stop'

Write-Output "=== ESRP publish outcome ==="
Write-Output "  Package     : $PackageName@$PublishVersion"
Write-Output "  Mode        : $Mode"
Write-Output "  Job status  : $JobStatus"
Write-Output ""

if ($Mode -eq 'test-esrp-auth') {
    Write-Output "Smoke test: NOTHING was published. A failure here is expected (ESRP rejects the Maven content-type at validation). Inspect the ESRP task log to confirm the failure was the content-type rejection and NOT an auth/cert/Key Vault error."
} elseif ($Mode -eq 'publish') {
    if ($JobStatus -eq 'Succeeded') {
        Write-Output "[OK] Published $PackageName@$PublishVersion to npmjs.org."
    } else {
        Write-Output "[FAILED] Publish did NOT complete successfully (status: $JobStatus). Check the ESRP task log."
    }
}
