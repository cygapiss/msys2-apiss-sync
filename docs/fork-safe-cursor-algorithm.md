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

## Queue order is already topological

Each source list comes from `git log --reverse`: parents appear before children.
The merged replay queue is a topological interleaving of the two source lists.

No separate sort step is needed. We scan that order **once**, from the **last**
commit to the **first**.

## Mainline color (first parent)

Before the backward scan, mark mainline SHAs:

1. Walk from mirror tip following **first parent only** (`parent1`).
2. Those commits are **mainline** (parent1 chain).
3. All other queue commits are **side-branch** (parent2 / fork sibling lines).
4. At a merge, `parent1` continues mainline; `parent2` side is absorbed at the
   merge commit.

`buildFirstParentSpine(parentMap, tipSha)` does this in one walk from tip.

## Backward scan (last to first)

Single pass, **O(n)** over queue length `n` for one source:

```text
safe[n - 1] = true                    // last commit: empty suffix, always safe

sideTips = {}                         // non-mainline SHAs still in suffix

for i from n - 2 down to 0:
  if queue[i] not on mainline:
    safe[i] = false
  else:
    safe[i] = every tip in sideTips is a descendant of queue[i]

  if queue[i + 1] not on mainline:
    sideTips = merge(sideTips, queue[i + 1])   // add suffix commit to open sides
```

`sideTips` holds incomparable side-branch heads still in the suffix (antichain).
When one side tip is an ancestor of another, keep the descendant only.

Ancestor checks use the parent map with memoization. Each queue index is visited
once; there is no inner loop over all `n` suffix entries and no extra factor
beyond `n`.

## Example

Fork with `Right` on mainline (first-parent chain from tip):

| Index | Commit | Mainline? | safe |
|-------|--------|-----------|------|
| 0     | Base   | yes       | yes  |
| 1     | Left   | no        | no   |
| 2     | Right  | yes       | yes  |

Scan from index 2: `safe[2] = true` (base case).

At index 1: `Left` is not mainline, so `safe[1] = false`.

At index 0: `Base` is mainline; suffix side tip `Left` descends from `Base`, so
`safe[0] = true`.

## Per-source and merged queue

`precomputeReplayCursorBranchSafeFlags`:

1. Split merged queue into ports and ports-mingw lists (git order preserved).
2. Run spine mark + backward scan on each list with that source's parent map.
3. For merged index `i`, `safe[i] = portsSafe[portsIndex] && mingwSafe[mingwIndex]`
   (both sources must be fork-safe at that replay point).

## Prepare vs replay

| Phase   | Work |
|---------|------|
| Prepare | Parent maps (`rev-list --parents`), mainline spine, backward safe scan |
| Replay  | O(1) flag lookup; git only for diff/commit; cursor branch writes only when safe and SHA changed |

Fetch history, prepare graph work once, then replay.
