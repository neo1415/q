# ADR 0028 — Q errands: one approval for an exact multi-step plan

- Status: Accepted (founder direction, 2026-09-29)
- Builds on: Q authority rules (Prepare → Recommend → Human Approval →
  Execute "unless explicit scoped delegation exists"); ADR 0019 (chat
  actions); BIZ-008 (calls); ADR 0027 (meeting record)

## Context

The founder asked for Q to take on whole jobs: "express interest; when they
accept, chat with them, answer their questions, book a call, send me the
link, notify me". Approving each step separately defeats the point, and
letting Q act freely on a relationship breaks the authority rules.

## Decision

1. **The approval is the delegation.** `propose_errand` prepares one
   `q.errand.start` action whose payload is the whole plan: Express Interest
   (yes/no), the opening message word for word, the brief Q may answer
   from word for word, and the call's purpose and length. The person
   approves exactly that; Q never widens it.
2. **Every step runs as the person.** The runner re-resolves the approver's
   own actor context at each step (a revoked membership stops the errand)
   and calls the same commands their buttons call, with the same party,
   connection, block and calendar checks, under step-scoped idempotency
   keys.
3. **The brief is the Context Firewall.** Q's replies to the other side
   state only the approved brief (ERRAND_REPLY prompt). Anything else goes
   back to the person as a notice. Q's messages carry the approved action
   id and show as sent by Q.
4. **Bounded.** An errand ends when its plan is done, when the person stops
   it, when access is lost or messaging is blocked, or after 14 days. It
   sends at most 8 replies. Calls are booked at least 18 hours out, at the
   first free time on the person's own calendar.

## Consequences

- Table `q_runtime.errands` (owner-read RLS) and notice kind `Q_ERRAND`.
- A one-minute runner in q-api. Each reply is one small model call through
  the gateway.
