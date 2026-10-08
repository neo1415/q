# Workstream E: rich UI, the arrival experience, and the promises Q.01–Q.08

Owner: workstream E (RECOVERY-2026-10). Branch `build/rec-e`. Base: integration `fe5579c3`.
TRACKING rows: E1–E5. SPEC §5: Scenario A [C, E, B], B [C, E, B], F [B, E], and the promises Q.01–Q.08 [E leads].

> The founder's words (2026-10-08): "when I log in it should greet me casually, happy to see me, then a full summary of all it has done (agents answering messages, booking calls), then all the things that need my attention (things it couldn't answer, documents requested). As an investor it notices new companies that meet my mandate, tells me all of them and gives its opinion, while cards appear and disappear based on what it's talking about. Cards like what to do and what needs you by the sides of the Q presence, some below when needed."

## 1. Research

| Topic                                             | Source                                                                                                                                                                                                                                                                                         | What it settles                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portals keep state while their DOM target changes | React docs, `createPortal` (react.dev/reference/react-dom/createPortal)                                                                                                                                                                                                                        | Cards can be portalled into whichever side column is mounted. The card sequence's own state lives in the component that calls `createPortal`, so it survives the columns being re-created when the page switches from "welcome" to "conversing".                |
| Stable component identity across a branch switch  | React docs, "Preserving and resetting state" (react.dev/learn/preserving-and-resetting-state)                                                                                                                                                                                                  | A component keeps its state while it stays at the same position in the parent's children. The persistent stage layer is placed as a sibling of the `conversing ? … : …` ternary, never inside either branch.                                                    |
| Accessible charts                                 | WCAG 2.2 SC 1.1.1 and 1.4.1; W3C WAI "Complex images" tutorial (w3.org/WAI/tutorials/images/complex)                                                                                                                                                                                           | Every chart and map gets a text equivalent (a data table, or a list of places) in the DOM. Meaning is never carried by colour alone.                                                                                                                            |
| Map data and licence                              | `world-atlas@2.0.2` (npm, ISC licence), built from Natural Earth 1:110m (public domain, naturalearthdata.com/about/terms-of-use)                                                                                                                                                               | Country outlines with no API key, no tile provider, no per-view cost, and no third-party request carrying a person's or an investor's location.                                                                                                                 |
| Map options rejected                              | MapLibre GL (BSD-3, ~220 KB gz, needs a vector-tile provider: MapTiler/Stadia have paid tiers and per-view metering, and need an API key); Leaflet with OSM tiles (the OSM tile usage policy, operations.osmfoundation.org/policies/tiles, forbids heavy app use without your own tile server) | Tiles cost money, leak locations to a third party, and add a lockfile change. A static SVG of 110m outlines is enough for "where they're based" at country granularity, which is the only granularity the data has (`hqCountry` is an ISO 3166-1 alpha-2 code). |
| Equirectangular projection                        | Snyder, _Map Projections: A Working Manual_ (USGS PP 1395), §12                                                                                                                                                                                                                                | `x = (lon + 180) × k`, `y = (90 − lat) × k`. No library needed; the outlines are pre-projected once by a script, committed as data, and loaded lazily.                                                                                                          |
| Partial validation                                | Zod 4 `safeParse` per element (zod.dev/basics)                                                                                                                                                                                                                                                 | Validate each block on its own, keep the valid ones, drop and log the invalid ones by kind and path. Never the whole answer.                                                                                                                                    |
| Grounded investor opinion                         | `packages/contracts/src/http/fit.ts` (ADR 0052): nine parameters, UNKNOWN first-class, band in words, Q's view labelled `Q_INFERENCE`                                                                                                                                                          | The arrival opinion is built by code from the fit profile's own reasons and unknowns. It says "fit with your mandate", never "a good company", and has no percentage.                                                                                           |

## 2. Current behaviour (path:line, at `fe5579c3`)

- **E-01, cards vanish.** The arrival columns exist only in the pre-conversation branch: `apps/web/src/features/q/q-conversation.tsx:1166-1201`. `conversing = lines.length > 0 || liveIsPerson` (`:523`), and spoken-only lines count (`:498-508`). The briefing is part of `welcome` (`home/returning-welcome.tsx:129-145`), which is shown only when `lines.length === 0` (`q-conversation.tsx:608`). When Q's opener lands, `ArrivalBriefing` unmounts, and with it the voice decider (`briefing/arrival-briefing.tsx:766-794`) and the standing note (`:751-755`).
- **E-05, the first question waits.** `qAsk` awaits `spokenWelcome` (`q-conversation.tsx:662-672`), which polls for up to 1.5 s (`:171-174`), then `voiceBriefing` with a 2.5 s timeout (`briefing/arrival-voice.ts:6,22-29`), then the R35 race of 1.5 s (`:180-187`). `talk()` does the same (`:374-395`).
- **E-02, no investor matches.** `ArrivalCard.kind` is `APPROVAL | HELD` (`briefing/arrival.ts:35-56`). The read set (`briefing/arrival-actions.ts:114-122`) has no slate.
- **Attention.** The arrival reads approvals, held drafts and NEEDS_YOU notice titles (`arrival-actions.ts:123-128`). It has no "unread" notion: a failed notices read is `[]`, which is said as "nothing needs you" (`arrival.ts:176-189`).
- **D-E6.** `decisionGroups` is called without `dismissedHeld` (`arrival-actions.ts:136-142`).
- **E-07.** `QResultBlocksSchema.safeParse(blocks)` over the whole array, returning `undefined` on any failure, with no log (`packages/model-gateway/src/q/result-blocks.ts:428-429`).
- **E-08.** `INVESTOR_REFERENCE` renders as an unnamed "Investor" (`apps/web/src/features/q/q-result-blocks.tsx:414-443`). COMPARISON headers read "Company 1" (`:293-310, 463-470`). Card subjects resolve companies only (`packages/model-gateway/src/q/card-subjects.ts:26-56, 88-103`).
- **No chart, map, table or timeline block kinds** (`packages/contracts/src/q/result-block.ts:37-52`).
- **Promises.** Readiness (`packages/readiness`), the plan board (`apps/web/src/features/readiness/action-plan-board.tsx`), the follow-up stack (`readiness/follow-up-stack.tsx`) and the Blueprint generator (composed at `apps/q-api/src/main.ts:5636`) landed after the 2026-10-07 promise audit (commits `5f269fd6`, `41df28ee`, `35bd5bfd`). The audit's Q.03/Q.04 scores are stale. `docs/recovery/promises.md` re-checks every promise against HEAD.

## 3. Design

### 3.1 The stage layer (E-01)

The arrival is no longer a welcome. It is a **layer of the stage** that lives as long as the page.

- `QConversationPanel` gets a new prop, `stageLayer?: ReactNode`. It is rendered once, as a sibling of the `conversing ? … : …` ternary, so its identity and state survive the switch.
- The side columns (`ArrivalRoom`) are mounted in **both** branches: around the presence before the conversation, and around the presence stage while conversing (presence view only, when no answer object holds the stage).
- `ArrivalBriefing` splits in two:
  - **`ArrivalHead`** (in the welcome): the greeting, the lowdown and the summary line. It leaves with the welcome.
  - **`ArrivalStage`** (the stage layer): the cards. Groups are _What I did_, _Needs you_ (the existing decision sequence plus attention lines) and, for investors, _New for you_ (matches). It portals into the columns when they are mounted and there is room; otherwise it renders below Q. The voice decider and the standing note stay registered for as long as a decision card is open, whether or not the conversation has started.
- **Cards follow speech.** Each `cq:q-said` line is matched by code (`stageFocusFor`, pure) against the cards' names: counterpart, company, group words such as "needs you", "new companies" or "what I did".
  - A card that is named comes into focus (the decision sequence's own `FOCUS` event).
  - A group that is named is revealed.
  - While Q is giving the briefing on voice, the groups appear as Q reaches them; without voice they appear at once.
- **Cards step aside.** When an answer object takes the centre (answer cards, a room card, a document), the side columns are not mounted, so the cards collapse to a one-line strip below Q: "Needs you · 3 · What I did · New for you · 4". The strip is one tap to reopen. When the object leaves, or Q's line names a card again, they return to the sides. Decided cards leave for good. "Not now" collapses the layer to the strip; it does not destroy it.
- **Below 1024 px**, the layer renders below Q as a compact stack (one card in focus, the others a line each).

### 3.2 Arrival content (E-02, E-05)

- **Greeting.** `warmGreeting(firstName, now, zone, hoursAway, seed)`, built on q-core's `arrivalGreeting`, adds one of a fixed set of warm second clauses chosen by a seeded pick, so it is deterministic and testable.
  - Examples: "Good afternoon, Zino. Good to see you." and "Morning, Zino. Nice to have you back."
  - After more than 3 days away: "It's been a few days."
  - Late at night: "Hi Zino, you're up late."
  - It never says "What would you like to work on today?".
- **What Q did.** `QActivitySummary` (lead contract, `packages/contracts/src/q/attention.ts`) is mapped from the existing `QWorkSinceDto` (`activitySummaryOf`). The card lists, by count and up to three names: replied to / sent, booked calls, expressed interest, held back, and jobs completed.
- **Needs you.** The `QAttentionReport` (lead contract) comes through a port, `AttentionReader`.
  - Until workstream B's endpoint merges, the default reader is an **adapter over the reads the arrival already makes**: approvals become APPROVAL, held drafts become HELD_DRAFT, NEEDS_YOU notices are mapped by kind (CHAT_MESSAGE → UNANSWERED_MESSAGE, DILIGENCE → DOCUMENT_REQUEST, INTEREST_RECEIVED/CONNECTION_REQUESTED → INTEREST_REQUEST, TIME_PROPOSED → MEETING, otherwise NOTICE), and blocked workforce jobs become AGENT_BLOCKED.
  - A source whose read failed or is not read at all goes in `unread`. It is said as "I couldn't check X just now", never as "nothing needs you".
  - Tests use a fake reader.
  - Decidable items are the existing decision cards (exact content and the same verbs, so voice card decisions keep working). Others are attention lines with an "Open" link to where they are acted on.
- **Investor: new for you.**
  - `newMatchesFor(slate, relationships, seen)` takes slate items that are not acted on (no relationship, not saved) and not in the browser's seen set (`localStorage["cq.arrival.seen-matches"]`, a per-viewer convenience).
  - The label is honest: "New in your feed since you were last here" only when a seen set exists; otherwise "In your feed, not yet looked at".
  - Up to 6 companies. Each has the fit profile from `getFitProfiles` (one batched read), a **Q's take** line built by code from the profile (`matchOpinion`), and "fit is not quality".
  - Example: "Fits your mandate on stage and sector; geography matches. Cheque size and traction aren't known yet. That's fit with your mandate, not a view on the business."
  - No model call, no score, no percentage. "Ask Q's view" asks Q on demand.
- **The same words are spoken.** `arrivalWords` gains the activity sentence, the attention sentence (unread included) and the matches sentence ("Four new companies fit your mandate: A, B, C and D. B fits best on stage and sector."). Workstream A speaks `spoken` and E provides it. `spoken` is set as soon as the data is read (`setArrivalSpoken`).
- **E-05.** A typed question never waits. `qAsk` sends at once, with `opening` set to whatever is composed _now_: `arrivalSpoken()` if ready, else `welcomeLine`. `talk()` opens the line at once with the same rule. If the briefing lands after the line opened, its words go to the line as a note to say at a natural pause (`noteToLine(words, true)`; duplex only, see the request to A).
- **D-E6.** `arrivalBriefingAction(since, dismissedHeld)` passes the browser's dismissed-held list to `decisionGroups`, as Work already does.

### 3.3 Result blocks (E-07, E-08, new kinds)

- **Partial validation.** `parseQResultBlocks(value): { blocks, dropped: {index, kind, issue}[] }` lives in `result-block.ts` and validates block by block. `analystResultBlocks` uses it and logs dropped blocks through an optional `onDropped` callback (no logger dependency in a pure function). The web's conversation parse uses it too. q-runtime's read path is a request to the lead.
- **New kinds** (additive, closed union), all with server-validated content:
  - `TABLE`: a title, 1–8 columns (label, optional subject ref for linked headers) and up to 30 rows of string cells. An empty cell means "Not known".
  - `CHART`: `BAR` or `LINE`, a unit, a currency when it is money, and 1–4 series of up to 24 points `{label, value}`. Each series has `truthClass` and `evidenceStatus`. **The schema refuses a series that is `Q_INFERENCE` or `UNKNOWN` and any series with `NO_EVIDENCE`** ("from verified figures only": VERIFIED, or a USER_CLAIM that is DOCUMENT_SUPPORTED or better, shown with its label). The renderer always prints the truth label beside the chart.
  - `MAP`: up to 20 places `{label, countryCode (ISO alpha-2), subject?, note?}` and a `basis` line ("Head office country, as each investor publishes it"). Country granularity only. Unknown locations are listed as "Location not published", never placed.
  - `TIMELINE`: up to 20 events `{at (ISO date or datetime), label, detail?, subject?}`. They are ordered by code, never by the model.
- **Investor cards (E-08).**
  - `INVESTOR_REFERENCE` renders the investor's name (resolved by a server action under the person's session; a name they may not see stays "Investor"), with "Open profile" → `/investors/<id>` and "Ask Q about <name>".
  - `COMPARISON` headers show the resolved names.
  - Answer-card subjects resolve investors as well as companies from the run's own tool reads (`createRunCompanies` also notes `{investorOrganisationId, name}`), so investor cards can open their profile.
- **Founder → investor comparison.** "Compare these three investors, where they're based, best fit":
  - The model lays the three out as `SIDE_BY_SIDE` answer cards (its choice of kind).
  - Code attaches each investor's subject, and also a `map` and `fitBasis`, both from the run's `find_prospective_investors` / discovery reads, never from the model's words. `map` reuses the `MAP` schema and holds the countries the tool returned. `fitBasis` holds the tool's deterministic reasons and the published gate's criteria met, not met or unknown.
  - **Firewall:** these come only from network-visible public profiles and published gates. That is the tool's own contract (`find-prospective-investors.ts:139`), and no investor's private mandate is read.
  - The canvas renders the cards, a "Where they're based" map with a list fallback, and a "Why they fit (from what they publish)" row per card.
- **Model hint (requested from B).** `AnalystResultLike.visual?: "MAP" | "CHART" | "TABLE" | "TIMELINE"` is read when present. `analystResultBlocks({…, read})` builds that kind only from the run's reads. Until B adds the field to the analyst schema and the lead passes `read` in `model-gateway/src/q/index.ts` (a one-line change, requested), standalone MAP/TABLE blocks are built only from answer cards with grounded subjects.

### 3.4 Promises (E5)

`docs/recovery/promises.md` gives a 12-step table per promise: locate (implementation, journey, data), then backend, UI, text, voice, persistence, authorization, failure and test. Gaps are closed in founder-impact order:

1. **Q.03** (readiness in words, no score): verify `ReadinessSection` shows status words and Unknown stays neutral, and fix what is missing.
2. **Q.04** (action plan):
   - Replace the "Pro upsell only" Blueprint entry with the live plan when the generator is composed, so a 501 is never shown.
   - "Let Q do it" opens a Q run with the step's prompt today. Work delegation (a durable job) is D's executor; it is requested and reported PARTIAL if not wired.
3. **Q.01:** pending interview questions on the arrival as a "Q still wants to know" card (founder), answerable in place through the existing `answerQuestionAction`.
4. **Q.05/Q.06:** the fit explanations above, plus the investor "New for you".
5. **Q.07/Q.08:** checked and reported. The deck reader is F/B infrastructure.

## 4. Screen designs

### 4.1 Desktop ≥ 1024 px, returning founder, voice open, mid-briefing

```
┌ sidebar ┬──────────────────────────────────────────────────────────────────────┐
│         │  [scope] [Q can see]                       Presence|Chat  ⋯  Board 2 │
│         │                                                                      │
│         │   WHAT I DID              (  Q aperture  )           NEEDS YOU 1 of 3│
│         │  ┌───────────────────┐       Speaking          ┌──────────────────┐ │
│         │  │ Replied to Halyard│                          │ Reply to Halyard │ │
│         │  │ and Apex · booked │  "Good afternoon, Zino.  │ They: "Can we …" │ │
│         │  │ your call with    │   Good to see you. While │ Q's reply: "…"   │ │
│         │  │ Northwind         │   you were away I…"      │ [Send] [Edit]    │ │
│         │  └───────────────────┘                          │ [Not this one]   │ │
│         │   Q STILL WANTS TO KNOW                         └──────────────────┘ │
│         │  ┌───────────────────┐                          ─ Data room request  │
│         │  │ What's your burn? │                            from Apex · Open   │
│         │  │ [Answer]          │                          ─ I couldn't check   │
│         │  └───────────────────┘                            meetings just now  │
│         │                                                                      │
│         ├──────────────────────────────────────────────────────────────────────┤
│         │ [mic]  Ask Q or say anything…                                        │
└─────────┴──────────────────────────────────────────────────────────────────────┘
```

- Left column: _What I did_ and _Q still wants to know_. Right column: _Needs you_, with one decision card in focus and the rest as one-line items. This is the existing alternate-sides rule, keyed by group.
- The greeting and lowdown are under the presence while no conversation exists. Once the conversation starts, the caption shows the live exchange (presence view), and the columns stay.

### 4.2 Desktop, conversing, Q shows answer cards (the cards step aside)

```
│  (q) small   "Here are the three side by side…"                           │
│  ┌ Card: Apex Capital ┐ ┌ Card: Northwind ┐ ┌ Card: Halyard ┐            │
│  │ Based in  UK       │ │ Based in  KE    │ │ Based in  NG  │            │
│  │ Why they fit (from │ │ …               │ │ …             │            │
│  │ what they publish) │ │ [Open profile]  │ │ [Open profile]│            │
│  └────────────────────┘ └─────────────────┘ └───────────────┘            │
│  WHERE THEY'RE BASED   [ world outline, three marked countries ]         │
│                        UK · Apex Capital   KE · Northwind   NG · Halyard │
│  ─────────────────────────────────────────────────────────────────────── │
│  Needs you · 2   What I did   [Show]          ← the stage layer, a strip │
```

### 4.3 Investor arrival (≥ 1024 px)

```
│   WHAT I DID                 ( Q )                       NEW FOR YOU 4    │
│  ┌──────────────────┐                     ┌───────────────────────────┐ │
│  │ Expressed interest│  "Morning, Ada. Nice │ Kora Health · Seed · KE   │ │
│  │ in Kora for you   │   to have you back.  │ Good fit with your mandate│ │
│  └──────────────────┘   Four new companies │ Q's take: fits on stage   │ │
│   NEEDS YOU 1          fit your mandate…"  │ and sector; cheque size   │ │
│  ┌──────────────────┐                     │ not known yet. Fit is not │ │
│  │ Approve intro to  │                     │ a view on the business.   │ │
│  │ Kora · [Approve]  │                     │ [Open] [Ask Q's view]     │ │
│  └──────────────────┘                     └───────────────────────────┘ │
│                                            ─ Tamu Pay · Pre-seed · TZ    │
│                                            ─ …                           │
```

### 4.4 Mobile < 768 px

Stage: the aperture and the current line. Below it, one compact stack in this order: _Needs you_ (the focus card plus lines), _What I did_ (one line), _New for you_ (the first card plus lines). When conversing, the stack is the strip ("Needs you · 2 ▾") above the composer, and it expands in place. Touch targets are ≥ 44 px. Pass is neutral. Nothing glows except Q.

### 4.5 Readiness and the plan (Capital, founder)

```
Readiness — what could stop the raise
  Traction evidence      Gap         2 sources · "No revenue evidence yet"   [Ask Q]
  Team                   Developing  …
  Financials             Unknown     not yet shared                        (neutral)
Your action plan
  Now:   Upload 3 months of revenue evidence  · why · closes "Traction"  [Let Q do it]
  Next:  …
  Done:  …
```

These are words plus an icon, with no score or percentage. Unknown is neutral.

## 5. Files

| Area                                | Files (E-owned unless marked)                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage layer                         | `apps/web/src/features/q/q-conversation.tsx`, `apps/web/src/features/briefing/{arrival-room.tsx, arrival-briefing.tsx, arrival-stage.tsx (new), stage-focus.ts (new)}`, `apps/web/src/features/home/{home-screen.tsx, returning-welcome.tsx}`                                                                                                                     |
| Arrival content                     | `apps/web/src/features/briefing/{arrival.ts, arrival-actions.ts, attention.ts (new), matches.ts (new), greeting.ts (new)}`                                                                                                                                                                                                                                        |
| Blocks                              | `packages/contracts/src/q/{result-block.ts, answer-cards.ts}`, `packages/model-gateway/src/q/{result-blocks.ts, card-subjects.ts, answer-cards.ts}`, `apps/web/src/features/q/{q-result-blocks.tsx, q-answer.tsx, answer-canvas*.tsx, blocks/* (new: map, chart, table, timeline, world data)}`, `apps/web/src/features/q/room/room-actions.ts` (name resolution) |
| Outside ownership (minimal, listed) | `apps/web/src/features/q/conversation.ts` (let the new kinds through `objectBlocksOf`), `packages/model-gateway/src/q/index.ts` (one line, passing `read`: **requested, not made**)                                                                                                                                                                               |
| Promises                            | `docs/recovery/promises.md` (new), readiness and capital files as gaps require                                                                                                                                                                                                                                                                                    |

## 6. Contracts needed from the lead or other workstreams

1. **B:** the `QAttentionReport` endpoint and an api-client function. E codes against `AttentionReader` and swaps the adapter for B's reader when it lands (one line in `briefing/attention.ts`).
2. **B:** an optional `visual` field (`"MAP" | "CHART" | "TABLE" | "TIMELINE"`) on the analyst output schema and prompt.
3. **Lead:** pass `read: companiesRead` into `analystResultBlocks` at `model-gateway/src/q/index.ts:4073`, and use `parseQResultBlocks` in `q-runtime` `postgres-q-runtime-repositories.ts:176,553` (stored answers keep their valid blocks).
4. **A:** call `noteToLine` on the standard (Deepgram) line too, so late briefing words and card focus notes reach it (D-E3).
5. **D:** a typed "delegate this plan step to Work" entry (instruction plus idempotency key) for Q.04's executable steps.

## 7. Tests

- **Unit (pure):**
  - `stageFocusFor` (names → focus/reveal);
  - `warmGreeting` (part of day, away, late, no name);
  - the attention adapter (notice kind → source; failed read → `unread`; unread is never said as "nothing");
  - `activitySummaryOf`;
  - `newMatchesFor` (acted-on and seen excluded; honest label);
  - `matchOpinion` (fit ≠ quality wording; unknowns named; no digits or % in the take);
  - `arrivalWords` with attention, unread and matches;
  - `parseQResultBlocks` (one bad block dropped, others kept, issue reported);
  - CHART refuses inference and no-evidence series;
  - MAP refuses non-ISO codes;
  - TIMELINE ordering;
  - investor subjects in `withCardSubjects`;
  - map and fit basis attached only from tool reads.
- **Component (jsdom):**
  - the stage layer stays mounted and the decider stays registered after the first spoken line and after a typed turn (E-01 regression);
  - cards collapse to the strip when an answer object is shown;
  - the typed question is sent without awaiting the briefing (E-05);
  - the new block renderers (table headers named, map list fallback, chart truth label, timeline order);
  - investor reference shows its name and the profile link.
- No live provider calls. Provider keys are `disabled-locally-000000000000`.

## 8. Risks

- **Two portals into the same columns** (dock and page). The dock already returns null on `/home`, so only one renderer exists there.
- **The process-local room feed** (R-E2) can still drop voice answers' cards on multi-instance q-api. That is out of E's scope (A/F).
- **The seen-matches set is per browser.** It is labelled honestly. A server-side "last seen slate" is a follow-up.
- **The world outline data** (~60–90 KB raw) is lazy-loaded only when a map renders, so it is never in the first-load bundle.
- **Concurrent edits.** `q-conversation.tsx` is large, and C registers controls in pages. E touches only the panel's layout and ask path.

## 9. Acceptance checklist

| Item                                                                                                                          | SPEC §5 / TRACKING    |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Arrival cards stay beside Q after Q's first spoken line and after a typed question; the voice decider is still registered     | E1, Scenario F        |
| Cards follow what Q says (focus, reveal); they step aside for answer objects and return                                       | E1                    |
| Warm greeting by local time; QActivitySummary card; QAttentionReport items with unread shown                                  | E2, Scenario F        |
| Investor: new matching companies, with a grounded take, fit distinct from quality                                             | E2 (E-02), Q.06       |
| A typed question is sent without waiting on briefing reads                                                                    | E2 (E-05)             |
| One invalid block drops only itself and is logged                                                                             | E3 (E-07)             |
| TABLE / CHART / MAP / TIMELINE contracts, validation and renderers; investor cards named and linked; comparison headers named | E4 (E-08), Scenario B |
| Founder "compare three investors, where based, best fit": named comparison, map and public-criteria fit basis                 | E4, Q.05              |
| Q.01–Q.08 12-step table with DONE / PARTIAL / BLOCKED per promise and the exact gap                                           | E5                    |
