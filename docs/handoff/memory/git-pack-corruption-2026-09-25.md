---
name: git-pack-corruption-2026-09-25
description: "The forced restart corrupted the repo's main git pack; recovery/2026-09-12 was rebuilt with new SHAs; old agent-branch history has missing snapshots — don't gc, don't merge recovery into agent branches"
metadata:
  node_type: memory
  type: project
  originSessionId: 2374147b-5604-4acd-887a-0c3e6155e493
  modified: 2026-09-25T08:06:08.527Z
---

2026-09-25 the forced restart (machine freeze) corrupted `.git/objects/pack/pack-07b2533…`. Repair: corrupt pack moved to the session scratchpad `git-repair/moved`, readable objects unpacked, 6 blobs restored from a GitHub mirror clone, the mirror's pack added to `.git/objects/pack`, trees rebuilt from working files via a throwaway index + `git write-tree`. The unpushed part of `recovery/2026-09-12` (after `e9e54fb`) was rebuilt as 5 commits (head `fe23440`, tree identical to the old head `061dbce`; the first rebuilt commit folds 29 lost commits' messages). Backed up as `origin/backup/2026-09-25-integration`.

**Why:** local-only objects that were packed at 06:03 and never pushed were lost; branch heads were restorable from disk, intermediate snapshots were not.

**How to apply:** do not run `git gc`/`repack` until old agent branches are pruned; do not merge/rebase recovery into old agent branches (broken merge bases) — cherry-pick their new commits instead; spawn new workers from `fe23440` or later; push to GitHub backup branches often so a future corruption loses nothing. Old commit SHAs in ledgers from before this date no longer exist on recovery. Related: [[machine-freeze-concurrency-cap]].
