# 20 — Code evidence index

Every significant conclusion, mapped to its source location. This file is assembled verbatim from each investigator's EVIDENCE INDEX section in `_findings/`. Defect-level evidence is also in `14-CONFIRMED-DEFECTS.md`. Excerpts with line numbers are in `evidence/<area>/`.

## A — Architecture & database


| Conclusion | Evidence |
| --- | --- |
| Hosted migrations = repo (178/178) | `evidence/architecture/live-db-aggregates.md` |
| App connects as postgres, bypasses RLS | `packages/database/src/client.ts:24-41`; `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:61-64`; live pg_roles/pg_stat_activity |
| RLS policies only for `authenticated` | `supabase/migrations/20260902144826_identity_permissions_rls.sql:239-275`; live pg_policies by schema |
| Web never uses PostgREST | grep of `apps/web` for `.from(`/`.rpc(`/`.schema(` (no hits) |
| q.action events stuck | `apps/workers/src/event-registry.ts:1-35`; `packages/eventing/src/publisher/outbox-publisher.ts:171-186`; live outbox aggregates |
| Railway IaC drift | `.railway/railway.ts` (whole file, `evidence/architecture/railway-iac.md`) |
| OpenAI primary | `apps/q-api/src/main.ts:927-935`; `supabase/migrations/20261008130000_ai_ops_openai_primary.sql` |
| Room feed process-local | `apps/q-api/src/room/feed.ts:17-40` |
| Static readiness | `apps/q-api/src/app.ts:760-770` |
| Bearer-only, per-request Auth call | `apps/api/src/security/supabase-authenticator.ts:20-37`; `packages/security/src/supabase/access-token-authenticator.ts:69-89` |
| Actor context never from headers | `apps/api/src/security/actor-context.ts:93-112` |
| App actions: authorize then run, deny = 404 | `apps/api/src/http/app-actions.ts:156-200` |
| Voice token contents and key | `apps/q-api/src/voice/session-token.ts:20-52`; `apps/q-api/src/main.ts:5111-5114` |
| Duplex transcripts only since today | `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:1-18`; live voice_line_turns = 21 |
| q-api schedulers | `apps/q-api/src/main.ts` lines in DEF-A6 |
| Workers loops | `apps/workers/src/main.ts:1338-1452` |
| Telemetry no-op | `packages/observability/src/telemetry.ts:15-21` |
| Schema-only tables (63) | `evidence/architecture/live-table-counts.md` |
| Package graph has no cycles or app imports | DFS over `packages/*/package.json` (see `diagrams/system-architecture.md`) |
| 139 deprecated prompt versions | `grep 'status: "DEPRECATED"' packages/q-core/src/prompts` |


## B — Q brain & memory


- One orchestrator path for typed Q → `q-runs.ts:111-163`, `orchestrator.ts:334-395`, `graph.ts:481-509`
- Answer seam = specialist wrapper plus conversational delegate → `q-intelligence.ts:320-371`, `405-544`; `answer.ts:3105-3117`
- History windows 64 / 6×400 / 12×4,000 / all earlier → `answer.ts:1973-1977`, `turn-reader.ts:269-272`, `answer.ts:649-671`, `index.ts:2495-2499`
- Conversation history goes into the USER message, not chat turns → `renderer.ts:197-200`, COMPANY_ANALYST template "CONVERSATION SO FAR"
- Untrusted fencing → `q-core/src/prompts/definition.ts:247-322`
- Environment notes bound of 9,000 and ordering → `index.ts:686`, `903-1063`
- Tool loop limits (2 rounds, 10 calls) → `index.ts:338`, `363`, `3214-3223`
- Tool pipeline (offered, Zod, actor/plan, authorize, sensitivity, output) → `q-tools/src/executor.ts:142-370`
- Two tool lanes only (SAFE_READ / LOW_RISK_INTERNAL SIDE_EFFECT) → `q-tools/src/registry.ts:195-205`
- No role gate; GENERAL_MODEL_KNOWLEDGE actor-wide → `q-firewall/src/purpose.ts:73-75`, `162-176`
- Denial sentence → `contracts/src/q/failure.ts:110-111`, `170`
- Prepare → Approve → Execute → `relationships.ts:574-614`, `main.ts:3252-3281`, `graph.ts:404-467`, `orchestrator.ts:397-458`, `pending-decision.ts:459-626`
- 54 ACTIVE prompts (TURN_READER v44, COMPANY_ANALYST v21, Q_SYSTEM v2, Q_SYSTEM_VOICE v3) → `evidence/brain/prompts-active-texts.md`; registry rule `registry.ts:306-312`
- Spoken unclear → SILENT → `answer.ts:2448-2450`
- heardAs recursion → `answer.ts:2345-2378`
- Per-answer cost and model logging → `index.ts:4176-4219`


## C — Voice


| Conclusion | path:line |
|---|---|
| Duplex first, standard on same credential on failure | `apps/web/src/features/voice/use-voice-session.ts:57-62` |
| Duplex offered on top of standard credential | `apps/q-api/src/voice/routes.ts:866-896` |
| One standard binding per person | `apps/q-api/src/voice/routes.ts:809` |
| Realtime model / transcriber / voices | `packages/model-gateway/src/realtime/openai.ts:26`, `48`, `59` |
| semantic_vad, create_response false, interrupt_response false | `openai.ts:110-122`; `duplex-line.ts:1042-1062` |
| getUserMedia constraints duplex | `duplex-line.ts:283-286` |
| Standard STT model and EOT | `apps/q-api/src/voice/providers/deepgram.ts:198-235` |
| Routing rules | `apps/q-api/src/voice/duplex/routing.ts:167-183` |
| Heard routing + ask_q server-side | `broker.ts:816-855` |
| Silent result returned by askQ | `broker.ts:555-559` |
| Strict tool result schema without silent | `packages/contracts/src/q/voice.ts:432-441` |
| Tool route strict parse | `apps/q-api/src/voice/duplex/routes.ts:86` |
| Browser on non-ASK_Q → model answers | `duplex-line.ts:1643-1646` |
| Browser on silent → LISTENING | `duplex-line.ts:1647-1652` |
| Transport-changed drop | `duplex-line.ts:1654-1658` |
| relayTool generation-only guard | `duplex-line.ts:1421`, `1528-1533` |
| Forced ask_q | `duplex-line.ts:1589-1602` |
| No error case in dispatcher | `duplex-line.ts:1258-1413` |
| Barge-in confirm 450 ms; immediate during generation | `duplex-line.ts:132`, `1265-1266`, `1185-1237` |
| Idle end | `duplex-line.ts:1153-1175`; `config.ts:49` |
| Levels 0 on duplex | `duplex-session.ts:246-248` |
| timedSpeaker drops facts | `apps/q-api/src/voice/turn-timing.ts:369-395` |
| fromFacts uses speaker.facts | `apps/q-api/src/voice/turn.ts:951-979` |
| Spoken unclear → SILENT | `packages/q-specialists/src/answer.ts:2442-2462` |
| heardAs re-read | `answer.ts:2340-2378` |
| Not addressed to Q → no answer | `answer.ts:2426-2437` |
| Turn handler NOTHING paths | `turn.ts:1864-1866`, `1913`, `1944-1951`, `2089-2090` |
| Standard think deadline/keep-alive | `apps/q-api/src/voice/think.ts:42-59`, `330-347` |
| Standard thinking watchdog 14 s | `deepgram-session.ts:61`, `358-368` |
| Speak relay and ElevenLabs model order | `routes.ts:396-548`; `providers/elevenlabs-speak.ts` header + constants |
| speakable flattening + 1,200-char cap | `apps/q-api/src/voice/speech.ts:12`, `271-305` |
| "Say exactly this" opener/beats | `duplex-line.ts:1077`, `1914`; `duplex/instructions.ts:213` |
| Server actions serialized | `node_modules/.pnpm/next@16.3.4…/next/dist/client/components/app-router-instance.js` (`dispatchAction`, `runRemainingActions`); `provider/narration-poll.ts:7-8` |
| No deadline on duplex askQ | `broker.ts:528-535`; `packages/api-client/src/request.ts:54-63` |
| In-memory duplex lines | `broker.ts:453` |
| Daily cap default 1 USD platform-wide | `config.ts:48`; `spend.ts:23-28` |
| Transcript store | `apps/q-api/src/voice/duplex/transcript.ts:65`; `broker.ts:584-634`, `857-916` |
| Latency log "voice turn timed" | `turn-timing.ts:14-48`, `143-200` |
| Duplex first-audio stats at line end | `duplex-line.ts:1342-1348`, `862-883`; `broker.ts:1141-1158` |


## D — Work, agents, tools


| Conclusion | Evidence |
|---|---|
| Threshold 75, 2 rounds, weights | `packages/q-orchestrator/src/workforce/review-loop.ts:24-50` |
| Near miss within 10 points becomes a card | `apps/q-api/src/composition/workforce/review.ts:92`; `engine.ts:2381-2415` |
| Cadence default 240, claim before fire | `supabase/migrations/20261123090000_instruction_triggers.sql`; `instructions/store.ts:345-360` |
| 60 s sweep; autonomy env | `apps/q-api/src/main.ts:1892-1908` |
| Delegation toggle makes the instruction due now | `apps/api/src/q-work-port.ts:66-79` |
| Approval TTL 24 h, list hides lapsed cards | `packages/q-actions/src/ports.ts:300`; `postgres-repositories.ts:410` |
| Engine holds on AWAITING actions regardless of expiry | `instructions/store.ts:715-726`; `engine.ts:726-733` |
| REPLY_WAITING notice | `engine.ts:2746-2800` |
| Misleading quiet note | `engine.ts:2811-2824` |
| Only 4 job executors | `workforce/jobs.ts:333-338` |
| WRITER blocks a job | `evidence/agents/repro-writer-step.md` |
| Job fire-and-forget | `workforce/job-actions.ts:305-325` |
| Errand false success | `errands.ts:1418-1436` |
| No viaQ on app-action chat send | `app-actions/src/actions/chat.ts:63-76`; `communication/src/service.ts:171-172` |
| Needs you count formula | `apps/web/src/features/work/decision-queue.tsx:224-228` |
| Message card only for `chat.message.send` | `decision-queue.tsx:441-444` |
| Registry lanes and tool cap | `packages/q-tools/src/registry.ts:22-31,191-210` |
| Tool executor: no timeout or retry | `packages/q-tools/src/executor.ts` (grep: only abort-signal handling) |
| Duplex offers only `ask_q`, `decide_card` (+listening) | `broker.ts:733-739`; `voice/duplex/instructions.ts:219-234` |
| `email.send` not an app action | `apps/q-api/src/composition/email-action.ts:45`; `packages/app-actions/src/actions/*` |
| Research providers and timeouts | `apps/q-api/src/composition/research.ts:254-305`; `q-research/src/providers/*.ts` |
| Tavus absent | grep `-i tavus` over `apps`, `packages` → only `engine.ts:443` comment |
| Tests pass (81) | `evidence/agents/tests-run.md` |


## E — Generative UI & UX

- Blocks are a closed typed union → `packages/contracts/src/q/result-block.ts:37-52, 285-309`
- Model cards get code-computed fit/order and a null subject → `packages/model-gateway/src/q/answer-cards.ts:52-67, 88-132`
- Company-only subject resolution → `packages/model-gateway/src/q/card-subjects.ts:1-10, 88-100`; `model-gateway/src/q/index.ts:4070-4083`
- All-or-nothing block validation → `packages/model-gateway/src/q/result-blocks.ts:428-429`
- `SHOW_IN_Q_ROOM`: model picks kind and id only → `packages/contracts/src/q/ui-intent.ts:368-449`; content read as the person → `apps/web/src/features/q/room/room-actions.ts:60-98`
- Inline / chip / stage split → `apps/web/src/features/q/q-answer.tsx:32-65`
- Answer cards follow speech → `apps/web/src/features/q/answer-canvas-logic.ts:87-169`; `use-answer-playback.ts:20-28`
- One object at a time in the centre → `apps/web/src/features/q/q-presence-stage.tsx:150-166, 301-416`
- Side columns only pre-conversation → `apps/web/src/features/q/q-conversation.tsx:1166-1227`
- Spoken lines make `conversing` true → `q-conversation.tsx:493-523`; `q-session.tsx:233-239`
- Arrival cards are APPROVAL/HELD → `apps/web/src/features/briefing/arrival.ts:35-56`
- Arrival read set → `apps/web/src/features/briefing/arrival-actions.ts:100-214`
- Lowdown sources → `apps/q-api/src/composition/work/page.ts:639-752`
- Greeting/lowdown words → `packages/q-core/src/speech/arrival.ts:50-288`
- Gate → `apps/web/src/features/briefing/arrival-gate.ts:26-104`
- R35 hidden when the arrival is ready → `apps/web/src/features/home/returning-welcome.tsx:164-167`
- Generic opener → `apps/web/src/features/home/returning.ts:115-160`
- Voice card seam duplex-only → `apps/web/src/features/voice/provider/duplex-session.ts:166-172, 208-213`; `voice/line-cards.ts:1-91`
- Silent turn → `apps/web/src/features/voice/provider/duplex-line.ts:1647-1652`
- Typed ask waits for briefing → `apps/web/src/features/q/q-conversation.tsx:156-193, 659-672`
- Process-local room feed → `apps/q-api/src/room/feed.ts:35-38, 91-122`
- Held dismissal local-only → `apps/web/src/features/work/decision-queue.tsx:141, 188-196`; `briefing/arrival-actions.ts:136-142`
- No chart or map libraries → `apps/web/package.json:15-39`
- Root-only error boundary → `apps/web/app/error.tsx:1-59` (find: no other `error.tsx`)
- Unnamed investor card → `apps/web/src/features/q/q-result-blocks.tsx:414-443`
- Investor fit room card = own top 8 → `apps/web/src/features/q/room/room-actions.ts:277-290`
- Founder→investor finder has location and reasons → `packages/q-tools/src/tools/find-prospective-investors.ts:169-170`


## F — Providers, security, tests


| Conclusion | Evidence |
|---|---|
| Text LLM calls are centralised in the gateway | SDK imports only in `packages/model-gateway/src/providers/{openai,google,groq}.ts`; `gateway.ts:590-647` |
| OpenAI adapter runs only `gpt-5.6-luna` | `providers/openai.ts:61-62,364-375` |
| Effective routing (luna first; FAST_CLASSIFICATION flash-lite first with a 2 s hedge) | `20261008130000…sql:8-21`; `20261110000000…sql:11-16`; `20261207163000…sql:33-36` |
| Google ceiling PUBLIC; OpenAI CONFIDENTIAL via asserted ZDR | `20260926090000…sql`; `20261006100000…sql:27-36` |
| Provider-justified ceiling mapping | `policy/eligibility.ts:77-93` |
| SYNTHETIC_DEMO skips ceilings | `policy/eligibility.ts:221-225,295-309` |
| Staging may attest | `policy/synthetic-demo.ts:175-215` |
| `firstAttemptTimeoutMs` semantics | `gateway.ts:807-812`; `q/turn-reader.ts:310` |
| Hedge semantics | `gateway.ts:837-908,1077-1153` |
| Per-attempt ledger, non-fatal on failure | `gateway.ts:256-269,499-518`; `infrastructure/postgres-usage.ts:14-33` |
| Per-task budgets | `q/index.ts:401-456` |
| Duplex daily cap ($1 default, 0–20) | `apps/q-api/src/voice/duplex/config.ts:45-57,87-92`; `spend.ts:19-33`; `broker.ts:653-664,1058-1066` |
| Browser-reported realtime usage | `apps/web/src/features/voice/provider/duplex-line.ts:44,371-405`; `broker.ts:1017-1043` |
| Realtime and transcribe models and prices | `realtime/openai.ts:26-56` |
| Embeddings outside the gateway | `packages/q-embeddings/src/infrastructure/openai-provider.ts:20-60` |
| Image model id collision | F-D1 evidence |
| Voice vendors and models | `apps/q-api/src/voice/providers/deepgram.ts:16-35,195-245`; `elevenlabs-speak.ts:109-123` |
| Auth via Supabase `getUser` | `packages/security/src/supabase/access-token-authenticator.ts:75` |
| Org selector resolved against active membership | `packages/security/src/postgres/actor-context-resolver.ts:55-131` |
| Firewall version and plan log | `packages/contracts/src/q/firewall.ts:34`; `packages/q-firewall/src/firewall.ts:597-625` |
| Tool pipeline | `packages/q-tools/src/executor.ts:25-40,170-260` |
| Approval hash recheck and idempotency key | `packages/q-actions/src/application/service.ts:310-315,1376-1395` |
| AUTO autonomy off by default; audited delegation | `apps/q-api/src/composition/instructions/engine.ts:1385-1411` |
| Fence implementation | `packages/q-core/src/prompts/definition.ts:223-288` |
| Logger redaction | `packages/observability/src/logger.ts:15-36` |
| Telemetry no-op | `packages/observability/src/telemetry.ts:11-22` |
| CI scope | `.github/workflows/ci.yml:3-13,66-80` |
| Test counts and run results | `13` §2–§3 |

