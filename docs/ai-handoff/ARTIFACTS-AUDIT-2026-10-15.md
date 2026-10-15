# Q artifacts audit: 15 October 2026 (lane A)

Owner problem: Q's artifacts (cards, tables, pictures, maps, comparisons, documents) "appear and disappear willy-nilly" and "don't appear when they are needed or being talked about".

Base: `origin/build/int-rc` @ `755d9b4f`. Status words follow AGENTS.md §6.

## 1. Inventory

### How artifacts are produced (server)

Every artifact is a typed `QResultBlock` (`packages/contracts/src/q/result-block.ts`). It is carried on the persisted Q message, so a reload reads it back from the server (`conversation.ts` `objectBlocksOf`). The browser never builds an artifact from model words.

| Artifact                                            | Block                        | Produced by                                                                                                                                     | Notes                                                                                       |
| --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Answer cards (top N, research, side by side)        | `ANSWER_CARDS`               | `model-gateway` builds them from the run's fits (`builtCards`) or the analyst's `answerCards`. Subjects come from `card-subjects.ts` `RunRead`. | A comparison with shared measures is drawn as one table (`comparesAsTable`).                |
| Comparison grid                                     | `COMPARISON`                 | Analyst comparison over authorised subject refs                                                                                                 |                                                                                             |
| Comparison cards                                    | `COMPARISON_CARDS`           | Analyst                                                                                                                                         | Names are the analyst's words, not entities.                                                |
| Table                                               | `TABLE`                      | `result-blocks.ts` `visualBlock("TABLE")` → `investorsTableBlock`                                                                               | Investors only, and at least 2 of them. A company table is never built (§2, F-7).           |
| Map                                                 | `MAP`                        | `visualBlock("MAP")` → `investorsMapBlock`                                                                                                      | Investors only. Company countries are read into `RunRead.countries` but never mapped (F-7). |
| Timeline                                            | `TIMELINE`                   | `visualBlock("TIMELINE")`                                                                                                                       | Only from exactly one relationship read.                                                    |
| Chart                                               | `CHART`                      | `chartBlock`; `visualBlock` never returns one                                                                                                   | Only evidenced series (`chartableSeries`).                                                  |
| Document (brief, memo, deck)                        | `ARTIFACT_REFERENCE`         | `packages/q-artifacts` service plus the document jobs                                                                                           | The card polls `/api/q-artifact/:id/detail` while `PREPARING` (`artifact-card.tsx`).        |
| Question back                                       | `CLARIFICATION_REQUEST`      | Analyst, only when Q could not answer                                                                                                           |                                                                                             |
| Room card (profile, data room, deck, chat, sources) | `UI_INTENT` `SHOW_IN_Q_ROOM` | Client-action tools                                                                                                                             | `room/room-stage.ts`. Derived from the turns, so it is reload-stable.                       |
| Approval                                            | `ACTION_PROPOSAL`            | Approval engine                                                                                                                                 | Lives in Now / Needs you. Never on the stage.                                               |

What Q is allowed to claim about the screen: `model-gateway/src/q/screen-claims.ts`.

- Any `UI_INTENT`, `ANSWER_CARDS` or `COMPARISON_CARDS` "backs" every claim.
- The claim is not tied to a kind, so "here's the map" passes when only cards were drawn (F-6).

### How the web decides to show, keep, hide or replace

| Surface                                      | Code                                           | Rule before lane A                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q page, presence view (the default)          | `q-presence-stage.tsx` + `shown.ts`            | Only `ARTIFACT_REFERENCE`, `COMPARISON*`, `ANSWER_CARDS` and `CLARIFICATION_REQUEST` could appear. The newest item stayed for `SHOWN_FOR_ANSWERS = 3` answers. Cards also left at the first later answer that named none of them (`topicMovedOn`), and never came back on their own. |
| Q page, Chat view                            | `q-answer.tsx` → `q-result-blocks.tsx`         | Every block is drawn inline in its own turn and stays in the thread.                                                                                                                                                                                                                 |
| Other pages                                  | `answer-chip.tsx`                              | A chip for a new answer with cards only. "Dismissed" is per-page `useState`.                                                                                                                                                                                                         |
| Board                                        | `board.ts`, `board-timeline.ts`, `q-board.tsx` | A pure projection of the turns. Pin and dismiss marks are kept in their own sessionStorage store (`q-board.tsx` `MARKS_KEY`).                                                                                                                                                        |
| Room card                                    | `room/room-stage.ts`                           | Open while the turns stay on its subject, then closed with "Closed … as we moved on". "Closed by hand" was `useState`.                                                                                                                                                               |
| Clear / restore controller (directive F, R7) | `cards/card-visibility-store.ts`               | sessionStorage, presentation only. Stage objects were **not** registered with it, so "Q, clear all cards" left them on screen.                                                                                                                                                       |
| Spotlight taps                               | `spotlight-store.ts`                           | Module memory for the tab.                                                                                                                                                                                                                                                           |

### Effect of voice and text turns, routes, refresh and controller acts (before)

- **Text and voice turns:** both arrive as turns. A streaming answer has no blocks until it is persisted, so the stage holds still while Q is still talking.
- **Later turns:** these were the main cause of disappearance: the 3-answer count, and a name-only `topicMovedOn`.
- **Route change:** the stage unmounts. Dismiss and "Shown recently" reopenings were `useState`, so they were lost. A dismissed object could come back on return.
- **Refresh:** turns come back from the server. Presentation state was lost, except for the card-visibility controller and the Board marks.
- **Voice reconnect into another conversation (INC-1):** `result-shelf.ts` carries the old set. With answer index 0 it stayed for up to 3 answers about anything (a stale artifact).
- **Clear/restore controller:** did not cover stage objects or room cards.

## 2. Failures found

| #   | Failure                                                                                                                                                                                | Evidence                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | An artifact vanishes while Q is still talking about it. "What should I ask them first?" names no card, so the cards leave. Three answers about the cards also step them back by count. | CODE OBSERVED. LIVE (prod, savanna-seed): top-three cards on stage; after one unrelated turn they were gone, and the next answer, about MedTrail (a card), did not bring them back. |
| F-2 | "Here's the table" or "see the map" with nothing drawn on the Q page. `TABLE`, `MAP`, `CHART` and `TIMELINE` were not stage objects, so they were visible only in Chat.                | CODE OBSERVED                                                                                                                                                                       |
| F-3 | A set with cards plus a map or table drew only the cards.                                                                                                                              | CODE OBSERVED                                                                                                                                                                       |
| F-4 | A stale artifact from another conversation stayed for up to 3 answers about something else.                                                                                            | CODE OBSERVED                                                                                                                                                                       |
| F-5 | Dismiss, "Shown recently", a card's X and a room card's close were per-mount `useState`. They were lost on route change and refresh, and outside the clear/restore controller.         | CODE OBSERVED                                                                                                                                                                       |
| F-6 | Text and artifact mismatch: a screen claim is backed by _any_ card or UI intent, whatever kind it names. Curly apostrophes ("I’ve opened") also bypass the guard's regexes.            | LIVE: "I’ve opened the three company records" with no `UI_INTENT` in the run.                                                                                                       |
| F-7 | Asking for a map or table of _companies_ draws nothing. `visualBlock` only builds from investors, so the model's `visual: "MAP"` hint is dropped.                                      | LIVE: "Show me on a map where they are based" gave no MAP block, while Nigeria and Kenya were known.                                                                                |
| F-8 | (Lane S, noted only) "Put those three in a table" researched the public web for "how to put tables side by side in Word".                                                              | LIVE: four `PUBLIC_SOURCE` blocks about Word tables.                                                                                                                                |

## 3. Fixes

### Slice 1 (web): one stage rule, one presentation controller (`claude/a-artifacts-oct15`)

**`shown.ts` `stageOf`:** a pure rule over the turns, for every showable kind. `TABLE`, `MAP`, `CHART` and `TIMELINE` are now stage objects.

1. An answer that shows an object puts it on the stage, **replacing** the previous one.
2. An answer that shows nothing keeps the object while the answer or its question refers to it:
   - the object's records (structured `COMPANY_`/`INVESTOR_REFERENCE`);
   - its names, as whole words;
   - its kind words ("the table", "the map");
   - pointing words in the person's question ("them", "the second one", "all three").
3. An answer _to a question_ that refers to none of the objects moves the object off. An unprompted answer (greeting, arrival replay) moves nothing (INC-1).
4. When the subject returns, the object comes back.
5. There is no answer count.

**Never silently:** `stageNoteOf` says "Replaced “A” with “B”." or "Put “A” away as we moved on.", with **Show again**.

**One controller:** `cards/card-visibility-store.ts` now holds per-key hides (`hideKey`), reopen exceptions and the stage's `reopened` state. It covers:

- the stage object's X;
- a single card's X (`stage-canvas.tsx`);
- a room card's close;
- "Shown recently" / Show again.

It is in sessionStorage, so it holds across route changes and reload. "Clear all cards" and "show them again" now cover stage objects too.

**Rest of set:** cards plus a table or map in one answer draw both (`data-q-canvas-rest`).

**Browser confirmation:** `artifact-rendered.tsx` `RenderedMark` sits inside the object's Suspense boundary. It records `{run, kinds}` only after the object's code has committed, and clears on unmount. The marker is `data-q-artifact-rendered` / `data-q-artifact-kinds`.

Tests: `apps/web/test/artifact-stage.test.tsx` (F-1 to F-5, 11 cases). Updated: `q-presence-stage.test.tsx`.

### Slice 2 (server): grounded artifact claims (`claude/a-claims-oct15`)

- `model-gateway/src/q/artifact-claims.ts` handles sentences that present a table, map, chart or timeline ("here's", "I've put", "see", "below", "the map shows"):
  - It is backed only by a block of that kind. Side-by-side cards or `COMPARISON` back a table.
  - Offers, questions and refusals are not claims.
  - While streaming, an unbacked claim is held back and never said. The finished answer says once: "I couldn't build a map from what I could read, so there isn't one on screen."
- `screen-claims.ts` reads typographic apostrophes as plain ones, which fixes F-6 "I’ve opened…".
- `result-blocks.ts` adds `companiesMapBlock` for F-7. When the model asks for a map and no investor has a published place, it maps the run's companies (names and countries from authorised reads). An unknown country stays `null`.
- Tests: `packages/model-gateway/test/q-artifact-claims.test.ts`.

### Slice 3 (browser confirmation to the Q API) (`claude/a-rendered-oct15`, includes slices 1 and 2)

- Contract: `QPageManifestSchema.drawn = { run: uuid, kinds: closed list }`. This is additive and optional (`packages/contracts/src/q/screen-manifest.ts`).
- Web: `artifact-rendered-store.ts` is a plain module that the manifest reads. `RenderedMark` sets it after commit. `manifest.ts` adds `drawn` and bumps `seq` when it changes.
- Server: `drawnOnScreen(plan.screen.manifest.drawn.kinds)` also backs claims. So a follow-up "as the map shows, Baridi is in Kenya" stands while that map is drawn, and is corrected when it is not.
- **Deploy order:** `screen.manifest` is a `.strict()` schema. A q-api/api still on the old contracts would refuse a run request carrying `drawn`, so deploy q-api and api before or with web.
- Tests:
  - `artifact-stage.test.tsx`: the manifest carries `drawn` and clears it on unmount; the kinds are closed.
  - `q-artifact-claims.test.ts`: browser-drawn backing.

## 4. Remaining / not done

- The Board's pin and dismiss marks are still their own sessionStorage store. Spotlight taps are module memory. Both are presentation-only and reload-safe enough, but they are not in the one controller yet.
- The chip on other pages still keeps "dismissed" per page.
- The chat view and the Q sheet on other pages draw blocks inline in the thread. Only the Q stage reports `drawn`.
- F-8 (public research on "tables side by side in Word") belongs to lane S's research topic continuity.
- A company _table_ is still built only as side-by-side cards. `visualBlock("TABLE")` remains investors-only.

## 5. Log

See section 3 above and HANDOFF-LOG for branch SHAs and live checks.
