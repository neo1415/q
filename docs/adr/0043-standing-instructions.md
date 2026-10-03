# ADR 0043: Standing instructions and delegated authority

- Status: Accepted (founder decisions, 2026-10-03)
- Amends: doc 12 ("no generic autonomous agent"), Final System Review
  §497 and §506, within PADL #140 (standing delegated authority) and
  Product Specification §7.4 and §8.7.6
- Builds on: ADR 0028 (the approval is the delegation), ADR 0030
  (LangGraph for delegated work), ADR 0040 (the app's own action and read
  registry)
- Migration: `20261121090000_standing_instructions.sql` (additive)

## Context

Q can do one approved thing at a time, and two scripted jobs (an
investor's outreach, a founder's stand-in). Founders and investors asked
for more: "handle all the work for me". The founder decided on 2026-10-03:

- standing instructions are in V1;
- under a "handle everything" grant Q may, without asking each time,
  express interest, send intro and follow-up chat messages within the
  approved tone and topics, and propose and book times within the person's
  working hours;
- terms, commitments, signing and money always need an explicit yes;
- email beyond Gmail send comes later;
- each instruction has a model budget, $5 a month by default, then it
  pauses and asks.

## Decision

1. **An instruction is a goal plus ONE approved grant.** The person says
   the goal in their own words; Q answers at once and shows one card in
   plain words: what Q will do on its own, what it asks first, what it
   never does without them, who it covers, the hours, the budget and until
   when. Approving it (Approval Engine action `q.instruction.grant`, bound
   to the exact grant by hash) makes it ACTIVE. Changing a grant is a new
   version that needs its own approval. One sentence or one tap stops it.
2. **The grant names declared actions only** (ADR 0040), each AUTO or ASK,
   with a counterpart scope, working hours and time zone, tone, topics,
   a per-counterpart message cap (8, then ASK) and an expiry.
3. **What Q may ever do alone is fixed in code**, not in the grant:
   `relationship.interest.express`, `chat.message.send`,
   `schedule.meeting.book`. A declaration marked `consequence` (TERMS,
   MONEY, COMMITMENT) is never delegable: raise terms and sharing,
   relationship outcomes and passes, interest and connection decisions,
   mandates, KYB. Those are ASK at most, whatever the grant says.
4. **Q plans; code decides.** Each run, a large model writes a typed plan
   naming declared actions and reads. Code validates every step against
   the approved grant version: unknown, out of scope, non-delegable,
   over the message cap, outside working hours or touching terms or money
   is refused or turned into a card. AUTO steps run the same command the
   person's own button runs, under their actor context, with a step
   idempotency key; ASK steps prepare an approval card. A step the plan
   cannot take is explained at once in plain words, with something Q can
   do instead.
5. **Outreach and stand-in coexist** as tools the planner may call, and
   become templates of this engine later.
6. **Untrusted content** (messages, email, web) reaches the planner only
   through a quarantined extractor with no tools, as typed fields.
7. **Cost is per instruction**: model usage carries the instruction id,
   the gateway refuses a call that would exceed the month's budget, and the
   instruction pauses with a "continue?" card. The running cost is shown.
8. **Nothing is hidden.** Every step Q takes or asks is recorded
   (append-only), audited as acting under the instruction, summarised in
   a digest at the person's cadence, and anything that needs them is a
   NEEDS_YOU notice.

## Consequences

- New tables `q_runtime.standing_instructions`, `instruction_grants`
  (append-only; recording an approval is the one allowed change) and
  `instruction_steps` (append-only). Triggers and firings follow with the
  scheduler.
- App-action declarations gain `consequence`; `delegableOnItsOwn` is the
  single test of what Q may do alone.
- Relationships stay the only CRM truth; an instruction holds no copy of
  them.
