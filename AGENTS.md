# Agent guide: msys2-apiss-sync

This repository builds cross-platform TypeScript tooling to replay upstream
MSYS2 package history into `cygapiss/msys2-apiss`.

## Read first

- [docs/README.md](docs/README.md) - documentation entry (pipeline architecture)
- [docs/usage.md](docs/usage.md) - operator commands and local testing
- [docs/mirror-merge.md](docs/mirror-merge.md) - mirror-merge (`yarn mirror-merge`)
- [docs/mirror-init.md](docs/mirror-init.md) - mirror-init (`yarn mirror-init`; [Tooling branch layout](docs/mirror-init.md#tooling-branch-layout))
- [docs/mirror-poll.md](docs/mirror-poll.md) - mirror-poll (`yarn mirror-poll`)
- [docs/mirror-sync.md](docs/mirror-sync.md) - mirror-sync (CI on mirror repos)
- [.cursor/rules/](.cursor/rules/) - coding and workflow conventions

## Key facts

- **Sources**: mirror `msys2-apiss/*`, commit footer `UpstreamRepo` `msys2/MSYS2-packages` -> `ports/`, `msys2/MINGW-packages` -> `ports-mingw/`
- **Destination**: `cygapiss/msys2-apiss`, branch `upstream`
- **Base commit**: `6fc20894663468a04dd4986a8b1c15a9d5ae8649` (parent of first replayed commit)
- **Strategy**: deterministic date-ordered replay; same SHAs on every rebuild at same pins
- **Triggers**: mirror-poll (~hourly cron, push to `main`); mirror-sync -> mirror-merge `workflow_dispatch` after mirrors advance. Expect ~1 h end-to-end latency.
- **Runtime**: Node.js 26+; TypeScript runs directly with Node type stripping
- **State**: destination branches (`upstream`, `upstream-ports`, `upstream-ports-mingw`) hold replay progress and resume cursors; no checkpoint file
- **Tooling branches**: mirror-init install branches **`msys2-apiss-mirror-sync`** and **`msys2-apiss-mirror-merge`** follow [Tooling branch layout](docs/mirror-init.md#tooling-branch-layout)

## Do not

- Ship untestable instructions (dot-source-only recipes); use runnable scripts -- see `.cursor/rules/human-testable.mdc` and [`docs/usage.md`](docs/usage.md)
- Use Cursor internal plans (`~/.cursor/plans/`) or untracked shadow design files; edit committed docs in `docs/` (see `.cursor/rules/documentation.mdc`)
- Use `git merge` of entire upstream repos into destination (use replay instead)
- Add platform-specific APIs in shared sync code
- Commit PATs or tokens; use GitHub Actions secrets only
- Modify upstream `msys2/*` repositories from this project

## Typical tasks

| Task | Location |
|------|----------|
| Sync logic | `src/mirror-init/`, `src/mirror-poll/`, `src/mirror-sync/`, `src/mirror-merge/`, `src/git/` |
| Config | `config/mirror-merge.json`, `config/mirror-poll.json` |
| Replay cursors | destination branches `upstream`, `upstream-ports`, `upstream-ports-mingw` |
| CI | `.github/workflows/` |
| Design changes | update [`docs/README.md`](docs/README.md) first; then matching stage doc |
| Run sync | [`docs/usage.md`](docs/usage.md) |
| Local testing | `yarn test`, dry-run -- [`docs/usage.md`](docs/usage.md) |
| Add a mirror | [`docs/add-mirror.md`](docs/add-mirror.md) |
