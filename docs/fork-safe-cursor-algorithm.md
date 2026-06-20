# Fork-safe cursor branch algorithm

When replay pauses or aborts, `upstream-ports` and `upstream-ports-mingw` must
point at destination commits whose `Source: ...@<sha>` footer is still a valid
resume cursor. Advancing a cursor branch too early (before parallel fork siblings
are replayed) would skip commits on interrupt.

This document describes how fork-safe positions are precomputed in prepare
(before replay). Implementation: `src/lib/queue.ts`
(`precomputeSourceCursorBranchSafeFlags`, `precomputeReplayCursorBranchSafeFlags`).

See also `docs/PLAN.md` (Interrupted-run state, fork-safe cursor branches).

## Problem

For one source queue (git `log --reverse` order, oldest first), after replaying
entry at index `i` we may want to move that source's cursor branch to the
destination commit for `queue[i]`.

**Safe** at `i` when every later queue entry from that source is a **descendant**
of `queue[i]` in the mirror DAG.

At a fork:

```text
      Base
     /    \
  Left    Right
```

Queue: `Base`, `Left`, `Right`.

- After `Base`: safe (both branches descend from Base).
- After `Left`: unsafe (`Right` is a sibling, not a descendant of `Left`).
- After `Right`: safe (nothing left).

## Mainline color (first parent)

Upstream history is a DAG. We do not scan all pairs `(i, j)`.

**Color rule** (matches merge/fork structure in git):

1. Walk from mirror tip following **first parent only** (`parent1`). Those
   commits form the **mainline** (safe spine).
2. Commits **not** on that spine are **side-branch** (parent2 / fork sibling
   lines). A side-branch commit is **never** a safe cursor position.
3. At a merge, `parent1` continues mainline; commits that lived only on
   `parent2` are absorbed when the merge commit is reached.

`buildFirstParentSpine(parentMap, tipSha)` marks mainline SHAs in one walk
(O(depth), typically thousands of commits, done once per source).

## Open side branches in the suffix

Scan the queue **backward** (suffix = entries not yet processed when standing
at `i`).

Track **open side tips**: non-mainline commits still in the suffix, collapsed
to an **antichain** (incomparable branch heads only). When two side tips are
ancestor/descendant, keep the descendant tip.

For index `i`:

- If `queue[i]` is **not** on mainline: `safe[i] = false`.
- If `queue[i]` is on mainline: `safe[i] = true` only when every open side tip
  in the suffix is a **descendant** of `queue[i]` in the parent map.

Replay uses the precomputed flag at each index (O(1) lookup). Cursor branches
update only when `safe[i]` is true and the destination SHA changed.

## Example

Fork with `Right` on mainline (first-parent chain from tip):

| Index | Commit | Mainline? | safe |
|-------|--------|-----------|------|
| 0     | Base   | yes       | yes  |
| 1     | Left   | no        | no   |
| 2     | Right  | yes       | yes  |

At `Base`, suffix has open side tip `Left`; `Left` descends from `Base`, so
mainline `Base` is safe. At `Left`, side commits are never safe.

## What is k (and why it is not a tuning knob)

Some descriptions use **O(n * k)** for the backward queue scan:

- **n** = queue length for one source (~11k ports, ~57k mingw).
- **k** = number of open side tips in the antichain **at that step** (not a
  config value and not n).

**k is usually 0 or 1** on mostly-linear package history: one mainline, no
parallel side branch waiting in the suffix.

**k briefly grows** when a fork puts multiple incomparable side tips in the
suffix (e.g. two sibling branches before either merges). It drops back when
those commits are passed or absorbed by a merge on mainline.

So **k is not something you choose**. It is how many parallel non-mainline
branch heads are still "open" at a point in the queue. The algorithm does not
loop over all n suffix entries; it only checks ancestor relations against those
k tips (with memoization on the DAG).

Worst-case k can be larger on pathological fork-heavy graphs, but MSYS2 package
repos are dominated by first-parent mainline with occasional side merges.

## Per-source and merged queue

`precomputeReplayCursorBranchSafeFlags`:

1. Split merged queue into ports and ports-mingw lists (git order preserved).
2. Run mainline + side-antichain precompute on each list with that source's
   parent map.
3. For merged index `i`, `safe[i] = portsSafe[portsIndex] && mingwSafe[mingwIndex]`
   (both sources must be fork-safe at that replay point).

## Prepare vs replay

| Phase   | Work |
|---------|------|
| Prepare | Parent maps (`rev-list --parents`), spine, safe flags |
| Replay  | O(1) flag lookup; git only for diff/commit; cursor branch writes only when safe and SHA changed |

This matches the pipeline: fetch history, prepare expensive graph work, then
replay.
