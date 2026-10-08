# 06 — Rich results / generative UI: how a Q answer becomes visible UI

Investigator E · repository `/home/user/q` · branch `recovery/2026-09-12-8y2j4w` · HEAD `520bd123` · read-only static audit, 2026-10-08.
Evidence excerpts are in `evidence/ui/*.md`; the flow is drawn in `diagrams/rich-response-rendering.md`. Findings are summarised with IDs in `_findings/E.md`.

Classification key: IMPLEMENTED / PARTIAL / CONFIGURED-UNUSED / MOCKED / BROKEN / UNTESTED / PLANNED.
I did not run the app or a browser. Every runtime claim below comes from reading the code. Where I infer behaviour, I mark it as an inference.

---

## 0. Executive summary

1. **No model writes UI.** A Q answer has two parts: Markdown-subset text, and a closed, Zod-validated union of 14 typed `QResultBlock` kinds (`packages/contracts/src/q/result-block.ts:37-52, 285-309`). The web renders only from those types. The model can affect what appears in three ways only: (a) by filling schema fields (`answerCards`, `comparisonCards`, findings, gaps, clarifying questions); (b) by calling typed client-action tools (`show`, `open_page`, `control_screen`, `control_document`, ...) that emit `UI_INTENT` blocks; (c) through its Markdown text. Card content behind `SHOW_IN_Q_ROOM` is read by the browser's server action **as the person** (`apps/web/src/features/q/room/room-actions.ts:60-98`). Status: **IMPLEMENTED**. The design is sound.
2. **Rich answer cards exist, sit in the centre, and follow speech.** `ANSWER_CARDS` (RANKED / SIDE_BY_SIDE / RESEARCH) render on the "stage" over Q's presence (`q-presence-stage.tsx:341-358`). The card Q names in a spoken line comes into focus (`answer-canvas-logic.ts:87-104`, `use-answer-playback.ts:20-28`). Cards leave when a later answer names none of them (`answer-canvas-logic.ts:156-169`). Status: **IMPLEMENTED (centre column only)**.
3. **The "cards by the sides of Q" layout exists only for arrival decision cards, and only before the conversation starts.** `ArrivalRoom` (left slot, Q, right slot) renders only in the pre-conversation branch of the Q page (`q-conversation.tsx:1166-1201`). The welcome that holds the arrival briefing renders only when `lines.length === 0` (`q-conversation.tsx:608, 1220-1227`). Q's own spoken opener becomes a spoken line (`q-session.tsx:233-239`; `duplex-line.ts:1376-1379`), and that flips the page to the conversing branch. At that point the side cards, the voice card decider and the standing screen note all unmount. `ArrivalDock` is suppressed on `/home` (`arrival-dock.tsx:42`). Static reading therefore says: **on the Q page, the side cards disappear once Q has spoken its briefing, or once the person types.** Status: **BROKEN (static analysis, high confidence; not reproduced in a browser)**. This is the main mechanical cause of "it's just listening and not doing anything". See §6.
4. **Investors get no "new companies that match my mandate, with Q's opinion" on arrival.** The arrival cards are typed `APPROVAL | HELD` only (`briefing/arrival.ts:35-56`). The lowdown's "matches" count means relationships that became `CONNECTED` (`apps/q-api/src/composition/work/page.ts:703-719`), not new companies in the feed. Status: **NOT IMPLEMENTED (absent)**. See §7.
5. **There are no charts and no maps.** `apps/web/package.json:15-39` has no chart, map, geo or Markdown library. "Show where they're based" can only be text, a table row, or a card measure. Tables exist in three forms: Markdown tables, the `COMPARISON` block, and `AnswerCanvas` laid out as a table. Status: charts/maps **ABSENT**; tables **IMPLEMENTED**.
6. **Investor answers are second-class.** `INVESTOR_REFERENCE` renders as an unnamed avatar labelled "Investor", with no link to `/investors/<id>`. Its only action is a generic "Ask Q about them" (`q-result-blocks.tsx:414-443`). Card subjects are resolved only for companies (`model-gateway/src/q/card-subjects.ts:1-10, 88-100`). Platform-computed fit exists only for investor→company (`q-tools/src/tools/fit.ts:30-47`). Status: **PARTIAL**.

---

## 1. The contracts: what an answer can carry

### 1.1 `QResultBlock` (14 kinds) — IMPLEMENTED

`packages/contracts/src/q/result-block.ts:37-52`:

| Kind                    | Payload (bounded)                                                                                           | Producer (server)                                                                                                                                     | Web renderer                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXT`                  | plain text ≤16k                                                                                             | (answer text travels as message text)                                                                                                                 | n/a (the message text goes through `QMarkdown`)                                                                                                                                     |
| `COMPANY_REFERENCE`     | `companyId`                                                                                                 | `subjectBlocks()` from the run's **authorised** subjects (`model-gateway/src/q/result-blocks.ts:142-167`)                                             | `QResultCard` + `CompanyAvatar` + "Open the company" link (`q-result-blocks.tsx:379-412`), behind the "Companies" chip (`q-answer.tsx:42-44, 96-101`)                               |
| `INVESTOR_REFERENCE`    | `investorOrganisationId`                                                                                    | same                                                                                                                                                  | Avatar labelled "Investor". No name, no link. "Ask Q about them" sends the generic `"Tell me more about that investor."` (`q-result-blocks.tsx:414-443`)                            |
| `COMPARISON`            | 2–6 subjects × ≤30 rows of strings                                                                          | none found in the analyst projection (I did not search every specialist)                                                                              | Table. Columns are headed by `subjectLabel()`, i.e. "Company 1", "Investor 2" (`q-result-blocks.tsx:293-310, 453-509`)                                                              |
| `COMPARISON_CARDS`      | 2–4 named items × ≤4 points (v12)                                                                           | `analystResultBlocks` when no v17 cards (`result-blocks.ts:336-347`)                                                                                  | `ComparisonCards` inline                                                                                                                                                            |
| `ANSWER_CARDS`          | RANKED/SIDE_BY_SIDE/RESEARCH, ≤10 cards, measures, fit, view, `said`, follow-ups (`answer-cards.ts:79-134`) | `answerCardsBlock()` from the model's `answerCards` (`answer-cards.ts:88-132`), or `fitAnswerCardsBlock()` from fit tool results (`fit-cards.ts:260`) | Stage: `StageCanvas`/`AnswerCanvas` (`q-presence-stage.tsx:341-358`). Thread/Board: `StaticAnswerCards` (`q-result-blocks.tsx:448-451`). Not repeated inline (`q-answer.tsx:59-61`) |
| `EVIDENCE`              | evidence refs                                                                                               | deliberately not emitted to the browser (`result-blocks.ts:39-44`)                                                                                    | none                                                                                                                                                                                |
| `FINDING`               | finding with truth/evidence/confidence axes                                                                 | from analyst findings (`result-blocks.ts:349-385`); `evidenceRefs: []` on purpose                                                                     | Sources panel (`q-evidence.tsx`, via `findingsOf`)                                                                                                                                  |
| `UNCERTAINTY`           | statement + uncertain level + missing                                                                       | from `missingEvidence` / `contradictions` (`result-blocks.ts:387-406`)                                                                                | Sources panel                                                                                                                                                                       |
| `CLARIFICATION_REQUEST` | question + 2–6 options                                                                                      | only when `couldNotAnswer()` (`result-blocks.ts:408-418`)                                                                                             | "Q needs to know" card with option buttons that call `onAsk` (`q-result-blocks.tsx:511-537`)                                                                                        |
| `ACTION_PROPOSAL`       | proposal                                                                                                    | run proposals                                                                                                                                         | **Display only**: "Nothing happens until you approve it below" (`q-result-blocks.tsx:539-554`). The decision is made in `QNow` (`q-now.tsx:79-121`)                                 |
| `ARTIFACT_REFERENCE`    | artifactId, type, status, title                                                                             | document tools                                                                                                                                        | `ArtifactCard`. Decks, one-pagers and memos also open in the room (`room-stage.ts:165-192`)                                                                                         |
| `UI_INTENT`             | one of 17 intent kinds (`ui-intent.ts:28-46`)                                                               | typed client-action tools (`ui-intent.ts:619-634`)                                                                                                    | link card / calendar connect / website (`q-result-blocks.tsx:568-613`); followed automatically by `q-session.tsx:422-457`                                                           |
| `PUBLIC_SOURCE`         | url, domain, title, dates                                                                                   | public web research                                                                                                                                   | Sources chip (`conversation.ts:107-121`)                                                                                                                                            |

Contract drift: the `TEXT` comment says "no Markdown contract (no sanitising renderer exists yet, so none is promised)" (`result-block.ts:22-25`). The web nevertheless renders a Markdown subset through a hand-written parser (`apps/web/src/features/q/markdown.tsx:14-38`), and the analyst prompt asks for lists and tables. The renderer is safe by construction: no HTML, and links only to http(s) or in-app targets (`markdown.tsx:358-370`). The contract comment is stale. Severity: low.

### 1.2 `UI_INTENT` and client actions — IMPLEMENTED

- `NAVIGATE` is limited to a closed list of 40+ destinations, never a path or URL (`ui-intent.ts:111-180`).
- `OPEN_RECORD_PAGE` covers 19 record pages by uuid (`ui-intent.ts:271-324`). `OPEN_SETTINGS` (`343-365`). `SHOW_IN_Q_ROOM` covers 23 room objects (`375-449`). `SHOW_CALENDAR_CONNECT` (`459-478`).
- `SCREEN_ACT` covers scroll, back, section focus, and feed next/prev/pass/save (`519-557`). `DOCUMENT_ACT` covers next/prev/goto/read/summarise/download/close (`567-595`). `SET_DISCOVER_FILTERS` (`492-507`).
- The model reaches these only through named tools (`Q_CLIENT_ACTION_TOOLS`, `ui-intent.ts:619-634`). `OPEN_WEBSITE` is restricted to the person's own declared site (`ui-intent.ts:226-234`).
- Note: `SCREEN_ACT` and `SET_DISCOVER_FILTERS` belong to `QClientActionIntentSchema` (`ui-intent.ts:597-612`) but not to `Q_UI_INTENT_KINDS` (`ui-intent.ts:28-46`). The web label switch handles both anyway (`q-result-blocks.tsx:215-221`). I did not trace how they travel (probably through the voice turn's `clientAction` and `followed.actions`).

### 1.3 Can the model request a specific component? Is it validated?

Yes, but only by kind, and validation happens at three points:

1. **Structured output fields.** The model fills `answerCards` / `comparisonCards` under a schema (`q-core/src/prompts/schemas/company-analyst.ts:493`). The prompt tells it to put "Lists, scores and comparisons" into `answerCards` (`company-analyst.v20.ts:32`). Code, not the model, computes `fit`, `hue` and RANKED order (`answer-cards.ts:52-67, 88-123`). `subject` is always `null` from the model (`answer-cards.ts:122`). Company subjects are then attached only from the run's own tool reads (`card-subjects.ts:1-10`; `model-gateway/src/q/index.ts:4080-4083`).
2. **The `show` tool.** The model names an object kind (enum) plus an id or name. The server resolves the id against the actor's own records (e.g. `q-tools/src/tools/client-actions.ts:960-1040`; `INVESTOR_FIT` → own company id only). The browser re-parses the intent with Zod (`room-stage.ts:172-198`). `loadRoomCardAction` parses again and reads the content through the same API the page would use, under the person's session (`room-actions.ts:80-98`).
3. **Assembly.** Server: `QResultBlocksSchema.safeParse(blocks)` (`result-blocks.ts:428-429`).

**Hidden failure (D-E7):** that parse is all-or-nothing. If any single block is invalid, `analystResultBlocks` returns `undefined`, and the answer loses all of its findings, uncertainties, cards and references silently. Nothing is logged at that point. Severity: medium.

**Browser-side trust boundary:** `fetchRoomRead` checks four top-level fields and then casts `body as QRoomRead` (`room-feed.ts:135-147`). The server-side route does parse against the contract (`apps/q-api/src/room/routes.ts:55-58`). Severity: low.

---

## 2. From a run to the screen (the pipeline)

1. **Typed question.** `QConversationPanel.qAsk` → `useQConversation.ask` → SSE stream → `turnsFrom()` (`conversation.ts:286-299`) keeps `objectBlocksOf` (9 kinds, `conversation.ts:86-100, 123-135`), `publicSources`, `findings` and `uncertainties`.
2. **Spoken question.**
   - Standard line: Deepgram STT → `/v1/q/voice/think` → ElevenLabs.
   - Duplex line: OpenAI realtime → `ask_q` → server run.
   - Either way, the answer reaches the screen through the **room feed**. While a line is active the browser long-polls `/api/q-room` (`room-feed.ts:155-174`; `q-session.tsx:289-313`). Each entry is absorbed into the conversation, and the record is re-read until it settles (`q-session.tsx:268-279`, `voice-reread.ts`).
   - The server room is a **process-local in-memory Map** keyed `tenant:user`, with one epoch per process (`apps/q-api/src/room/feed.ts:35-38, 99-122`). If q-api runs more than one instance, or restarts, voice answers published on one instance are invisible to a reader polling another. See risk R-E2. Instance count was not verified.
3. **Rendering split** (`q-answer.tsx:32-65`):
   - Text goes through `QMarkdown`.
   - References sit behind "Companies · n" / "Investors · n" chips.
   - Sources, findings and uncertainties sit behind a "Sources" chip (`q-answer.tsx:89-95, 169-183`).
   - Comparison, clarification, artifact and UI intent render inline.
   - `ANSWER_CARDS` go to the stage.
   - `ACTION_PROPOSAL` is not shown inline (it is decided in `QNow`).
4. **Presence view vs Chat view** (`q-conversation.tsx:524-548, 917-1114`):
   - Presence view shows Q large, with no transcript unless captions are on (`q-presence-stage.tsx:90-103, 318-325`).
   - An object being shown (answer cards, a shown answer, a room card or a document) shrinks Q and takes the centre (`q-presence-stage.tsx:301-316`).
   - Chat view shows the whole thread.
5. **What is on stage, and when it leaves:**
   - `onStage()` picks one shown item (`shown.ts`).
   - `topicMovedOn()` removes cards when a later answer names none of them (`answer-canvas-logic.ts:156-169`). This uses word matching, not a model.
   - Room cards stay open while later turns mention the record's name or kind words; otherwise they close with a note (`room-stage.ts:6-16, 121-163`).
   - Cards that leave fly to the Board (`q-presence-stage.tsx:212-243`). "Shown recently" brings them back (`437-480`).
6. **Voice-to-card coordination:**
   - Answer cards: each spoken line arrives as a `cq:q-said` event, and the card it names comes into focus (`use-answer-playback.ts:58-…`; `focusForSaid` `answer-canvas-logic.ts:87-104`). With no live line, a timed walk-through runs at speaking pace (`answer-canvas-logic.ts:113-136`).
   - Arrival decision cards: `registerCardDecider` (`line-cards.ts:25-31`) is called by the arrival `Sequence` while a card is active (`arrival-briefing.tsx:766-794`). The duplex line routes `decide_card` to it (`duplex-session.ts:166-172`). Button focus changes send a "screen note" (`focusNote`, `briefing/arrival.ts:307-319`; `noteToLine`, `line-cards.ts:87-91`), and a line opened later receives the standing note (`line-cards.ts:62-75`).
   - **This is wired only for the duplex line.** `decideCardByVoice`, `cardInFocus` and `onLineNote` have no caller in `deepgram-session.ts` or `elevenlabs-session.ts`. The grep found only `duplex-session.ts:18,168-171,208`. On the standard line, the one the lead's tests fell back to, a spoken "send it" is an ordinary Q turn. Status: **PARTIAL**.

---

## 3. The Board, Stage + Board (ADR 0017), and the room

- **Board.** The Board button with its count (`q-conversation.tsx:849-868`) docks a panel on wide screens (`boardDocked`, `q-conversation.tsx:581-583`) and shows `QBoardTimeline` (`q-conversation.tsx:1376-1398`). It also appears in the dock sheet (`q-sheet.tsx` → `QBoard`). The count is `boardTimeline(turns)` minus dismissed (`q-conversation.tsx:584-591`). Status: IMPLEMENTED.
- **Stage + Board.** The stage is the presence plus one object at a time. It is not a multi-card dashboard.
- **Q room cards (`SHOW_IN_Q_ROOM`).** One open card at a time (`RoomStage.open`, `room-stage.ts:30-36`), rendered by `QRoomStage` under the presence (`q-presence-stage.tsx:403-416`). Content comes from `loadRoomCardAction` (23 object kinds, `room-actions.ts:100-550`). Status: IMPLEMENTED.
- **Answer chip on other pages.** `AnswerChip` (`global-q.tsx:277`; `answerChipFor`, `answer-canvas-logic.ts:197-…`) and `?board=1` (`home/page.tsx`).

---

## 4. Markdown, citations, sources

- **Markdown.** Hand-written subset parser: headings, lists, tables, bold/italic, code, links, callouts. Streaming-aware. No HTML (`markdown.tsx:14-38, 159-…, 677-739`). Status: IMPLEMENTED.
- **Spoken text.** `plainFromMarkdown` strips the structure (`markdown.tsx:797`). Typed answers are read aloud up to `Q_SPEECH_MAX_CHARS = 600` (`wire-constants.ts:19`; `q-conversation.tsx:468-473`).
- **Citations.** There are no inline citation markers in the text. "Sources · label" is one chip (`q-answer.tsx:89-95`) that opens `QEvidenceBody`: public sources (url, domain, dates), findings with their axes, and uncertainties. Answer cards carry `sourceCount` only (`answer-cards.ts:103-104`), counted from the model's `citations` array (`answer-cards.ts:121`). Evidence ids never reach the browser (`result-blocks.ts:39-44, 378-380`). Status: PARTIAL. Sources exist per answer, not per claim or per card.

---

## 5. Charts, maps, timelines, tables

| Visual     | Exists?                                                                                                                               | Where            | Library                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| Charts     | No generative chart block. Hand-made SVG bars on fixed pages only, e.g. results `activity-bars.tsx`, rehearsal `score-trend.tsx`      | page-specific    | none (`apps/web/package.json:15-39`) |
| Maps / geo | **No.** No map component, no coordinates; "Based in" is a text fact (`room-actions.ts:309-318`)                                       | —                | none                                 |
| Timelines  | Board timeline (`q-board-timeline.tsx`, `board-timeline.ts`); relationship event timeline (`relationships/relationship-timeline.tsx`) | fixed components | none                                 |
| Tables     | Markdown tables; `COMPARISON`; `AnswerCanvas` table layout when SIDE_BY_SIDE measures line up (`answer-canvas-logic.ts:61-70`)        | generative       | none                                 |
| Fit scores | Code-computed /10 from measure levels (`answer-cards.ts:20-67`) or platform fit (`fit-cards.ts:19-30`)                                | generative       | none                                 |

There is no contract kind for a chart, a map, a timeline or a metric series. Adding one would need a new `QResultBlock` kind (additive, `result-block.ts:35`), a producer, and a renderer.

---

## 6. Loading, error and empty states (generative surface)

| State                         | What the person sees                                                                                                     | Evidence                                                               | Assessment                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Typed run working             | `QSwarm` "WORKING" + label "Thinking" + server stage (`workingLabel`)                                                    | `q-conversation.tsx:1116-1135`; `q-session.tsx:507-520`                | Honest (server stages)                                                             |
| Stream dropped                | "Reconnecting… Your conversation is saved."                                                                              | `q-conversation.tsx:703-707`                                           | OK                                                                                 |
| Run failed                    | "Q couldn't finish that" + `failureMessage` + `recoveryHint`                                                             | `q-conversation.tsx:708-712`                                           | OK                                                                                 |
| Voice: Q chose SILENT         | Their words appear as a bubble, the state goes "Thinking" then back to "Listening". Nothing is said and nothing is shown | `duplex-line.ts:1615-1616, 1647-1652`; labels `voice/session.ts:24-33` | **Misleading / hidden failure (D-E4)**                                             |
| Voice: transcript empty       | back to "Listening"                                                                                                      | `duplex-line.ts:1582-1587`                                             | silent by design                                                                   |
| Arrival briefing pending      | the page's own "Welcome back" fallback                                                                                   | `arrival-briefing.tsx:1066`                                            | OK, but see duplicate greetings (11 §4)                                            |
| Arrival words being read      | "Q is reading that…"                                                                                                     | `arrival-briefing.tsx:946`                                             | OK                                                                                 |
| Arrival decision failed       | status line with the server message                                                                                      | `arrival-briefing.tsx:244-247, 941-951`                                | OK                                                                                 |
| Room card unavailable         | "This isn't available to you here." / "Sign in again to see this."                                                       | `room-actions.ts:71-74, 89-91`; `room/room-load-failed.tsx`            | OK, permission-safe                                                                |
| Blocks invalid                | nothing (blocks silently dropped)                                                                                        | `result-blocks.ts:428-429`                                             | **hidden failure (D-E7)**                                                          |
| Wire contracts not loaded yet | room cards and NAVIGATE are held until the Zod chunk loads                                                               | `wire.ts:1-12, 37-40`; `room-stage.ts:174-176`; `q-session.tsx:444`    | fails closed; a chunk-load failure is retried by the next caller (`wire.ts:28-31`) |

---

## 7. Action dispatch from cards to verified backend actions

- **Arrival decision cards** (`arrival-actions.ts:216-347`):
  - `APPROVE` re-reads the approval, refuses if it can no longer be decided, compares the shown content with the server's current content (`sameShownMessage`), and only then calls `approveQApprovalAction`.
  - `SEND_EDITED` sends the person's own message with an idempotency key, then rejects the replaced approval.
  - `RETRY_HELD` and `DISMISS_APPROVAL`.
  - `DISMISS_HELD` is **client-only**. `dismissHeld(draftId)` (`arrival-briefing.tsx:169-171`) writes the id to `localStorage["cq.work.dismissedHeld"]` and nothing else (`work/decision-queue.tsx:141, 188-196`).
    - The Work page honours that list (`work-page.tsx:151, 175`).
    - The arrival read runs on the server and calls `decisionGroups` **without** `dismissedHeld` (`arrival-actions.ts:136-142`; parameter at `work/decisions.ts:132`).
    - Result: a held message the person dropped comes back in the next arrival briefing ("the X reply is held"), and on every other device. This is defect D-E6.
  - Status: IMPLEMENTED. The shown-content check is a read-then-approve sequence, not atomic. The server-side payload binding of the Approval Engine is outside my area.
- **Conversation approvals.** `QNow` Approve/Decline → `q.approve()` → `approveQApprovalAction(approvalId)` (`q-now.tsx:102-120`; `actions.ts:385-396`). Status: IMPLEMENTED.
- **Voice → card verbs.** `readSpokenReply` treats the provider's transcript of the person as authoritative. A consequential verb heard only from the model's paraphrase becomes `UNSURE` (`briefing/arrival.ts:224-246`). Free words are read by the `BRIEFING_COMMAND` model into verbs, then gated by `wordsAllowSend` / `wordsAllowDismiss` on the person's own words (`arrival.ts:354-423`). This is a good design, but duplex only (see §2.6).
- **Instant tools** act at once and are reversible (`ui-intent.ts:642-699`). **Client actions** are performed through the app's own code (`client-actions.ts`).

---

## 8. Component-level permissions

- References carry ids only. Avatars use gated photo routes (`q-result-blocks.tsx:408-441`). The company link goes to the company page, which authorises again.
- Room cards are read server-side under the person's session. A record they may not open becomes "This isn't available to you here" (`room-actions.ts:60-98`).
- `INVESTOR_FIT`, `THESIS` and `SAVED_COMPARISON` resolve the actor's **own** organisation on the server and never take the model's id (`client-actions.ts:992-1013`).
- UI hiding is never used as authorisation in the code I read. The Context Firewall and server tool authorisation are outside my area.

---

## 9. Mobile and accessibility

- **Arrival cards** use columns at ≥1024px only (`useWide`, `arrival-briefing.tsx:956-972`; slots `hidden lg:flex`, `arrival-room.tsx:89-91`). Below that they stack under Q (`arrival-briefing.tsx:923-934`). On a phone the arrival stack (greeting + lowdown + summary + focus card + lines + command bar) and the `ReturningWelcome` cards plus `FounderNext` all sit under Q in one scroll (`home-screen.tsx:212-231`).
- **A11y positives:**
  - `role="status"` lines.
  - Focus cards have `aria-label`s with "n of m" (`arrival-briefing.tsx:415-416`).
  - Reduced motion is honoured for arrival items (`arrival-briefing.tsx:722, 842-849`).
  - Screen-reader-only live region for Q's words in presence view (`q-presence-stage.tsx:318-323`).
  - Pass/fit levels use shapes as well as colour (`answer-cards.ts:23`).
- **A11y risks:**
  - Several concurrent `role="status"` regions on the Q page (stage label `q-conversation.tsx:1188-1200`, arrival status, returning status `returning-welcome.tsx:236-242`). This is chatty for screen readers.
  - Presence view hides the transcript by default; captions are opt-in (`q-presence-stage.tsx:94-97`).
  - `INVESTOR_REFERENCE` cards have no accessible name beyond "Investor".

---

## 10. Worked question: "compare these three investors, show where they're based, and tell me who'd be the best fit"

**What Q can do today** (founder asking; static reading):

1. **Tools.** The likely path is `find_prospective_investors`. It returns network-visible declared profiles "where they are based, what kind of investor they are, whether they say they are deploying", with deterministic reasons and gate criteria met/not met/unknown (`q-tools/src/tools/find-prospective-investors.ts:169-170`). `lookup_public_profile`, `search_network` and `research_public_web` also exist (tool list, `q-tools/src/tools/*`). Which tools the planner actually picks was not traced (brain area).
2. **Rendering.**
   - The model may fill `answerCards` with shape `SIDE_BY_SIDE` and measures like "Based in", "Stage", "Cheque". `fit` is then computed by code from the **model-assigned** levels (`answer-cards.ts:52-67`), not from a platform investor-fit service. Platform fit exists only for investor→company (`q-tools/src/tools/fit.ts:30-47`; `fit-cards.ts:19-30`).
   - If every card has the same measure labels, the canvas lays them out as a table (`answer-canvas-logic.ts:61-70`).
   - Otherwise the answer is a Markdown table or list, or v12 `COMPARISON_CARDS`.
   - The cards come with **`subject: null`** (investor subjects are never attached, `card-subjects.ts:88-100`), so a card cannot "Open profile".
   - `INVESTOR_REFERENCE` blocks appear only if the investors were the run's authorised subjects, and then only as unnamed avatars.
3. **"Where they're based."** Text only. There is no map, no coordinates and no geo block.
4. **"Best fit."** The answer gives a verdict in words plus code-computed /10 from model-chosen levels. `RANKED` ordering is by that number (`answer-cards.ts:97-103`). The `INVESTOR_FIT` room card is different: it shows the founder's own top 8 Discover investors with gates (`room-actions.ts:277-290`), not "these three".

**What is missing:**

- A contract and producer for **investor answer-card subjects** (`INVESTOR_ORGANISATION` in `withCardSubjects`) and a named, linked `INVESTOR_REFERENCE` card (name plus "Open profile" → `/investors/<id>`, which `OPEN_RECORD_PAGE INVESTOR` already supports, `ui-intent.ts:279`).
- A deterministic **company→investor fit** (published criteria/gates exist; there is no scored fit block for a founder).
- A **map/geo block** (new `QResultBlock` kind with country codes; render without a tile provider, e.g. a country list or a static SVG).
- A `SHOW_IN_Q_ROOM` object for an **investor profile** or **investor comparison** of named ids. Today `INVESTOR_LOOKS_FOR` covers one investor (`ui-intent.ts:414-423`), and `INVESTOR_FIT` cannot be scoped to chosen ids.

---

## 11. The founder's complaint, mapped to code

| Founder expectation                                                             | What the code does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Casual greeting, happy to see me                                                | `arrivalGreeting`: "Good afternoon, Zino." / "Hi Zino, you're up late." by their zone (`q-core/src/speech/arrival.ts:50-70`). The fallback is "Welcome back, X." (`home/returning.ts:115-121`)                                                                                                                                                                                                                                                                                                                                                                                                                      | IMPLEMENTED (plain, not warm)         |
| Full summary of all it has done (agents answering messages, booking calls)      | `lowdownOf` names counts: replied to / sent N, booked a call, expressed interest, replies, connections, held (`arrival.ts:157-288`), from `readWorkSince` over `instruction_steps` with status `DONE` in the window (`work/page.ts:647-665`). "Since" is the browser's localStorage heartbeat, reset every 60s while any page is open (`arrival-gate.ts:61-84`); with no history it is the last 24h (`arrival-actions.ts:108`). Workforce jobs' own results (e.g. "Expressed interest in N companies", `composition/workforce/jobs.ts:168-173`) count only if they wrote `instruction_steps`. I did not verify that | PARTIAL                               |
| Then everything that needs my attention (unanswered chats, requested documents) | Cards = pending approvals + held drafts (`arrival-actions.ts:124-202`). Unread `NEEDS_YOU` notices are said as names (`arrival.ts:117-156`). Document requests appear only if they produced a NEEDS_YOU notice or an approval. There is no direct read of `INVESTOR_REQUESTS` (it exists as a room object, `ui-intent.ts:431`). An unanswered investor chat with no Q draft is only a notice line, not a card                                                                                                                                                                                                       | PARTIAL                               |
| Investor: new companies that meet my mandate, all of them, with Q's opinion     | None of this is in the arrival. R35 `pitchItems` ("N pitches that match your mandate", `home/briefing.ts:251-265`) is shown **only when the arrival is not READY** (`returning-welcome.tsx:164-167`). The Work suggestion `NEW_MATCHES` lives on Work only (`work/page.ts:205-216`). No opinion is composed                                                                                                                                                                                                                                                                                                         | NOT IMPLEMENTED                       |
| Cards by the sides of Q, appearing and disappearing with what Q talks about     | Side columns: only arrival decision cards, only pre-conversation, only ≥1024px (`q-conversation.tsx:1166-1201`; `arrival-briefing.tsx:741-749`). They disappear once any line exists (see §0.3). Topic-following cards (answer cards, room cards) live in the **centre** and do follow speech                                                                                                                                                                                                                                                                                                                       | BROKEN (sides) / IMPLEMENTED (centre) |
| "Just listening and not doing anything"                                         | (a) The briefing cards vanish from `/home` as Q finishes speaking, and the voice decider goes with them. (b) SILENT turns show nothing (`duplex-line.ts:1647-1652`). (c) The first typed question waits for `spokenWelcome` (up to ~1.5s + 2.5s + 1.5s, `q-conversation.tsx:156-193, 662-672`). (d) On the standard line, voice cannot act on cards. (e) Voice answers depend on the in-memory room feed. (f) Answers like "nothing is waiting" come from a different read set (brain area: approvals, schedule, q.work, relationships) than the arrival notices                                                    | see `_findings/E.md`                  |
