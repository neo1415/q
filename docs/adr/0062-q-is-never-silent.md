# ADR 0062: Q is never silent (the silence ladder and small-talk memory)

Status: Accepted (Proposed by the Q room wave 4 build, 2026-10-06; accepted under the founder's blanket approval for the Q room brief, R7 and R5).
Amends: ADR 0012 (Q memory gains one type, `small_talk`), the R38 / 2026-09-27 rule in `apps/q-api/src/voice/turn.ts` that stages are shown and never spoken, and the 2026-09-29 thinking-beats rule (`thinking-beats.ts`), which the ladder replaces on the spoken Q path.

## Context

The founder's R7: "Never an awkward silence: while Q works, it hums, says what it is doing, or brings back something remembered from earlier small talk; particles move around the page while it creates; a low working sound." The research (`docs/research/2026-10-06/q-room-technical.md` §4) recommends a code-owned ladder rather than model preambles, which are inconsistent, and a rapport memory kept through the existing Write Gate.

## Decision

1. **The silence ladder is decided in code** (`packages/contracts/src/q/silence-ladder.ts`, pure and shared by the server and the browser). While a Q run is still working and nothing of the answer has been heard:
   - 0.7 s: a soft tone (the browser; obeys On / Quiet / Off and reduced motion).
   - 1.5 s: one stage line built from the run's real visible stage and, when code knows it, the subject's name ("Looking at Ledgerline's deck…").
   - 4 s, then every 6 s: a progress line from the current stage, or a voiced hum; at most three.
   - Past 8 s: at most one remembered small-talk thread per wait and per voice session ("By the way, how was Lagos?").
   - Never while the person speaks, never once Q's answer has started, and never while an approval is waiting.
     Lines are composed from stage templates with variation (opener × object × tail, never the same line twice running). No line is model text, and none names a specialist, a tool or a prompt: only the approved visible stages.
2. **Both voice paths speak the same ladder.** The standard voice line speaks it through its own speaker. The duplex line receives each beat from the server (`narration` relay) and voices it as an out-of-band response with fixed text, so nothing enters the conversation.
3. **Small-talk memory** is `memory_type = 'small_talk'` in `q_knowledge.memory_items`:
   - written only by the memory service (the Write Gate) from a `MEMORY_EXTRACTOR` v2 `SMALL_TALK` item whose quote is verified against the person's own turns; never a platform write, never about a company, and never without its follow-up question;
   - `personal_private`, owned by the user, quoted, and lapsing 90 days after the write (`valid_to`), which a table check enforces;
   - recalled only by `smallTalkThread` for Q's own conversation with that person; `recall` (every prompt, assessment and other purpose) leaves it out;
   - listed in Settings → What Q remembers, and forgotten there like any memory.
4. **Presence while working.** Particles travel around the page edge while Q works, keyed to Q's state (deterministic positions from elapsed time). A very quiet working hum plays only with sound On. Reduced motion stops the particles; sound Off stops every sound.

## Consequences

- Q speaks during long waits. Each line is short TTS (about $0.005 per slow turn).
- Lapsed small talk stays as a row until a sweep removes it; it is excluded from every read from the moment it lapses.
- The stage vocabulary bounds what the ladder can say. A finer line ("Three documents so far") needs a new approved stage or a progress event, which is future work.
