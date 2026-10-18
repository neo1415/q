# 11 — UI/UX architecture: key flows, surfaces and the founder's complaint

Investigator E · HEAD `520bd123` · static, read-only. Companion to `06-GENERATIVE-UI.md`; evidence is in `evidence/ui/*.md`; IDs (D-E*, R-E*) are in `_findings/E.md`.

---

## 1. Shell and global Q

- **Routes.** Next.js 16 App Router in `apps/web/app`. Signed-in pages are under `app/(app)/*`, onboarding under `app/(onboarding)/*`, and dev harnesses under `app/dev/*`. The dev harnesses return 404 in production unless `CQ_DEV_PREVIEW=1` (e.g. `app/dev/briefing/page.tsx:34-39`).
- **`(app)/layout.tsx`** renders `AppShell`. `GlobalQ` (`apps/web/src/components/app-shell/global-q.tsx:270-289`) mounts one `QSessionProvider` (the single conversation store, `features/q/q-session.tsx:161-564`) and, on every page:
  - the Q sheet (side panel);
  - the runner;
  - `AnswerChip`;
  - `ArrivalDock`;
  - Q sounds;
  - `QEdgeFlow` (particles around the page edge while Q works);
  - `WakeWord` ("Hey Q", off by default);
  - the floating **Q Dock**.
- **The conversation store.** One conversation per tab, persisted as a pointer in this tab (`active-conversation`). It holds the voice line (`useVoiceInterview`), spoken lines, room-feed absorption, NAVIGATE following and the aperture state (`q-session.tsx:212-520`).

## 2. Surfaces that show Q (and their overlap)

| Surface                   | Where                                                   | Component                                              | What it shows                                                                  |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Q page / Home             | `/home` (`app/(app)/home/page.tsx`)                     | `HomeScreen` → `QConversationPanel`                    | presence stage, welcome, thread, Board, composer, voice                        |
| Q Dock                    | every page but `/home`                                  | `features/q-dock/q-dock.tsx:48-70`                     | minimal / compact pill / stashed; opens the sheet                              |
| Q sheet                   | side panel from the dock                                | `features/q/q-sheet.tsx` (`QAnswer`, `QNow`, `QBoard`) | the same conversation, compact                                                 |
| Arrival dock              | every page but `/home`                                  | `briefing/arrival-dock.tsx:23-56`                      | compact briefing + one focus card                                              |
| Answer chip               | other pages                                             | `features/q/answer-chip.tsx`                           | a new answer with cards; opens `/home?board=1`                                 |
| Work panel (home variant) | `/home` only when **not** a returning/first-run welcome | `home-screen.tsx:268-272`                              | running delegations                                                            |
| QSection                  | many pages                                              | `features/q/q-section.tsx`                             | not UI: tells Q which ids are on screen                                        |
| FounderNext               | `/home` welcome (founders)                              | `readiness/founder-next.tsx`                           | Q's follow-up questions + next 3 actions                                       |
| R35 briefing              | `/home` welcome when the arrival is not READY           | `home/q-briefing.tsx`, composed by `home/briefing.ts`  | up to 5 link cards (approvals, relationships, interest, pitches, setup, calls) |
| Arrival briefing          | `/home` welcome, or the arrival dock elsewhere          | `briefing/arrival-briefing.tsx`                        | greeting, lowdown, decision cards, command bar                                 |

**Duplicates (UX debt, D-E9):**

- **Three greeting/briefing systems coexist** on the same Home:
  1. `returning.ts` "Welcome back, X. What would you like to work on today?" (`home/returning.ts:115-160`);
  2. the R35 briefing (`home/briefing.ts`, server-composed, link cards);
  3. the 2026-10-08 arrival (`features/briefing/*`, client-composed, decision cards).
  - Which one the person sees depends on a `sessionStorage` flag (`arrival-gate.ts:69-77`). The first load in a browser session gets the arrival. A reload in the same tab gets "Welcome back" plus R35 (`returning-welcome.tsx:131-167`).
- **What voice says** comes from yet another path: `spokenWelcome` tries arrival, then R35, then `welcomeLine` (`q-conversation.tsx:164-193`), and `q-session.talk` falls back to `plainHello()` (`q-session.tsx:49-58, 359-363`).
- **Dead code:** `VoicePanel` (`features/voice/voice-panel.tsx`) and `ActivitySummary` (`home/activity-summary.tsx`) have no importers (grep, 0 hits). Classification: CONFIGURED-UNUSED.
- **"Needs you" in four places:** Work page `DecisionQueue`, arrival `Sequence` ("Needs you" heading, `arrival-briefing.tsx:876-878`), `QNow` ("Needs you" label, `q-now.tsx:84`), and the notification centre. All four read approvals, but with different filters:
  - `QNow` shows only the open conversation's approval (`q-now.tsx:31-38`);
  - the arrival dropped `dismissedHeld` (D-E6).

## 3. Key flows

### 3.1 Q page / Home (founder and investor)

- **Route.** `/home` → `HomePage`: `force-dynamic`; redirects to onboarding if unfinished; reads `?c`, `?new`, `?board` (`app/(app)/home/page.tsx`).
- **Server composition.** `HomeScreen` (`home-screen.tsx:153-294`) does the following:
  - `resolveOwnContext`.
  - `arrivalFor` → RETURNING / FIRST_TIME.
  - For RETURNING with no conversation:
    - `resolveBriefing(context)` (R35, not awaited);
    - `resolveReturningFacts` (1.5s per read budget, `returning-facts.ts:33-47`);
    - `returningGreeting`;
    - `ReturningWelcome` with `chooseReturningCards`;
    - founders also get `FounderNext` in Suspense.
- **Client.** `QConversationPanel` (`q-conversation.tsx:294-1460`):
  - **Pre-conversation branch** (`lines.length === 0`): `ArrivalRoom` around `QAperture` + state label, "Talk with Q", welcome, suggestions (only when there is no welcome), `QNow`, notices (`q-conversation.tsx:1166-1264`).
  - **Conversing branch:** presence view (`QPresenceStage`) or chat view (thread) (`917-1165`).
  - Top line: scope indicator, `QCanSee`, view toggle, captions, voice menu, Board, history, download (`763-898`).
  - Composer with voice controls (`1268-1300+`).
- **State.**
  - `useQSession()` (turns, voice, spoken, presence).
  - Local state: view (localStorage via `subscribeStageView`), captions, Board open, history sheet.
  - `useRoomSlots` (module store, `arrival-room.tsx:44-73`).
- **Data and backend.**
  - Q API runs through server actions (`features/q/actions.ts`).
  - `/api/q-room` long poll while a line is active (`room-feed.ts:17, 115-148`).
  - Approvals via the `approveQApprovalAction` / `rejectQApprovalAction` server actions.
- **Auto voice.** If the microphone is already granted and the person did not end the line in this tab, the line opens by itself on arrival (`q-conversation.tsx:403-432`).

### 3.2 Arrival briefing and the "room" (cards beside Q)

- **Gate** (`arrival-gate.ts`):
  - The briefing is given if this browser session has not had one, or the person has been away ≥2h (`arrival-gate.ts:26-40`).
  - "Since" = `localStorage["cq.q.last-seen"]`, refreshed on load and every 60s while visible (`61-84`).
  - It re-arms on `visibilitychange` after 2h (`85-100`).
- **Read.** `arrivalBriefingAction(since)`, server, under the person's session (`arrival-actions.ts:100-214`), fetches in parallel: `getQWorkSince`, pending approvals, workforce, done list, notices. It then reads up to 6 approvals in full and builds the cards with `decisionGroups` (the same queue as Work, minus `dismissedHeld`), plus the latest chat line per relationship.
- **Words.** `arrivalWords` (`briefing/arrival.ts:158-209`): greeting + lowdown (+ waiting names) + "Three things: …" summary or the first card's line.
- **Layout.** `Sequence` (`arrival-briefing.tsx:695-954`). `flank` is true only when all of these hold: not the dock, viewport ≥1024px, both room slots mounted, and a card active (`741-749`).
  - When `flank` is true, cards are portalled into left/right slots alternately (`861-922`).
  - Otherwise they render below.
  - Command bar: "Tell Q what to do with these" (`648-691`).
- **Lifetime.** The room slots exist only in the pre-conversation branch (`q-conversation.tsx:1166-1201`). See §4, the main finding.
- **Later cards.** A new unread `NEEDS_YOU` notice triggers `refreshArrival` (`arrival-briefing.tsx:980-997`). The notice store polls every 60s (`work/notice-store.ts:23, 128`).

### 3.3 Voice mode UI

- **Entry.** "Talk with Q" (`q-conversation.tsx:1203-1218`), the dock mic, or auto-start.
- **Start sequence.** `session.talk` → `voice.talk` → `startVoiceSessionAction` → provider client `start` with `firstMessage` (`use-voice-interview.ts:445-524`).
- **Providers.** `duplex-session.ts` (OpenAI realtime via `duplex-line.ts`, 2234 lines), `deepgram-session.ts` (standard line), `elevenlabs-session.ts`.
- **What the person sees:**
  - `QLumen` levels;
  - aperture state (`apertureStateFor`, `q-session.tsx:498-506`);
  - label from `VOICE_STATE_LABELS` (Ready / Connecting / Listening / Thinking / Speaking / Voice paused; `voice/session.ts:24-33`);
  - live user bubble (`q-conversation.tsx:483-491, 1023-1037`);
  - option buttons when Q asks (`1137-1159`);
  - mute / end in the composer.
- **Hidden-failure points:**
  - A SILENT result goes back to "Listening" with nothing said (`duplex-line.ts:1647-1652`). See D-E4.
  - Duplex → standard fallback is reported only through `voice.notice` (`duplex-session.ts:178-192`).
  - The card decider exists on duplex only (D-E3).

### 3.4 Q Dock

- **Component.** `q-dock.tsx` (502 lines): drag/throw anchors, obstacle avoidance (`dock-avoid.ts`), and a context menu for WCAG 2.5.7.
- **Behaviour.** It opens the Q sheet. The compact pill shows the task stage, mic-live and Stop.
- **Presence.** On every page but `/home`. `ArrivalDock` floats above it at `bottom-24 right-4` (`arrival-dock.tsx:44-46`) and returns null on `/home` (`arrival-dock.tsx:42`).

### 3.5 Work, agent activity, Team map

- **Route.** `/work` (`app/(app)/work/page.tsx`): views needs / progress / done / team / cost (`WORK_VIEWS`).
- **Server reads.** Pending approvals, read ahead in full for 10 (`VIEWS_READ_AHEAD`); `listWorkAction`; `listSuggestionsAction`; `listDoneAction`; `loadWorkforceAction`.
- **Client.** `WorkPage` (`work/work-page.tsx`, 1827 lines) contains:
  - `DecisionQueue` (`decision-queue.tsx`);
  - suggestions (from `composeSuggestions`, server `work/page.ts:87-…`);
  - running work;
  - done-for-you with undo;
  - the Team map (`workforce-map.tsx`, `WorkforceTeamView`).
- **Live data.** The Team map refreshes with `useLive`: 8s while active and focused, 30s while idle, 60s when unfocused, with backoff to 120s (`workforce-live.ts:11-26`). Freshness is shown honestly ("updated 40 s ago").
- **Backend actions.** Approve/reject (server actions), `stopWorkAction`, `answerWorkAction`, `setPausedAction`, `setDelegationAction`, `dismissSuggestionAction`, `unsendDoneForYouAction` (`work-actions.ts`, `work-page-actions.ts`).

### 3.6 Profiles

- **Route.** `/profile` → `ProfileHero`, `ProfileAnswers`, `FounderBackgroundSection`, `ProfileImageEditor`, `QCardSection`, `ProfileTeamSection`, `ThesisSection` (investors), with `QPageSubject` (`app/(app)/profile/page.tsx:16-51`).
- **Investor organisation page.** `/investors/[id]` → `ProfileHero`, `LooksForSection`, `ConnectionRequest`. A 404 from the API becomes `notFound()` (`investors/[investorOrganisationId]/page.tsx:64`).

### 3.7 Relationships and chat

- **Routes.** `/relationships` (`RelationshipsIndex`) and `/relationships/{company|investor}/[id]` (`InvestorRelationshipActions`, `CompanyPitch`), plus `/messages`, `/calls` and `/diligence` subpages.
- **Unavailable.** An unavailable relationship renders `RelationshipUnavailable`, or redirects to the overview (`relationships/company/[companyId]/messages/page.tsx:9, 33`).
- **Chat.** `RelationshipConversation` → `relationship-chat.tsx` polls the thread cursor every 3s while visible (`chat/relationship-chat.tsx:68, 171-205`). There is no websocket.
- **Chat actions** (`chat/chat-actions.ts:92-236`): send (with an idempotency key), mark read, unsend, attach, block, report.

### 3.8 Discover and Explore

- **`/discover`.** Investors get `InvestorFeedScreen` (the company feed, precomputed slate); founders get `DiscoverInvestors`; there are tabs and `NetworkVideos` (`app/(app)/discover/page.tsx:25-31`). Saved, passed and compare subroutes exist.
- **Q control of the feed.** `SET_DISCOVER_FILTERS` and `SCREEN_ACT` NEXT/PREV/PASS/SAVE (`ui-intent.ts:492-534`).
- **`/explore`.** `ExploreScreen` + search, with poster authorisation through `authorisePostersAction` (`app/(app)/explore/page.tsx:5-9`).

### 3.9 Company page and data room

- **`/company/[id]`.** Fold sections, `BackLink`, `QSection`, `QPageSubject` (`app/(app)/company/[companyId]/page.tsx:33-63`). Deep-link tabs (elevator / data room / deck / team) are reachable through `OPEN_RECORD_PAGE` `COMPANY_*` (`ui-intent.ts:295-299`).
- **Data room.**
  - Founder side: `/documents` with `DocumentsScreen`, `DataRoomTab`, `RequestsInbox` (`app/(app)/documents/page.tsx:15-21`).
  - In-room: `DATA_ROOM` room card and document viewer (`room/document-room.ts`, `q-room-document.tsx`), driven by `DOCUMENT_ACT`.

### 3.10 Error and permission states

- **Error boundaries.** Only `app/error.tsx` exists. A find for `error.tsx` under `apps/web/app` returns this single file; there is **no `(app)/error.tsx`**.
  - Inference from Next.js semantics: a render error in any signed-in page replaces the whole `(app)` layout. That unmounts `QSessionProvider`, which ends the voice line and drops the in-tab conversation state.
  - The page offers "Try again" / "Go to Home" (`app/error.tsx:24-58`).
  - This is risk R-E5 (not reproduced).
- **Loading files.** There are `loading.tsx` files for `(app)`, relationships, discover, explore, results, daily, settings/*, and others. There is no `loading.tsx` for `/home` or `/work`; those stream with Suspense instead.
- **Permission states:**
  - `notFound()` on 404s;
  - "This isn't available to you here." (room cards);
  - `RelationshipUnavailable`;
  - "Capital Q didn't answer just now…" when the context read fails (`home-screen.tsx:105-108`).
- **Q errors.** `StageNotice` "Q couldn't finish that" / "That didn't go through" (`q-conversation.tsx:701-740`).

## 4. The founder's complaint (2026-10-08), answered from the code

### 4.1 Login greeting and summary — what it is composed from

- **Greeting.** `arrivalGreeting({firstName, now, timeZone})` gives "Good morning/afternoon/evening, Zino." or "Hi Zino, you're up late." (`packages/q-core/src/speech/arrival.ts:50-70`).
  - The zone is the person's profile zone, or else their standing instruction's working-hours zone (`apps/q-api/src/composition/work/page.ts:720-729`), or else the browser's (`briefing/arrival.ts:96-103`).
  - It is deterministic and polite, with no warmth variation beyond these four forms. "Happy to see me" is not expressed.
- **Lowdown** (`lowdownOf`, `arrival.ts:235-288`), built from `QWorkSinceDto` (`work/page.ts:639-752`):
  - `sent` / `booked` / `interest` are `q_runtime.instruction_steps` with status `DONE` since `since`, by action `chat.message.send` / `schedule.meeting.book` / `relationship.interest.express`;
  - `held` is `workforce_draft_outcomes` with outcome `HELD`;
  - `replies` is counterpart messages on the person's side;
  - `matches` is relationships whose state became `CONNECTED`.
  - Each is a count plus up to 3 names. The window is clamped to 7 days.
- **Needs-you.**
  - The `decisions` count is the number of cards (approvals + held drafts).
  - `waiting` is the titles of unread `NEEDS_YOU` notices, said once per name (`arrival.ts:117-156, 174-182`). This came from the lead's fix today, after "All quiet" was said while an investor waited.
- **Cards.** `ArrivalCard{kind: APPROVAL | HELD}` with the exact message, "what they said", and Approve & send / Edit & send / Send as is / Ask Q to try again / Dismiss / Later (`arrival-briefing.tsx:390-611`).
- **What is not in it:**
  - document requests as such (only if they became a NEEDS_YOU notice or an approval);
  - an unanswered chat with no draft, as a card (only as a "waiting" line);
  - meetings booked by workforce jobs that did not write `instruction_steps` (unverified);
  - anything about the investor's feed.

### 4.2 Investors: "new companies matching my mandate, with Q's opinion"

**Not implemented on arrival.**

- No arrival read touches the feed or slate.
- `matches` means CONNECTED relationships (`work/page.ts:703-719`).
- The R35 "N pitches that match your mandate" card (`home/briefing.ts:251-265`) is **hidden whenever the arrival is READY** (`returning-welcome.tsx:164-167`). So the better arrival removed the only mandate-match line investors had.
- Partial substitutes elsewhere:
  - Work suggestion `NEW_MATCHES` "Founders fit your mandate · Prepare intros?" (`work/page.ts:205-216`);
  - saved-alert notices from `startup-alert-watcher.ts` (alerts, not the mandate; priority not verified);
  - the returning question "There are companies in your feed, ranked against your mandate" (`returning.ts:147-149`), which is generic, with no names and no opinion.
- Q's opinion would need a new producer: slate delta since the last visit, with per-company fit (`fit.top_candidates` exists, `q-tools/src/tools/fit.ts:46-47`) and a model view under the fit contract.

### 4.3 Cards by the sides of Q that appear and disappear with what Q is talking about

- **Built.** The side columns (`ArrivalRoom`, `arrival-room.tsx:78-94`). The e2e coverage is a dev harness only (`e2e/q-presence-room.spec.ts:31`, `/dev/briefing?variant=room`).
- **Breaks on the real page (D-E1)** — static reading, high confidence:
  1. The columns and the welcome render only when `lines.length === 0` (`q-conversation.tsx:523, 608, 1166-1227`).
  2. `lines` includes spoken-only lines (`q-conversation.tsx:493-508`).
  3. Q's spoken opener (the briefing itself) is added as a spoken line through `onLine` (`q-session.tsx:233-239`; duplex `duplex-line.ts:1376-1379` on transcript completion; deepgram `deepgram-session.ts:204-218`).
  4. As soon as Q's briefing line lands, or the person types, the page switches to the conversing branch. `ArrivalBriefing` unmounts, the side cards vanish, `registerCardDecider` is cleaned up (`arrival-briefing.tsx:766-794`), and the standing note is cleared (`751-755`).
  5. `ArrivalDock` never renders on `/home` (`arrival-dock.tsx:42`).
  6. Q then says "Three things… tell me what you'd like done" with no cards on screen, and a spoken "send it" has no decider.
  - Also, with `?c=<id>` in the URL, or after any prior turn in the tab, the welcome is never rendered. The server builds no welcome when `?c` is present (`home-screen.tsx:190`), and a bare `/home` keeps the tab's stored turns (`q-conversation.tsx:309-320`), so `showWelcome` is false (`q-conversation.tsx:608`). `writeToQPageUrl` adds `?c=` as soon as a conversation is named (`q-session.tsx:137-147, 208-211`), so a reload of `/home` after any conversation never shows the briefing cards on the Q page.
- **"Appear and disappear with what Q is talking about".** This exists for answer cards and room cards in the centre column: `focusForSaid`, `topicMovedOn`, `room-stage.mentions` (`answer-canvas-logic.ts:87-169`; `room-stage.ts:121-163`). It does not exist for the side columns, which hold only decision cards and never react to topic.
- **"Some below when needed".** On narrow screens the arrival cards go below Q (`arrival-briefing.tsx:923-934`). The answer stage is always centre and below.

### 4.4 Why it feels like "just listening and not doing anything"

Code-level contributors, in likely order of impact:

1. **D-E1.** Briefing cards and the voice decider vanish when Q starts talking or the person types. Only the voice remains, describing cards that are no longer on screen.
2. **D-E4.** Turns where Q chooses silence (or the turn reader returns UNCLEAR/SILENT, per the lead's live evidence) show "Thinking" → "Listening" with no words and no "I didn't catch that". Before the lead's v44 fix, the realtime model improvised instead.
3. **D-E3.** On the standard line (the lead's tests fell back to it), card verbs and screen notes are not wired, so spoken decisions go to Q as ordinary turns.
4. **D-E5.** The first typed question awaits `spokenWelcome` before it is sent: up to 1.5s polling for arrival + 2.5s voice briefing read + 1.5s R35 race (`q-conversation.tsx:164-193, 659-672`). During that time nothing is shown as working (`q.working` is still false). `talk()` waits the same way before the line opens (`371-395`).
5. **R-E2.** Spoken answers reach the screen only through the process-local room feed (`apps/q-api/src/room/feed.ts:35-38`). With more than one q-api instance, or a restart mid-call, the cards from a spoken answer never appear (unverified: instance count).
6. **Inconsistent reads.** "Nothing is waiting" (Q's answer) vs. the arrival's "Zino Aviation is waiting for your reply": the voice answer used approvals / schedule / q.work / relationships tools (lead's evidence), while the arrival reads notices. Different sources give different truths. This belongs to the brain area; noted for the lead.

### 4.5 Misleading progress indicators and confusing controls

- **"Listening"** is shown both for a healthy idle line and after a silent or failed turn (`voice/session.ts:27-31`; `duplex-line.ts:1650`).
- **"Ready when you are"** is the idle label before the first question (`q-conversation.tsx:622-625`), shown even while `spokenWelcome` is still awaiting reads.
- **`QNow` "Q isn't working on anything, and nothing needs you."** (`q-now.tsx:51-55`) is scoped to the open conversation's approval only. Every caller passes `quietWhenIdle`, so this text currently never renders (all four call sites, grep). Latent.
- **"Not now" vs "Later" vs "Dismiss" vs "Close".** There are four ways to put cards away (`arrival-briefing.tsx:579-595, 887-896`; dock Close `1102-1110`). "Dismiss" on a HELD card is local-only (D-E6).
- **Two "Q" toggles.** The view toggle labels presence as "Q" vs "Chat" (`q-conversation.tsx:809-823`), while the corner label also reads "Q" when idle (`625`).
- **Comparison table headers** read "Company 1, Company 2" rather than names (`q-result-blocks.tsx:463-470`).
- **The Investor reference card** has no name (`q-result-blocks.tsx:414-443`).

## 5. Classification summary (UI flows)

| Flow                                                                   | Status                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Q page presence/chat, Board, history, composer                         | IMPLEMENTED                                                                                                                        |
| Arrival briefing (greeting, lowdown, decision cards, verbs, any-words) | IMPLEMENTED (logic) / BROKEN on `/home` once the conversation starts (D-E1) / UNTESTED on the real page (e2e uses the dev harness) |
| Side columns around Q                                                  | PARTIAL: arrival decisions only, pre-conversation only                                                                             |
| Investor mandate-match arrival with opinion                            | NOT IMPLEMENTED                                                                                                                    |
| Voice → card decisions                                                 | PARTIAL (duplex only)                                                                                                              |
| Answer cards following speech                                          | IMPLEMENTED (centre)                                                                                                               |
| Room cards (`SHOW_IN_Q_ROOM`)                                          | IMPLEMENTED                                                                                                                        |
| Charts / maps                                                          | ABSENT                                                                                                                             |
| Work / Team map live                                                   | IMPLEMENTED                                                                                                                        |
| Chat                                                                   | IMPLEMENTED (3s polling)                                                                                                           |
| Segment error boundary for `(app)`                                     | ABSENT (R-E5)                                                                                                                      |
| VoicePanel, ActivitySummary                                            | CONFIGURED-UNUSED (dead)                                                                                                           |

## 6. Tests actually run (read-only, providers disabled)

`npx vitest run` on `apps/web/test/arrival-briefing.test.ts`, `arrival-waiting.test.ts`, `returning-welcome.test.tsx`, `q-result-blocks.test.ts`, `room-feed.test.ts` and `q-room.test.ts`: **6 files, 51 tests passed** (with act() warnings). Provider keys were set to `disabled-locally-000000000000`.
None of these tests mounts `QConversationPanel` with a spoken line together with the arrival briefing, so D-E1 is not covered.
