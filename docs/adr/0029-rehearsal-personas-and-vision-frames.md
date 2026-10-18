# ADR 0029 — Rehearsal personas per viewer, and shared-screen frames to a vision model

- Status: Accepted (founder direction, 2026-10-01; REHEARSE)
- Builds on: C12 Investor Twin (`q_runtime.rehearsals`); Context Firewall;
  Q Model Gateway; ADR-001 (truth class); spec `docs/specs/2026-10/rehearse.md`

## Context

The founder asked for Q to rehearse any meeting with the other person,
investor or founder, "down to the T", from a continuously refreshed
profile of that person, in a Google Meet-style room, with optional screen
sharing that Q reads and questions. Two things were not covered by the
architecture: a stored model reading _about a person_ that is not a fact
about them, and images entering the Model Gateway.

## Decision

1. **A persona is per viewer.** `q_runtime.persona_profiles` is keyed by
   (viewer, subject). It is built only from what that viewer may already
   see (their side of the relationship, Discover's projection, the pitch
   under the playback rule, network- or publicly-visible knowledge, the
   public web), so two people rehearsing with the same investor never share
   a reading, and nothing private to one side reaches the other's persona.
   Never the subject's Q chats, mandate internals or founder-private
   records of another organisation.
2. **A persona is Q inference about style, not a fact.** `truth_class` is
   fixed to `Q_INFERENCE` by a check constraint; it carries its sources
   (provenance) and is refreshed from the previous reading when its
   material changes (a digest), the public web at most weekly. It writes
   nothing to Knowledge, so the Write Gate is not bypassed: no fact about
   the subject is persisted. Nothing said in a rehearsal is evidence, a
   claim, a memory or a relationship event, and the subject never sees it.
   Every rehearsal surface says "AI rehearsal of X, based on public and
   shared information".
3. **Images through the gateway.** A USER `ModelMessage` may carry up to two
   inline base64 images (jpeg/png/webp, bounded). Carrying one adds the
   `VISION` capability to the route, so only vision-capable catalog models
   are eligible; the OpenAI, Gemini and Groq adapters map it; no URL is
   ever fetched by a provider. The only producer is the rehearsal room: a
   frame of a screen the person chose to share, sent only when it changed,
   held in memory for the next turn and never stored.
4. **Score in code.** The review's score is the mean of the word ratings
   by a fixed table (STRONG 90, SOLID 70, NEEDS_WORK 40), never a number a
   model writes.

## Consequences

- Personas can be stale between refreshes; the lobby shows when it was
  refreshed and what it read.
- Vision adds cost per changed frame; frames are rate-limited in the
  browser (one sample every six seconds, changed frames only).
- Next free ADR number after this is 0030 (other workers: check for a
  clash at merge).
