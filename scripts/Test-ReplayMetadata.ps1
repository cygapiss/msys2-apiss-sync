#requires -Version 7.0
<#
.SYNOPSIS
    Step 3/4: validate replay-queue.json manifest (no git).
#>
[CmdletBinding()]
param(
    [string] $QueuePath,
    [int] $MaxCommits = 0
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot/lib/Sync-Common.ps1"
Set-SyncUtf8Environment
. "$PSScriptRoot/lib/Sync-Validate.ps1"

try {
    $result = Invoke-ReplayMetadataPreflight `
        -RepoRoot $repoRoot `
        -QueuePath $QueuePath `
        -MaxCommits $MaxCommits

    Write-SyncLog "Step 3/4 complete; $($result.QueueCount) commit(s) validated."
    exit 0
}
catch {
    Write-SyncLog $_.Exception.Message -Level Error
    if ($_.ScriptStackTrace) {
        Write-SyncLog $_.ScriptStackTrace -Level Error
    }
    exit 1
}
