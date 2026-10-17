# Q conversation fixes — 17 October 2026 (Claude lead)

**Purpose:** a handover for the owner's live Q defects of 17 October and the state of each fix. Any agent can continue from this file.

## Owner-reported defects (production, morning of 17 October)

1. **Wrong cards.** "Top three companies" showed saved companies (Ledgerfold, Ajopot), not the three Q named.
2. **No memory.** "What was the second one?" re-ran the ranking: 23 fit calls returning 1 card.
3. **Tabs.** "Open the data room" or "the pitch deck" was slow or didn't happen.
4. **Moves between pages.** Moves from pages other than Home failed or were slow.
5. **Q Pitch narration** sounds like a robot reading a technical document. Deferred by the owner.

## What shipped

**Release AT** (`9a25c149`, all four services, live 10:35 UTC):

| Defect                 | Fix                                                                                                                                                                                                      | Commit     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Wrong cards            | "Show the cards again" re-emits that earlier turn's own blocks. The SAVED_COMPARISON view is now limited to the saved list.                                                                              | `4e9f9f10` |
| No memory: context     | A generic record of earlier turns (`packages/model-gateway/src/q/conversation-context.ts`), built from text, blocks, ids, order and figures. TURN_READER v54 adds SHOWN plus `fromShown {turn, reshow}`. | `4e9f9f10` |
| No memory: recall      | A recall port (`conversation-recall.ts`, prompt `conversation-recall/v1`) answers follow-ups from the record with no tools. It falls back to the normal path.                                            | `c00a6015` |
| No memory: answer note | The answer note now defers to the record.                                                                                                                                                                | `db2d4e8c` |
| Moves between pages    | A move to a tab on the current page clicks its registered control, with the router as fallback after 1.5 s. A move lost to a page's own `history` rewrite is re-sent, at most 3 times.                   | `fc0b9941` |

**Release AT, live-verified** (fictional Savanna Seed investor, conversation `0204d070`):

| Check                              | Result                          |
| ---------------------------------- | ------------------------------- |
| Top three                          | text and cards match            |
| "Show the cards again"             | the same three cards, in 0.45 s |
| "Tell me more about the third one" | right company, in 0.35 s        |
| Discover → CRM                     | 281 ms                          |
| CRM → Work                         | 279 ms                          |
| Open the data room                 | 1.6 s                           |

Still failing on AT:

| Defect | Detail                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A      | Recall throws `ModelGatewayError: model gateway request is invalid` (`conversation-recall.js:40`), so the slow path runs (3 s). |
| B      | An ordinal question also opens the company page.                                                                                |
| C      | "Now the pitch deck" is read as "make a deck".                                                                                  |

**Batch AU** (PR #200, in CI at `cbf96362`) carries three changes:

| Change                                  | Detail                                                                                                                                                                                                                                                                     | Commit     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Tool results persisted per conversation | Migration `20261228190000_q_runtime_conversation_tool_results`. The table is server-only, write-once, size-bounded, with 14-day retention and an owner/conversation trigger; pgTAP is 980. Apply the migration after pgTAP passes. Code fails softly before it is applied. | `06cfca6b` |
| Dialog state misread                    | The page manifest no longer reports the notifications dialog as always OPEN (wrapper state comes from its trigger).                                                                                                                                                        | `e1e1f5a1` |
| TURN_READER v55                         | v54 plus PAGE CONTROLS, with tabs and sections picked by meaning. The code emits SELECT_TAB or SCROLL_TO with no extra model call. Tests cover "now the pitch deck" giving `tab.deck` and "open the data room" giving `tab.dataroom`.                                      | `3c0369c6` |

## Still open (next actions)

1. **Cards not visible on Home in an old conversation.** In owner conversation `971c5a53`, the 11:06 and 11:07 answers carried the correct ANSWER_CARDS, but the owner saw saved companies or nothing. The likely cause is that the 09:15 SHOW_IN_Q_ROOM saved view is restored and covers the newer cards. A lane is fixing it on branch `claude/qfix-room-oct17`. The rule: the latest display wins.
2. **Recall gateway error (defect A) and unrequested page open (defect B).** On branch `claude/qfix-cards-oct17`, after `e1e1f5a1`.
3. **After AU deploys,** re-run the live scenario: top three, show again, the second one, the third one, data room, then the pitch deck from the data room, plus moves from other pages.
4. **Voice-delegated requests** still take 2.5–10 s; not changed.
5. **Typed turns** also call `/api/q-speech` (0.3–4.4 s each). Check whether typed mode should speak.
6. **Q Pitch narration tone** (owner): rewrite in plain, warm speech. Deferred.

## How to verify

- Hosted read-only SQL: `NODE_USE_ENV_PROXY=1 /root/sb node scripts/handoff/live/hosted-read.mjs "select … from q_runtime.conversation_messages …"`. The columns are `conversation_id`, `role`, `content`, `result_blocks` and `created_at`.
- Railway logs: helpers in the coordinator scratchpad (`qapilogs.mjs`, `rwdeploys.mjs`). Never commit tokens.
- Browser: Playwright with `executablePath: "/opt/pw-browsers/chromium"`, using a fictional seed account.
