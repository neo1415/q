# Q answer map (`createModelGatewayQAnswer`), 22 Nov 2026

W5-A, audit finding 4 part 3. This maps `createModelGatewayQAnswer` in `packages/model-gateway/src/q/index.ts`, so the rest of it can be split in safe slices. Line numbers are from after this slice (index.ts is 13,899 lines; the function runs from line 1,138 to 13,689).

## Shape

| Part | Lines | Size | What it is |
| --- | --- | --- | --- |
| Factory setup | 1138–2018 | ~880 | Per-seam state, built once: `movedBlocks`, `turnReads` and `notePrivateRead`, the wrapped `tools` port (260 lines; it records private reads, public web reads, held-company scope, list conditions and pending decisions), and `showFinding`, `showStage`, `recallMemory`, the `WideReads` type and `prepareTurn`. |
| `prepareTurnReads(request)` | 2019–5060 | 3,042 | Everything read before the model: arrival decision, compare, chart figures, company, named and visible-named reads, follow-up read, shared listings, shared documents, and the wide reads. It returns one large prepared object. It is a function of the request plus the factory's ports; it writes no factory `let`. |
| `answerArrivalEarly` | 5070–5183 | 114 | The arrival fast path. |
| Stage helpers | 5199–5224 | ~25 | `runStages`, `stagesOf`, `stepStarts`. |
| Returned seam | 5227–13686 | 8,460 | `lastObservation` (1 line), `warm` (61 lines: starts `prepareTurn`), and `answer` (8,400 lines). |

The factory has a single shared `let`, `last` (the last observation); `answer` writes it.

## `answer`, by phase

`answer` has 331 top-level statements. 254 of them declare names, and 18 of those write `let`s that other statements read: this is the shared mutable state that makes splitting hard. In order:

| # | Lines (approx.) | Phase | Reads | Writes (shared lets) |
| --- | --- | --- | --- | --- |
| A | 5290–5420 | Run set-up: stage once; take the warmed `prepareTurn` | request, factory `prepareTurn`, `warming` | none |
| B | 5428–5498 | Unpack the prepared turn: history, latest, profile, memory, on-screen records, compare facts, sweeps, finders (about 70 names) | `prepared`, `toolContext` | none |
| C | 5500–5960 | Asks and routing: discover rule, chart ask, assembled read, research choice, pointed-at, provisional route, research call | B's names | `retrievalRefineMs` |
| D | 6011–6340 | Early web and route: `earlyWeb` (166), web pictures, `route`, the prepared-context branch | B and C, factory `tools` | `researchingSaid`, `firstPublishedMs`, `picturesStarted` |
| E | 6366–6600 | Early lead and own reads: `callTool`, nudge, `composeEarlyLead`, own documents, ADVICE and own-team prefetch | B to D | `onboardingNudge` |
| F | 6601–7032 | `assemblePrompt` (432): renders the prompt (the cached shared prefix and the per-person tail) | almost everything above (51 names) | `retrievedPassages`, document counts, supplied standings and facts, `documentsThisTurn`, `rendered` |
| G | 7050–7700 | Live output: thinking guard, `showLive`, the table first, lead lines, `sayResearching`, `publish`, the sentence cutter (`takeSentence`, `releaseLastSentence`, `onTextDelta`), model options and round options | F, factory `showStage` | first-sentence and stream state (`firstSentence`, `heldPromise`, `seenText`, `firstTextMs`, `lastReleased`, `roundStop`) |
| H | 7717–7800 | **Tool outcomes into blocks (moved, phase 1)**: the client action, the document card, the schedule card | `clientActionBlocks`, `wideReads.ownDayReads` | `clientActionBlocks`, in place only |
| I | 7802–8180 | Persisting: `persistAnswer` (293), `persistCodeAnswer`, reader source counts | request, latest, factory `dependencies` | none at answer level |
| J | 8188–9600 | Code answers, one guarded branch each: attention report, contact status, own profile, follow-up, person search (212), companies map, company fact, web discovery (107), investors, conditioned lists, prospects, catalogue, fit sweeps (106) | B to I | `prospectsThin`, `platformLookupFoundNothing`, `recommendationGrounds` |
| K | 9620–9680 | **Public sources (moved, phase 2)**: `collectSources` | `webEvidence`, `pageSubjectMatch`, `publicSources` | those three, in place only |
| L | 9690–9974 | Model round set-up: messages, claim echoes and sources, extras (`startExtras`) | everything | `extrasFindings`, `modelCalls`, `extras` |
| M | 9978–13686 | The model round and the closing (one `try`, 3,709 lines): tool loop, claim check, grounding guards, blocks, persist, the outcome | everything | most of the lets above |

## Moved in this slice (W5-A)

Both phases read nothing but what they are handed. They change only the answer's own collections, in place, exactly as before.

- **Phase 1 (H)**: `collectClientActionBlock`, `collectDocumentBlock` and `collectScheduleBlock`, in `q/answer-tool-results.ts`. Each takes `{ blocks, outcome }`; the schedule also takes `name` and `ownDayReads`.
- **Phase 2 (K)**: `collectPublicSources({ outcome, webEvidence, pageSubjectMatch, publicSources })`, in the same module.

The answer keeps its four closure names, now one-line delegations, so none of their call sites changed. The characterisation tests (`test/answer-tool-results.test.ts`) were written and committed against the verbatim copies before the answer used them. The moved bodies were checked token for token against the closures they replace.

## Suggested next slices, safest first

1. **I, persisting**: `persistAnswer` and `persistCodeAnswer` write no answer-level `let`. They need request, latest, the factory's dependencies and the answer's collections, passed as one typed input.
2. **J, the guarded code-answer branches**, one at a time (person search, web discovery, fit sweep). Each reads B's names and returns early, and only three lets are written across all of J. Make each branch a function that returns `outcome | null`.
3. **B, the prepared-turn unpack**: a typed `PreparedTurn` already exists in effect as `prepareTurnReads`' return; name the type, and pass it instead of 70 locals.
4. **`prepareTurnReads`** (3,042 lines) into its own module: it writes no factory `let`, so it moves whole with its ports as input; split it there by read.
5. **F and G** last: the prompt assembly and the live stream share the most state (the first-sentence and stream lets). They should move together behind one typed stream-state object.
6. **M**, the model round, after the rest: it reads nearly every name above.
