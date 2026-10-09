# Integration 109b781f: repeated runs (G, 2026-10-09)

Label: **LOCAL-E2E (MOCK)**. Real Chromium, the local stack, the scripted model, faked voice transports, $0. Live voice is **LIVE-PENDING**.

Build: `build/rec-g` = 109b781f + G harness commits up to `bd27653a`. The local database had migration `20261220210000` applied (`runs_screen_check` ≤ 65,536). Raw Playwright JSON is in `.playwright/recovery/runs-109/*.json`.

Command: `npx playwright test -c tests/recovery/playwright.recovery.config.ts --reporter=list,json <args>`, with `PLAYWRIGHT_JSON_OUTPUT_FILE` set per batch.

## ×3: `--project=scenarios --repeat-each 3 k-incident l-named pages-load`, plus `-g "busy page"`

| Test                                                                      | Pass                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| pages-load (10 pages, founder and investor)                               | 30/30                                               |
| INC-1: 3 cards, 3 unique ids, DOM = stored message                        | 3/3                                                 |
| INC-1: mandate-fit label, X of Y, source, tie sentence                    | 3/3                                                 |
| INC-1 (d): "rank them" keeps the 3 ids                                    | 3/3                                                 |
| INC-1 (e): cards reachable after an attention turn (E's visible-only fix) | 3/3                                                 |
| INC-1 (a): late result, bridges                                           | 3/3 (assertion being changed by A to "0 narration") |
| INC-1 (b)+(c): one answer line, cards stay, terminal disposition          | 3/3                                                 |
| INC-1 (f): voice final fails, then one terminal line                      | **1/3**                                             |
| INC-1 (g): reconnect keeps cards, no stale bridge                         | **2/3**                                             |
| busy page (G-D8)                                                          | 3/3                                                 |

## ×3: accessibility, `--project=a11y --repeat-each 3 -g "/investors\|/settings\|/discover"`

/investors (founder), /discover (investor) and /settings (investor): each 3/3. No serious or critical violations.

## Named navigation, 6 runs (×3 before and ×3 after the data-room tab selector fix)

| Ask                                         | Pass                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "Take me to Ledgerfold relationship"        | 4/6                                                                                             |
| "Open Ledgerfold"                           | 3/6                                                                                             |
| "Show me the data room for Ledgerfold"      | 2/3 after the selector fix (0/3 before, a harness error: the tab is a link with `aria-current`) |
| An unknown name is not navigated or claimed | 6/6                                                                                             |

Every red run stayed on /home: `open_page` was DENIED NOT_AVAILABLE (G-D16).

## ×3 voice (`--project=voice --repeat-each 3`), then duplex once more after the open-line wait fix (`bd27653a`)

| Test                                                           | ×3                          | After the fix                                |
| -------------------------------------------------------------- | --------------------------- | -------------------------------------------- |
| A voice line that cannot open says so                          | 3/3                         | —                                            |
| The failure notice is announced (live region, G-D7)            | 3/3                         | —                                            |
| Standard line: audio flows, a spoken turn is answered          | 2/3                         | —                                            |
| Standard line: a dropped line reconnects                       | 3/3                         | —                                            |
| Standard line: a vendor error mid-turn ends visibly            | 0/3                         | —                                            |
| Duplex: realtime connect timeout falls back and says so        | 3/3                         | pass                                         |
| Duplex: lost microphone permission is said                     | 0/3                         | fail                                         |
| Duplex: a failed transcript is CLARIFIED or FAILED (B-01)      | 0/3                         | fail: last turn has no terminal disposition  |
| Duplex: a lost relay ends visibly (C-08)                       | 0/3                         | fail: no terminal disposition                |
| Duplex: playback loss shows the answer as text                 | 0/3                         | fail                                         |
| Duplex: network loss, the answer in flight not lost (C-04)     | 0/3                         | fail                                         |
| Duplex: a 200 ms blip during generation does not cancel (C-07) | 3/3 (line not yet up: void) | **fail**: the browser sent `response.cancel` |

## Once: scenarios A–H (`a-navigate b-investor c-documents d-work f-attention g-cross e-uninterrupted`)

23 passed and 10 failed. All 10 are annotated expected red:

- A: `fill` timed out;
- TARGET_MISSING, B, C, D and failed-agent: the dock showed no new answer within 120 s;
- archive: the artifact status is still READY, not ARCHIVED;
- E: a 450 ms barge-in sent `[conversation.item.create, response.create, output_audio_buffer.clear]` with no `response.cancel`/`truncate`;
- F: the attention tool was not offered to the model;
- G: the spoken answer was not shown.

## Once: promises (`--project=promises`) after the `ask()` Chat-view fix

91 passed and 5 failed:

- Q.01 step 4: no `[data-q-pending-questions]` element (E5);
- Q.05 step 4: no `main a[href*='/investors/']`;
- Q.06 step 6: the voice reply is not the code-built fit answer;
- Q.08 step 2: no deck extraction in the seed (E5);
- Q.08 step 4: no profile tab list.

The full-harness tally from before these fixes is in `results.md` and `promises.md`.
