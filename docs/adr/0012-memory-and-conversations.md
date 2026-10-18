# ADR 0012 — Q remembers: conversations, memory and the learning loop

## Status

Accepted — 2026-09-17.

## Context

Q forgot everything between two sentences of the same person. A refresh
lost the thread (the browser remembered run ids in local storage and
pretended otherwise); there was one conversation per tab and no way to
see, name or return to another; a correction, a pronunciation or a
preference stated on Monday was unknown on Tuesday; the interview met the
same founder twice and did not know it; and a spoken "Approved." fell
through a word list into a run that said the approval had been noted when
nothing had been.

The architecture already describes the missing pieces. Doc 13 §40 gives
`q_knowledge.memory_items` its columns and its status lifecycle. Doc 14
§55-§61 names the memory kinds (working, episodic, semantic, preference),
the ownership model, the write modes and the poisoning controls; §130
gives the memory service its three operations and §131 says a recall is
a bundle of typed sections, never one string. Doc 12 draws the line ADR
0011 restated: a model reads meaning, code holds authority. None of it
was built.

## Decision

1. **A conversation is a thing a person returns to.** `q_runtime.
conversations` gains a title, a rolling summary, the timestamp the
   summary covers and the time of its last message. The Q API lists a
   person's conversations newest-activity first, opens one with its
   recent turns and its latest run, and archives one. The browser holds
   nothing: the conversation it is in comes from the URL, and reopening
   it reads the recorded turns back under the person's own session. The
   spoken thread names its conversation on the voice turn state so
   "Go to chat" and a refresh find what was said aloud.

2. **Memory is its own table with its own gate.** `q_knowledge.memory_items`
   follows doc 13 §40 with three additions the gate needs: a content hash
   (the same thing is never remembered twice), a write mode (how it got
   here) and a verbatim quote. One live value per key per owner is a
   partial unique index, not a habit. The table is server-internal: RLS
   on and forced, no policy, no grant.

3. **The memory write gate is deterministic and the only writer.** Its
   order is fixed: candidate → schema → owner is the actor, never the
   candidate → quote verified against the person's recorded USER turns
   in this run → secrets refused → dedupe by hash → supersede by key →
   persist. A model never chooses tenant, owner, status, visibility,
   sensitivity or write mode; those fields do not exist on the candidate.
   A Q_PROPOSED memory with a quote that is not in the turns is refused,
   which is the whole defence against a memory nobody stated.

4. **Q learns after the turn, never inside it.** When a run ends, the
   memory extractor reads the unseen turns, what is already remembered
   and the previous summary, and proposes bounded items in a closed set
   of types (preference, pronunciation, correction, fact about the
   person, fact about their company) plus a title and a rolled-forward
   summary. Proposals go through the gate; the digest goes to the
   conversation. All of it hangs off the orchestrator, detached: a person
   never waits on Q learning, and a failure costs a memory, not a turn.

5. **Recall is typed, rendered last, and marked untrusted.** The memory
   service returns a bundle (person, company, this conversation's
   summary, other recent conversations' summaries). It is rendered to
   bounded text only at the prompt boundary, in usefulness order, and
   enters the analyst (v4) and the interview conductor (v3) as an
   UNTRUSTED variable inside the same fences as the person's words. The
   recogniser is told the names the person taught Q to hear.

6. **A reply to a closed question is read by a model.** DECISION_READER
   returns YES, NO or UNRELATED for the reply to the one question Q asked,
   with the remainder of a reply that also says more carried on verbatim
   as the next turn. The word list stays only as the degraded fallback
   when no model answers, as the interview's scripted reading does.

7. **The person's own name is a Q action.** `person.profile.update` is
   CONFIRM_REQUIRED, proposed only for the acting person, authorised only
   when the payload names them, executed under the approver's id through
   the identity context. What Q calls the person was never a company
   field; it is now not a word list either.

## What memory is not

- Not evidence about a company. A founder saying "we sell to insurers" is
  a memory of what they said, kept so Q behaves as told; the recorded
  claim with truth class and evidence status is the Knowledge Write
  Gate's, as before.
- Not audit. Who approved what is in `audit.material_actions`; memory
  never records an action.
- Not authority. A remembered preference changes what Q says, never what
  anybody may do. The Context Firewall, the Tool Registry and the
  Approval Engine are untouched by this decision.
- Not one blob per user (doc 14 §150.1). Rows, keys, statuses, history.

## Consequences

- Two migrations; two tables changed; one new server-internal table. The
  schema guard and the knowledge RLS suite are updated to say so.
- One extra model call per completed run, on the small extraction model,
  off the answer path. One recall (a bounded index read) per answer.
- Prompt versions: company-analyst/v4, interview-conductor/v3,
  decision-reader/v1, memory-extractor/v1, pinned in `prompts.lock.json`.
- The browser's local-storage run list is gone. What a refresh shows is
  what the server recorded.
- `docs/modules/q-memory-conversations-audit.md` is the checklist this
  decision is verified against; it is meant to be re-run.

## References

- `docs/architecture/13_Database_and_Data_Architecture.md` §38, §40
- `docs/architecture/14_RAG_Memory_Knowledge_Architecture.md` §11.5,
  §55-§61, §130-§131, §150.1
- ADR 0011; `packages/q-knowledge/src/memory`, `packages/q-runtime/src/application/conversations.ts`,
  `apps/q-api/src/composition/memory-learner.ts`, `apps/q-api/src/voice/decision.ts`
