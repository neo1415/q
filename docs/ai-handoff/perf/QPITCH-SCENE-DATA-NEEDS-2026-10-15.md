# Q Pitch scene data needs — for Lane S's prefetch contract (Lane P, 15 Oct)

This is Lane P's input to the prefetch contract. Lane S owns `packages/model-gateway`, Q routing and the contract itself. Lane P owns the tour side: `TourPorts.prefetch`, called on every scene PREPARE with the next two scenes, for the current actor only.

## What the tour prefetches today (no server change)

- **Routes:** `router.prefetch(path)` for each `openRoute` destination and each resolved `openCompany` (`/company/<id>`) in the next two scenes.
- **Fixture resolution:** read only from the actor's own Q conversation (answer cards with a COMPANY subject). No API call.

## What each scene needs warm (proposed contract asks)

| Scene            | Data the first frame needs                               | Q run? (cold cost today, S baseline)                           | Ask of S                                                                                                                                             |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 Discover      | Discover slate for the actor                             | no                                                             | the precomputed slate (exists); nothing new                                                                                                          |
| P2 top three     | the actor's mandate projection + fit inputs              | **yes**: generation; certified run settled at 3.4 s            | a fit-path capsule warmed at tour start (mandate projection, slate ids), keyed by actor + membership + mandate version                               |
| P3 company       | company profile read + findings sources for Ledgerfold   | **yes** ×2: record page generation, p50 about 14.7 s           | a **source capsule** for (actor, company): permission-filtered evidence ids and profile facts, prepared during P2 narration; first clause streamable |
| P4 compare       | both companies' profiles against the mandate             | **yes**: about 31 s single run                                 | the same capsule for the second company, prepared during P3; comparison card builder warm                                                            |
| P6 privacy       | nothing private; the refusal must come from the firewall | **yes**: should route to the fast lane (no generation needed?) | S decides whether a scope-refusal answer can be code-only. The capsule must **not** contain founder-private ids                                      |
| P5 GateQ         | inbox list for the actor's gateway                       | no                                                             | the arrival snapshot is cold (126 DB round trips once). Warm the GateQ inbox read model when P6 prepares                                             |
| P7 relationships | the relationship overview read model                     | no                                                             | warm it when P5 prepares                                                                                                                             |
| P8 rehearsal     | partners list; the rehearsal persona                     | **yes**: rehearsal turns                                       | persona build `GET .../persona` warmed at P7 prepare (no paid call if the persona is cached)                                                         |
| P9 Home          | arrival snapshot                                         | no                                                             | warm the arrival snapshot at P8 prepare (the cold miss in S baseline §2)                                                                             |

## Invariants for any capsule (Lane P will test the tour side)

1. **Keyed by actor, membership, role and content version.** Any role switch or membership change clears it (`CLEAR_SCOPED` already drops the tour's caches).
2. **Ids and permission-filtered facts only.** Never founder-private or other-tenant content, and never a raw transcript.
3. **Prefetch reads only.** It never starts a paid model run speculatively; a Q run starts only when the scene dispatches it.
4. **The receipt stays truthful.** Prefetching never shortens it: DONE still requires the run COMPLETED and the answer visible.

## Proposed interface (for S to accept, change or reject)

`prefetchSceneCapsule({ sceneId, actor, subjects: companyIds[], intent: "PROFILE" | "RISKS" | "COMPARE" | "INBOX" | "RELATIONSHIPS" | "ARRIVAL" })` returns `{ capsuleId, expiresAt }`. It is fire-and-forget from the browser. A later Q run may carry `capsuleId`, and the server re-authorises it before use.

## Answer to the contract question: which scenes carry a Q ask (Lane P, 15 Oct)

S's contract is accepted (`PREFETCH-CONTRACT-2026-10-15.md`), and `QAnswerCapsule` lives in `packages/contracts/src/q/answer-capsule.ts`.

| Scene (script)                      | Status on 15 Oct                            | Q ask                                  | Code lane S can map it to                                                                      |
| ----------------------------------- | ------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `s.pilot.opening` (pilot, premiere) | browser-certified (re-cert due)             | `q.top-three`                          | computed fit ranking: the best capsule candidate                                               |
| `s.pilot.company`                   | browser-certified (re-cert due)             | `q.company-profile`, `q.company-risks` | profile: declared company facts (partly); risks: generation, so no capsule beyond evidence ids |
| `s.pilot.compare`                   | browser-certified (re-cert due)             | `q.compare-two`                        | generation; warm both companies' reads only                                                    |
| `s.premiere.privacy`                | CODE_VERIFIED                               | `q.private-runway`                     | ideally a code-only scope refusal; never a capsule holding private ids                         |
| `s.premiere.gateq`                  | browser-certified (`GATEQ-INBOX-VIEW`)      | none                                   | page reads only                                                                                |
| `s.premiere.relationship`           | browser-certified (`CRM-RELATIONSHIP-VIEW`) | none                                   | page reads only                                                                                |
| `s.premiere.rehearsal`              | CODE_VERIFIED                               | none (rehearsal turns, not a Q run)    | n/a                                                                                            |
| `s.premiere.close`                  | CODE_VERIFIED                               | none                                   | warm the arrival snapshot two scenes ahead                                                     |

Lane P will call `GET /v1/q/arrival-snapshot` (in the actor's own session) from `TourPorts.prefetch` when a scene with a Q ask is two scenes ahead. Done in the next P slice.
