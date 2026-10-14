# Q Pitch — implementation status

Tracks every Q Pitch building block against the [master blueprint](Q_PITCH_MASTER_BLUEPRINT.md).

**Statuses:**

| Status        | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| PLANNED       | Specified, not built                                                    |
| IMPLEMENTED   | Code exists on a branch                                                 |
| TESTED        | Automated tests pass in CI                                              |
| LIVE VERIFIED | Observed working on a named production/showcase revision with a receipt |
| BLOCKED       | Cannot proceed; reason stated                                           |

A planned or implemented item is never a certified demo claim. Claims require an entry in [`CERTIFICATION_MANIFEST.md`](CERTIFICATION_MANIFEST.md).

**Updating:** update in the same PR that changes the status. Name the branch/PR, the revision and the evidence.

## Foundations (Milestone P0–P1)

| ID     | Item                                                                                              | Status      | Owner / branch                        | Evidence / notes                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QP-F01 | Route and navigation-action inventory (reusable Q actions)                                        | IMPLEMENTED | Lane B / `claude/q-pitch-foundations` | Audit [`audits/QP-F01-route-and-action-inventory.md`](audits/QP-F01-route-and-action-inventory.md): 8 primitives backed with acknowledgements; 6 unsupported or excluded; 4 director-local. Proposes `askApprovedQuestion` (PROPOSED r2) |
| QP-F02 | Dual-membership capability audit (one sign-in, founder + investor org)                            | IMPLEMENTED | Lane B / `claude/q-pitch-foundations` | Audit [`audits/QP-F02-dual-membership.md`](audits/QP-F02-dual-membership.md): memberships and switch exist; RLS is membership-wide, not context-scoped; Q re-scope on switch missing                                                     |
| QP-F03 | Demo fixture isolation audit (Doc 23 seed separation, environment checks)                         | IMPLEMENTED | Lane B / `claude/q-pitch-foundations` | Audit [`audits/QP-F03-demo-fixture-isolation.md`](audits/QP-F03-demo-fixture-isolation.md): seed separation met; whether production is the attested synthetic project is unverified; no banner                                           |
| QP-F04 | `TourAction` contract (typed primitives, acknowledgement results)                                 | TESTED      | Lane B / `claude/q-pitch-foundations` | `packages/q-pitch/src/tour-action.ts` (v1). Merged 86106e43; CI run 38468377950 (test, typecheck, lint, build) PASS                                                                                                                      |
| QP-F05 | `SceneEvidence` / scene manifest contract                                                         | TESTED      | Lane B / `claude/q-pitch-foundations` | `packages/q-pitch/src/scene-evidence.ts` (blueprint §9 fields). Merged 86106e43; CI run 38468377950 (test, typecheck, lint, build) PASS                                                                                                  |
| QP-F06 | Chapter registry + sealed scene scripts (`approvedClaimIds`-bound)                                | TESTED      | Lane B / `claude/q-pitch-foundations` | `script.ts` and `certification-gate.ts`; DRAFT pilot registry `pilot.ts` (only the 4 certified entries; owner review pending, §15). Merged 86106e43; CI run 38468377950 (test, typecheck, lint, build) PASS                              |
| QP-F07 | Tour director state machine (`PREPARE_SCENE`…`COMPLETE`, PAUSED/INTERRUPTED/RESUME/SAFE_FALLBACK) | TESTED      | Lane B / `claude/q-pitch-foundations` | `packages/q-pitch/src/director.ts` (pure). Merged 86106e43; CI run 38468377950 (test, typecheck, lint, build) PASS                                                                                                                       |
| QP-F08 | Persistent Q shell across routes during a tour                                                    | PLANNED     | Lane B                                | Reuse the existing Q dock/stage                                                                                                                                                                                                          |
| QP-F09 | Pause / resume / back / skip / jump controls, keyboard, captions                                  | PLANNED     | Lane B                                | —                                                                                                                                                                                                                                        |
| QP-F10 | Authorised workspace switch over existing memberships                                             | PLANNED     | Lane B + integration owner            | Server/RLS enforced; invalidates retrieval, prefetch and action scope                                                                                                                                                                    |
| QP-F11 | Read-only GateQ showcase/dossier view contract                                                    | PLANNED     | Lane A (GateQ) → Lane B               | Lane A provides it after the GateQ dossier contract is stable                                                                                                                                                                            |
| QP-F12 | Latency/audio baseline in a real browser (start, first audio, action ack, route, pause)           | PLANNED     | Lane C                                | No new provider bills                                                                                                                                                                                                                    |
| QP-P1  | Three-scene pilot: spoken start → Discover card → evidence-backed Q/comparison → pause/back       | PLANNED     | Lane B                                | Acceptance per blueprint §11 P1                                                                                                                                                                                                          |

## Dependencies

| Depends on                                                      | Status                                                            | Notes                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| GateQ G1 text workflow (contact → interview → submit → dossier) | PLANNED (backend in progress on `claude/gateq-interview-backend`) | The GateQ premiere scene stays a labelled overview until GateQ is LIVE VERIFIED |
| Guest document uploads (ADR 0067)                               | PLANNED                                                           | Required for full GateQ acceptance                                              |
