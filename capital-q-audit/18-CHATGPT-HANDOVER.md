# 18 — Standalone technical briefing for an external architect

You have no access to the repository. This briefing, together with files 01–22, `diagrams/` and `evidence/` (sanitized source excerpts with original paths and line numbers), is meant to let you reconstruct how Capital Q works and where it fails. Everything here comes from a read-only audit on 2026-10-08 of branch `recovery/2026-09-12-8y2j4w` at commit `520bd123`, plus that day's live production traces (`21-EXECUTION-TRACES.md`).

## 1. What Capital Q is

An "investment intelligence operating system" for private capital, used by founders and investors. Its centre is **Q**, an AI analyst the user talks to by text or voice. Q:

- reads the user's company or fund records, relationships, documents and the public web, under a strict permission layer (the Context Firewall);
- shows answers as text plus cards;
- prepares actions that need human approval;
- runs background agents ("standing instructions", "workforce jobs", "errands") that reply to counterparts and book meetings.

Non-negotiable product rules are in `19-RECOMMENDATION-INPUTS.md`.

## 2. System shape (see `02`, `diagrams/system-architecture.md`)

- **Monorepo:** TypeScript 5.9, Node 24, pnpm/Turborepo.
- **Four deployables, all on Railway:**
  - `apps/web`: Next.js 16 App Router, server actions as the BFF.
  - `apps/api`: Fastify 5, the domain API.
  - `apps/q-api`: Fastify 5, the Q runtime, voice and agent loops.
  - `apps/workers`: outbox publisher and jobs.
- **About 52 packages:** contracts (Zod), model-gateway, q-core (prompts), q-tools, q-specialists, q-orchestrator (LangGraph), q-actions (approvals), q-firewall, and domain packages.
- **Supabase Postgres:** 178 migrations, 262 tables. The app connects as a role that **bypasses RLS**, so isolation is in application SQL.
- **Supabase Auth:** bearer tokens verified per request. Actor context is resolved from the database, never from headers.
- **q-api is one replica holding important state in memory:**
  - the room feed (cards beside Q);
  - duplex voice lines;
  - turn boards;
  - conversation-core maps.
- **About ten scheduler loops** (`setInterval`) also run inside that q-api HTTP process.

## 3. Q's brain (see `03`, `05`, `diagrams/q-brain-routing.md`, `text-message-execution.md`)

A typed message goes from the web server action to `POST /v1/q/runs`, then the orchestrator graph: preflight → Context Firewall plan → retrieval → synthesis.

Synthesis is `q-specialists/src/answer.ts`, about 3,100 lines. It runs these steps in order:

- screen commands handled in code ("scroll down");
- page-by-name navigation handled in code;
- speculative answer start for voice;
- **TURN_READER v44**, a structured classification: kind, question kind, tool, reference, heardAs, and more. It runs on Gemini flash-lite with a 2 s hedge to gpt-5.6-luna.
- handling of a pending decision;
- unclear or not-addressed turns get **SILENT on voice**;
- opening a referenced record, or repeating the last action;
- otherwise, the conversational delegate (the model gateway's "company analyst").

The company analyst:

- prefetches the user's own facts (schedule, approvals, Q work, rehearsals);
- offers up to 127 typed tools;
- calls gpt-5.6-luna (NORMAL_DIALOGUE) with prompt bundle `q-system.v2 + company-analyst.v21 + comm.v2`, about 37k characters;
- returns text plus validated result blocks (cards).

Consequential actions are prepared as approval cards whose payload hash is bound to the approval.

**Q is not one brain.** Besides this path there are separately prompted agents:

- the duplex realtime voice model;
- the onboarding interview;
- welcome;
- the rehearsal twin;
- the workforce writer and reviewer;
- the instruction planner;
- the meeting host.

Some of them may not apply the Context Firewall the same way (unverified, `15`).

**Memory:**

- History is the last 64 messages; the turn reader sees 6×400 characters.
- Short-term conversation state lives in process maps.
- Long-term memory has 62 items across 164 users.
- There are 0 embeddings, so retrieval is lexical only.

## 4. Voice (see `04`, `diagrams/voice-lifecycle.md`, `voice-state-machine.md`)

**Two transports:**

- **Duplex (preferred).** The browser talks WebRTC to OpenAI realtime `gpt-realtime-mini`, using a client secret minted by q-api.
  - semantic_vad with `create_response=false`, so the server decides who answers.
  - Input transcription is `gpt-4o-transcribe` (mini until 2026-10-08) with a language and vocabulary hint.
  - Each finished user transcript goes to q-api through a Next.js server action (`heard`). `routeDuplexTurn` decides:
    - **ASK_Q:** run Q's brain, then return `{say | facts | silent}` to the browser, which inserts it as a function-call output and asks the realtime model to speak it.
    - **SMALLTALK / MODEL:** the realtime model answers by itself.
- **Standard (fallback):** Deepgram STT → `/v1/q/voice/think` (Q's brain) → ElevenLabs TTS.

**Main failures:**

- The realtime model answers without Q on short turns while a card is in focus (C-03).
- SILENT answers let the realtime model improvise (B-01). Today's `silent` flag broke model-initiated tool calls (C-01).
- Answers are lost or arrive stale around reconnects and interrupts (C-04, C-05, C-07).
- There is no "Thinking" watchdog and errors are ignored (C-06).
- Relays are serialized per browser tab and the Q round trip has no deadline (C-08).
- Delivery is mechanical by design: "say exactly this", "say that faithfully", lists flattened, answers capped at 1,200 characters (C-17, C-02).
- Duplex state is lost on deploy (A-05).

## 5. Rich UI (see `06`, `11`, `diagrams/rich-response-rendering.md`)

**What exists:**

- A closed, Zod-validated union of result blocks: findings, sources, company/investor references, comparison, answer cards, document cards, `SHOW_IN_Q_ROOM`, and UI intents such as NAVIGATE.
- The model chooses a kind and an id. The content is read with the user's own permissions, and the model never writes UI.
- Cards follow speech in a single centre "stage".

**What's missing:**

- No chart or map components.
- Investor cards are unlinked.
- One invalid block drops all of them.

**The arrival briefing:**

- Content: greeting, a rundown of what the agents did, and decision cards for approvals and held drafts.
- It sits in side columns **only before the conversation starts**. It unmounts when Q's spoken opener lands (E-01), so Q talks about cards that are no longer on screen.
- Investors get no new-matching-companies summary (E-02).

## 6. Agents and Work (see `07`, `08`, `diagrams/agent-task-execution.md`, `work-page-state.md`)

**Standing instructions:**

- Swept every 60 s; cadence 240 min.
- A planner model plans the steps. A writer drafts; a reviewer grades against a 6-criterion rubric (threshold 75/100, 2 rounds).
- Integrity rules: grounded, no commitments, nothing private, honest identity, responds to the thread.
- A pass is sent if autonomy allows. A near miss becomes an approval card (24 h TTL). Otherwise it's held or refused.

**Failures:**

- A lapsed card parks the thread forever (D-01).
- Workforce job plans include roles with no executor, so they never send (D-02).
- Near-miss bookkeeping is wrong, with possible double-send (D-03).
- "Nothing needs a reply" is invented when threads weren't read (D-04).
- A planner failure costs 4 h (D-05).
- An errand reports false success (D-06).
- Q's sends aren't marked as from Q (D-07).
- Jobs are fire-and-forget (D-08).

**Live today:** an investor's message to a seeded founder company had gone unanswered for about 21 h. Draft scores were 58 and then 68, and the reply became an approval card.

## 7. Providers and costs (see `09`, `diagrams/model-routing.md`)

- Text models: OpenAI `gpt-5.6-luna` is primary for most task classes; Gemini flash-lite does fast classification; Groq exists.
- Voice: OpenAI realtime `gpt-realtime-mini` plus `gpt-4o-transcribe`; Deepgram; ElevenLabs.
- Also: OpenAI embeddings (unused, 0 rows) and research providers (Tavily, SerpAPI, Bright Data).
- All text calls go through the model gateway with routing policies stored in the database (`ai_ops`).
- **No overall spend cap** on text. The duplex cap defaults to $1 a day platform-wide.
- Several vendors have no usage ledger.
- Heavy analysis runs on a STANDARD-tier model (demo floors left lowered).

## 8. Security (see `10`, `diagrams/auth-permission-boundaries.md`)

**Strong:**

- Server-resolved actor context.
- The Context Firewall before model calls.
- Tool authorize steps.
- Approvals bound to a payload hash, with idempotency keys.

**Weak:**

- RLS is bypassed for all service traffic (A-02).
- Public web content enters the model as SYSTEM/instructions, a prompt-injection vector (F-03).
- Possible routing of non-public turns to unreviewed Gemini under the "synthetic demo" attestation (R-F2).
- Voice transcripts have no deletion path.
- No error monitoring; telemetry export is off.

## 9. Testing and operations (see `13`)

- Thousands of Vitest unit tests; selected suites ran and passed. One known stale failure.
- pgTAP RLS suites, with 4 stale failures on base.
- Playwright e2e exists but no script runs it.
- CI runs only on `main` and PRs. **The deploy branch is not CI-gated**, and Railway deploys without waiting for checks.
- Duplex voice is tested only with fakes.
- `/health/ready` is static.

## 10. What to analyse, in priority order

1. **Voice architecture.** Should the realtime model stay a "mouth" for a 3–7 s separate brain, or get Q's tools and context directly within firewall constraints? How should turn routing, silence, interruption and relay transport work? (`04`, `16` X1, X8, X12)
2. **One persistent "attention" model** for the arrival briefing, voice, Work and answers: a single source of truth for "what needs you" and "what Q did", with cards that persist beside Q while talking (`06`, `11`, `16` X2, X3, X15).
3. **Agent reliability.** Escalation instead of silent parking, executors that match the plan, durable jobs, honest "unknown" vs "nothing" (`07`, `16` X4, X5).
4. **Statelessness and durability of q-api.** Room feed, duplex lines, conversation maps, schedulers (`02`, `16` X7).
5. **Security posture.** RLS for service traffic, untrusted content placement (`10`).
6. **Operations.** CI on the deploy branch, monitoring, readiness checks, spend caps (`13`).

Severity-ranked lists: `14-CONFIRMED-DEFECTS.md` (confirmed) and `15-UNVERIFIED-RISKS.md` (hypotheses). Questions that need the founder: `17-OPEN-QUESTIONS.md`. Map from each conclusion to its source: `20-CODE-EVIDENCE-INDEX.md`. What was and wasn't inspected: `22-COVERAGE-MATRIX.md`.
