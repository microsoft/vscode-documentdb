<#
.SYNOPSIS
    Build and serve the docs site (docs/) locally, the way GitHub Pages builds it.

.DESCRIPTION
    Copies the Gemfile to a work folder outside the repository, installs the gems once, and runs
    `jekyll serve` with live reload. Nothing is written inside the repository.
    Open http://127.0.0.1:<Port>/vscode-documentdb/ when "Server running" appears.

.EXAMPLE
    .github/skills/previewing-docs-site/scripts/preview.ps1
.EXAMPLE
    .github/skills/previewing-docs-site/scripts/preview.ps1 -Port 4001 -WorkDir C:\temp\docs-preview
#>
param(
    [int]$Port = 4000,
    [string]$WorkDir = (Join-Path ([IO.Path]::GetTempPath()) 'vscode-documentdb-docs-preview')
)
$ErrorActionPreference = 'Stop'

# Jekyll in safe mode silently drops docs/_sass when --source casing differs from the disk,
# so rebuild the path with the exact casing of every segment.
function Get-ExactPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $parts = $full.Split('\')
    $exact = $parts[0].ToUpper()
    foreach ($part in $parts[1..($parts.Count - 1)]) {
        $match = Get-ChildItem -LiteralPath "$exact\" -Force | Where-Object { $_.Name -ieq $part } | Select-Object -First 1
        $exact = "$exact\$($match.Name)"
    }
    $exact
}

$docs = Get-ExactPath (Join-Path $PSScriptRoot '..\..\..\..\docs')
if (-not (Test-Path (Join-Path $docs '_config.yml'))) { throw "docs/_config.yml not found at $docs" }

$ruby = 'C:\Ruby33-x64\bin'
if (-not (Get-Command bundle -ErrorAction SilentlyContinue) -and (Test-Path $ruby)) { $env:Path = "$ruby;$env:Path" }
if (-not (Get-Command bundle -ErrorAction SilentlyContinue)) {
    throw 'Ruby with Bundler not found. Install it with: winget install RubyInstallerTeam.RubyWithDevKit.3.3'
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Gemfile') $WorkDir -Force
$env:BUNDLE_GEMFILE = Join-Path $WorkDir 'Gemfile'
Push-Location $WorkDir
try {
    bundle check *> $null
    if ($LASTEXITCODE -ne 0) { bundle install }
    Write-Host "Serving $docs at http://127.0.0.1:$Port/vscode-documentdb/ (first build takes about 2 minutes)"
    bundle exec jekyll serve --source $docs --destination (Join-Path $WorkDir '_site') --livereload --port $Port
}
finally {
    Pop-Location
}
