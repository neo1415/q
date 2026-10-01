# AUTO — "Let Q handle it": durable delegated work, stand-in, Q-to-Q, notifications

- Area: AUTO (worker), branch `build/auto`, migration prefix `202611120`.
- Controlling sources: CLAUDE.md (Q authority, Context Firewall, evidence),
  ADR 0028 (errands = scoped delegation), ADR 0027 (Q in meetings), ADR 0019
  (chat actions), BIZ-008 (meetings/reminders), R34 (chat), R20 (capability
  registry), ADR 0011/0016 (no word lists over user words).
- New ADR: `docs/adr/0029-langgraph-delegated-work.md` (amends "no agent
  orchestration" for this one purpose).

## 1. Goals (founder's words, 2026-10-01)

Investor: "Q, handle it." Using the mandate, Q goes through the founders the
investor can discover, watches pitch videos (their transcripts), reads decks
and profiles, picks the closest 2-5 (or more), expresses interest, reports
back that it is waiting, knows when a founder accepts, messages them and
chats in the chat page to learn what matters to the investor, asks the
investor which times work (message / reminder / email), books the meeting,
sends the Meet link to both and tells the investor. As many founders as the
investor allows. Optionally Q runs a first-stage interview of the founder
and sends the investor a PDF report (transcript, how it went, Q's view,
whether to proceed); the investor says "book another meeting for this time"
and Q does it. All of it from ANY Q surface (Home Q, dock, chat, voice).

Founder: Q stands in while they are offline — answers investors' questions
the way the founder would, only from an approved brief and their own
records the investor may already see — and hands the chat back when they
return.

Two Qs (investor's and founder's) can talk to each other.

Reminders, notification centre, email, and Web Push for the PWA (VAPID,
free).

Authority: one approval of a plan and its limits; anything outside comes
back; every message labelled as sent by Q; audit trail; Stop any time;
expiry; never invent facts.

## 2. Research findings

LangGraph.js (docs.langchain.com/oss/javascript/langgraph/interrupts,
/add-human-in-the-loop; @langchain/langgraph 1.4 already pinned here):

- `interrupt(value)` inside a node suspends the thread; the value surfaces to
  the caller; resume with `graph.invoke(new Command({ resume }), config)`,
  which re-runs the node from its start with `interrupt()` returning the
  resume value. Consequence: code before an `interrupt()` in a node must be
  idempotent (we put side effects in their own nodes, keyed by step).
- A persistent checkpointer is required for interrupts; `PostgresSaver`
  costs one round trip per checkpoint and is the production choice. This
  repo already runs `PostgresSaver` on `q_runtime.checkpoint*` (migration 20260906150000) with a bounded pool; we reuse it, so threads survive
  deploys and restarts.
- Durable execution = every super-step checkpointed; a crash resumes from
  the last checkpoint. External effects must be idempotent; we already key
  every command by idempotency key.
- Pattern used here ("wake and observe"): a long wait is an `interrupt`
  whose resume value is a fresh, code-gathered Observation. A runner resumes
  a thread only when the observation changed (fingerprint), so a quiet
  thread costs nothing and checkpoints do not grow per minute.

Agentic deal flow (Q2Q YC, Gamut "VC deal sourcer", Evalyze AI screening,
Auren Hoffman "first VC meeting will be agent-to-agent", gtmnow.com 2026):

- The products that work keep a human gate at the commitment points and
  show a pipeline with stage per company; screening interviews are short,
  structured, and end in a one-page summary with a recommendation.
- Agent-to-agent first meetings are expected in 2026; the risk called out is
  loops and over-claiming, solved here with a typed envelope, intent rules
  and a turn cap (section 7).

Web Push (WebKit "Web Push for Web Apps on iOS and iPadOS", MDN Push API,
OneSignal/MoEngage iOS guides):

- iOS/iPadOS 16.4+: only for a web app added to the Home Screen with a
  manifest `display: standalone`; permission may be requested only inside a
  user gesture; standard Push API + VAPID (RFC 8292) + aes128gcm payload
  encryption (RFC 8291) — no Apple developer account. Safari 18.4 adds
  Declarative Web Push; the classic service-worker path still works and is
  what we ship.
- Android/Chrome and desktop: Push API in the browser and installed PWA;
  Chrome shows the quieter permission UI when sites ask without context.
- A subscription can expire (410 Gone/404) → delete it.
- `showNotification` must be called in every `push` event (iOS revokes
  otherwise).

Notification UX (Courier "Best practices for notification centers",
MagicBell UI guide, SuprSend batching, AppMaster permission timing 2026):

- Ask for push only at a moment of intent, never on first load: a soft
  in-app ask first ("Get a push when Q needs you?"), then the browser prompt.
- Two tiers: "Needs you" (actionable, may push and email) vs "Updates"
  (in-app only, batched). Batch bursts ("Q expressed interest in 4
  companies" = one notice).
- Centre: bell with unread count, newest first, grouped by day, one tap to
  the place to act, mark all read, per-type preferences, an easy off switch.

## 3. UX flows

### 3.1 Investor: "Q, handle it" (any Q surface)

1. The person says it (Home Q, dock, chat sheet, voice). Q calls
   `propose_q_outreach` which prepares ONE approval card: the plan in plain
   steps and the limits — up to N founders (default 3, max 10), the opening
   message word for word, what Q may tell founders (brief, word for word),
   what Q should learn (topics), whether to run a first-stage interview
   (question list word for word), call length and the person's call windows
   ("weekdays 10:00-16:00", in their calendar zone), whether Q may book
   inside those windows without asking, expiry (default 14 days).
2. Approve → a delegation starts (`q.work.outreach.start`). Q replies "On it.
   I'll go through your feed and tell you who I picked."
3. Sourcing (minutes): Q reads the investor's own Discover feed (same reader
   as the page: eligibility, visibility, pass suppression), takes up to 15
   candidates, reads for each what the investor may see: profile card,
   raise summary, pitch transcript(s) via the media service's playback
   authorisation, and the deck text when the investor may open it. A ranking
   call (OUTREACH_SHORTLIST) picks the closest N with one-line reasons that
   quote the material. No pick without at least one quoted reason.
4. Q expresses interest for each pick (Express Interest command, as the
   investor, idempotent per lane) and notifies: "Q expressed interest in 3
   companies: A, B, C. Waiting for them to accept." (one batched notice).
5. On accept (relationship connected): Q posts the opening message
   (labelled "Sent by Q for <Investor>"), then converses: answers from the
   brief, asks the approved topics one at a time, records what it learned.
   Anything it cannot answer → "Needs you" notice; Q tells the founder the
   investor will come back.
6. When topics are covered (or the founder asks for a call, or after 6
   founder turns): if interview is on → step 7; else → step 8.
7. First-stage interview in the chat: Q asks the approved questions one at a
   time (≤1 follow-up each), waits for answers (up to 72 h per question,
   one nudge at 24 h). Then INTERVIEW_REPORT writes: transcript, how it went,
   Q's view (strengths, concerns, open questions — each labelled as the
   founder's claim / from their material / Q's inference), and a
   recommendation (PROCEED / MAYBE / PASS) with why. Filed as a Q_REPORT PDF
   in the investor's documents; "Needs you" notice with the link.
8. Times: if Q may book inside the windows, it books the first free slot
   inside a window ≥18 h out. Otherwise it asks the investor (notice + push
   - email): three free slots inside the windows as buttons, or "other
     time". The investor answers by tapping a slot, or from any Q ("book it
     Tuesday at 3", "book another meeting for this time" → `answer_q_work`).
9. Booking: the schedule command (Google Calendar + Meet, invite to the
   founder's people); Q posts the time and Meet link in the chat; notifies
   the investor with the link. Lane done (or awaits the investor's next
   instruction: another meeting, stop).
   Declines, blocks, lost access and expiry end a lane with a plain notice.

### 3.2 Founder: stand-in

1. From any Q ("stand in for me while I'm away", "answer investors when I'm
   offline") or Settings → Q stand-in. Q drafts the brief from the founder's
   own records that investors can already see (profile, raise summary,
   public pitch facts) and anything they say; `propose_stand_in` prepares
   one approval: the brief word for word, after how long away Q steps in
   (default 30 min, or only when "Away" is on), whether to tell investors
   "I'm Q, standing in for <name>", expiry (default 30 days).
2. While away (no heartbeat for the threshold, or Away on): for each
   connected relationship with new investor messages, Q answers from the
   brief (STAND_IN_REPLY), labelled "Sent by Q for <Founder> (standing in)".
   Questions outside the brief: "I'll make sure <name> answers this when
   they're back" + a "Needs you" item.
3. On return (first heartbeat after away): Q stops answering and hands back:
   one notice "While you were away Q answered N messages from X, Y; 2
   questions are waiting for you", each linking to the chat.

### 3.3 Q-to-Q

When the investor's lane writes to a founder whose stand-in is active, the
founder's Q answers; both are visible to both humans, labelled. Protocol in
section 7.

### 3.4 "Q is working on" panel

- Home (both roles) shows a compact panel when there is active work: each
  delegation with its lanes as rows (company/investor name, stage chip in
  words — "Waiting for them to accept", "Chatting", "Needs your times",
  "Interviewing", "Report ready", "Call booked Tue 14:00"), latest step, and
  controls that work: Stop (whole job), Stop this one (lane), choose time,
  open report, open chat.
- `/work` page: the same, full, plus the timeline of steps (audit trail
  view) per lane. Polls every 10 s while visible (and the poll is the
  presence heartbeat).
- Empty: "Nothing running. Ask Q to handle outreach for you." with an
  "Ask Q" control opening the dock with that prompt. Loading: skeleton rows.
  Error: "Couldn't load Q's work. Retry" button.

### 3.5 Notification centre + push

- Bell in the app header (desktop) and top bar (phone) with unread count
  (no colour-only meaning: count text + aria-label). Opens a panel: "Needs
  you" first, then "Updates", grouped Today / Earlier; each row title, one
  line, time, and goes to its link. "Mark all read". Footer: "Push
  notifications: On/Off" with the two-step ask; on iOS Safari not installed:
  "Add Capital Q to your Home Screen to get pushes" with the steps.
- The soft ask also appears once in the approval confirmation of a
  delegation ("Q will tell you when it needs you. Get a push?").
- Service worker: `push` shows the notification (title, body, icon, tag =
  notice id, data.url); `notificationclick` focuses an open window or opens
  the link (same-origin path only).
- Email: "Needs you" notices are emailed when the person has not read them
  within 10 minutes (Brevo app email port), once per notice.

## 4. Data model (migration `20261112000000_q_work_delegations.sql`)

- `q_runtime.delegations` — the scoped delegation: id, tenant_id, user_id,
  organisation_id, kind (`INVESTOR_OUTREACH` | `FOUNDER_STAND_IN`),
  q_action_id unique (the approval), grant jsonb (the exact approved plan),
  status (`ACTIVE` `DONE` `STOPPED` `FAILED` `EXPIRED`), summary text,
  thread_id text (LangGraph thread), expires_at, timestamps. Owner-read RLS.
- `q_runtime.delegation_lanes` — one per counterpart: delegation_id,
  tenant_id, user_id, company_id, investor_organisation_id,
  relationship_id, counterpart_name, stage, match_reasons jsonb (quoted
  reasons), learned jsonb (topic → founder's words), interview jsonb
  (questions asked/answers), report_artifact_id, meeting_id, needs jsonb
  (what the person must decide: times offered), observed_fingerprint,
  last_step, unique (delegation_id, company_id). Owner-read RLS.
- `q_runtime.delegation_steps` — append-only trail: delegation_id, lane_id,
  step key, plain words, created_at; trigger forbids update/delete.
  Owner-read RLS.
- `q_runtime.presence` — user_id pk, tenant_id, last_seen_at, away boolean.
  Owner-read RLS; server-written.
- `communication.messages` + `q_delegation_id uuid` and `q_envelope jsonb`
  (Q-to-Q), both nullable; `viaQ` = q_action_id or q_delegation_id set.
  (Fixes ADR 0028 errands: `messages_one_per_q_action` let an errand post
  only one message.)
- `communication.push_subscriptions` — user_id, tenant_id, endpoint unique,
  p256dh, auth, user_agent, created_at, last_success_at, failures,
  revoked_at. Owner-read RLS (endpoint is a capability; never returned in
  full by the API).
- `communication.notification_settings` — user_id pk, push boolean, email
  boolean. Owner-read RLS.
- `communication.notifications` + `priority` (`NEEDS_YOU` | `UPDATE`,
  default `UPDATE`), `pushed_at`, `emailed_at`; kinds + `Q_WORK`,
  `Q_STAND_IN`.
- pgTAP: `supabase/tests/q_work_delegations.test.sql` — owner reads own,
  cross-tenant and other-user see nothing, `authenticated` cannot write,
  revoked select grant on anon, steps append-only.

## 5. Contracts (`packages/contracts/src/q/work.ts`)

- `QWorkDto` (delegation: id, kind, status, summary, createdAt, expiresAt,
  lanes[]), `QWorkLaneDto` (id, counterpartName, stage, lastStep,
  matchReasons[], needs (offered slots), meetingAt, meetLink?, reportArtifactId,
  chatPath), `QWorkStepDto`.
- Paths: `GET /v1/q/work` (own active + recent, also heartbeat),
  `GET /v1/q/work/:delegationId` (with steps), `DELETE /v1/q/work/:id`
  (stop), `DELETE /v1/q/work/:id/lanes/:laneId` (stop one),
  `POST /v1/q/work/:id/lanes/:laneId/answer` (times / proceed / pass, with
  idempotency key), `PUT /v1/q/presence` (`{away}`),
  `GET/PUT/DELETE /v1/push/subscription`, `GET /v1/push/key` (VAPID public
  key), `GET/PUT /v1/notifications/settings`.
- Action payloads (`q.work.outreach.start`, `q.work.standin.start`) with
  Zod schemas; the payload IS the grant.

## 6. Q tools + capability registry (`// AUTO block`)

| tool                 | approval                                                                                                        | executes                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `propose_q_outreach` | PREPARE_APPROVE                                                                                                 | `q.work.outreach.start` |
| `propose_stand_in`   | PREPARE_APPROVE                                                                                                 | `q.work.standin.start`  |
| `list_q_work`        | INSTANT (read)                                                                                                  | —                       |
| `stop_q_work`        | INSTANT (acts: stopping is always the person's right, never needs approval)                                     | —                       |
| `answer_q_work`      | INSTANT within the grant (the person's own words name the time; booking only on a lane of their own delegation) | —                       |

Tools exist in the shared registry, so Home Q, the dock, the chat sheet and
voice (all on the same tool registry) get them. Capability text for Q's
system notes mentions them.

## 7. Authority, firewall, privacy

- Approval classes: start = Prepare → Approve (exact grant). Steps inside the
  grant run as the person (actor re-resolved each step; revoked membership
  stops), through the same commands their buttons use, each with a
  step-scoped idempotency key, and recorded in `delegation_steps` + the
  material action audit of the underlying command.
- Outside the grant → a "Needs you" notice, never an action: a founder count
  above the limit, any money/terms/valuation, any time outside the windows,
  any question not in the brief.
- Context Firewall: sourcing reads ONLY the investor's own feed and material
  the investor may already see (media playback authorisation, document
  access check). The investor's mandate is the investor's own. Replies to a
  founder state only the approved brief. Stand-in replies state only the
  founder's approved brief (+ the investor-visible profile lines it was
  drafted from, approved as part of the brief); founder-private data never
  reaches an investor.
- Labels: every Q message carries `q_delegation_id`; the chat shows "Sent by
  Q for <name>"; the stand-in says it is Q.
- Never invent facts: prompts forbid it; each model output is schema-checked;
  shortlist reasons must quote material (code checks the quote appears).
- Q-to-Q protocol `cq.q2q/1`: envelope `{protocol, side, intent, turn}`,
  intents ASK | ANSWER | DEFER | INFO | HANDBACK. A Q answers another Q only
  an ASK; a stand-in never ASKs; at most 6 Q-to-Q messages per relationship
  per 24 h; no Q commits money, terms or times on its principal's behalf
  beyond its own grant.
- Stop: any time, from any surface; stopping ends every lane; nothing
  further runs (the runner checks status before every side effect).
- Expiry: outreach 14 days default (max 30), stand-in 30 days (max 90).
- Cost bounds: shortlist one call per delegation (≤15 candidates), one small
  call per conversation turn, ≤12 Q replies per lane, report one call.

## 8. Runtime

`packages/q-orchestrator/src/work/*` (the only LangGraph importer):

- `createQWorkEngine({ checkpoints, ports, now })`: two compiled graphs,
  `outreach` (thread per delegation for sourcing, thread per lane) and
  `standIn` (thread per delegation). Ports are Capital Q types: `observe`,
  `source`, `shortlist`, `expressInterest`, `post`, `converse`,
  `interviewTurn`, `report`, `slots`, `book`, `notify`, `record`.
- Runner (`q-api`, every 60 s, bounded batch): for each ACTIVE delegation
  and lane, gather Observation; if fingerprint unchanged and no timer due,
  skip; else `invoke(Command({resume: observation}))`.
- Tests: deterministic graph tests with fake ports/model
  (`packages/q-orchestrator/test/work.test.ts`), durable resume across a
  fresh engine on the Postgres saver (integration, local DB).

## 9. Failure / edge cases

Empty feed → "Q found no companies in your feed that fit yet" notice, done.
Fewer fits than N → picks fewer, says so. Interest refused (already
expressed / not available) → lane skipped with reason. Founder declines →
lane DECLINED notice. Calendar not connected → Needs you "Connect Google
Calendar". Model unavailable → lane waits and retries next tick (no
invented reply). Push endpoint gone → subscription revoked. Thread
checkpoint unreadable (version change) → delegation FAILED with notice, no
silent restart. Duplicate approval execution → one delegation (unique
q_action_id).

## 10. Design

Tokens only (`--cq-*`), light + dark, phone + desktop, 44 px targets,
reduced motion (no pulsing; progress shown as text + step count), stage in
words never colour alone, no badges spam: one quiet stage label per row.

## 11. Tests and live checks

- Vitest: graph tests (sourcing → interest → accept → converse → interview →
  report → times → book; stop mid-way; expiry; decline; stand-in away →
  answer → handback; Q-to-Q loop cap), VAPID/aes128gcm encryption vs RFC
  8291 test vector, contract schemas, tools authorize.
- pgTAP for the migration.
- Live (after deploy, fictional accounts): investor.onboard1 with 2 seed
  founders: approve outreach (N=2, interview on), accept as founders,
  answer interview, check report PDF, tap a time, check Meet link + push.

## 12. As built (2026-10-01) — differences from the plan above

- **Decks.** Investors cannot open a company's deck on Capital Q before they
  are connected, so sourcing reads only what the investor may see: the feed
  card (stage, country, the company's own description, feed reasons) and
  up to two ready pitch transcripts under the pitch's own playback rule.
  Shortlist reasons must quote that material; code drops any that do not.
- **The report** is kept on its lane (`delegation_lanes.report`, migration
  `20261112010000`) rather than as a Q document: a Q document is prepared
  inside a Q run under that run's Context Firewall plan, and delegated work
  runs outside any conversation. It is read at
  `/work/<delegation>/report/<lane>` and downloaded as PDF through
  `/api/q-work-report/<delegation>/<lane>` (rendered by the same document
  renderer as Q documents).
- **Chat marker.** `communication.messages.q_delegation_id` marks every Q
  message under a delegation or errand; the chat shows "Sent by Q for
  <name>". ADR 0028 errands now use it too: the unique `q_action_id` index
  allowed an errand only one message.
- **jsonb.** Errand plans and chat envelopes were written as
  `JSON.stringify(x)::jsonb`, which this driver stores as a JSON _string_
  (the object checks reject it, so errands could never be filed). Both now
  use the driver's own `sql.json`.
- **Stand-in and interviews.** When the founder's stand-in is on, an
  investor Q's interview questions (intent ASK) are answered by the
  founder's Q from the approved brief; the transcript marks those lines
  `[Q]` and the report prompt reads them as such.
- **Push** is VAPID on `node:crypto` (RFC 8291 test vector passes), no
  provider and no new dependency. Configure `WEB_PUSH_VAPID_PUBLIC_KEY`,
  `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` on api (public key) and
  workers (sender); without them in-app and email delivery continue.
