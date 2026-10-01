---
title: HARDEN — Q that is fast, remembers, follows through, and never fails
area: HARDEN (migration prefix 202611100)
owner: HARDEN worker (branch build/harden)
status: living spec; each queue item is specified here before it is built
---

# HARDEN

## 0. Goal (founder's words)

"One agent dedicated solely to continuously researching, enriching and
brainstorming within the project specs on how Q can sound more human, be
faster, have better memory, be more proactive; how the design of its
reminders and chats can be better; giving summaries and next steps and
offering to do the next steps — and actually doing them; making Q so
realistic and proactive it is scary, while making sure everything it does
works 100% of the time, hardened, never failing."

Every idea below is mapped to the locked sources (CLAUDE.md, docs 12, 14,
17, 19, 20, 24; ADRs 0011, 0016, 0017, 0028). Anything that conflicts is
listed in §7 as rejected.

## 1. Research findings (with sources)

| # | Finding | Source | What it means for Q |
|---|---|---|---|
| R1 | Across ten languages the modal gap between conversational turns is ~0-200 ms; longer gaps are heard as trouble or a dispreferred answer. | Stivers et al., "Universals and cultural variation in turn-taking in conversation", PNAS 106(26), 2009 — https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/ | A reply cannot be 200 ms when a model is in the loop, so Q must *acknowledge* inside that window (presence state + first words streamed) and keep the full answer for later. Measure time-to-first-words, not just turn end. |
| R2 | Mixed-initiative principles: act autonomously only when the expected value beats inaction; consider timing and the cost of interrupting; let the person guide and refine; scope the action to uncertainty about the goal. | Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI '99 — https://dl.acm.org/doi/10.1145/302979.303030 | Proactive nudges are decided by a deterministic policy (cost of interruption, recency, dismissals), not by the model; an offer to do the next step is the default, execution needs a yes (Prepare → Approve → Execute). |
| R3 | Tiered memory (in-context working set + recall store + archival) with the agent paging facts in by retrieval keeps long multi-session chat coherent. | Packer et al., "MemGPT: Towards LLMs as Operating Systems", arXiv 2310.08560 — https://ar5iv.labs.arxiv.org/html/2310.08560 | Q keeps a small "about you" working set (confirmed preferences, open threads, last session summary) injected every turn, and retrieves older memories by query; every write still goes through the Write Gate. |
| R4 | A memory stream plus periodic *reflection* (higher-level summaries scored by recency, importance, relevance) makes agents believable over time. | Park et al., "Generative Agents", arXiv 2304.03442 — https://arxiv.org/abs/2304.03442 | Session end produces a short, quote-anchored summary ("last time we…") stored as Q memory (not audit), recalled on return. Importance is the person's confirmation, not the model's guess. |
| R5 | Cloudflare Stream's `/token` endpoint is meant for testing or under ~1,000 tokens/day and is rate-limited; signing keys let the server mint tokens locally with no API call. | Cloudflare Stream docs, "Secure your Stream" — https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/ | Production has no signing key (only `CLOUDFLARE_API_KEY`), so every playback authorization is a Cloudflare round trip and the feed will hit a rate limit with real traffic. Fix: create a signing key (lead/founder action) and cache minted tokens per asset meanwhile. |
| R6 | For a scrolling HLS feed, attaching a source to hls.js *is* the prefetch; a 4 s buffer is enough to render frame one and start instantly, and the active player raises the target. | "Build a directional preload window for a scrolling video feed with hls.js" — https://dev.to/masonwritescode/build-a-directional-preload-window-for-a-scrolling-video-feed-with-hlsjs-310o ; hls.js API docs (`maxBufferLength`, `startFragPrefetch`) — https://github.com/jvary/hls.js/blob/master/docs/API.md | The next card buffers ~4 s (not 10 s) with `startFragPrefetch`; when it becomes active the same engine raises its target. Billable bytes stay small (doc 20 §51). |
| R7 | `navigator.connection` is not universally supported (Safari/iOS and Firefox have none). | Doc 20 §52; MDN Network Information API | "Unknown" is not "constrained": the startup buffer must run unless the browser says Save-Data or a slow link. |

## 2. Queue item 1 — Discover: the next pitch starts instantly

### Diagnosis (code read, 2026-10-01)

1. `useFeedBudget` treats a browser with no Network Information API as a
   constrained link. Safari, every iPhone browser and Firefox have none, so
   on them the next card is POSTER only: no source is attached until the
   swipe, and the swipe then pays manifest + first segment + decode
   (seconds). Doc 20 §50/§52 says STARTUP_BUFFER "when conditions permit"
   and that the API is often missing — absence is not a constraint.
2. The STARTUP_BUFFER intent sets `preload="metadata"`. Native HLS
   (Safari) then fetches only the manifest; no media is buffered.
3. hls.js buffers 10 s for the warm card (more bytes than needed, competes
   with the active card) and does not prefetch the first fragment before
   the media is attached-ready.
4. Every authorization without a signing key is a Cloudflare `/token` API
   call (R5), behind a Next server action, which Next runs one at a time
   per client, queued behind Save/Pass decisions.

### Fix

- Budget: DEFAULT unless the browser says Save-Data, or an effective type
  of `slow-2g`/`2g`/`3g` (doc 20 §130 Save-Data → poster only).
- STARTUP_BUFFER intent: attach, `preload="auto"` (the controller's single
  next card, not scattered — CLAUDE.md feed rule), never autoplay.
- hls.js: one engine per attached element; warm target 4 s with
  `startFragPrefetch`; the engine's buffer target is raised to 30 s when the
  controller makes the card ACTIVE (same engine, no re-attach), and
  lowered again if it falls back to warm.
- Authorizations: the controller authorises the warm window (+1, +2)
  ahead through the shared per-feed cache (already one owner); unchanged
  contract.
- Server: the Cloudflare provider caches a `/token`-minted token per
  (asset, access mode) for half its life (authorization is still decided
  per viewer per request — the token is a bearer for the asset, not the
  viewer); local signing is used when a key is configured. Lead action:
  create a Stream signing key and set `CLOUDFLARE_STREAM_SIGNING_KEY_ID`
  and `CLOUDFLARE_STREAM_SIGNING_KEY_PEM` on api.

### Tests

Unit: budget for unknown/4g/3g/Save-Data; intent for STARTUP_BUFFER;
hls buffer-target switch; token cache (reuse within half-life, refresh
after, never across assets or access modes, never for a refused asset).
Live (after deploy): Discover on Safari/iPhone and Chrome — second and
third card start < 300 ms after the swipe (network panel: the next card's
`.m3u8` and first `.ts`/`.m4s` fetched before the swipe).

## 3. Queue item 2 — HANDOVER §5 open items 1-6

Specified in full when started (measure first with `ai_ops.model_usage`
and the "interview q run traced" logs). Direction:

1. Re-asked required questions: code-composed turn notes already list
   unanswered steps; add an ask counter per step and a "defer after two
   asks while they talk about something else" note (same pattern as the
   optional-question pass-over). No regex over user words (ADR 0011/0016).
2. Namesake research: research findings must carry the matched entity's
   identity evidence (domain/registry/country) and be dropped by code when
   the sign-up website/country contradicts them.
3. Over-read short first answers: the reader's output for a one-word
   answer to a choice step is held as a pending recommendation (read
   back), never recorded directly.
4. Deck offer / findings offer: live check only.
5. Signals & verification: live check for a new bench company.
6. Latency: measure per-round latency; candidates — a faster dialogue
   task class route, streaming the first sentence (R1), and running the
   reader, the first agent round and the context loads in parallel.

## 4. Queue item 3 — end of turn, memory, proactive nudges

- **End of turn** (every Q surface: Home Q, dock, chat, voice): after an
  action, Q says a one-line summary, the concrete next step and an offer
  to do it. The offer is a typed *pending next step* (capability id +
  prepared input) held server-side for that conversation; a yes runs it
  through the existing tool registry and its authorize step — the model
  never gains authority because it proposed it (CLAUDE.md "Authority").
  Consequential capabilities still go Prepare → Approve → Execute.
- **Memory**: Q memory (≠ audit, ≠ knowledge) holds confirmed preferences
  and a per-session summary; recall injects a small working set every turn
  (R3) and retrieves older items by relevance (R4). All writes through the
  Write Gate; the person sees and deletes them on the memory page.
- **Proactive nudges**: a deterministic policy (R2) reusing the onboarding
  nudge policy pattern (`packages/onboarding/src/domain/nudge-policy.ts`):
  quiet hours, at most one open nudge per subject, backoff after a
  dismissal, never during a swipe or a call.

## 5. Queue item 4 — hardening harness

A deterministic eval suite (fake model + scripted tool results) that walks
every capability in `packages/q-tools/src/capabilities.ts`: happy path and
refusal path (unauthorised scope, invalid input, provider failure), and
asserts the exact refusal code. Plus `scripts/handoff/live/smoke.mjs`: ≤10
cheap live turns after each deploy, each naming the capability, expected
outcome and, on failure, the correlation id and the `ai_ops.model_usage`
row that explains it.

## 6. Authority, privacy, states

- No new consequential action is executed without the existing approval
  path; the pending next step binds to the exact prepared payload.
- Context Firewall: memory recall is filtered to the asker's scope before
  model invocation; founder-private memory never feeds investor-facing
  ranking.
- Playback: authorization stays per viewer per request; a cached token is
  never returned to a viewer the server did not just authorise.
- Feed states: poster instant (warmed), buffering spinner only after
  300 ms, fallback still when unplayable (existing), reduced motion =
  poster + explicit Play (ADR-001 D5).

## 7. Rejected ideas (conflict with locked specs)

- Preloading full videos or more than the next one buffer (doc 20 §51,
  billable delivery).
- Letting the model decide when to interrupt with a nudge (R2 says cost
  of interruption; CLAUDE.md: no LLM in critical ranking/decision paths
  that code can decide).
- Executing an offered next step on "the model thinks they agreed" —
  agreement is read by the independent reader and bound to the payload.
- Storing raw transcripts as memory (Q Memory ≠ Audit History).
