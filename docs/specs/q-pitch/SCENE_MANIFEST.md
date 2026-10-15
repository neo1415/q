# Q Pitch — scene route and action manifest (r3, PROPOSED)

The machine source for P1–P4 is `PILOT_SCRIPT` (`packages/q-pitch/src/pilot.ts`). P5–P9 are blueprint §16.1 candidates that are not in the machine script yet. Paths come from `apps/web/src/features/voice/destinations.ts`.

## Receipts

| Path                 | Receipt                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **NAV** (navigation) | `requestMove` reaches VERIFIED on the settled route                                                             |
| **UIA** (UI act)     | the `performUiAct` receipt is DONE                                                                              |
| **QRUN** (Q run)     | the run is COMPLETED with no failure, and a `[data-q-answer="settled"]` answer is laid out on screen within 4 s |

Q describes a result (AFTER_ACK) only after every receipt in the scene arrives.

## Scenes

| #     | Scene id / status                           | Actor (fictional)                                | Actions → path                                                                                                                                                    | Expected route         | Ack timeout | Prefetched at prepare                               | Fallback                                                                                         |
| ----- | ------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1+P2 | `s.pilot.opening` — certified (re-cert due) | `investor.savanna-seed@fictional.capitalq.local` | `ta_open-discover` openRoute DISCOVER → `/discover` (NAV); `ta_ask-top-three` askApprovedQuestion `q.top-three` (QRUN)                                            | `/discover`            | 20 s        | next two scenes; `/company/<id>` once cards resolve | generic SAFE_FALLBACK line; pause                                                                |
| P3    | `s.pilot.company` — certified (re-cert due) | same                                             | `ta_open-ledgerfold` openCompany ledgerfold → `/company/<id>` (NAV; id only from the actor's own top-three cards); `ta_ask-profile` (QRUN); `ta_ask-risks` (QRUN) | `/company/[companyId]` | 30 s        | compare scene                                       | FIXTURE_UNRESOLVED if Ledgerfold was not in the actor's cards                                    |
| P4    | `s.pilot.compare` — certified (re-cert due) | same                                             | `ta_compare-two` buildComparison `q.compare-two` [ledgerfold, f2] (QRUN; names from the actor's cards)                                                            | `/company/[companyId]` | 45 s        | —                                                   | FIXTURE_UNRESOLVED if F2 was not shown; **F2 classification unverified** (DEMO_FOUNDER_PROPOSAL) |
| P5    | candidate GateQ                             | investor                                         | openRoute GATEWAY → `/gateq` (NAV); selectTab `tab.inbox` (UIA)                                                                                                   | `/gateq`               | —           | —                                                   | Variant B (§16.2)                                                                                |
| P6    | candidate privacy                           | investor                                         | askApprovedQuestion `q.private-runway` (QRUN; refusal must come from the server)                                                                                  | current                | —           | —                                                   | drop the scene                                                                                   |
| P7    | candidate relationship                      | investor                                         | openRoute RELATIONSHIPS → `/relationships?view=overview` (NAV); scrollTo `section.*` (UIA; id to be confirmed)                                                    | `/relationships`       | —           | —                                                   | drop the scene                                                                                   |
| P8    | candidate Q-to-Q                            | founder                                          | `runShortRehearsal` (package `q2q-rehearsal.ts`): start, say ×≤3, finish, read, via the existing rehearsal actions; then the review page                          | `/rehearsals/...`      | ~45 s       | —                                                   | open a saved review (A2)                                                                         |
| P9    | close                                       | current actor                                    | openRoute HOME → `/home` (NAV)                                                                                                                                    | `/home`                | —           | —                                                   | stay; Q is live                                                                                  |

## Controls

All controls are AUDIENCE intents that go through `TourControlGate`:

| Control            | Director event                                            |
| ------------------ | --------------------------------------------------------- |
| Back               | `GO_BACK` (last valid scene, never browser history)       |
| Pause / Resume     | `PAUSE` / `RESUME` (the runner reads `routeIntact` first) |
| Show me that again | `REPEAT`                                                  |
| Skip               | `SKIP`                                                    |
| Chapters           | `JUMP_TO_CHAPTER`                                         |
| Esc                | `PAUSE`                                                   |

Any intent from the narrator, the rehearsal counterpart or the script is refused (`SYNTHETIC_SOURCE` / `SEGMENT_NOT_AUDIENCE`).

## Start

`CQ_Q_PITCH_TOUR=1` on the web service, then open any app page with `?qpitch=pilot` while signed in as the fictional actor. A DRAFT script runs only as `INTERNAL_REHEARSAL`.
