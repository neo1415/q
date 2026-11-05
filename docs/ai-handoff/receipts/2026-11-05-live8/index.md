# Live verification 8: a452c84fc (5 Nov 2026)

These checks used the fictional investor `investor.savanna-seed@fictional.capitalq.local` at 1440 and 1024 px, with 6 Q turns. One plan was run with "okay"; no step card was approved and nothing was sent. Full detail is in `results.json`.

Deploy: the integration owner pushed `23451cb58` → `a452c84fc`. Web, api, q-api and workers were all SUCCESS at 03:24:50Z.

| Check                                                             | Result | Observed                                                                                                                                       |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| One-page Ledgerline memo                                          | PASS   | PDF is 1 page, has no "ready for review" line and no doubled sentences; chat headings are on their own lines                                   |
| "Which has better traction?" without the table                    | PASS   | No comparison table repeated; figures stay per company. Two ranked fit cards render above the answer                                           |
| Discover tabs and video at 1024 and 1440                          | PASS   | Tabs don't overlap the video; For you video is 256×455 px at 1024. On Harbourline, our captions sit over the video's own title text            |
| Ledgerline: picture captions only; Watchly: our captions + switch | PASS   | Ledgerline: 0 tracks, no switch. Watchly: 1 track, "Captions" switch                                                                           |
| Plan card stays on the Q stage after "okay" at 1440               | PASS   | Running card and plan card stay; no "put away" line                                                                                            |
| /work Moving: one row per plan, titled by goal, with steps        | FAIL   | The Ledgerline plan is one row. The Silo Credit plan has 3 rows: its goal row plus two "goal: step" rows (Research · Working, Assess · Queued) |
