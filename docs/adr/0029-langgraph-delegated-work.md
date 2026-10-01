# ADR 0029 — LangGraph.js runs Q's long-running delegated work

- Status: Accepted (founder direction 2026-09-30 / 2026-10-01; ledger:
  "LangGraph.js for long-running agents, model calls through the Q Model
  Gateway adapter")
- Amends: CLAUDE.md "do not prematurely build … agent orchestration"
  (for delegated work only); doc 12 §10 (orchestration).
- Builds on: ADR 0028 (errands: the approval is the delegation), ADR 0027,
  CQ-Q-003 (LangGraph behind the QOrchestrator port, Postgres checkpoints in
  `q_runtime`).
- Spec: `docs/specs/2026-10/auto.md`.

## Context

The founder asked for whole jobs Q carries out over days: an investor's
outreach to several founders (source → shortlist → interest → chat →
interview → report → times → booking), a founder's stand-in while offline,
and Q-to-Q conversations. ADR 0028's one-minute polling runner holds its
state in hand-written columns and cannot express waits, branches and
resumable sub-steps without growing into an ad-hoc engine. CLAUDE.md forbade
"agent orchestration" in the 48-hour build; the product has now asked for
exactly that.

## Decision

1. **LangGraph.js is the runtime for delegated work**, inside
   `@capital-q/q-orchestrator` (still the only package that imports it).
   Graphs are deterministic state machines; waits are `interrupt()`s resumed
   with a code-gathered Observation; checkpoints go to the existing
   `PostgresSaver` on `q_runtime.checkpoint*`, so work survives deploys.
2. **Nothing in a graph is authority.** Each step that acts calls a
   Capital Q port that re-resolves the person's actor context and runs the
   same command their own button runs, with a step-scoped idempotency key.
   The checkpoint never carries permission forward.
3. **Models only through the Q Model Gateway**, by task class, with
   versioned prompts and schema-checked output. Graph nodes never see a
   provider SDK. No model decides authority or state transitions; models
   write words (replies, shortlist reasons, reports), code decides what
   happens.
4. **The approval is the delegation** (ADR 0028 generalised): one approved
   action (`q.work.outreach.start`, `q.work.standin.start`) whose payload is
   the grant (limits, words Q may say, windows, expiry). Outside the grant →
   back to the person. Stop at any time; expiry always set.
5. **Q-to-Q** uses a typed envelope on the chat message (`cq.q2q/1`) with
   intent rules and a turn cap, so two Qs cannot loop or negotiate beyond
   their principals' grants.
6. **Specialists stay invisible.** The person sees one Q and plain-word
   progress, never node or agent names.

## Consequences

- New tables `q_runtime.delegations`, `delegation_lanes`,
  `delegation_steps`, `presence`; `communication.push_subscriptions`,
  `notification_settings`; message columns `q_delegation_id`, `q_envelope`.
- ADR 0028 errands keep running unchanged; their message marker moves to
  `q_delegation_id` (they could only post one message under the unique
  `q_action_id` index).
- A graph-shape change must bump the work-graph version; an unresumable
  thread fails its delegation visibly rather than restarting silently.
