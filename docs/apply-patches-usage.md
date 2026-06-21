# Apply mirror patches (path mapping)

Apply a single upstream commit (or range) from the local mirror clones into a
destination checkout, with paths rewritten into `ports/` or `ports-mingw/`.

Full sync replay: [`usage.md`](usage.md). Design: [`PLAN.md`](PLAN.md).

## Path mapping

`--source ports` is not a separate repo named "ports". It selects a mirror clone
and the destination subfolder where paths are rewritten.

| `--source` | GitHub mirror | Local mirror path | Upstream | Destination subdir |
|------------|---------------|-------------------|----------|----------------------|
| `ports` | `msys2-apiss/MSYS2-packages` | `.work/mirrors/MSYS2-packages` | `msys2/MSYS2-packages` | `ports/` |
| `ports-mingw` | `msys2-apiss/MINGW-packages` | `.work/mirrors/MINGW-packages` | `msys2/MINGW-packages` | `ports-mingw/` |

Example path rewrite:

| Mirror | Upstream path | Destination path |
|--------|---------------|------------------|
| `MSYS2-packages` | `cmake/PKGBUILD` | `ports/cmake/PKGBUILD` |
| `MINGW-packages` | `mingw-w64-foo/PKGBUILD` | `ports-mingw/mingw-w64-foo/PKGBUILD` |

## Fetch mirrors

Clone or update both mirror repos before applying patches:

```bash
yarn fetch-mirrors
```

This creates or refreshes bare clones under `.work/mirrors/`:

- `.work/mirrors/MSYS2-packages` from `https://github.com/msys2-apiss/MSYS2-packages.git`
- `.work/mirrors/MINGW-packages` from `https://github.com/msys2-apiss/MINGW-packages.git`

On first run each mirror is cloned with `git clone --mirror`. Later runs run
`git fetch --prune origin`. Output includes each mirror path and `master` tip
SHA, for example:

```text
[sync] Fetching mirrors
[sync] Ports mirror: .work/mirrors/MSYS2-packages (tip master = aac3de01)
[sync] PortsMingw mirror: .work/mirrors/MINGW-packages (tip master = ...)
[sync] Done.
```

Skip network fetch when mirrors are already present and up to date:

```bash
yarn fetch-mirrors --skip-fetch
```

`apply-mirror-patch` uses the same mirror initialization. If a mirror is missing,
omit `--skip-fetch` on that command and it will clone automatically; otherwise
run `yarn fetch-mirrors` first and pass `--skip-fetch` to patch commands.

Check a mirror tip:

```bash
git -C .work/mirrors/MSYS2-packages rev-parse master
git -C .work/mirrors/MINGW-packages rev-parse master
```

## Command

```bash
yarn apply-mirror-patch --source <ports|ports-mingw> --commit <sha> --destination-path <path>
```

`--source` also accepts `MSYS2-packages`, `MINGW-packages`, `Ports`, and
`PortsMingw`.

## Stage one commit

Same index logic as `yarn sync` (no destination commit unless
`--create-commit`):

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit aac3de01 \
  --destination-path .work/destination/msys2-apiss
```

MINGW mirror:

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports-mingw \
  --commit <sha> \
  --destination-path .work/destination/msys2-apiss
```

Without `--create-commit`, changes are staged only. Inspect with:

```bash
git -C .work/destination/msys2-apiss diff --cached
```

## Print a remapped unified diff

For manual `git apply` in the destination repo:

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit <sha> \
  --print-patch > mapped.patch
```

Write to a file via `--output` (requires `--print-patch`):

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit <sha> \
  --print-patch \
  --output mapped.patch
```

## List mapped paths only

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit <sha> \
  --list-files \
  --destination-path .work/destination/msys2-apiss
```

## Apply a commit range

Oldest-first git order (`rev-list --reverse`):

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --range abc123..def456 \
  --destination-path .work/destination/msys2-apiss
```

Use either `--range` or `--commit`, not both. Repeat `--commit` for a small
explicit list:

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit abc123 \
  --commit def456 \
  --destination-path .work/destination/msys2-apiss
```

## Stage and create a replay commit

Preserves upstream author/committer name, email, and dates; message uses the
same template as full sync:

```bash
yarn apply-mirror-patch --skip-fetch \
  --source ports \
  --commit <sha> \
  --destination-path .work/destination/msys2-apiss \
  --create-commit
```

## Flags

| Flag | Purpose |
|------|---------|
| `--source` | `ports`, `ports-mingw`, or mirror/repo alias (required) |
| `--commit` | Upstream mirror SHA (required unless `--range`) |
| `--range` | Git range `A..B` on the mirror (oldest first) |
| `--destination-path` | Destination clone path (required for index apply) |
| `--skip-fetch` | Do not fetch mirrors |
| `--print-patch` | Print remapped unified diff to stdout |
| `--output` | Write patch file (with `--print-patch`) |
| `--list-files` | List mapped paths only |
| `--create-commit` | Create a replay commit after staging |
| `--parent` | Override first parent for the diff (default: `sha^1`) |

`--create-commit` cannot be combined with `--print-patch` or `--list-files`.
