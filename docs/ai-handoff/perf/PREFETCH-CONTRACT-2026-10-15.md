# Prefetch contract: lane P (Q Pitch) × lane S (Q speed), 2026-10-15

**Status: ACCEPTED** by the lead on 2026-10-15. It was read against `claude/p-artifacts-oct15`: `packages/q-pitch/src/{director,tour-runner,guide,scene-evidence}.ts` and `apps/web/src/features/q-pitch/use-tour-ports.ts`.

## What lane P already does (keep it)

- **Scene lookahead.** `director.ts` `PREPARE` effects carry `prefetch` = the **next two** scenes (`slice(i + 1, i + 3)`).
- **Route warming.** `TourPorts.prefetch(scenes, actor)` warms only routes (`router.prefetch` for `openRoute` / `openCompany`).
- **Scene limits.** A `SceneEvidence.prefetch` lists at most 4 routes and 8 opaque media ids per scene. It covers safe UI data and media for **this actor only**.
- **Capsules.** A `SceneCapsule` holds ids only (`sourceIds`, `resourceIds`) for one `TourActor`. It is cleared on a role switch, and a capsule for another actor is refused.

## Rules both lanes keep

1. **Prefetch never calls a model.** No speculative `POST /v1/q/runs` for an upcoming scene. Warming uses read paths answered by code:
   - `GET /v1/q/arrival-snapshot`;
   - `POST /v1/q/navigation/resolve`;
   - the app's own page reads.
2. **The actor is always resolved server-side** from the session, never from the capsule. A `TourActor` email names a fictional account. It is a label, not authority.
3. **The cache key is the context-cache scope:** tenant, user, organisation, membership, authorisation epoch, kind, sensitivity and firewall policy version (`@capital-q/security/context-cache`). There is no key without the actor, so nothing is cached across tenants or actors, and that includes embeddings and vectors.
4. **Invalidation:**

   | change                 | effect                                                                |
   | ---------------------- | --------------------------------------------------------------------- |
   | role switch            | different actor → different key; P also clears its capsule            |
   | membership or role     | epoch change                                                          |
   | the person's own write | `invalidateActor`                                                     |
   | disclosure or content  | probe stamp change, or `invalidateSubject` / `invalidateOrganisation` |

   Nothing is ever served past its trust window without a probe.

5. **Budget:**
   - at most two scenes ahead;
   - routes and media within the `SceneEvidence.prefetch` caps;
   - nothing on a constrained connection (`CONSTRAINED_PREFETCH_BUDGET`) or with reduced data;
   - a prefetch is abortable and never blocks the current scene.

## What lane S offers (the next S5 slices)

- **Warm Q reads, no new endpoint.**
  - When a scene with a Q moment is two ahead, P calls `GET /v1/q/arrival-snapshot` for the scene's actor (the person's own session).
  - The arrival snapshot builds at about 1.4 s and 126 DB round trips cold, versus 22 ms warm. S will make a refresh-ahead for active actors.
- **Q answer capsule v1 (needs a contract, coordination-critical).**
  - A per-actor, code-composed answer for a certified scene question (computed fit ranking, declared company fact, arrival item).
  - Shape: `{ capsuleId, sceneId, kind, sourceIds, resourceIds, text, builtAt, validUntil }`.
  - Built only by the zero-model lanes (S2 and S2b), under the same plan and tools.
  - Served only to the same actor key, and invalidated as in rule 4.
  - A scripted Q Pitch line stays labelled scripted. A capsule is labelled live-computed with its `builtAt`.
- **Q stays visible across routes.** No navigation path makes a model call (S2 removed the speculative reads on navigation words).

## Where `QAnswerCapsule` lives (lane S decision, for lane P)

**Decision: `packages/contracts/src/q/answer-capsule.ts`** (Zod and TypeScript).

- **Why not model-gateway.** The capsule crosses a trust boundary: q-api serves it to the web host and the q-pitch tour. Both sides must validate it, and neither the web nor `packages/q-pitch` may import model-gateway.
- **Scope.** It ships in the S5 capsule slice together with its first consumer, not before. It is one file and one schema. No existing contract changes.

## Open

- P confirms which certified scenes carry a Q ask, so S can mark the code lane each one maps to.
