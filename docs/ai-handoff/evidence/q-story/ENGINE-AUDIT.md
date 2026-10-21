# Q Pitch engine audit, for the Q Story (v7) engine

**Date:** 2026-10-21. **Branch:** `qstory/engine` @ `722ddb43` (read only; nothing committed).
**Judged against:** `docs/specs/q-pitch/Q-STORY-PLAN-2026-10-21.md` §1 (narrator / director / verifier, one audio clock), §3 (word-anchored cues, highlight with pulse) and §4 (controls, interruption, triggers).

## Method: what was run, and what was not

1. **Unit tests.** `pnpm exec vitest run packages/q-pitch/test apps/web/test/q-pitch*.test.ts*`: **24 files, 249 tests, all pass** (28.5 s).
   - Package: step-commands 39, tour-runner 24, premiere 22, director 21, contracts 15, founder-v6 13, certification-gate 9, q2q-rehearsal 9, qa-bank 8, investor-v6 6, knowledge-pack 4, step-graph 3, story 25.
   - Web: host 19, tour-routes 5, entry 4, page-settled 4, and 3 each for entry-route, founder-anchors, investor-anchors, section-light and strip-clearance; live-question 2, voice-hold 2.
2. **Behaviour probes.** A throwaway script in the session scratchpad imported `packages/q-pitch/dist/index.js` and tried:
   - `parseStepCommand` and `parseStoryCommand` on 36 phrasings;
   - `buildQaIndex("INVESTOR").answer` on 32 realistic investor questions.
3. **Code reading** for duplication, polling, hard-coded timeouts, brittle selectors and dead code.
4. **Not run: a live browser run of the signed-in app.** This sandbox has no local Supabase or API and no demo session. Every DOM behaviour below is judged from code and jsdom tests only. "Re-check live" lists what must be confirmed on production.

### Probe results

**Step and story commands.** Every intended command parsed correctly:

- moves: next, next please, skip, previous, rewind, go back two steps, go back 2, back two, can you go back two steps please;
- pause and resume: stop, pause, carry on, keep going;
- jumps: go to step 7, the third step, last step;
- French and Spanish: suivant, reviens deux étapes, retour, siguiente por favor, vuelve dos pasos, continúa, sigue.

"what's next for founders?" is correctly **not** a command, so a question never moves the tour.

Misses that should probably be commands: "next one", "I want to go back" and "stop talking". "hold on a second" and "wait, what?" miss in v6. The story parser does catch "hold on" and "wait".

Two collisions to note:

- "weiter" means NEXT (German), while "sigue" means RESUME. Both are fine, but undocumented.
- In the story, "stop" pauses but "stop the story" ends it, which is the intended split.

**QA bank (85 investor-side entries).** Of 32 questions: **20 correct, 4 wrong answers, 8 misses.** Lookups take 0.05 to 0.4 ms.

| Result | Questions |
| --- | --- |
| Wrong answer | "Who can see my deal flow?" → `qa.investor.value` (should be privacy)<br>"What actually works right now?" → `qa.why-now` (should be `qa.whats-live`)<br>"Where is my data stored?" → `qa.outside-sources` (no honest entry exists, so it should miss)<br>"what happens to the data room" → `qa.deletion` |
| Miss, entry exists | "Who is it for?" and "Who is this for?" (`qa.who-for` exists, but every word is a stop word, so the query is empty: `qa-bank.ts:347`)<br>"Does it work in Nigeria?" (`qa.geography`)<br>"How do I apply to a fund?" (`qa.gateq`)<br>"what is q" and "what does q do" (`q` is dropped as a 1-letter token, `qa-bank.ts:415`) |
| Miss, no entry | "Is there a mobile app?"<br>"How big is the market?" (`knowledge-pack.ts` has `kp.unknown.market-size`, but the bank does not) |

The bank's own test only checks that each entry answers its own paraphrases (`qa-bank.test.ts`), so it cannot catch any of these.

## Verdicts

| Module | Story uses it? | Verdict | Why / what to change | Evidence |
| --- | --- | --- | --- | --- |
| `step-commands.ts` | Yes (`story/controls.ts:3`) | **KEEP + small UPGRADE** | Deterministic and well tested. Add "next one", "go back"/"I want to go back", "stop talking" and "hold on a second" (v6). Document the cross-language collisions. | 39 tests pass; probes above |
| `qa-bank.ts` (+ `-founder`, `-product`) | Yes (`story-host.tsx:519`) | **UPGRADE** | (1) Don't let stop words empty a query: keep "who/what … for" and treat "q" as a term. (2) Raise the bar or add a margin over the runner-up, so a weak 2-word overlap is not answered with the wrong entry. (3) Add a held-out test set of about 40 real investor phrasings, including the 4 wrong answers above. (4) Fold in the knowledge-pack unknowns (market size, mobile, data residency) as holding answers. | 4 wrong answers and 8 misses out of 32 |
| `section-light.ts` | Yes (`lightSection`, `placeAnchors`, `unlightAll`) | **UPGRADE** | Works, but:<br>- it polls every 100 ms (`:130-133`); a `MutationObserver` would answer in about 1 frame;<br>- the anchor registry is a module global that every host writes at import (`tour-host.tsx:165`, `story-host.tsx:73`), and "later ones win", so tracks can overwrite each other;<br>- `scrollIntoView` uses `block:"start"` (`:152`), which can hide the section under the sticky header;<br>- it has no §3 breathing pulse (the ring only; the pulse must live in CSS);<br>- the 450 ms tap settle is hard-coded (`:112`). | 3 tests (jsdom) |
| `investor-anchors.ts` | No (the story has its own `STORY_ANCHORS`) | **KEEP (v6)** | Brittle selectors: a class (`.cq-ac-head-main`, `:18-26`) and first-child `> *` (`:66`, `:80`). The story's own table repeats the pattern: `nth-child` (`story-pages.ts:17`), `.cq-q-dock-pill`, `.gq2-list`, and an `aria-label` text match. Put `data-qp-anchor` on those elements instead. | 3 tests |
| `tour-voice.ts` (`openTourVoice`) | Yes, live fallback only (`story-host.tsx:219`) | **UPGRADE** | It can't be cancelled: it passes a never-aborting signal (`:30`), then polls every 150 ms for up to 5 s + 20 s + 15 s (`:48`, `:55`, `:63`). Ending the story during that time leaves a loop running and may open a paid line afterwards. Take an `AbortSignal`, and wait on the voice session's state change instead of polling. | Read only; no test covers abort |
| `narrator.ts` | Yes: `LiveNarration` type, `setNarrationVoice`; standard TTS through `answerAloud` | **UPGRADE (keep the types)** | - It polls `live.speaking()` every 100 ms (`:97`, `:118-155`).<br>- `hushRest` runs on a never signal for up to 20 s (`:102`, `:118`).<br>- `voiceOn` is a module-global mutable flag (`:211`).<br>- Standard TTS fetches `/api/q-speech` per line (`:245`), so it is a network call and a different voice. For the story, Q&A answers should be pre-rendered in the story voice; this path is only a fallback. | Covered indirectly by `q-pitch-host` tests |
| `tour-host.tsx` (`answerAloud`) | Yes (`story-host.tsx:38`) | **UPGRADE: move `answerAloud` out** | The story imports a 979-line v5/v6 host for one 12-line function (`:175-187`). That statically pulls `TourRunner`, every v5/v6 script and `use-tour-ports` into the story's dynamic chunk, and runs `placeAnchors(INVESTOR_ANCHORS)` as a side effect. `answerAloud` also hard-codes the `"FEMALE"` voice (`:182`), not the story's voice. Move it to its own small module. `findQPanel` matches a dialog by label text "Q" under a body-wide `MutationObserver` (`:481-497`), which is brittle and costly on every DOM change. | 19 host tests |
| `use-tour-ports.ts` | No | **KEEP (v6)** | It is v6's adapter. Its waits are polls with hard-coded budgets: `PAGE_SETTLE_MS` 8 s, `VISIBLE_WAIT_MS` 4 s, `UI_ACT_WAIT_MS` 6 s, `RUN_START_WAIT_MS` 15 s (`:69-72`, `:110`, `:155`, `:206`). Acceptable for v6. The story must not grow a dependency on it. | page-settled 4 tests |
| `director.ts` | No | **KEEP (v6)** | Pure state machine: no clock and no I/O. It is cleanly split from the runner, so its responsibilities are **not** duplicated. Its acknowledgement-gated model (never advance before DONE) is the opposite of the story's audio-never-waits clock, so the story is right not to use it. | 21 tests |
| `tour-runner.ts` | No | **KEEP (v6)** | It performs effects through ports and schedules time only through `ports.schedule` (`:499`, `:531`). No defects found. `story-player.ts` is a separate loop by design. | 24 tests |
| `step-graph.ts` | No | **KEEP** | Small and pure. It is used only by tests (`buildStepGraph` has no runtime importer) as the v6 anchor/step index. Fine as a test utility. | 3 tests |
| `tour-action.ts` | Partly (`TourActorSchema`, via `story-host.tsx:18`) | **KEEP** | Typed v1 action contract. The story's `StoryAct` is its own union; keep the two apart, because the story acts are not acknowledged contracts. | contracts 15 tests |
| `certification-gate.ts` | **No** | **KEEP + UPGRADE for v7** | The story bypasses the gate entirely: no story beat carries a claim id (`grep claim packages/q-pitch/src/story` is empty), and `atlas.ts:62` hard-codes `certifiedScenes: 0`. `CLAUDE.md` requires every demonstration claim to map to `CERTIFICATION_MANIFEST.md`. Add a story-beat admission: product-capability beats bind claim ids, and the gate decides them at story start. | 9 tests |
| `control-channel.ts` | **No** | **KEEP, and the story should adopt it** | Plan §4 says speaking pauses the story. The story handles **typed** text only (`story-host.tsx:524`), with no microphone or transcript path. `TourControlGate` / `classifyAudienceSpeech` already do "only `AUDIENCE_MIC` steers", which protects against the live-fallback narrator echoing its own "next". Reuse them for spoken interruption. | Used by tour-runner tests |
| `guide.ts`, `scene-evidence.ts`, `script.ts` | No (indirect types only) | **KEEP (v6)** | Contracts for the scene, evidence and gate model. Sound; nothing to change for the story. | contracts / gate tests |
| `q2q-rehearsal.ts` | No | **KEEP (v6)** | Bounded (15 to 45 s), and always calls `finish`. Not part of the story. | 9 tests |
| `knowledge-pack.ts` | No | **DISCARD (after folding)** | Nothing reads it at runtime, only its own test and a source-string reference in `capital-q-pitch.ts:68,147`. It duplicates the QA bank's honest-unknowns role. Move its UNKNOWN entries into `qa-bank-product.ts`, repoint those references, then delete it. | 4 tests; grep shows no importer |
| `premiere.ts`, `pilot.ts` (`PREMIERE`/`SHORT`/`ATLAS`/`PILOT` scripts) | No | **DISCARD the tours; keep the ledger data** | v5 internal rehearsals, superseded: the investor `Q_PITCH` start is now the story (`tour-start.ts:13`). They still ship in the `/q-pitch` menu (`atlas.ts:66-74`) and in `tour-host.tsx:122-162`, and they are 1,850 + 389 lines in the bundle. Keep `PREMIERE_CERTIFICATION_LEDGER` (the verified entries) wherever the gate needs it; retire the scripts and their menu entries. | premiere 22 tests (will need pruning) |
| `investor-v6.ts` | No | **KEEP as the deeper walkthrough** | No longer the default investor start, but it is the certified, receipted product walk and the safe fallback when the story has no audio. Plan whether `/q-pitch` still offers it. | 6 tests |
| `founder-v6.ts`, `qa-bank-founder.ts`, `capital-q-pitch.ts` | No (founder side) | **KEEP** | The founder `Q_PITCH` start is still founder-v6 (`tour-start.ts:14`). `FOUNDER_V6_PRESENTER_LINES` has no runtime importer, only the script and a test (`founder-v6.ts:830-853`), which is fine. | 13 tests |
| `tour-entry.tsx` | Yes (mounts `StoryHost` via `dynamic`, `:82`, `:136`) | **KEEP + UPGRADE** | The latching logic is sound. But `tour-entry-slot.tsx` resolves the tour subject, the API's heaviest read, on **every** hard load of every app page, story or not. Resolve it lazily, only when a v5/v6 tour that needs it is asked for. | entry 4 + entry-route 3 tests |
| `tour-start.ts` | Yes (`?qpitch=story`) | **KEEP** | Trivial and correct. | tour-routes 5 tests |
| `tour-presence.ts` | Yes (indirectly, via `tour-entry`) | **KEEP** | Small and pure. It prevents a paid line from opening before Start. A module-global flag is acceptable here. | voice-hold 2 tests |
| `live-question.ts` | No | **KEEP (v6)** | It imports `isTourAsk` from `use-tour-ports` (`:3`), a heavy dependency for one predicate; move that predicate out if the story ever counts spoken questions. | 2 tests |
| `atlas.ts` | Yes (the story option on `/q-pitch`) | **UPGRADE** | Drop the premiere and short options and the Atlas chapters with the v5 retirement. Derive the story's standing from the gate instead of `certifiedScenes: 0` (`:62`). | No dedicated test |
| `fixtures.ts`, `subject.ts`, `subject-model.ts` | No | **KEEP (v6)** | Receipt-bound company resolution and a per-viewer subject cache (60 s TTL). Sound. The story uses its own preloaded demo fixtures and must not read these mid-story. | host tests |
| `founder/matches.ts` | No | **KEEP** | It is live product code used by `discover-screen.tsx:3`, not a tour module, so it sits in the wrong folder (move it to discover later). | n/a |
| `founder/draft-fill.tsx`, `pitch-rail.tsx`, `founder-tour.css` | No | **KEEP (founder v6, `/q-pitch/capital-q`)** | `pitch-rail` reads `[data-qp-anchor~=…]` directly (`:31`), duplicating `anchorElement`; use the shared function. | founder-anchors 3 tests |

### Re-check live (not possible here)

- Anchor lighting and scroll position under the real sticky header, on each story route.
- The `openTourVoice` timings with a real GPT-Live line, and what happens when the story ends mid-open.
- `answerAloud` standard-TTS latency (2 to 7.5 s per line was logged on 15 Oct) against a pre-rendered answer.
- That no `/api/q-speech`, Q run or database read fires during the story, checked in the HAR.
- The CLS of the pulse highlight.

## Top 5 fixes

1. **Move `answerAloud` out of `tour-host.tsx`** into a small module that takes the story's voice. Ideally play pre-rendered Q&A answers in the story voice ("Sarah"), and fall back to `/api/q-speech` only when none exists. This keeps v5/v6 code out of the story's chunk and keeps the voice consistent.
2. **Fix the QA bank's matching:**
   - stop-word-only queries ("Who is it for?");
   - the dropped "q" term;
   - a margin over the runner-up, so a weak 2-word overlap does not get a wrong answer;
   - a held-out test set of real phrasings, which today gives 4 wrong answers and 8 misses out of 32;
   - fold in the knowledge-pack unknowns, then delete `knowledge-pack.ts`.
3. **Make `openTourVoice` cancellable and event-driven** (`tour-voice.ts:30-71`), so ending the story stops it from opening a paid line late. Do the same for `narrator.ts` `hushRest` (`:102-127`).
4. **Bind story claims to the certification gate.** Product-capability beats carry claim ids, `certifyTour`-style admission runs at story start, and atlas shows the real standing. Also **wire spoken interruption through `control-channel.ts`**: today the story handles typed text only, but plan §4 promises voice.
5. **Harden `section-light`:**
   - wait with a `MutationObserver`, not 100 ms polling;
   - a scroll offset for the sticky header;
   - the §3 breathing pulse;
   - stable `data-qp-anchor` markers in place of the class, `nth-child`, `> *` and `aria-label` selectors (`investor-anchors.ts:18-26,66,80`, `story-pages.ts:17,37,64,68`);
   - per-track anchor tables, not one global registry.

   Then retire the v5 premiere, pilot and short tours, and stop the subject read on every page load.
