# Live check: `3f813b9b9` (Hey Q reliability + plan line) — 2026-11-05

**Build:** Railway web reached SUCCESS on `3f813b9b9` at 10:21Z (deployment created 10:14:28Z). Rollback for web is `c7536d46d`.

**Account:** `investor.savanna-seed@fictional.capitalq.local` (fictional).

**Method:**

- 2 Q turns, one per width, both short and unrelated to the plan.
- Hey Q was turned on in Settings → Q and turned back off at the end of each run (the setting lives in browser storage only).
- Raw numbers are in `results.json`.

| #   | Check                                                                                                                                            | 1440                                                                                                                                                                               | 390                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | No Hey Q banner at the top of any page                                                                                                           | **PASS**: none on /home, /discover, /work, /profile with Hey Q paused, and none while a Q turn was running                                                                         | **PASS** (same)                                                                               |
| 2   | With Hey Q on, a 44px mic button in the corner while it listens; tapping it offers Pause and Turn off                                            | **PASS**: status LISTENING; button 44×44, 16px from the inline-end edge, 120px above the bottom; Pause and Turn off shown                                                          | **PASS** (same)                                                                               |
| 3   | A plan waiting on the person shows one folded line, at most once, and none after the next person turn; no expanded plan under an unrelated reply | **PASS**: before, `PLAN:WAITING` folded (plus a separate `RUN:AWAITING_APPROVAL` approval line), no plan line expanded; after the person turn, 0 lines and the reply reads cleanly | **PASS**: before, one `PLAN:WAITING` line, folded; after, 0 lines and no plan under the reply |

**Conversation:** "Ledgerline unit economics plan" (`cd96234f…`). The old build, in `before-plan-chat-*.png`, drew the waiting plan's steps in Chat.

**Observation, not one of the three checks:** after Pause from the corner menu, the indicator was gone at once. On later full page loads it showed LISTENING again (the corner mic is visible in `item3-*` shots). Pause appears not to survive a reload. Worth confirming whether that is intended.

**Screenshots:**

- `item1-paused-home-*`, `item1-while-working-*`
- `item2-settings-*`, `item2-corner-mic-*`, `item2-menu-*`
- `item3-before-*`, `item3-after-*`
- `before-plan-chat-*` (old build)
