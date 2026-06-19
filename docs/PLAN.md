# MSYS2-UWP upstream sync plan

Sync upstream package history from [msys2/MINGW-packages](https://github.com/msys2/MINGW-packages)
and [msys2/MSYS2-packages](https://github.com/msys2/MSYS2-packages) into
[msys2-uwp/msys2-uwp](https://github.com/msys2-uwp/msys2-uwp).

## Goals

- Cross-platform PowerShell 7 (`pwsh`) scripts runnable locally and in CI.
- Incremental sync via mirror dispatch; hourly poll fallback (`PollIntervalMinutes = 60`).
- Auto-push three destination branches after replay.
- Deterministic date-ordered replay with preserved upstream metadata.

## Configuration

All sync constants live in [`config/config.psd1`](config/config.psd1) only (read-only at
runtime). No `sync.json`, no `.sync/state.json`.

Not in config: GitHub secrets, CLI flags (`-Clean`, `-DryRun`, `-DestinationPath`).

See committed [`config/config.psd1`](config/config.psd1) for full schema: `Destination`,
`Sources`, `Mirrors`, `Replay`, `PollIntervalMinutes`, `DailyReconciliationCron`.

## Destination branches

All in `msys2-uwp/msys2-uwp`:

| Branch | Role |
|--------|------|
| `upstream` | Linear replayed history tip |
| `upstream-ports` | Last replayed MSYS2-packages upstream SHA |
| `upstream-ports-mingw` | Last replayed MINGW-packages upstream SHA |

**Bootstrap:** any of the three branches missing, or after `-Clean` -- full replay, no age gate.

**Incremental:** all three exist -- resume from cursors, apply age gate.

## Sync entry point

Single script: [`scripts/Sync-Upstream.ps1`](scripts/Sync-Upstream.ps1)

```powershell
./scripts/Sync-Upstream.ps1 -DestinationPath .work/destination/msys2-uwp [-Clean] [-DryRun] [-MaxCommits n] [-Push]
```

No `-Mode`. Full rebuild = `-Clean` then sync.

## Script layout

```
scripts/
  Sync-Upstream.ps1
  lib/
    Sync-Common.ps1
    Sync-Config.ps1
    Sync-Git.ps1            # clone, branch refs, -Clean, push
    Sync-GitHistory.ps1     # retrieve from cursor branches
    Sync-GitQueue.ps1       # merge-sort by replay rank
    Sync-GitReplay.ps1      # apply tree + commit (phase 1c)
tests/
  *.Tests.ps1
  Test-Sync.ps1
```

## Three-stage pipeline

1. **Retrieve** (`Sync-GitHistory.ps1`) -- `git log --reverse` from cursor SHA to mirror tip per source.
2. **Sort** (`Sync-GitQueue.ps1`) -- two-pointer merge by replay rank (not global sort).
3. **Replay** (`Sync-GitReplay.ps1`) -- one linear destination commit per queue entry.

### Sort algorithm (replay rank)

Compare two entries using keys in order until one differs:

| Priority | Key | Order |
|----------|-----|-------|
| 1 | CommitterDateUnix | ASC |
| 2 | AuthorDateUnix | ASC |
| 3 | SourceId | ASC (`ports` before `ports-mingw`) |
| 4 | Sha | ASC hex |

Within each source, git history order is preserved. Cross-source order interleaves by timeline.

### Linearizing non-linear upstream history

Upstream repos may have merge commits; destination `upstream` is strictly linear. Each queue
entry becomes one destination commit with parent = previous `replayTip`. File delta comes
from `diff-tree sha^1 sha` on the mirror; paths map into `ports/` or `ports-mingw/` only.
Never `git merge` on destination.

## Deterministic replay

Replay rank merge, normalized LF commit message template, path prefix mapping, preserved
author/committer metadata. Same mirror tips + `BaseCommit` + `ReplaySpecVersion` yield
identical destination SHAs on full replay.

### Commit message template

```
[<source-id>] <upstream subject>

<upstream body, unchanged>

Source: <upstream-repo>@<upstream-full-sha>
```

## Triggers

- Primary: mirror repos + `repository_dispatch`
- Fallback: hourly cron (`PollIntervalMinutes = 60`) and daily (`DailyReconciliationCron`)

## Implementation phases

### Phase 0 - Plan and rules

- [x] docs/PLAN.md, AGENTS.md, Cursor rules

### Phase 1a-d - Sync script

- [ ] 1a Foundation (config.psd1, Sync-Common/Config/Git)
- [ ] 1b Retrieve + sort (GitHistory, GitQueue) + unit tests
- [ ] 1c Replay one-by-one (GitReplay)
- [ ] 1d Sync-Upstream.ps1 orchestration

### Phase 2 - GitHub Actions

- [ ] sync-upstream.yml calls Sync-Upstream.ps1
- [ ] Poll/cron reference config.psd1
- [ ] Push 3 branches; no state commit

### Phase 3 - Mirror repos + dispatch

### Phase 4 - Initial bootstrap + enable schedule
