# mirror-sync

mirror-sync force-pushes each mirror's **content branch** to match upstream and optionally
dispatches mirror-merge. Pipeline: [`README.md`](README.md). Code:
`src/mirror-sync/`. CI bundle: `config/mirror-template/toolings/mirror-sync.mjs`
(`yarn run pack`). Workflow template:
[`mirror-sync.yml`](../config/mirror-template/mirror-sync.yml) on branch
**`msys2-apiss-mirror-sync`** ([Tooling branch layout](mirror-init.md#tooling-branch-layout)).

There is no local `yarn mirror-sync`; runs happen on each `msys2-apiss/*` mirror repo
via GitHub Actions.

## Role

For each `Branches[]` entry in `config/mirror-sync/<repo>.json`:

1. Ensure `upstream` remote = `UpstreamUrl`
2. `git fetch upstream <UpstreamBranch>`
3. Compare with `origin/<MirrorBranch>` (content branch, not tooling branch)
4. If different: force-push upstream tip to the mirror content branch (`PushViaSsh` when set)
5. If `SyncTags`: fetch and push tags

Content branches (`master` or configured `Mirror`) hold pure upstream history with
**no workflow files**. Workflow YAML and the bundled CLI run from
**`msys2-apiss-mirror-sync`** only.

| Outcome | Next step |
|---------|-----------|
| Tips already match | No push; mirror-merge not notified |
| Content branch advanced, `Notify.Enabled: false` | Mirror updated only |
| Content branch advanced, `Notify.Enabled: true` | Dispatch mirror-merge ([`mirror-merge.md`](mirror-merge.md)) |

Package mirrors (`MSYS2-packages`, `MINGW-packages`) use `Notify.Enabled: true`.
Mirror-only repos set `Notify.Enabled: false`.

## Triggers

| Trigger | Where |
|---------|--------|
| mirror-poll | [`mirror-poll.md`](mirror-poll.md) dispatches `workflow_dispatch_mirror_sync` |
| mirror-init `--push` | [`mirror-init.md`](mirror-init.md) dispatches after tooling push |
| `workflow_dispatch` | Manual on ref **`msys2-apiss-mirror-sync`** |

Input event type: `workflow_dispatch_mirror_sync`. mirror-sync -> mirror-merge uses
`workflow_dispatch_mirror_merge` on package mirrors only.

## Config

Per-mirror file: **`config/mirror-sync/<repo>.json`** (canonical in tooling repo; CI
downloads at runtime -- not committed on mirror repos).

| Key | Purpose |
|-----|---------|
| `UpstreamUrl` | External upstream git URL |
| `Branches[]` | `Upstream` branch to fetch; `Mirror` content branch to push |
| `Notify.Enabled` | When true, dispatch mirror-merge after advance |
| `Notify.Repository` | Destination repo (default `cygapiss/msys2-apiss`) |
| `PushViaSsh` | Use SSH push (large mirrors, e.g. gcc) |
| `SyncTags` | Mirror tags when true |
| `Description`, `Url` | Optional; mirror-init `gh repo create` metadata |

Register new mirrors: [`add-mirror.md`](add-mirror.md). Repo must appear in
`config/mirror-poll.json` `Repos`.

## CI secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `SYNC_DISPATCH_TOKEN` | Package mirror repos with `Notify.Enabled: true` | mirror-sync notify step runs `gh workflow run mirror-merge.yml` |
| `MIRROR_PUSH_SSH_KEY` | Mirrors with `PushViaSsh: true` | SSH deploy key for `git push` |

Mirror-only repos use `github.token` for checkout and push when `SYNC_DISPATCH_TOKEN`
is unset. PAT setup: [`usage.md`](usage.md#setup-sync_dispatch_token).

**SSH push (`PushViaSsh`):** add deploy key with write access on the mirror repo and
set `MIRROR_PUSH_SSH_KEY` (secret alone is not enough). See
[`usage.md`](usage.md#setup-mirror_push_ssh_key).

mirror-poll uses the same PAT on the tooling repo to dispatch mirror-sync.

## Operator flows

**Routine (CI):** mirror-poll cron -> mirror-sync when upstream ahead -> mirror-merge when
`Notify.Enabled`.

**Watch a run:**

```bash
gh run watch --repo msys2-apiss/MSYS2-packages
gh run watch --repo msys2-apiss/mingw-w64
```

**Manual dispatch** (workflow on tooling branch, not content branch):

```bash
gh workflow run mirror-sync.yml --repo msys2-apiss/<repo> --ref msys2-apiss-mirror-sync \
  -f event_type=workflow_dispatch_mirror_sync
```

**New mirror dispatch 404:** after first [`mirror-init --push`](mirror-init.md), GitHub
may return **404** until `mirror-sync.yml` is indexed on **`msys2-apiss-mirror-sync`**.
Pushing the content branch alone does not fix this. Wait a few minutes and re-run:

```bash
yarn mirror-init --push --repo <name> --skip-fetch
```

Check registration: `gh api repos/msys2-apiss/<repo>/actions/workflows -q ".total_count"`
returns `1` when ready.

## Mirror list (reference)

| Mirror | Upstream (config) | mirror-merge replay |
|--------|-------------------|---------------------|
| `MSYS2-packages` | `msys2/MSYS2-packages` | yes (`ports/`) |
| `MINGW-packages` | `msys2/MINGW-packages` | yes (`ports-mingw/`) |
| Others in `mirror-poll.json` `Repos` | per `config/mirror-sync/*.json` | per `Notify.Enabled` |

## Related

- [`mirror-poll.md`](mirror-poll.md) -- triggers mirror-sync
- [`mirror-init.md`](mirror-init.md) -- installs workflow YAML on tooling branch
- [`mirror-merge.md`](mirror-merge.md) -- after package mirror advance
- [`add-mirror.md`](add-mirror.md) -- add `config/mirror-sync/<repo>.json`
- [`usage.md`](usage.md) -- GitHub operator flow and secrets
