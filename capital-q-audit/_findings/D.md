# Findings: Investigator D (Work page, agents, tool registry, integrations)

Repo HEAD `520bd123` · 2026-10-08 · reports: `07-WORK-AND-AGENTS.md`, `08-TOOLS-AND-INTEGRATIONS.md` · diagrams: `diagrams/agent-task-execution.md`, `diagrams/work-page-state.md` · excerpts: `evidence/agents/*`.

## CONFIRMED DEFECTS

Each defect below was confirmed by reading the code path. D-02 was also reproduced. None was observed in production data.

### D-01 — High: a lapsed approval card silently parks the conversation for good

- **Symptom.** After the 24 h approval TTL, an instruction's message card disappears from Needs you. The engine still treats the conversation as "already asked". As a result:
  - no new draft is written,
  - no REPLY_WAITING notice is sent,
  - the planner is told "plan none of these again".
- **Effect.** The counterpart stays unanswered indefinitely, with nothing visible to the person.
- **Evidence:**
  - `packages/q-actions/src/ports.ts:300` (TTL 24 h)
  - `packages/q-actions/src/infrastructure/postgres-repositories.ts:410` (the list filters on `expires_at > now`)
  - `packages/q-actions/src/application/service.ts:1309-1312` (expiry is written only when someone decides)
  - `apps/q-api/src/composition/instructions/store.ts:715-726,762-776` (no `expires_at` filter)
  - `engine.ts:726-733` (HOLD ALREADY_ASKED), `engine.ts:2065-2068` (removed from replyWaiting), `engine.ts:2151-2160`
  - `packages/q-runtime/src/application/orphaned-runs.ts:91-110` (expires the run but not the action or approval)
- **Root cause.** Expiry is lazy, and the instruction store reads action status without `expires_at`. There is also no escalation for a card that waits.

### D-02 — High: workforce jobs that follow the lead-Q prompt never send

- **Symptom.** A plan of WRITER → REVIEWER → CONVERSATION never sends. The WRITER step is HELD "No agent can do this step on its own" and every later step is SKIPPED.
- **Evidence:**
  - Prompt: `packages/q-core/src/prompts/tasks/workforce.v1.ts:353-356` ("Every message … written by WRITER and graded by REVIEWER; plan them as steps")
  - `packages/q-orchestrator/src/workforce/plan.ts:66,107` (WRITER/REVIEWER steps kept)
  - `job-runner.ts:151-168` (no executor gives HELD; dependants SKIPPED)
  - `apps/q-api/src/composition/workforce/jobs.ts:333-338` (only 4 executors)
  - Reproduced: `evidence/agents/repro-writer-step.md`
- **Root cause.** The roster, prompt and runner disagree. Writing and reviewing happen inside the CONVERSATION executor, yet are offered as separate roles. DOCUMENTS and RESEARCH also have no executor.

### D-03 — Medium: a near-miss draft is recorded HELD while it is actually an approval card

- **Symptom.**
  - The workforce page says "Held, not sent".
  - The Work queue lists the same message twice: an APPROVAL row and a HELD row. The HELD row offers "Send as is" while the card is still pending, so the message could be sent twice.
  - The outcome is never linked to the card.
- **Evidence:**
  - `apps/q-api/src/composition/workforce/review.ts:370-378` (HELD outcome written in `review()`)
  - `review.ts:403-411` (`settle` returns unless PASSED)
  - `engine.ts:2392-2415,2714-2721`
  - `workforce/page.ts:241,269-289`
  - `apps/web/src/features/work/decisions.ts:85-125,198-231`; `held-actions.ts:44-58`
- **Root cause.** The near-miss path was added on 8 Oct (`ee304b16`) without an OFFERED outcome for HELD verdicts.

### D-04 — Medium: invented "nothing needs a reply" note

- **Symptom.** The note "Looked at N people: nothing needs a reply right now" is recorded when some reachable threads were **not read**. Causes include budget, `THREADS_PER_FIRING=8`, and reader failure.
- **Evidence.** `engine.ts:2811-2824`; thread cap at `engine.ts:1894`.
- **Root cause.** An unknown result is rendered as a negative claim.

### D-05 — Medium: a planner failure costs a full cadence, silently

- **Symptom.** When the model is unavailable or the firing throws, nothing is recorded or notified, and the next attempt is about 240 min later. The claim has already advanced `next_fire_at`.
- **Evidence.** `engine.ts:2170,2272`; `instructions/store.ts:345-360`; `triggers.ts:66-71`.
- **Root cause.** The claim moves `next_fire_at` before the work, and there is no short retry on failure.

### D-06 — Medium: errand reports success when the send failed

- **Symptom.** "Q answered X" is recorded, `repliesSent` is incremented and `seenUntil` moves past their message, even when `post()` returned false or threw. The reply is lost.
- **Evidence.** `apps/q-api/src/composition/errands.ts:1418-1436,772-779`.
- **Root cause.** `sent` is used only to settle the reviewer outcome, not to update the errand.

### D-07 — Medium (product trust): Q's own sends are presented as the person's

- **Symptom.** Instruction AUTO/delegated sends and workforce-job sends are not marked "sent by Q". The counterpart sees a message apparently written by the founder or investor. Errands, by contrast, are marked.
- **Evidence:**
  - `packages/app-actions/src/actions/chat.ts:63-76` (no `qActionId` or `qDelegationId`)
  - `engine.ts:2603`
  - `apps/q-api/src/main.ts:1451-1457`
  - `packages/communication/src/service.ts:171-172` (viaQ depends on those fields)
  - Contrast: `errands.ts:780-789`
- **Root cause.** The app action's `run` drops the Q marker. Note that the reviewer's HONEST_IDENTITY rule presumes the marker is present.

### D-08 — Medium: workforce jobs are not resumable

- **Symptom.** An approved job runs as `void jobs.run(...)`. A restart, or a throw inside the run, leaves the job and its runs RUNNING forever, with no FAILED status and no resume.
- **Evidence.** `apps/q-api/src/composition/workforce/job-actions.ts:305-325`; `jobs.ts:509-553`.
- **Root cause.** Fire-and-forget with no durable step queue.

### D-09 — Medium: held replies in a job reach no one

- **Symptom.**
  - CONVERSATION counts held drafts but does not notify the person.
  - The step still ends DONE, with a summary such as "Replied to 0 people; held 2 drafts".
  - Thread consistency is not applied, because `theirLatest` is not passed.
  - The writer is given an empty brief.
- **Evidence.** `jobs.ts:265-289,309-325`; `main.ts:1464`.

### D-10 — Low/Medium: a cautious "declined" reading drops the reply-waiting safety net

- **Symptom.** The thread reader is told to report `declined: true` when unsure. Such people are excluded from `replyWaiting`, so no REPLY_WAITING notice is sent.
- **Evidence.** `packages/q-core/src/prompts/tasks/instructions.v1.ts:436-437`; `engine.ts:2061-2068`.

### D-11 — Low: Team map shows "Working" forever for some jobs

- **Symptom.** INSTRUCTION and DELEGATED_WORK jobs are set RUNNING and never DONE. The web hides this only for INSTRUCTION leads, so a DELEGATED_WORK job's LEAD shows "Working" indefinitely.
- **Evidence.** `jobs.ts:625-641`; `workforce/store.ts:405-410`; `apps/web/src/features/work/workforce-agents.ts:181-189,612-628`.

### D-12 — Low: the delegation toggle overpromises

- **Symptom.** The toggle confirms "Q now handles routine replies…". In fact:
  - every step is a card when `CQ_INSTRUCTIONS_AUTO` is not `on`;
  - drafts that do not PASS 75 are carded or refused.
- **Evidence.** `packages/app-actions/src/actions/work.ts:139-145`; `main.ts:1902`; `engine.ts:2560-2580,2392-2425`.

### D-13 — Low: Needs you count double-counts

- **Symptom.** The count still double-counts after today's fix. One instruction card counts twice: the card plus its "1 thing needs your yes" notice. A near-miss draft also appears as both an APPROVAL row and a HELD row (D-03).
- **Evidence.** `decision-queue.tsx:224-228`; `work-page.tsx:257`; `engine.ts:2830-2843`; `notice-groups.ts`.

### D-14 — Cosmetic: stored redraft count does not match behaviour

- **Symptom.** Jobs are filed with `max_redrafts=2`, and the workforce page shows it. The loop allows only 1 redraft.
- **Evidence.** `jobs.ts:446,594,636`; `review-loop.ts:45-50,306-309`.

### D-15 — Medium (UX): instruction message cards are not rendered as messages in Work

- **Symptom.** Instruction cards use actionType `app.chat.message.send`. The decision queue renders the message quote and verbs only for `chat.message.send`, so these cards fall back to the generic plan view and the title shows the summary.
- **Evidence.** `decision-queue.tsx:441-444`; `decisions.ts:285-290`; `engine.ts:2690`.
- **Test gap.** `apps/web/test/work-decisions.test.tsx:218` covers only `chat.message.send`.

### D-16 — Low: dead direct-tool branch in the duplex broker

- **Symptom.** The broker computes up to 6 read tools and accepts calls to them, but never offers them to the model.
- **Evidence.** `apps/q-api/src/voice/duplex/broker.ts:697-699,733-739,1002-1012`.

## UNVERIFIED RISKS

- **Production autonomy setting.** `CQ_INSTRUCTIONS_AUTO` may not be `on` in production, which would turn every delegated step into a card. To verify, read the Render env NAME/value presence. The ledger claims it is on (`docs/handoff/research/ledger.md:320`).
- **Reviewer score drag.** The reviewer may systematically under-score replies when the person has no etiquette guide, because PERSONAL_STYLE carries 15 points (`review-loop.ts:24-31`; `workforce.v1.ts` PERSONAL_STYLE line). This could explain 58/68. To verify, query `q_runtime.workforce_grades.criteria` for today's two drafts.
- **Today's card will lapse.** Today's NEAR_THE_BAR card (about 11:19 UTC 8 Oct) will lapse at about 11:19 UTC 9 Oct and trigger D-01. To verify, check `q_runtime.approvals.expires_at` and the instruction's next firings' NOTED/HOLD steps.
- **Planner over-refusal.** The planner may keep drafting meeting proposals that the investor side refuses (MEETING_NOT_ALLOWED), while thread consistency demands a response to a meeting ask. The two could deadlock on the investor side. To verify, run an investor-side instruction against a founder message that asks for a call.
- **Pending card lost on restart.** An orphan-sweep EXPIRED run with a still-PENDING approval may break approval-time continuation (`approved-continuation`). To verify, approve a card older than 24 h, or one whose run was expired.
- **Empty writer brief.** The workforce writer with `brief: ""` probably yields generic drafts that the reviewer holds (GROUNDED). To verify, look at workforce_drafts for `source_kind='JOB'`.

## OPEN QUESTIONS

1. Should a card that waits (NEAR_THE_BAR or ASK) escalate, for example by reminding the person after N hours, or should Q send a holding reply? The product brief says Q should "answer messages". The code's design is "nothing outward without a PASS or a yes".
2. Should lapsed approvals be expired eagerly by a sweep, so the instruction can redraft or notify?
3. Are WRITER and REVIEWER meant to be plan steps at all, or internal to CONVERSATION? The prompt and the runner disagree.
4. Should Q-sent messages always carry viaQ, including delegated AUTO sends?
5. Is Tavus expected anywhere in the product? No runtime code exists.

## EVIDENCE INDEX (conclusion → path:line)

| Conclusion                                             | Evidence                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Threshold 75, 2 rounds, weights                        | `packages/q-orchestrator/src/workforce/review-loop.ts:24-50`                                   |
| Near miss within 10 points becomes a card              | `apps/q-api/src/composition/workforce/review.ts:92`; `engine.ts:2381-2415`                     |
| Cadence default 240, claim before fire                 | `supabase/migrations/20261123090000_instruction_triggers.sql`; `instructions/store.ts:345-360` |
| 60 s sweep; autonomy env                               | `apps/q-api/src/main.ts:1892-1908`                                                             |
| Delegation toggle makes the instruction due now        | `apps/api/src/q-work-port.ts:66-79`                                                            |
| Approval TTL 24 h, list hides lapsed cards             | `packages/q-actions/src/ports.ts:300`; `postgres-repositories.ts:410`                          |
| Engine holds on AWAITING actions regardless of expiry  | `instructions/store.ts:715-726`; `engine.ts:726-733`                                           |
| REPLY_WAITING notice                                   | `engine.ts:2746-2800`                                                                          |
| Misleading quiet note                                  | `engine.ts:2811-2824`                                                                          |
| Only 4 job executors                                   | `workforce/jobs.ts:333-338`                                                                    |
| WRITER blocks a job                                    | `evidence/agents/repro-writer-step.md`                                                         |
| Job fire-and-forget                                    | `workforce/job-actions.ts:305-325`                                                             |
| Errand false success                                   | `errands.ts:1418-1436`                                                                         |
| No viaQ on app-action chat send                        | `app-actions/src/actions/chat.ts:63-76`; `communication/src/service.ts:171-172`                |
| Needs you count formula                                | `apps/web/src/features/work/decision-queue.tsx:224-228`                                        |
| Message card only for `chat.message.send`              | `decision-queue.tsx:441-444`                                                                   |
| Registry lanes and tool cap                            | `packages/q-tools/src/registry.ts:22-31,191-210`                                               |
| Tool executor: no timeout or retry                     | `packages/q-tools/src/executor.ts` (grep: only abort-signal handling)                          |
| Duplex offers only `ask_q`, `decide_card` (+listening) | `broker.ts:733-739`; `voice/duplex/instructions.ts:219-234`                                    |
| `email.send` not an app action                         | `apps/q-api/src/composition/email-action.ts:45`; `packages/app-actions/src/actions/*`          |
| Research providers and timeouts                        | `apps/q-api/src/composition/research.ts:254-305`; `q-research/src/providers/*.ts`              |
| Tavus absent                                           | grep `-i tavus` over `apps`, `packages` → only `engine.ts:443` comment                         |
| Tests pass (81)                                        | `evidence/agents/tests-run.md`                                                                 |

## COVERAGE

**Inspected (read in full or in the relevant sections):**

- `instructions/engine.ts` (all of the firing, `validateStep`, `messageProblem`, `retryHeld`)
- `instructions/triggers.ts`, `store.ts` (claim, notify, awaiting, waitingCards), `ask.ts`, `actions.ts` (grant card), `digest.ts` (`needsYouNotice`), `planner.ts` and `quarantine.ts` (config only)
- `workforce/review.ts`, `models.ts`, `jobs.ts`, `job-actions.ts` (execute), `store.ts` (`ensureJob`, `setJobStatus`), `page.ts` (drafts and outcomes)
- `q-orchestrator` `workforce/*` (all), `work/engine.ts` (head), node lists of lane, outreach and stand-in
- `errands.ts` (overview, runner, reply, post)
- `work/runtime.ts` (head)
- `main.ts` wiring for sweeps, engine, workforce ports, wake listeners, Recall
- `apps/api/src/q-work-port.ts`
- `q-actions` approval TTL, list, expire; `q-runtime` orphaned-runs
- Web: `app/(app)/work/page.tsx`, `work-page.tsx` (composition), `decision-queue.tsx` (head, count, message branch), `decisions.ts`, `held-actions.ts`, `notice-groups.ts`, `workforce-agents.ts` (state derivation)
- `q-tools`: `definition.ts`, `registry.ts` (header and lanes), `default-tools.ts`, `executor.ts` (limits), `app-actions.ts` (generation), metadata of every tool file
- `app-actions` names and classifications; delegation rules
- Prompts: `workforce.v1.ts`, `instructions.v1.ts` (plan v1/v8, reader)
- Integrations composition (research, video, push, Google, SMTP/Brevo, Recall)

**Not inspected:**

- LangGraph node bodies (`lane.ts`, `outreach.ts`, `stand-in.ts`)
- `instructions/material.ts` `checkMessage`; q-core `wooProblem` and `considerOutreach`
- `workforce/learning.ts`, `held-retry.ts` internals; `work/page.ts` beyond the done query
- Most of `workforce-map.tsx` and `workforce-panel.tsx`
- MCP connector internals; Gmail poller and inbound-email internals; data-room actions in depth
- Production DB rows and environment values (none were read; read-only rules)
