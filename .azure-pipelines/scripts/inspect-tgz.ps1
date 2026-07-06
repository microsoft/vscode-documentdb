<#
.SYNOPSIS
    Inspects the .tgz contents and fails on obviously sensitive files.

.DESCRIPTION
    Safety net that runs right before the artifact is uploaded to ESRP.
    CredScan runs earlier in the build, but the .tgz is the actual public
    artifact, so it is worth double-checking its exact contents here.
#>
[CmdletBinding()]
param(
    # Folder containing the single .tgz prepared for publishing.
    [Parameter(Mandatory = $true)] [string]$PublishDir
)

$ErrorActionPreference = 'Stop'

$tgzPath = Get-ChildItem -Path $PublishDir -Filter "*.tgz" | Select-Object -First 1 -ExpandProperty FullName
if (-not $tgzPath) {
    Write-Error "[Error] No .tgz found in $PublishDir"
    exit 1
}

Write-Output "Listing contents of $tgzPath ..."
$entries = & tar -tzf $tgzPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "[Error] Failed to list tarball contents"
    exit 1
}

$entries | ForEach-Object { Write-Output "  $_" }

# Patterns that should never appear in a published package.
$forbiddenPatterns = @(
    '\.env(\..*)?$',
    '(^|/)\.npmrc$',
    '(^|/)\.netrc$',
    '(^|/)id_rsa(\.pub)?$',
    '(^|/)\.ssh/',
    '\.pem$',
    '\.pfx$',
    '\.p12$',
    '\.key$',
    '(^|/)secrets?(\.json|\.yaml|\.yml|\.txt)$',
    '(^|/)credentials?(\.json|\.yaml|\.yml|\.txt)$'
)

$violations = @()
foreach ($entry in $entries) {
    foreach ($pattern in $forbiddenPatterns) {
        if ($entry -match $pattern) {
            $violations += "  $entry  (matched: $pattern)"
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Error "[Error] Forbidden file(s) detected in the .tgz:"
    $violations | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output ""
Write-Output "[Success] No forbidden files detected ($($entries.Count) entries scanned)"
