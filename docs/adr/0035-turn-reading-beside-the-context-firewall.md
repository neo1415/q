# ADR 0035: Reading the turn beside the Context Firewall

Status: ACCEPTED (lead decision, HARDEN speed sweep, 2026-10-01).

## Context

Before Q answers, it reads the person's latest turn into the conversation core's closed vocabulary
(TURN_READER, about 1 s). The reading used to start only once the run reached SYNTHESIS, after
CONTEXT_RESOLUTION, POLICY_CHECK, PLANNING and RETRIEVAL (about 0.65 s). The first sentence of a
simple answer therefore arrived after about 3 s.

## Decision

The turn reader may start as soon as PREFLIGHT has passed. It then runs concurrently with the
Context Firewall, under these conditions:

1. **After authorisation.** It starts only once preflight has confirmed the run, the actor and the
   orchestration version. Run creation has already checked authentication, Q access and
   entitlements.
2. **Own content only.**
   - Its input is the person's own latest message and their own recent turns in this run's
     conversation (OWN_Q_CONVERSATION, which the firewall grants to nobody but them). These are read
     as the run's owner.
   - It also receives the action vocabulary that this conversation's previous turn was given: tool
     names and what they do, which is Capital Q's own metadata.
   - It receives no company, investor, document, memory or knowledge content.
3. **A reading, not an answer.** Nothing is said, stored or done from it. The answer for the same run
   takes it up only if the message and the action vocabulary match what this turn computes after the
   plan exists. Otherwise the turn is read again.
4. **Discarded on refusal.** If POLICY_CHECK, revalidation before retrieval, or the answer node's plan
   refuses the run, the early reading is dropped unused (`QAnswerPort.discard`). Readings are also
   held in a bounded per-process map and never persisted.

## Why the Context Firewall still holds

The firewall decides which context Q may reason over; it filters scope before any model call that
uses that context. The early reading uses no context the firewall governs. It sees only what the
person themselves wrote in their own conversation, which they may always see. Its result reaches no
one before the firewall has authorised the run, and a refused run discards it.

Founder-private information cannot reach investor-facing reasoning through this path, because none
is read.

## Consequences

- About 0.65 s comes off the path to Q's first sentence.
- A refused run may still have spent one reader call (flash-lite) that is then discarded.
- A conversation's first turn has no known action vocabulary, so it is read at SYNTHESIS as before.
- The lifecycle moves CONTEXT_RESOLUTION and POLICY_CHECK now share one transaction
  (`advanceThrough`). Every status is still taken in order and logged.
