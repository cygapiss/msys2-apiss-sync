#requires -Version 7.0

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. "$repoRoot/scripts/lib/Sync-Common.ps1"
. "$repoRoot/scripts/lib/Sync-Git.ps1"

$script:Failed = 0

function Assert-True {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][bool] $Condition
    )

    if (-not $Condition) {
        Write-Host "[FAIL] $Name"
        $script:Failed++
        return
    }

    Write-Host "[PASS] $Name"
}

function Assert-Equal {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)] $Expected,
        [Parameter(Mandatory)] $Actual
    )

    Assert-True -Name $Name -Condition:($Expected -eq $Actual)
}

$fieldSep = [char]0x1f
$recordSep = [char]0x1e

$normalBody = "subject line`n`nbody line`n"
$normalRecord = @(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Example User',
    'user@example.com',
    '1700000000',
    '1700000001',
    $normalBody
) -join $fieldSep
$normalRecord += $recordSep

$emptyEmailRecord = @(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'Mehrdad',
    '',
    '1520670164',
    '1520833463',
    "/etc/post-install and /etc/profile.d script optimizations`n"
) -join $fieldSep
$emptyEmailRecord += $recordSep

$entries = ConvertFrom-UpstreamCommitLogMetadataText -Text $normalRecord
Assert-Equal -Name 'record count' -Expected 1 -Actual $entries.Count
Assert-Equal -Name 'normal sha' -Expected 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -Actual $entries[0].Sha
Assert-Equal -Name 'normal author name' -Expected 'Example User' -Actual $entries[0].AuthorName
Assert-Equal -Name 'normal author email' -Expected 'user@example.com' -Actual $entries[0].AuthorEmail
Assert-Equal -Name 'normal author date' -Expected 1700000000 -Actual $entries[0].AuthorDate
Assert-Equal -Name 'normal committer date' -Expected 1700000001 -Actual $entries[0].CommitterDate
Assert-Equal -Name 'normal subject' -Expected 'subject line' -Actual $entries[0].Subject
Assert-True -Name 'normal body' -Condition:($entries[0].Body.Trim() -eq 'body line')

$entries = ConvertFrom-UpstreamCommitLogMetadataText -Text ($normalRecord + $emptyEmailRecord)
Assert-Equal -Name 'two records' -Expected 2 -Actual $entries.Count
Assert-Equal -Name 'empty email author name' -Expected 'Mehrdad' -Actual $entries[1].AuthorName
Assert-Equal -Name 'empty email author email' -Expected '' -Actual $entries[1].AuthorEmail

$empty = ConvertFrom-UpstreamCommitLogMetadataText -Text ''
Assert-Equal -Name 'empty text' -Expected 0 -Actual $empty.Count

$trailingNewline = $normalRecord + "`n"
$trailing = ConvertFrom-UpstreamCommitLogMetadataText -Text $trailingNewline
Assert-Equal -Name 'trailing newline' -Expected 1 -Actual $trailing.Count

if ($script:Failed -gt 0) {
    Write-Host "FAILED: $script:Failed test(s)"
    exit 1
}

Write-Host 'All ConvertFrom-UpstreamCommitLogMetadataText tests passed.'
exit 0
