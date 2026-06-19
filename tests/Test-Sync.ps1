#requires -Version 7.0
<#
.SYNOPSIS
    Run sync unit tests and optional metadata preflight checks.
#>
[CmdletBinding()]
param(
    [switch] $Preflight,
    [ValidateSet('Bootstrap', 'Incremental', 'Rebuild', 'Verify')]
    [string] $Mode = 'Incremental',
    [switch] $SkipFetch,
    [switch] $Force,
    [int] $MaxCommits = 0
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host '[test] Running Parse-GitCommitObject unit tests...'
& "$repoRoot/tests/Parse-GitCommitObject.Tests.ps1"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($Preflight) {
    Write-Host '[test] Running replay metadata preflight (step 3/4, replay-queue.json)...'
    & "$repoRoot/scripts/Test-ReplayMetadata.ps1" -MaxCommits $MaxCommits
    exit $LASTEXITCODE
}

Write-Host '[test] All unit tests passed.'
exit 0
