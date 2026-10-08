# 15 — Unverified risks

These are hypotheses, not findings. Each says what would confirm it. The full lists are in `_findings/{A,B,C,D,E,F}.md`.

| ID | Hypothesis | How to verify |
|---|---|---|
| R-C1 | The lead's 12:02 duplex drop ("rejoined, ended about 20 s later") was two 10 s WebRTC connect timeouts, because the sandbox blocks the media path. It was not a product fault. | Browser `#tryConnect` failure logs; a call from a real desktop browser (`duplex-line.ts:541-556`) |
| R-C2 | A second `response.create` while one is active is refused by OpenAI, so the newer answer is lost; the error is ignored (C-06) | Log realtime `error` events in a real call |
| R-C3 | Vercel/Next function limits or proxy timeouts cut long `heard` server actions, leading to a forced ask_q and a second Q run | Platform settings and request logs |
| R-C4 | After a SILENT answer, the next ask reuses the same utteranceRef and supersedes the stored user message | `conversation_messages.provider_message_ref` across consecutive duplex turns |
| R-C5 | Duplex `<audio autoplay>` fails on Safari/iOS | Manual Safari test |
| R-A1 | Deploys during a call wipe duplex lines and the room feed (A-05). Deploys happen many times a day. | Railway deploy timestamps against duplex end events |
| R-A2 | A raw SQL query somewhere lacks a `tenant_id` predicate; with RLS bypassed, that is a cross-tenant read | Grep audit plus negative tests as a non-bypass role |
| R-A3 | The q-api voice token key is derived from `DATABASE_URL` because `SUPABASE_SECRET_KEY` isn't set on q-api | `railway variable list` (names only) |
| R-A4 | The 1,225 cancelled runs (43%) carry real model spend | An aggregate join of `ai_ops.model_usage` by run status |
| R-D1 | `CQ_INSTRUCTIONS_AUTO` isn't `on` in production, so every delegated step becomes a card | Env name and value presence |
| R-D2 | The reviewer under-scores replies when there's no etiquette guide (PERSONAL_STYLE is worth 15 points), which would explain 58 and 68 | `workforce_grades.criteria` across many drafts |
| R-D3 | Investor-side instruction deadlock: the planner refuses meetings while thread-consistency demands answering a meeting ask | A scripted investor-side run |
| R-E1 | On Deepgram, the arrival cards vanish as the greeting starts (on duplex, when its transcript lands) | Playwright on `/home` with a fake mic |
| R-E2 | The room feed with more than one q-api instance means spoken answers' cards never reach the screen | Instance count and a kill test |
| R-E4 | A second open tab keeps `last-seen` fresh, so "since" is minutes ago and the lowdown says "All quiet" | Two-tab test |
| R-E5 | There's no `(app)` error boundary, so any page crash tears down the voice line | Throw in a page under `(app)` |
| R-F2 | Hosted q-api runs with the SYNTHETIC_DEMO attestation, so non-public turns go to the unreviewed Gemini free tier (whose terms allow training) | Startup log "synthetic-demo attestation accepted"; Google usage rows with purpose CONVERSATION |
| R-F3 | Realtime spend is under-counted (usage is reported by the browser) | OpenAI billing against the ledger |
| R-F6 | OpenAI zero data retention isn't actually enabled | OpenAI organisation data controls |
| R-L1 | The `lastMessage` fix deployed at 12:59 UTC makes "what needs my attention" name the waiting investor | One live typed or voice question as a Tensorgate member |

Brain and memory risks (investigator B) are in `_findings/B.md`.
