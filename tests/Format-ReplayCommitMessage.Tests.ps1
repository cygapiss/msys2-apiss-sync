#requires -Version 7.0

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. "$repoRoot/scripts/lib/Sync-GitReplay.ps1"

$script:Failed = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)] $Expected,
        [Parameter(Mandatory)] $Actual
    )

    if ($Expected -ne $Actual) {
        Write-Host "[FAIL] $Name"
        Write-Host "  expected: $Expected"
        Write-Host "  actual:   $Actual"
        $script:Failed++
        return
    }

    Write-Host "[PASS] $Name"
}

$metaWithBody = [pscustomobject]@{
    Subject = 'update foo'
    Body = "line one`nline two"
}

$expectedWithBody = @"
[ports] update foo

line one
line two
Source: msys2/MSYS2-packages@abc123
"@ -replace "`r`n", "`n"

Assert-Equal -Name 'message with body' -Expected $expectedWithBody -Actual (
    Format-ReplayCommitMessage `
        -SortKey 'ports' `
        -Metadata $metaWithBody `
        -UpstreamRepo 'msys2/MSYS2-packages' `
        -UpstreamSha 'abc123'
)

$metaNoBody = [pscustomobject]@{
    Subject = 'update bar'
    Body = ''
}

$expectedNoBody = @"
[ports-mingw] update bar
Source: msys2/MINGW-packages@def456
"@ -replace "`r`n", "`n"

Assert-Equal -Name 'message without body' -Expected $expectedNoBody -Actual (
    Format-ReplayCommitMessage `
        -SortKey 'ports-mingw' `
        -Metadata $metaNoBody `
        -UpstreamRepo 'msys2/MINGW-packages' `
        -UpstreamSha 'def456'
)

if ($script:Failed -gt 0) {
    Write-Host "FAILED: $script:Failed test(s)"
    exit 1
}

Write-Host 'Format-ReplayCommitMessage tests passed.'
exit 0
