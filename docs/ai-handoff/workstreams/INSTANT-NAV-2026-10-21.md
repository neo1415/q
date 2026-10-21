# Instant navigation and actions, from any page, by code (Lane 7, 2026-10-21)

Branch `speed/instant-nav-r1` → `speed/q-oct20`. Owner's requirement: from any page, "open / close / back / scroll / press / show" happens immediately, once, without a refusal, and mostly without any AI call.

## How it is measured

- **After:** a real Chromium run (`apps/web/e2e/instant-nav.spec.ts`, desktop project, 1440 px) against a production build of the `/dev/instant-nav` harness.
  - The harness has three pages (feed, company, work) inside the app's own `GlobalQProvider`, `QControlRuntime` and `DocumentReadyCenter`.
  - Typed requests go through the Q session's own `ask`.
  - Spoken requests go through `navigationHeardFor`, the hand-off every voice line uses for a final transcript.
  - `/api/q-navigate` (the Q API's code-only reader) answers from fixtures after 30 ms.
  - `/api/q-ask` (a Q run, where a model may be called) is counted and refused.
- **ms** is the time from Enter or the final transcript to the effect on screen, measured in the page's own clock:
  - a page or record move: the router push;
  - a tab: it is selected;
  - a close: the dialog is gone;
  - a scroll: `scrollTop` moved;
  - a document: the viewer opened over the page.
- **Q runs** is the number of `/api/q-ask` calls. Only a run can call a model. On the typed line, 0 runs means 0 model calls.
- Raw rows: `docs/ai-handoff/evidence/instant-nav/rows/*.json`. Run with `pnpm --filter @capital-q/web build`, then `CQ_E2E_CHROMIUM=/opt/pw-browsers/chromium npx playwright test -c apps/web/e2e/playwright.config.ts apps/web/e2e/instant-nav.spec.ts`. Result: 160/160 pass, phone and desktop (45 instant cases, 29 context cases and 6 modal screenshot cases, each on both).
- **Before:** read from the code at `origin/speed/q-oct20` (db352c8c), using the same readers:
  - "code" means the browser or the Q API resolved it with no model;
  - "Q (model)" means it went to a Q run whose answer then acted, after the full answer. The time to the effect is the answer's round trip, which can't be measured offline without a provider.

## Table (45 requests)

| #   | Said (channel, page)                                     | Kind                 | Before                                                                              | After: ms to effect                                        | After: Q runs (typed)                               | Said / moved twice after?               |
| --- | -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| 1   | "open discover" (typed, feed)                            | page                 | code, moves at once                                                                 | 40                                                         | 1 (Q's code lane says "Opening Discover.", 0 model) | no: one move                            |
| 2   | "take me to relationships" (typed, company)              | page                 | code                                                                                | 45                                                         | 1 (code lane)                                       | no                                      |
| 3   | "go to my settings" (typed, work)                        | page                 | code                                                                                | 24                                                         | 1 (code lane)                                       | no                                      |
| 4   | "open my notification settings" (typed, feed)            | page                 | code                                                                                | 34                                                         | 1 (code lane)                                       | no                                      |
| 5   | "okay, show me the work page" (spoken, feed)             | page                 | code                                                                                | 28                                                         | n/a                                                 | no                                      |
| 6   | "take me back to discover" (spoken, company)             | page                 | code                                                                                | 21                                                         | n/a                                                 | no                                      |
| 7   | "open Northwind Robotics" (typed, feed)                  | record               | code (Q API, open_page)                                                             | 110                                                        | 1 (record code lane)                                | no                                      |
| 8   | "open my chat with Nixo" (typed, work)                   | record               | code                                                                                | 103                                                        | 1 (code lane)                                       | no                                      |
| 9   | "show me Nixo's data room" (spoken, feed)                | record + tab         | code                                                                                | 73                                                         | n/a                                                 | no                                      |
| 10  | "open the data room" (typed, company)                    | tab here             | code                                                                                | 179                                                        | 1 (code lane)                                       | no                                      |
| 11  | "now the pitch deck" (spoken, company)                   | tab here             | code, **but GPT-Live waited 6 s for a route receipt and then said "still loading"** | 84                                                         | n/a                                                 | **fixed**: the voice is told it is done |
| 12  | "show me the team tab" (typed, company)                  | tab by name          | code + a Q run                                                                      | 61                                                         | **0**                                               | no                                      |
| 13  | "open the Saved tab" (typed, feed)                       | tab by visible name  | Q (model: control_screen)                                                           | 48                                                         | **0**                                               | no                                      |
| 14  | "switch to the For you tab" (spoken, feed)               | tab by visible name  | Q (model)                                                                           | 47                                                         | n/a                                                 | no                                      |
| 15  | "close it" (typed, feed, dialog open)                    | close                | Q (model)                                                                           | 67                                                         | **0**                                               | no                                      |
| 16  | "close that" (typed, company, Q's cards open)            | close                | Q (model)                                                                           | 58                                                         | **0**                                               | no                                      |
| 17  | "okay, dismiss this" (spoken, work)                      | close                | Q (model)                                                                           | 45                                                         | n/a                                                 | no                                      |
| 18  | "close the document" (typed, feed, nothing open)         | close, nothing open  | Q                                                                                   | left to Q                                                  | 1                                                   | n/a (Q says nothing is open)            |
| 19  | "go back" (typed, feed)                                  | back                 | Q run, code lane (moves after the answer)                                           | 84                                                         | **0**                                               | no                                      |
| 20  | "take me back" (spoken, feed)                            | back                 | **never: read as a cut-off verb and dropped**                                       | 69                                                         | n/a                                                 | fixed                                   |
| 21  | "scroll down" (typed, feed)                              | scroll               | Q run, code lane (after the answer)                                                 | 54                                                         | **0**                                               | no                                      |
| 22  | "Q, scroll down a bit please" (spoken, company)          | scroll               | Q run, code lane                                                                    | 40                                                         | n/a                                                 | no                                      |
| 23  | "scroll to the bottom" (typed, feed)                     | scroll               | Q run, code lane                                                                    | 42                                                         | **0**                                               | no                                      |
| 24  | "back to the top" (spoken, feed)                         | scroll               | Q run, code lane                                                                    | 501 (a smooth scroll of 900 px; the scroll starts at once) | n/a                                                 | no                                      |
| 25  | "scroll up" (typed, work, already at top)                | scroll, no room      | Q                                                                                   | left to Q                                                  | 1                                                   | n/a                                     |
| 26  | "press Show more" (typed, feed)                          | registered control   | Q (model)                                                                           | 72                                                         | **0**                                               | no                                      |
| 27  | "click Notifications" (typed, feed)                      | button by name       | Q (model)                                                                           | 63                                                         | **0**                                               | no                                      |
| 28  | "tap the notifications button" (spoken, feed)            | button by name       | Q (model)                                                                           | 77                                                         | n/a                                                 | no                                      |
| 29  | "press express interest" (typed, feed)                   | consequential        | Q (Prepare → Approval)                                                              | **never by code**                                          | 1                                                   | n/a                                     |
| 30  | "press approve" (spoken, feed)                           | consequential        | Q                                                                                   | **never by code**                                          | n/a                                                 | n/a                                     |
| 31  | "open the certificate of incorporation" (typed, company) | data-room document   | Q (model: open_company_document), after the answer                                  | 198 (viewer opened over the page)                          | **0**                                               | no: Q's answer never reopens it         |
| 32  | "show me Halyard's term sheet" (spoken, feed)            | data-room document   | Q (model)                                                                           | 73                                                         | n/a                                                 | no                                      |
| 33  | "open the questions for Priya" (typed, work)             | Q-made document      | Q (model); **left the page for /documents**                                         | 191, in a modal on this page                               | **0**                                               | no                                      |
| 34  | "open my investor brief" (typed, feed)                   | Q-made document      | Q (model); left the page                                                            | 141, in a modal                                            | **0**                                               | no                                      |
| 35  | "open the secret cap table" (typed, company)             | document not theirs  | Q                                                                                   | **never opens; name never shown**                          | 1                                                   | n/a                                     |
| 36  | "switch to dark mode" (typed, feed)                      | theme                | Q (model: set_theme)                                                                | 143                                                        | **0**                                               | no                                      |
| 37  | "light mode please" (spoken, work)                       | theme                | Q (model)                                                                           | 57                                                         | n/a                                                 | no                                      |
| 38  | "clear all cards" (typed, feed)                          | cards                | code (P5) + a Q run (code lane)                                                     | unchanged, by code                                         | 1                                                   | no                                      |
| 39  | "change the language to French" (typed)                  | language             | Q (model: it is saved server-side)                                                  | left to Q                                                  | 1                                                   | n/a                                     |
| 40  | "show me my top three companies" (typed, company)        | Q shows cards        | Q (model); cards only on the Q page                                                 | left to Q; **the cards now open in a modal on this page**  | 1                                                   | n/a                                     |
| 41  | "compare Nixo and Halyard" (typed, work)                 | Q shows a comparison | Q (model); Q page only                                                              | left to Q; modal on this page                              | 1                                                   | n/a                                     |
| 42  | "uh, open the data room" (spoken, company)               | tab here             | code                                                                                | 81                                                         | n/a                                                 | no                                      |
| 43  | "open discover, no wait" (spoken, feed)                  | taken back           | never moves                                                                         | never moves                                                | n/a                                                 | n/a                                     |
| 44  | "um, close it." (spoken, feed)                           | close                | Q (model)                                                                           | 58                                                         | n/a                                                 | no                                      |
| 45  | "scroll down" (spoken, feed)                             | scroll               | Q run, code lane                                                                    | 68                                                         | n/a                                                 | no                                      |

### Summary

- **Done on screen before Q's answer, before → after:** 13 → 35 of 45.
  - Before: rows 1–12 and 42.
  - The other 10 are rightly Q's: two consequential presses; a document they may not open; nothing to close, and no room to scroll; the language change; two "show me" answers, which now open as a modal when Q answers; a taken-back request; and the cards clear, which is code already.
- **Went to a model before:** 15 of these requests (13–17, 26–28, 31–34, 36, 37, 44). After: 0.
- Row 20 never acted before.
- **Time to effect for the 35 code paths:**
  - median 67 ms; max 501 ms (a smooth scroll still running); every other case 21–198 ms;
  - documents 73–198 ms, including the 30 ms fixture read.
- **Typed line, model calls:** 0 for close, back, scroll, a control or tab by its name, theme and documents, because no Q run starts. Page, record and "tab here" requests still start a run, and Q API's code lanes answer those with 0 model calls (`answer.ts` `codeAnswersWords`). - **Twice:** in every measured case the screen moved or opened at most once (`moves ≤ 1` asserted). Q's answer naming the same document does not open it again (`openedEarly`), and it does not move to a page again (`movedEarlyTo`, unchanged).

## Context: names are not required (owner addition, 2026-10-21)

The person says "open their deck", "open this one", "show me that", "their stuff", "go back to the other one" or "the second one", and the screen works out what they mean.

**Context set.** It is built in the browser from real state only (`control/context-set.ts`):

- the record on screen, from its route, and its registered tabs;
- what Q's answers named, newest first: the records they opened (OPEN_RECORD_PAGE), the subjects of their cards and comparisons, and the documents Q made (ARTIFACT_REFERENCE);
- the cards Q is showing over the page now;
- what was opened last, by the fast path or by Q's answer.

**Resolution.**

- The reader `contextAskOf` (q-specialists) handles three kinds of words:
  - pointers: this, that, it, the other one, the second one, the last one;
  - possessives: their, its, his, her, this company's;
  - kind words: deck, data room, team, chat, financials, memo, doc, stuff.
- The resolver scores candidates by being on screen, recency in the conversation, being shown now, having been opened last, and matching the asked-for kind. "This" weighs the screen most; "that" weighs what was just shown or said.
- A clear winner, at least 2 points ahead of the runner-up, opens at once with no network and no model.

**Torn cases.**

- When code is torn, the browser posts the top 2–3 to `/v1/q/navigation/choose`.
- The Q API opens each candidate as the person first (open_page by id; a data-room document through open_company_document).
- Only the ones they may open go on. One left is chosen with no model. Two or three get one `FAST_CLASSIFICATION` call (prompt `NAVIGATION_CHOOSER` v1), capped at 700 ms server-side and 800 ms in the browser.
- With no answer in time, the browser takes its best if its score is at least 4, else shows a one-tap chooser in the modal. It never asks in prose.
- Interim speech ("open their…") prefetches the top candidate's page.

**Permission.** Context never surfaces a document the person can't see, even one that was mentioned:

- the tie-break drops it before the model sees its label, and the chooser offers only what the Q API allowed;
- anything opened from context still loads through the page's or the viewer's own authorised read.
- Tests: `apps/q-api/test/navigation-chooser.test.ts` checks the label never reaches the model; `apps/web/test/context-nav.test.ts` checks what may not be opened never opens or is offered.

| #   | Said (channel, page)                                | Conversation state                           | Resolved by                                        | ms  | Correct | Q runs (typed) |
| --- | --------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- | --- | ------- | -------------- |
| 101 | "open their deck" (typed, feed)                     | Q just talked about Nixo (opened its page)   | code                                               | 34  | yes     | 0              |
| 102 | "show me their data room" (spoken, work)            | Q just talked about Nixo (opened its page)   | code                                               | 30  | yes     | n/a            |
| 103 | "open their team" (typed, feed)                     | Q just talked about Nixo (opened its page)   | code                                               | 37  | yes     | 0              |
| 104 | "open their chat" (typed, work)                     | Q just talked about Nixo (opened its page)   | code                                               | 35  | yes     | 0              |
| 105 | "uh, open their deck" (spoken, feed)                | Q just talked about Nixo (opened its page)   | code                                               | 23  | yes     | n/a            |
| 106 | "open its data room" (spoken, work)                 | Q just talked about Nixo (opened its page)   | code                                               | 26  | yes     | n/a            |
| 107 | "show me the financials" (typed, feed)              | Q just talked about Nixo (opened its page)   | code                                               | 39  | yes     | 0              |
| 108 | "show me that" (typed, feed)                        | one card shown (Halyard)                     | code                                               | 32  | yes     | 0              |
| 109 | "open that one" (spoken, work)                      | one card shown (Halyard)                     | code                                               | 26  | yes     | n/a            |
| 110 | "pull up that deck" (typed, feed)                   | one card shown (Halyard)                     | code                                               | 55  | yes     | 0              |
| 111 | "show me that" (typed, company)                     | one card shown (Halyard)                     | code                                               | 45  | yes     | 0              |
| 112 | "open the second one" (typed, feed)                 | three cards shown (Northwind, Nixo, Halyard) | code                                               | 46  | yes     | 0              |
| 113 | "show me the last one" (spoken, work)               | three cards shown (Northwind, Nixo, Halyard) | code                                               | 29  | yes     | n/a            |
| 114 | "open the first one's deck" (typed, feed)           | three cards shown (Northwind, Nixo, Halyard) | code                                               | 47  | yes     | 0              |
| 115 | "go back to the other one" (typed, company)         | two shown side by side (Northwind, Halyard)  | code                                               | 36  | yes     | 0              |
| 116 | "take me to the other one's deck" (spoken, company) | two shown side by side (Northwind, Halyard)  | code                                               | 24  | yes     | n/a            |
| 117 | "open their stuff" (typed, investors)               | nothing                                      | code                                               | 46  | yes     | 0              |
| 118 | "open their chat" (spoken, investors)               | nothing                                      | code                                               | 22  | yes     | n/a            |
| 119 | "open this one" (typed, investors)                  | Q just talked about Nixo (opened its page)   | code                                               | 33  | yes     | 0              |
| 120 | "open their stuff" (typed, feed)                    | Q just talked about Nixo (opened its page)   | code                                               | 60  | yes     | 0              |
| 121 | "open the memo" (typed, feed)                       | Q just made a memo                           | code                                               | 42  | yes     | 0              |
| 122 | "show me that" (spoken, work)                       | Q just made a memo                           | code                                               | 23  | yes     | n/a            |
| 123 | "open the doc" (typed, company)                     | Q just made a memo                           | code                                               | 53  | yes     | 0              |
| 124 | "open it" (typed, feed)                             | Q opened a document; they closed it          | code                                               | 44  | yes     | 0              |
| 125 | "open their deck" (typed, feed)                     | one answer about both Nixo and Halyard       | small model (1 capped call)                        | 383 | yes     | 0              |
| 126 | "open their deck" (spoken, work)                    | one answer about both Nixo and Halyard       | one-tap chooser                                    | 847 | yes     | n/a            |
| 127 | "open their deck" (typed, feed)                     | one answer about both Nixo and Halyard       | code, after the Q API allowed only Nixo (no model) | 352 | yes     | 0              |
| 128 | "open their deck" (typed, feed)                     | nothing                                      | left to Q                                          | —   | yes     | 1              |
| 129 | "open the second one" (typed, work)                 | nothing                                      | left to Q                                          | —   | yes     | 1              |

**Summary.**

- 29 of 29 resolved correctly.
- 25 by code alone: median 36 ms, range 22–60 ms, no network and no model. One more (#127) was code after the Q API's permission answer, at 352 ms.
- 1 by the small model: 383 ms, including a 300 ms fixture standing in for the hosted call.
- 1 by the one-tap chooser: 847 ms, the 800 ms budget running out.
- 2 rightly left to Q, because nothing in context fits.
- No case moved twice. Typed context requests start no Q run.

## What changed

- **Code-only reader** (`packages/q-specialists/src/instant-request.ts`, subpath `./instant-request`):
  - close, back, forward, scroll, press-by-name, a tab by its visible name, and theme;
  - a document by name (`documentAskOf`), never a page, tab or drawing;
  - `consequentialLabel`: anything that sends, approves, deletes, pays, requests, books, saves or passes is never pressed by code.
- **Browser** (`apps/web/src/features/q/control/instant-acts.ts`):
  - close the topmost thing: Q's modal, then a dialog (through its own close control, else Escape), then the Q-room document, then a room card. Never an `alertdialog`, and never Q's own sheet;
  - back only when a page of this app is behind them; scroll only when there is room;
  - press exactly one visible control with that name, registered first and then any button, tab or link. Never a submit, a disabled control or a control inside a form;
  - anything else goes to Q.
- **Fast path** (`control/fast-navigation.ts`):
  - local acts run first, in the same task;
  - documents come back from the Q API as `DATA_ROOM_DOCUMENT` or `DOCUMENT` and open in the viewer over the current page;
  - the company on screen is sent as input (`companyId`), never as proof;
  - spoken "take me back" is no longer swallowed as a cut-off verb.
- **Typed line** (`use-q-conversation.ts`):
  - a sentence the screen handled starts no run;
  - a document request waits up to 2.5 s for the fast path, then the run starts anyway.
- **Q API** (`apps/q-api/src/composition/fast-navigation.ts`):
  - a document by name goes through `open_page` (DOCUMENT) and `open_company_document`, as the person, under the firewall's plan;
  - exactly one match opens; none, several, or on request leave it to Q, and nothing is returned, so no title leaks;
  - one match in each place is never a guess.
- **One modal on every page** (`control/q-show-modal.tsx`, mounted by `QSessionProvider`):
  - off the Q page, an answer to a fresh question that carries cards, a comparison, a table or chart, or a `SHOW_IN_Q_ROOM` card opens over the page;
  - it closes by its Close button, Escape, an outside click, a pull down on a phone, or "close it";
  - Base UI traps focus and returns it on close; 44 px close target; `--cq-*` tokens only; reduced motion follows the global rule.
- **Q-made documents** now open in the app shell's viewer over the current page instead of navigating to `/documents?open=`. The voice line waits for no route receipt for a document.
- **GPT-Live:**
  - a tab, act or document done by the screen is reported as done at once (`fastActLine`);
  - before, a tab waited the full 6 s for a route receipt and the voice said it was "still loading" after the screen had already moved.

## Modal fixes (coordinator, from the screenshots)

- **Desktop modal sizes to its content.** It is as tall as what it holds, scrolls inside up to the viewport, and is 3xl wide (`DialogViewerContent fit="content"`). A phone keeps the whole-screen sheet.
- **No focus ring on Close unless the keyboard is used.** When opened by a voice, a pointer or the app, focus lands on the dialog itself (`focus="popup"`). Opened by the keyboard, or after Tab, Close gets focus and shows its `:focus-visible` ring. The focus trap and focus return are unchanged.
- **The page behind is clearly held back in dark mode.** A new `--cq-scrim` token (light: 0.55 alpha; dark: 0.82 alpha over near-black, no blur) is used only for this modal (`scrim="strong"`). Other dialogs keep `--cq-overlay`.
- **The e2e asserts all three:** height below the viewport minus 164 px on desktop, no `:focus-visible` on Close at open, and the scrim present. Screenshots are regenerated.

## Not done here / needs others

- **Duplex voice line, routed turns:** the turn still goes to Q's server run after the screen has acted. Scroll and back are code lanes there (0 model). "Close it", "press X" and documents may still call a model, and the answer acts once more on something already done (a no-op). A code lane in `packages/q-specialists/src/answer.ts` for `instantRequestOf` / `documentAskOf` would end that; that file is Lane 4's, and the change has been proposed to them.
- **The data-room viewer** needs its signed read (a server action), so offline the harness shows only that the viewer was opened, not the file. The modal screenshots are of Q's card modal.
- **Language** stays Q's, because the preference is saved server-side.
