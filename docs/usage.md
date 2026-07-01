# Usage

How to run sync on GitHub and on your machine.

Pipeline: `msys2/*` upstream -> `msys2-apiss/*` mirrors -> `msys2-apiss/msys2-apiss`
on branches `upstream`, `upstream-ports`, `upstream-ports-mingw`.

Local testing and debugging: [`run-local.md`](run-local.md). Design and flags:
[`PLAN.md`](PLAN.md). Block 1: [`mirror-init.md`](mirror-init.md). Block 2:
[`mirror-poll.md`](mirror-poll.md). Block 3: [`mirror-sync.md`](mirror-sync.md). Block 4:
[`mirror-merge.md`](mirror-merge.md).

## GitHub (`gh`)

Block 2: [`mirror-poll.md`](mirror-poll.md). Block 3: [`mirror-sync.md`](mirror-sync.md).
Block 4: [`mirror-merge.md`](mirror-merge.md) (`mirror-merge.yml` on **`msys2-apiss-mirror-merge`**;
installed by [`mirror-init`](mirror-init.md)).

Requires the [GitHub CLI](https://cli.github.com/) (`gh auth login`) with access to
`msys2-apiss`. Local commands use **git** and **gh** only; no env secrets.
`SYNC_DISPATCH_TOKEN` and `MIRROR_PUSH_SSH_KEY` are GitHub Actions secrets on
remote repos (see below); set them with `gh secret set`.

### Setup `SYNC_DISPATCH_TOKEN`

One PAT is reused in three places:

| Where | Block | Purpose |
|-------|-------|---------|
| `msys2-apiss/msys2-apiss-sync` | Block 2 | [`mirror-poll.md`](mirror-poll.md) (`GH_TOKEN` dispatches Block 3) |
| `msys2-apiss/MSYS2-packages`, `MINGW-packages` | Block 3 | [`mirror-sync.md`](mirror-sync.md) notify step dispatches Block 4 |

Package mirrors **`MSYS2-packages`** and **`MINGW-packages`** need the secret on
the mirror repo (`Notify.Enabled: true`). The tooling repo needs the same PAT
so Block 2 can trigger Block 3 when tips differ ([`mirror-poll.md`](mirror-poll.md)).

1. **Create a PAT** ([fine-grained](https://github.com/settings/personal-access-tokens/new) recommended, or [classic](https://github.com/settings/tokens/new)):
   - **Fine-grained:** resource owner = `msys2-apiss`; repository access =
     `MSYS2-packages`, `MINGW-packages`, and `msys2-apiss-sync`; permissions:
     **Contents** Read and write, **Workflows** Read and write, **Metadata**
     Read-only.
   - **Classic:** scopes **`repo`**, **`workflow`**.
2. **Add the secret on each package mirror** and on the tooling repo (Block 2;
   see [`mirror-poll.md`](mirror-poll.md)):

```bash
gh secret set SYNC_DISPATCH_TOKEN --repo msys2-apiss/MSYS2-packages
gh secret set SYNC_DISPATCH_TOKEN --repo msys2-apiss/MINGW-packages
gh secret set SYNC_DISPATCH_TOKEN --repo msys2-apiss/msys2-apiss-sync
```

Mirror-only repos (`aports`, `glibc`, `gcc`, etc.) do not need this secret;
[`mirror-sync`](mirror-sync.md) uses `github.token` for checkout and push when the secret
is unset.

### Setup `MIRROR_PUSH_SSH_KEY` (SSH push, large mirrors)

When `PushViaSsh` is true in `config/mirror-sync/<repo>.json` (e.g. gcc). See
[`mirror-sync.md`](mirror-sync.md#ci-secrets) for which repos use SSH push.

1. **Generate a deploy key** (write access) or reuse one org-wide key pair:

```bash
ssh-keygen -t ed25519 -f mirror-push -N "" -C "msys2-apiss-mirror-push"
```

2. **Add the public key** (`mirror-push.pub`) as a **deploy key** with write
   access on each mirror repo that uses SSH push (Settings -> Deploy keys).
   The Actions secret alone is not enough; GitHub must have the matching public
   key on the repo.

```powershell
gh api repos/msys2-apiss/gcc/keys `
  -f title="mirror-push" `
  -f key="$(Get-Content -Raw mirror-push.pub)" `
  -f read_only=false
```

3. **Add the private key** as secret `MIRROR_PUSH_SSH_KEY` on those repos (or as
   an organization secret shared by all mirrors):

```powershell
Get-Content -Raw mirror-push | gh secret set MIRROR_PUSH_SSH_KEY --repo msys2-apiss/gcc
```

SSH is used only for `git push` on repos with `PushViaSsh` true.

### 1. Refresh mirrors from upstream

See [`mirror-poll.md`](mirror-poll.md) and [`mirror-sync.md`](mirror-sync.md) for cron,
tip compare, watch runs, and manual dispatch.

### 2. Replay destination

See [`mirror-merge.md`](mirror-merge.md) for Block 4 CI trigger, watch, and recovery.

### 3. Verify CI run

See [`mirror-merge.md`](mirror-merge.md#operator-flows) and
[`run-local.md`](run-local.md#verify-replay-manifest) for branch tips and dry-run verify.

### 4. Recovery and special cases

See [`mirror-merge.md`](mirror-merge.md#operator-flows) (`--clean`, resume).

## Local machine

Requires **Node.js 26+**, **Yarn**, **git**, and network (mirror clone/fetch).

From the repository root.

### Mirrors

```bash
yarn fetch-mirrors
yarn fetch-mirrors --push
yarn fetch-mirrors --skip-fetch
yarn fetch-mirrors --skip-fetch --push
```

`--push` runs `git push --force-with-lease origin msys2-apiss-sync` on each mirror when
local `msys2-apiss-sync` differs from `origin/msys2-apiss-sync`. Requires push access to `msys2-apiss/*`
mirror repos.

Tip compare and Block 3 dispatch: [`mirror-poll.md`](mirror-poll.md),
[`mirror-sync.md`](mirror-sync.md). Block 1 [`yarn mirror-init --push`](mirror-init.md)
pushes tooling branches and dispatches Block 3 directly (no tip compare). Block 4 replay:
[`mirror-merge.md`](mirror-merge.md).
