# Q Pitch v6 — plan (Lane P, 16 Oct 2026)

Controlling direction: `Q-PITCH-V6-OWNER-DIRECTION.md` (owner, 16 Oct) and its addendum: plan first, IDs everywhere, keep it light, premium, cheap.
This plan extends the v5 engine (`packages/q-pitch` director, runner, gate, ledger; `apps/web/src/features/q-pitch` host and ports; the certification manifest). Nothing is rebuilt.

## 1. Step graph

- **A step is a scene.** v5 already runs scenes through a deterministic director (prepare → act → acknowledge → narrate → checkpoint), with honest fallbacks and receipts. v6 adds:
  - **`stepId`**: the scene id itself, in the form `s.<track>.<NN>.<page>.<part>` (for example `s.inv.07.profile.overview`), stable across versions. The step number is its 1-based position in the track.
  - **`StepGraph`** (new, `packages/q-pitch/src/step-graph.ts`): built once from a `TourScript`. Each node holds `{ stepId, number, prevId, nextId, route, anchors[] }`, so next, back and go-to are index lookups, never a decision.
  - **Section targets:** each step lists the sections it discusses as anchor ids, `<stepId-without-s.>.<section>` (for example `inv.07.profile.overview.moats`). Each anchor has a narration line, so a section is highlighted exactly while Q talks about it.
- **Step commands** (done, `8a49caa4`):
  - `parseStepCommand` reads next, back N, forward N, go to N, the ordinals, signed digits, pause and resume, in en, fr, es, pt, de, it and sw, plus digits for any language.
  - `resolveStepCommand` turns a command into an absolute step. It never clamps; out of range is refused, and Q says so.
  - A `STEP` control intent becomes `GO_TO_STEP` through the existing gate, with its echo, source and duplicate rules unchanged.
  - **To do:** wire it in the host. A typed command is intercepted before it reaches Q, so no model call is made; a spoken one goes through `classifyAudienceSpeech`.
- **New tour acts** (`uiAct` gains them; `tour-action.ts`):
  - `SECTION { anchor, expand?: true | false, open?: boolean }` scrolls to the anchor, optionally opens or closes it, and lights it.
  - `UNLIGHT` clears the light.
  - `MUTE` is implicit: pitch mode mutes Discover.

## 2. Anchor inventory (what exists, what to add)

**Existing Q controls (140, `packages/q-tools/src/tools/control-catalog.ts`) the tracks reuse:**

| Page                | Controls already there                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Profile tabs        | `tab.overview`, `tab.diligence`, `tab.elevator`, `tab.dataroom`, `tab.deck`, `tab.team`                                    |
| Discover            | `carousel.feed`, `button.feed-save`, `tab.for-you`, `tab.yours`                                                            |
| CRM hub             | `tab.pipeline`, `tab.capital`, `section.hub-overview`, `section.needs-you`, `list.pipeline`, pipeline filters              |
| Relationship record | `section.relationship-history`, `dialog.book-call`, `dialog.reminder`, `dialog.join-call`, `section.calls`, `section.chat` |
| Capital             | `section.commitments`, `section.rounds`                                                                                    |
| Work                | `tab.work-main`, `tab.work-team`, `list.work-jobs`, `section.work-in-progress`                                             |
| GateQ               | `tab.inbox`, `tab.gate`, `tab.find`, `disclosure.gateq-transcript`, `section.interview`                                    |
| Elsewhere           | `dialog.notifications`, `list.documents`, `button.documents-by-q`                                                          |

**Existing markers that need no new code:**

- Overview folds: `[data-overview-fold=<id>]`, native `<details>`.
- Pitch claims: `[data-pitch-claim]`.

**To add:** `data-qp-anchor="<anchor id>"`. This is a tour-only marker, not a Q control, so the capability catalog is unchanged. One attribute per section the narration discusses, on:

- **Company profile:** Overview's 14 folds (alias the existing `data-overview-fold` key), the diligence items, Elevator, Data room folders, Deck, Team.
- **Explore:** the mosaic and the Express Interest control.
- **Relationship record:** each tab and Next.
- **Capital:** the sections.
- **CRM hub:** Overview, Needs you, Pipeline, Capital.
- **Work:** the job plan and the team view (each agent role).
- **Daily:** the lead story.
- **GateQ application:** Q's reading, the founder's own words, the dossier, the transcript.
- **Investor profile** (founder track): every section.
- **Gateway form** (founder track): each field.
- **Rehearsal results.**

Resolution order for an anchor: `[data-qp-anchor=id]`, then a mapped existing marker (fold key, Q control id). A missing anchor is TARGET_MISSING, and the step falls back honestly as in v5.

## 3. Highlight and motion (premium)

- **Light:** `data-qp-lit` on the anchor's box. CSS gives a gold ring and a soft glow (the Q glow tokens, `--cq-*`, allowed on Q's own pointer under ADR 0017), fading in over 220 ms and out over 160 ms. One section is lit at a time.
- **Movement:** smooth scroll with `scroll-margin-top` clearing the header; the page's foot clears the strip (`10rem`, shipped).
- **Reduced motion** (ADR-001): instant scroll and no fade; the ring stays.
- **No layout shift:** the ring is an outline or shadow, never a border or size change. No flicker: the next step's route is prefetched (below), and the light moves only after the act's receipt.

## 4. Preload ("keep it light")

- **On entry:** the compact step table (ids, routes, anchors, lines) is in the bundle, the Q&A bank index loads into memory, and the first two steps' routes, data and voice lines are prefetched.
- **While step N narrates:** prefetch step N+1 and N+2. Concretely:
  - `router.prefetch` of their routes;
  - their record keys, resolved and warmed through the existing fixture reads;
  - their voice lines through `/api/q-speech`, cached as blob URLs (cap 300 lines per 10 minutes, set).
- Nothing else is preloaded. The model never sees the script beyond the line it is narrating, and on the standard voice it narrates nothing at all: the lines are prepared text.

## 5. Q&A bank

- **Content:** `packages/q-pitch/src/qa-bank.ts`, about 40 entries per side: product, market, why now, moat, business model, pricing, competition, privacy, AI accuracy, scores methodology, go-to-market, team, roadmap, the ask, risks.
  - Each entry: `{ id, side, question, paraphrases[], answer, sources[] }`. Every answer carries at least one `sources` path (`docs/product-sources/text/...`, `docs/architecture/...`, `docs/ai-handoff/INVESTIQ-METHODOLOGY.md`, `LANDING-PROMISES.md`).
  - A test refuses an answer that claims traction, customers, revenue, team size or investors, and one without a source.
- **Retrieval by meaning, without a model:** an in-memory BM25 over the question, its paraphrases and the answer, with a small synonym map ("moat" ~ "defensible", "advantage"; "pricing" ~ "cost", "charge"). Below a tuned threshold it is no match, and the question goes to normal Q. Cost is microseconds and no provider call.
  - _Considered:_ precomputed embeddings. They still need a query embedding per question (a provider call, about 200 ms), so they are deferred and BM25 is measured first.
- **Delivery:** the answer appears in the tour strip as a Q&A card and is spoken in Q's voice. It works paused or after hand-over. Q's conversation is not touched, so nothing is persisted as if Q had run.

## 6. Natural-language trigger

- **Path:** Q's turn reading already maps any wording to a destination (`Q_VOICE_DESTINATIONS`, contracts). Add one destination, `Q_PITCH`, described in the turn-reader prompt as "they ask you to pitch, present, explain or demo Capital Q itself, or what you can do". The web maps it to `/home?qpitch=<track>`, with the track from the actor's side.
- **What changes:** a contract enum value, a prompt version bump and its eval cases. It is coordination-critical, so the lead owns the merge.
- **Fallbacks:** the Q Pitch page and button stay.

## 7. Q-to-Q (GateQ interview, rehearsal)

- The presenter's lines are preloaded from the Capital Q pitch facts (knowledge pack, honest: pre-seed, bootstrapping). The persona side uses the existing rehearsal and interview sessions.
- **Order of preference:**
  1. voice-only through the existing `runShortRehearsal` (paid text turns, cents);
  2. a completed session's results and assessment shown and explained;
  3. Tavus video, at most 2 sessions of 90 s or less in total, and only after 1 is reliable.
- The GateQ form fill (founder track) types into the real form fields, at once, without submitting. If the form needs a fresh application, it is described instead.

## 8. Tracks

- **Investor** (Savanna), 12 steps as directed. Data:
  - top-three cards with Investability and Suitability (`features/scores`);
  - Harbourline (fictional) for the profile tabs;
  - Clinicrest (fictional, connected) for the record, calls and Capital;
  - Maji Loop for GateQ;
  - Savanna's work and daily.
  - Step 11 adds what else is worth showing: Documents, Notifications, Saved, Results.
- **Founder:** the subject is Capital Q (`ee75a7d8…`; pre-seed, bootstrapping; a USD 2M raise as a founder claim).
  - It pitches through the 14-section Overview template, with "why now" from the product sources and landing research, and no team-size claim.
  - **Data risk:** it needs a founder account that holds Capital Q (the owner's) or a fictional founder account acting with Capital Q as the subject. Decision needed (below).

## 9. Risks

1. **Scope:** two premium tracks, each of 10 to 12 steps over many sections, plus the Q&A bank and Q-to-Q, is several days. _Proposal:_ this lane does steps 1 (infra) and 2 (investor); a second agent takes the founder track and Q-to-Q against the shared interfaces below, once `step-graph.ts`, the `SECTION` act and `qa-bank.ts` types are pushed.
2. **Founder account:** we have no seed password for Capital Q's real founder account.
3. **Typed-command interception** needs a small hook in the Q composer (web), which several lanes touch.
4. **Language:** step commands cover 7 languages and digits. Narration follows the translation layer only for UI text; prepared lines in other languages need translation at preload (one model call per line set, cached), which is deferred unless requested.
5. **Tavus** is paid and fragile; it is the last option.
6. **The trigger** changes a prompt and a contract enum; it needs evals and the lead's merge.

## 10. Shared interfaces (for a second agent) — pushed

All in `packages/q-pitch` (exported from its index):

- **Steps** (`step-graph.ts`): `buildStepGraph(script) → { steps; byId(id); byNumber(n) }`. `StepNode` is `{ stepId; number; title; prevId; nextId; route; anchors }`. A step is a `SceneScript` whose `sceneId` is `s.<track>.<NN>.<page>[.<part>]`.
- **Sections** (`script.ts`): `SceneLine.anchor?: AnchorId` (`/^(inv|fdr)\.\d{2}(\.[a-z0-9-]+){1,5}$/`) and `SceneLine.open?: boolean`, for AFTER_ACK lines only.
  - The web host (`apps/web/src/features/q-pitch/section-light.ts`) scrolls to `[data-qp-anchor="<id>"]`, opens or closes it, and lights it before the line is spoken.
  - A page section gets its anchor as a plain `data-qp-anchor` attribute, which is not a Q control and not in the capability catalog.
- **Step commands** (`step-commands.ts`): `parseStepCommand(text)` and `resolveStepCommand(cmd, current, total)`. A `STEP` control intent becomes `GO_TO_STEP` in the director.
- **Q&A** (`qa-bank.ts`):
  - `QaEntry { id; side: INVESTOR | FOUNDER | BOTH; question; paraphrases (≥2); answer; sources (≥1) }` and `QA_BANK`;
  - `buildQaIndex(side).answer(text) → QaEntry | null`, BM25 in memory with no model;
  - tests refuse invented traction, customers, revenue, investors or team size, and missing source files.
- **Tracks** are `TourScript`s with ledger entries, as in v5 (`premiere.ts` is the model). The founder track's file is `packages/q-pitch/src/founder-v6.ts` (second agent), with its own `fdr.*` anchors and FOUNDER Q&A entries added to `QA_BANK`.
- **Ownership:** this lane owns `step-*`, `qa-bank.ts`'s shape and index, `section-light.ts`, the host, and the investor track (`investor-v6.ts`). The second agent owns `founder-v6.ts`, its anchors on founder-side pages, and Q-to-Q.

## 11. Spend

No provider calls so far for v6.

- Expected: Q&A and navigation, 0.
- Investor certification run: about $0.5 (Q text runs, rehearsal, speech).
- Q-to-Q voice: cents.
- Tavus: ≤ 3 minutes in total, only if approved at that point.
