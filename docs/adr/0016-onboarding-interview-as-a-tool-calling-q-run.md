# ADR 0016 — The onboarding interview is a tool-calling Q run

## Status

Proposed — 2026-09-25. Amends the interviewer design (CQ-QX-005, CQ-QX-006).
Builds on ADR 0011.

## Context

The interview was a step engine with a model in front of it. Each turn, the
model read the utterance into a closed per-turn reading, and code then picked
the next question, composed read-backs and ran a repair ladder. Every live
failure became another branch: "Yes, it is" to "Your mandate is ready?" never
registered, the same question was sent twice, "go with those" was refused,
exclusions looped across three lists. Each fix was correct. Together they are
the pattern ADR 0011 rejected: a controller that understands only the
sentences somebody has already met.

## Decision

An interview turn is a Q run with tools, the same shape as a Home Q answer.

- The model sees the whole objective every turn: every step (asked, answered,
  missing, held or recommended), the values on the record, the full
  conversation, and the session's communication preferences. The step list is
  a checklist the model consults. Code does not pick the next question.
- The model acts only through typed tools (Zod in and out, authorised, then
  executed through the owning service's existing write APIs):
  - `get_onboarding_state`;
  - `record_answers` (batched, any steps; free text resolved by code to
    options, taxonomy and reference data; each item returns committed,
    rejected with a reason, ambiguous with candidates, or needs another answer
    first);
  - `recommend` (a pending recommendation, never an answer);
  - `accept_recommendation` (the person's explicit approval turns that exact
    recommendation into their answer);
  - `correct_answer`;
  - `confirm_mandate` (code checks completeness and refuses honestly).
- The reply is written after the tool results, in the same loop. The model can
  only claim what a tool result says happened. That is the grounding rule,
  enforced structurally rather than by a prose filter.
- The tools are offered only under the actor-wide `OWN_ONBOARDING` firewall
  scope, and they are bound to the caller's own session. The model never
  supplies a session id.
- The tool registry accepts one write lane: `LOW_RISK_INTERNAL` with
  `SIDE_EFFECT`, for writes to the caller's own record that the owning service
  validates again. Everything else stays `SAFE_READ`. Consequential actions
  still go through the Approval Engine.
- One concept, one answer. The exclusion lists are one concept to the
  completeness check, and a red flag lives in exactly one list.
- Once the loop owns the conversation, the repair ladder, the runtime-composed
  question templates and the read-back branches are deleted. What remains is
  transport-level failure copy, and the legacy definition as checklist and
  storage.

## Consequences

- A conversational failure maps to a missing capability in state, tool
  semantics, validation or persistence, never to a phrase.
- Voice and text call the same loop.
- Every turn costs a tool round. The loop is bounded (rounds and calls per
  turn), as Home Q's is.
