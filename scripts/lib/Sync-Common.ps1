#requires -Version 7.0

function Write-SyncLog {
    param(
        [Parameter(Mandatory)]
        [string] $Message,
        [ValidateSet('Info', 'Warn', 'Error')]
        [string] $Level = 'Info'
    )
    $prefix = switch ($Level) {
        'Warn' { '[sync][warn]' }
        'Error' { '[sync][error]' }
        default { '[sync]' }
    }
    Write-Host "$prefix $Message"
}

function Invoke-Git {
    param(
        [string] $RepoPath,
        [Parameter(Mandatory)]
        [string[]] $GitArgs
    )

    $allArgs = if ($RepoPath) { @('-C', $RepoPath) + $GitArgs } else { $GitArgs }
    $output = & git @allArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        $cmd = "git $($allArgs -join ' ')"
        throw "git command failed ($cmd): $output"
    }
    return $output
}

function Get-SyncRepoRoot {
    param([string] $StartPath = $PSScriptRoot)

    $current = Resolve-Path -LiteralPath $StartPath
    while ($true) {
        $configPath = Join-Path $current.Path 'config/sync.json'
        if (Test-Path -LiteralPath $configPath) {
            return $current.Path
        }
        $parent = Split-Path -Parent $current.Path
        if (-not $parent -or $parent -eq $current.Path) {
            throw 'Could not locate sync repo root (config/sync.json not found).'
        }
        $current = Resolve-Path -LiteralPath $parent
    }
}

function Get-WorkDirectory {
    param([Parameter(Mandatory)][string] $RepoRoot)
    $work = Join-Path $RepoRoot '.work'
    if (-not (Test-Path -LiteralPath $work)) {
        New-Item -ItemType Directory -Path $work | Out-Null
    }
    return $work
}

function ConvertTo-UnixLineEndings {
    param([string] $Text)
    if ($null -eq $Text) { return '' }
    return ($Text -replace "`r`n", "`n" -replace "`r", "`n")
}

function Set-SyncUtf8Environment {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    [Console]::InputEncoding = $utf8
    $OutputEncoding = $utf8
    $env:LANG = 'C.UTF-8'
    $env:LC_ALL = 'C.UTF-8'
}

function Invoke-GitText {
    param(
        [string] $RepoPath,
        [Parameter(Mandatory)]
        [string[]] $GitArgs
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new('git')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $psi.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)

    if ($RepoPath) {
        [void]$psi.ArgumentList.Add('-C')
        [void]$psi.ArgumentList.Add($RepoPath)
    }
    foreach ($arg in $GitArgs) {
        [void]$psi.ArgumentList.Add($arg)
    }

    $process = [System.Diagnostics.Process]::Start($psi)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($process.ExitCode -ne 0) {
        $cmd = if ($RepoPath) { "git -C $RepoPath $($GitArgs -join ' ')" } else { "git $($GitArgs -join ' ')" }
        throw "git command failed ($cmd): $stderr"
    }

    return $stdout
}

function Parse-GitCommitObject {
    param(
        [Parameter(Mandatory)]
        [string] $Raw
    )

    $raw = ConvertTo-UnixLineEndings -Text $Raw
    $authorName = $null
    $authorEmail = $null
    $authorDate = 0

    foreach ($line in ($raw -split "`n")) {
        if ($line -match '^author (.+) <([^>]+)> (\d+) ') {
            $authorName = $Matches[1]
            $authorEmail = $Matches[2]
            $authorDate = [int64]$Matches[3]
            break
        }
    }

    if (-not $authorName) {
        throw 'Could not parse author from git commit object.'
    }

    $blankIdx = $raw.IndexOf("`n`n")
    $message = if ($blankIdx -ge 0) { $raw.Substring($blankIdx + 2) } else { '' }
    $message = $message.TrimEnd("`n")
    $msgParts = $message -split "`n", 2
    $subject = $msgParts[0]
    $body = if ($msgParts.Count -gt 1) { $msgParts[1].TrimEnd() } else { '' }

    return [pscustomobject]@{
        AuthorName = $authorName
        AuthorEmail = $authorEmail
        AuthorDate = $authorDate
        Subject = $subject
        Body = $body
    }
}
