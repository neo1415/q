# R1 root cause: Q's page-move decision never ran (owner live test, 7 Nov 2026)

W4 (session_01Wncmn4BQnwUu8PoUpcMjfu), for the integration owner, about `LIVE-FINDINGS-2026-11-07-OWNER.md`. Every claim below is reproduced by a failing test or quoted from the code at `d57b87e06`. I did not read production rows: the read was refused by this session's permission policy. The DB facts quoted (0 of 36 runs carry `screen.workspace`) are the integration owner's.

## 1. Why `screen.workspace` never reached the decision

The trace runs: web send → q-api gate → run persistence → Context Firewall plan → `createQPageMoves.start`.

| Step                             | Verdict                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web send                         | **Sends it**                                     | `apps/web/src/features/q/screen.ts:286-288` adds `workspace` whenever `.cq-shell[data-workspace]` is on the page. `app-shell.tsx:120` renders that attribute exactly when the workspace is on. `actions.ts` parses it with the strict schema (`QScreenContextSchema.safeParse`), and a bad workspace would void the whole screen. The findings show the runs kept their route, so that did not happen.                                                                                                                                                                                                                                                                          |
| q-api gate (`workspace-gate.ts`) | **Not the cause, by construction**               | The web decides whether to render the workspace from the same token's claims (`features/workspace/mode.ts`, `getClaims()`). The toggle refreshes the session (`workspace-actions.ts`: `updateUser`, then `refreshSession`). The run's server action sends that same cookie session as the bearer. So the token q-api sees says "on" whenever the person sees the workspace. Reproduced: the end-to-end test below passes the gate with an opted-in token. Not checked live.                                                                                                                                                                                                     |
| **Run persistence**              | **DROPS IT: root cause**                         | `q-runtime/src/application/create-run.ts:493` `screenWithManifest` rebuilt the screen **field by field**: route, timeZone, attachedDocumentIds, manifest, artifact, then the resolved entities. It never listed `workspace`, which was added to the contract on 7 Nov (`8139a963f`, `QWorkspaceScreenSchema`). It also never listed `surface` (Q Intelligence step 1). So `q_runtime.runs.screen` never holds either. The orchestrator plans from the stored run (`q-orchestrator/src/orchestrator.ts:451`, `screen: run.screen`), so `plan.screen.workspace` is always absent and `createQPageMoves.start` returns at its first line. That is the integration owner's 0 of 36. |
| **Firewall plan**                | **Drops it too: the same defect, a second time** | `q-firewall/src/firewall.ts:178` `screenWithin` has the same field-by-field copy, also without `workspace`. Even a run that kept it would have lost it in the plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**The root problem.** Two separate hand-written allowlists narrow the screen, each meant to "keep the route and only bound entities". Each copies the fields its author knew of. The contract is already strict, which makes it the real allowlist. Any field added to the contract later was silently dropped in two places, and no test could notice, because the page-move tests build `plan.screen.workspace` directly.

**The fix** (branch `fix/q-nav-workspace-r1`) has one rule in the contract: `screenWithBoundEntities` in `contracts/src/q/request.ts`.

- Only the fields that name an entity are judged: company, investor organisation, document with its page, and an artifact's slide and version with the artifact.
- Everything else is a hint about the person's own screen. It grants nothing and is kept as the strict schema accepted it.
- `create-run` and `firewall.screenWithin` both call this rule.

Failing first, now passing:

- `q-runtime/test/screen-context.test.ts` "nothing the screen contract carries is silently lost":
  - a sample naming every contract field is recorded whole when everything resolves;
  - only the entities go when nothing resolves;
  - workspace and surface are kept.
  - The sample is checked against `QScreenContextSchema.shape`, so a new field fails the test until it is classified.
- `q-firewall/test/policy.test.ts`: the plan keeps workspace and surface, and drops only unbound entities.
- `apps/q-api/test/workspace-page-moves-e2e.test.ts` (end to end, through real seams): `createApp` with the real gate and run route → the runtime's real `createQRuntimeService` → the real `createContextFirewall` plan of the stored run → `createQPageMoves.start`. With an opted-in labs token the decision starts. With no opt-in, the hint is dropped at q-api and the decision never runs. Before the fix, the opted-in case failed at "the run keeps screen.workspace".

## 2. Why the moves the owner saw were keyword-like

With the D78 decision never running, every move came from paths that existed before it. The probe at `d57b87e06` checked the code readers with the owner's exact sentences: `pageRequestOf`, `documentAskOf` and `namedRecordRequestOf` return **null** for all of them, so fast navigation (`/v1/q/navigation/resolve`) left them to Q. The moves came from the answer path:

- **"okay take me tensorgates profile" → "Opening your profile."**
  - That exact line is `q-specialists/src/answer.ts:1772` (`PROFILE: "Opening your profile."`). It is emitted by `actOnTool` (`answer.ts:3918`) for the **turn reader's NAVIGATE tool** (FAST_CLASSIFICATION).
  - That tool can only name the person's own destinations: `TurnTool.destination` is `QNavigateDestinationSchema` (`q-core/src/prompts/schemas/turn-reader.ts:100`). It has no slot for a record or its tab. So "Tensorgate's profile" can only be read as the nearest own page, PROFILE.
  - The guard that should stop it, `wordsNamePage(words, {DESTINATION})` (`answer.ts:3989`), is a **word match**. The word "profile" is in the sentence, so the move is confirmed. A reading forced into the wrong slot, then confirmed by a keyword, is exactly the DECISIONS 75 failure.
- **"i want to see tensor gates pitchdeck" → the deck in a document viewer.** This came from the answering model's own client-action tools. `open_company_document` (`q-tools/src/tools/company-documents.ts:425`) or `open_page` with DOCUMENT (`client-actions.ts:744`: "'Open the deck' … is DOCUMENT") opens a file, not the company's Pitch deck tab. The tool descriptions steer by example phrases, and nothing in them knows the page pane's places.
- **"i want to rehaearse" → an arbitrary Tensorgate rehearsal.** `open_page` with `COMPANY_REHEARSAL`, name taken from context: "'rehearse … with X' is COMPANY_REHEARSAL". With no X, the model filled one in.
- **One move per turn, decided by whoever comes first.** `createQPageMoves.settle` returns early when the answer already carries a move (`navigation-decision.ts`, `movesAlready`). So even once R1 is fixed, these three paths would **pre-empt** the D78 decision on exactly these turns.

### Proposal: one authority for where the page pane goes (needs a go-ahead; it changes the answer path)

When the plan's screen carries `workspace` (the person opted in), **the D78 decision is the only thing that moves the page pane**:

1. **The turn reader's NAVIGATE → the D78 decision.** In workspace mode, `actOnTool` NAVIGATE does not emit its own `UI_INTENT`. The decision is already running on the same words, with the whole site map and the person's records, and it decides the place. The reader still says what the turn is; it no longer picks the page. Outside workspace mode, nothing changes.
2. **The answering model's pane-moving tools are not offered in workspace mode** (`open_page`, `open_company_document`). This uses the existing per-run eligibility ("each run receives only context-eligible tools"). `show`, which puts a card in the Q room and does not touch the pane, stays. The decision names documents too (`place.document`), resolved by name as the person, so "open Halyard's certificate" still lands, on the company's data-room tab with the document open.
3. **Explicit commands stay instant and correct for the named subject.** The web fast path keeps pages by their exact name ("open settings", "go to work") and records named in full ("open Tensorgate"), each code-verified through `open_page`'s authorize step. It no longer acts on anything it would have to guess. When it has moved, the decision sees the pane already there (ALREADY_THERE: no second move). When it has not, the decision moves in its p50 1.5 s / p95 2.3 s (held-out, D78).
4. **A test that fails if any other path moves the pane in workspace mode:** an answer-path test that runs the reader NAVIGATE and an `open_page` tool result alongside a D78 outcome, and asserts the stored message carries only the decision's move.

Cost: no new model calls. It removes moves; it adds none.

## 3. Topic-driven placement (R5), once R1 lands

These are exactly the D78 decision's job, and the q-nav eval measures them:

- pitch deck → `/company/[id]` deck tab;
- "curious about their team → can I see it" → team tab;
- "who viewed my profile" → Analytics, engagement (viewing is not interest).

Two caveats:

- They only happen live once (1) the R1 fix is deployed, and (2) the proposal above stops the other paths taking the turn first.
- Several of the owner's turns are follow-ups about the company in the conversation ("their elevator"). The decision reads RECENT TURNS for that, but the answer path passes it only Q's and the person's text, not which company the conversation is about. That is R2's conversation-focus question; the decision should consume the same focus once R2 defines it.

No live model calls were made for this note.
