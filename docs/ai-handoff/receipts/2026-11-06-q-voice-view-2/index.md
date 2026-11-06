# Q view round 2: choosing Q talks, specific greeting, no work panel on Home — receipts (2026-11-06)

Branch `fix/q-voice-view-2` (from `fix/resume-asking-cv9ru3` @ `309143f51`, which already contains `590b62d`). This round answers the owner's feedback on the Q view.

The screenshots come from the dev harness `/dev/q-nav?connected=1&shell=1`, with the harness strip hidden. Nothing reaches Q, the database or a provider. Each shot was taken like this:

1. Store the Q view (`cq.q.view = presence`).
2. Type "Where are we with Brightwell?" and press Enter, so the panel holds a conversation.
3. Take the Q shot.
4. Switch to Chat and take the Chat shot.

The harness has no Q behind it, so nothing answers and the words stay in the composer. The "before" shots use `q-conversation.tsx` and `globals.css` from `0a13cb2`, which is what production ran before `590b62d`, in the same harness.

| State                                      | Before                                      | After                                      |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| In a conversation, Q view (the `?c=` case) | `before-conversation-q-<w>-<scheme>.png`    | `after-conversation-q-<w>-<scheme>.png`    |
| The same conversation, Chat view           | `before-conversation-chat-<w>-<scheme>.png` | `after-conversation-chat-<w>-<scheme>.png` |

The sizes are 1440×900 and 390×844, each in light and dark. Measured in the page, for all four sizes:

- **Before:** the Q view had no aperture in the conversation's stage (`[data-q-presence='stage'] [data-q-aperture]` missing). This matches the owner's production screenshot.
- **After:** the aperture is there. The Chat view has none, and the person's words are in both views.

A component test also renders the panel with a `conversationId` and a stored Q view, and asserts that the aperture is on the stage. A real `/home?c=<id>` needs a signed-in session, so it belongs to the integration owner's live check.

## What changed

1. **No "Q is working on N things" panel on Home.**
   - `home-screen.tsx` no longer mounts `<WorkPanel variant="home" />`. Its `headed` flag only gated that panel, so it is gone too.
   - `WorkPanel` itself is unchanged. Running work stays on the Board (its count is on the top line) and on `/work`.
   - `test/home-no-work-panel.test.ts` guards this. The harness doesn't render `HomeScreen`, so there is no screenshot of this item.
2. **Choosing Q starts voice.**
   - A click on the Q side of the switch calls the existing `talk()` in the same gesture. The click is the person's own action, which satisfies QO-46. Q speaks first with the opener.
   - The same click while already in Q starts nothing new.
   - A stored Q choice with no click opens ready, with the mic shut and **Talk to Q** shown. Talk to Q is also the way back when the mic was refused.
   - Leaving for Chat still ends the line the way End does. The composer's Q button is unchanged: it switches to Q and calls `talk()`.
3. **The greeting names what is waiting.**
   - The existing opener (`briefing/opener.ts`, `openerOf`) builds the line Q says first. It feeds `arrivalWords().spoken`, then `arrivalSpoken()`, then `welcomeNow()`, then `talk()`. There is no second greeting path.
   - Its count sentence now names the items, for example: "Two things need you: approve the reply to Brightwell and checking Q's reading of your deck."
   - At most three items are named, then "and N more". It never says a bare "N things waiting".
   - The phrases come only from the `ArrivalData` the stage already holds, in the order `pendingCount` counts them:
     - decision cards, by counterpart: "approve the reply to X", or "a message to X that Q held back";
     - attention lines, by their own titles;
     - new matches: "Kora Health is a new match";
     - Q's questions;
     - "finishing your setup";
     - "checking Q's reading of your deck".
   - There is no new read, and no web or search call. A test asserts that the named weights add up to `pendingCount`.
   - A source that could not be read makes it "At least three things need you: …". Unknown is not zero.
   - With nothing waiting, it is the greeting plus "What would you like to look at?" (unchanged).
   - "What are they?" is already one of the opener's look-now answers (`SHOW_PHRASES`). On a line, `tellLineOpenerAnswer("SHOW")` gives the voice the held briefing (`arrivalBriefingWords()`), so Q answers from the same list straight away, without searching. A test pins `readOpenerReply("What are they?") === "SHOW"`.
   - This replaces the 2026-10-16 rule "never the list" in the opener's header comment. The owner's newer direction wins.
4. **The presence in a conversation.** See the shots and the test above.

## Known limitation

The Arabic opener (`arrival-ar.ts`, `arabicOpener`) still says a hand-composed count with Arabic number agreement, not the named list. Naming the items in Arabic needs hand-written Arabic phrases for each kind of item. That is a follow-up for the Arabic lane, so as not to ship English fragments in an Arabic sentence.

No new `t()` strings were added; the opener's words are spoken, and the Arabic composer handles Arabic.

## Tests

- **New:**
  - `test/home-no-work-panel.test.ts` (1).
  - In `test/arrival-opener.test.tsx`, "what waits, named": four tests covering "and N more", a held message, weights equal to the count, and "What are they?".
  - In `test/q-voice-view.test.tsx`:
    - the switch's Q click starts `talk()`;
    - a stored Q choice opens ready without the mic;
    - choosing Q again starts nothing;
    - `?c=` keeps the presence.
- **Failing-first** against the base `src`: 9 failed, 35 passed across the three files.
  - The `?c=` test passes on the base too, because `590b62d` is already merged there.
- **Updated honestly to the new words:**
  - `arrival-opener.test.tsx`: the names replace "You have 3 things waiting".
  - `arrival-opener-setup.test.tsx`: "One thing needs you: finishing your setup."
  - `arrival-briefing.test.ts`: the opener now names, and the full summary is still kept for when they look.

## Gates (2026-11-06, exact results)

- `pnpm exec turbo run build --filter=./packages/*`: exit 0. There were 54 tasks, 37 of them cached.
  - It was re-run after `309143f`, because the first container build predates that merge.
  - The first root tsc failed (exit 2) in `model-gateway` and `q-specialists`, on a stale `q-core` `dist` (`TurnSkimV11ResultSchema`). The rebuild fixed it.
- Root tsc `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: exit 0.
- Web tsc (`apps/web`, `tsc --noEmit -p tsconfig.json`): exit 0.
- eslint on the 8 touched TS/TSX files (`NODE_OPTIONS=--max-old-space-size=6144`): exit 0, with no findings.
- Full web vitest (`vitest run apps/web`): 466 files and 4055 tests passed, exit 0.
  - That includes `back-everywhere` (87), `destination-routes` (52) and `manifest-page-coverage` (3).
  - There is no `app-routes` test file; `control/app-routes.ts` is covered through the tests that use it.
- `prettier --check` on `apps/web` and this receipt: clean.

## Addendum: Chat is voice fully off (owner 2026-11-06, commit `067ff5b`)

Switching to Chat mirrors switching to Q. Whenever Chat shows, one effect in `q-conversation.tsx` acts. That covers the switch, a stored choice, and arriving on Chat by navigation with a line still open. It does three things:

- **Ends the line** the way End does (`voice.end("user")`). That closes it, and the line's own close stops every microphone track:
  - `duplex-line.ts` and `live-call.ts`; `voice-duplex.test.tsx` already asserts `track.stop`.
  - The interview's `end()` clears any pending reconnect.
- **Stops Q's speech** mid-sentence (`useQSpeech().stop`) on arrival at Chat.
- **Ends any line that comes up while Chat shows,** so nothing reconnects on Chat, and `talk()` is never called from there.

Also in this commit:

- **ElevenLabs permission probe.** It used to leave its `getUserMedia` stream open until garbage collection, so the microphone light stayed on. `probeMicrophone()` now stops every track it opened.
- **"Hey Q".** The view store moved to `q/stage-view.ts`. The wake word now calls `showQVoiceView()` before it talks, on the Q page or the one it opens. Voice means the Q view, so Chat never ends a line the person asked for by name.
- **Scope.** Navigating away from the Q page during a call is unchanged. A call can follow Q-driven navigation across pages (`destinations.ts`), so "navigation away" is read as arriving on Chat, and is handled there.
- **Wake listener.** The "Hey Q" listener itself keeps its microphone while that setting is on. It is the person's own app-wide setting, not the Q line.

### Tests

- In `q-voice-view.test.tsx`, "Chat is voice off" (3 tests):
  - the switch ends the line and stops speech;
  - arriving on Chat with a line open ends it;
  - a line coming up on Chat is ended, and `talk()` is not called.
- `voice-off-microphone.test.ts` (2 tests):
  - the probe stops every track;
  - a wake chooses the voice view.
- **Failing-first** against `24ee53c`'s `src`:
  - the two Chat-arrival and no-re-arm tests failed;
  - the probe and wake file could not load, because neither export existed;
  - "the switch stops speech" already passed there.

### Gates (exact results)

- Root tsc: exit 0.
- Web tsc: exit 0.
- eslint on the 6 touched TS/TSX files (`NODE_OPTIONS=--max-old-space-size=6144`): exit 0.
- Full web vitest: 467 files and 4060 tests passed, exit 0.
  - That includes `back-everywhere` (87), `destination-routes` (52) and `manifest-page-coverage` (3).
- `prettier --check apps/web`: clean.

## Addendum 2: in a conversation, the Q view is the voice room (owner 2026-11-06, live defect)

The live defect: on `/home?c=…` the Q view looked like Chat, a full transcript with cards, and the presence was scrolled out of view. The owner asked: "is the presence only there on first login?".

**Now, in a conversation:**

- **Q's presence is the stage.** It is pinned (`.cq-voice-room-presence`, sticky at the top of the stage with the stage's own field behind it) and centred. It is 280 px at desktop width and 200 px on a phone, and decorative (`aria-hidden`), with the state line under it.
- **Only the current exchange sits under it** (`q-current-exchange.tsx`):
  - the person's last line (2 lines at most);
  - Q's latest reply as a caption, in plain words (3 lines at most). On a live line it is what Q is saying now.
  - Q's cards, one line each ("Name · line"), four at most, then "See all in Chat". Every card line, and "Earlier in this conversation", opens Chat.
- **Chat keeps the whole transcript, the cards and the lists,** as before.
- **Unchanged:** one thread and one `talk()`. Talk to Q, End, the work lines, and the approval waiting on them (QNow) all stay.
- **Nothing follows the newest words in the Q view;** it rests at Q's presence. Chat follows them as before.
- **`QPresenceStage` is no longer mounted in the conversation's Q view** (it is unchanged, and still used by the dev rooms). Its stage objects are no longer drawn there: the cards canvas, room documents and live previews, and the flight to the Board. They are Chat's now, as asked.

  **Flag for the owner:** during a live call, Q naming a company used to put its card up on the stage. In the Q view that card is now a one-line entry. Whether that fits the Q Pitch script's live-card moments is a call for the owner.

- **Harness:** `/dev/q-nav?c=demo` holds a live-shaped conversation through `QSessionTurnsOverride`, a dev-only override of the session's turns that the app never mounts. The conversation has 12 turns and ends in discovery cards, using the harness's own `demoTop(5)` card fixtures.

New strings, with Arabic in `sweep.ts`, are "See all in Chat" and "Cards in this answer". `generate-ui-text-source` regenerated them: 6524 strings, 0 Arabic gaps.

### The `?c=` proof

| View                    | Before (`1501a54`)                          | After                                      |
| ----------------------- | ------------------------------------------- | ------------------------------------------ |
| Q, 12-turn conversation | `before-conversation-q-<w>-<scheme>.png`    | `after-conversation-q-<w>-<scheme>.png`    |
| Chat, same conversation | `before-conversation-chat-<w>-<scheme>.png` | `after-conversation-chat-<w>-<scheme>.png` |

These replace the earlier two-line conversation shots of the same names.

Measured in the page, with no scrolling:

- **Before:** in the Q view, no aperture taller than 100 px inside the viewport. A thread was drawn.
- **After:** the aperture is fully in view, 280 px at 1440 and 200 px at 390, in light and dark. There is no thread. There are 4 card lines, the body's `scrollTop` is 0, and no earlier turn is on screen.
- **Chat, after:** the whole transcript is there, from the first question to the cards.

### Tests

- In `q-voice-view.test.tsx` (14 tests in all), "the Q view in a conversation is the voice room" (2 tests):
  - the presence is pinned and first in the room;
  - there is no thread and no earlier turn;
  - the person's line and Q's caption are shown;
  - there are 4 card lines plus "See all in Chat";
  - a card line opens Chat, which has the whole transcript and the cards.
- **Failing-first** against `1501a54`'s panel: both failed, and the other 12 passed.

### Gates (exact results)

- Package build: exit 0. There were 54 tasks, 41 of them cached.
- Root tsc: exit 0.
- Web tsc: exit 0.
- eslint on the 7 touched files: exit 0.
- Full web vitest: 467 files and 4062 tests passed, exit 0.
  - That includes `back-everywhere`, `destination-routes` and `manifest-page-coverage`.
- `packages/q-core` vitest: 149 files passed and 1 skipped; 841 tests passed and 1 skipped.
- prettier: clean.

## Addendum 3: one conversation, so voice carries on (owner 2026-11-06)

1. **The arrival greeting only opens an empty thread.** In the panel's `talk()`, a thread with turns (typed in Chat or said earlier) no longer gets the arrival words. That applies to the switch, the composer's Q button and Talk to Q alike. The fallback in `q-session.talk()` (`callOpening()`, the briefing) is only reached when the panel hands no line. With turns, the panel now always hands one.
2. **Q's first words continue the thread** (`continuation.ts`, `continuationLine`). They are built deterministically from the turns the page holds:
   - after an answer with cards: "You'd asked “Find me founders raising in fintech right now”, and I found five. Want me to go through them, or something else?";
   - after an answer in words: "We were on “What's Brightwell's runway”. Want to pick up from there, or something else?";
   - when Q had not answered yet: "You'd asked “…”. Want me to carry on with that, or something else?".

   The person's words are said back at most 90 characters long, cut at a word. There is no waiting-count tail, because the client can't tell what arrived since the last turn without a new read, so none is added.

3. **Same conversation id. This was already true, and is now covered further:**
   - `q-session.talk()` opens the line with `resume: true` and `thread.conversationId` set to the open conversation. `voice-resume-conversation.test.tsx` already asserts both, and that no arrival greeting is sent.
   - With a greeting line from the panel, the line still resumes. The server composes no opening on a resumed line (`apps/q-api/src/voice/routes.ts`), and Q says the panel's line.
   - Spoken lines join Chat's transcript through `spokenOnly` and `threadInOrder`. There is a new test for this.

### What was found about a model-written opener

The owner preferred an opener written by Q itself, about 1.5 s, from `q_runtime.conversation_states`. It is not possible today without a server change:

- On `resume`, the q-api voice session route deliberately composes no opening, and the browser has no read of the conversation state.
- Adding one means a new step in `apps/q-api/src/voice/routes.ts` (resume branch). It would read the conversation state through q-runtime's repositories and run one bounded model call through the Q Model Gateway, with a timeout of about 1.5 s. This deterministic line would be the fallback.
- That is a server lane: q-runtime, the model gateway and q-api. It is outside this UI lane, which may not touch q-runtime or the model gateway. It is proposed to the integration owner, not built.

### Tests

- **New:** `test/q-voice-continuation.test.ts` (6 tests):
  - empty means null;
  - cards are named with a count;
  - an answer in words is picked up;
  - an unanswered question offers to carry on;
  - long words are cut at a word;
  - there is never a waiting count or welcome.
- **New, in `q-voice-view.test.tsx`:**
  - mid-conversation, the switch speaks the continuation, with no "Welcome back" and no waiting count;
  - an empty thread still opens with the arrival greeting;
  - voice lines appear in Chat's transcript.
- **Failing-first** against the previous panel (`19777b9`): the mid-conversation test failed (it had no line); the others passed there. The empty-thread test and the voice-in-Chat test check behaviour that already existed.

### Gates (exact results)

- Root tsc: exit 0.
- Web tsc: exit 0.
- eslint on the 4 touched files: exit 0, with no findings. The first run warned on `talk()`'s dependency list; it now lists `turns` and `spoken`.
- Full web vitest, re-run after that fix: 468 files and 4071 tests passed, exit 0.
- `prettier --check apps/web`: clean.

## Addendum 4: the duplex microphone after Chat, and full cards in the Q view (owner 2026-11-06)

### The microphone a stuck duplex line kept

**Live finding** (the integration owner's run on `d3829431a`, with UDP blocked): after switching to Chat, a track opened by `duplex-line.ts` `open()` was still live.

**Cause:** the line itself was sound. Its fallback and close (`#finish`) stop every track. The problem was above it, in two places:

1. `use-voice-interview` `end()` closed the transports only through `endVoiceLine`, which waits for any open still in progress (the voice-line exclusive queue). A duplex line stuck connecting held its stream until its timeouts and its rejoin attempt ran out.
2. `use-voice-session` `start()`, once ended mid-duplex, could still bring up the standard line after the duplex line gave up.

**Fix:**

1. `end()` now ends this surface's own transports at once, and again after any open in progress. Both are idempotent.
2. `start()` opens no standard line after an End.

**Tests:**

- `voice-off-line-mid-connect.test.ts` (2 tests): a failed connect falls back and stops the track; a close mid-connect stops it at once.
- `voice-off-session-mid-start.test.tsx` (1 test): ending mid-duplex-start opens no standard line.
- `voice-off-interview-mid-open.test.tsx` (1 test): End reaches the transport while the open is still in flight.
- **Failing-first** against the previous hooks: the session test and the interview test failed. The two line tests passed, which confirms the line was already correct.

### Full cards in the conversation's Q view (owner decision)

This replaces addendum 2's one-line cards.

- **Kept:** the pinned presence (280 / 200 px) and the current exchange (their last line and Q's caption).
- **Under them:** `QPresenceStage` again, so the answer's cards are drawn in full. Its stage objects work again: the cards canvas, room documents, live previews and the flight to the Board. A company Q names on a live call appears as a full card.
- **One presence:** the stage draws no presence of its own; the pinned one stays.
- **Unchanged:** earlier turns are still Chat's.
- **CSS:** the pinned presence is above the cards scrolling under it (`z-index: var(--cq-z-sticky)`), and its field reaches past the column by the stage's gutter. That is 20 px on a phone and 32 px from 640 px, so there is no sideways scroll; measured, the stage's `scrollWidth` equals its `clientWidth` at both widths.

### The `?c=demo` proof, updated

`after-conversation-q-*` and the new `after-conversation-q-scrolled-*` cover 1440 and 390, light and dark.

- **At rest:** the presence is fully in view (280 / 200 px). All four card names are drawn in full, there are no card lines, there is no thread, and no earlier turn is shown.
- **Scrolled to the end of the cards:** the presence stays pinned at the top (y = 72 to 352 at 1440, 73 to 273 at 390) and above the cards.
- **Before:** `before-conversation-q-*` is unchanged (`1501a54`), with no presence in view.

### Tests in `q-voice-view.test.tsx`, updated honestly

- "Pins Q's presence and shows the current exchange with its cards in full": one aperture only, no thread, no earlier turns, every card name drawn, and no card lines.
- "Earlier in this conversation opens Chat, where the whole transcript is."

### Restored after a review of the full diff against `1501a54`

- **The G-R3 screen-reader rows** of the current exchange (`Latest exchange`, with `data-q-turn-id`, `data-q-turn-role` and `data-q-disposition`). `scripts/recovery/voice/play-clips.mjs` counts the USER rows. The visible exchange words are `aria-hidden` there, so nothing is read twice; its buttons stay reachable.
- **The pinned work lines** for documents still being made, in the non-voice caption.
- **The written-answer note** to an open line (`briefLine`), back to its plain call. An earlier splice had appended a stray expression to it. The call still ran, so behaviour was unchanged, but eslint caught it (`no-unused-expressions`). It is fixed in `e4cb224`.

The screenshots were taken at `bbc24c3`. These restorations add only an `sr-only` list and an empty-hidden work-line slot, so the shots are unchanged.

### Gates (exact results, at `e4cb224`)

- Root tsc: exit 0.
- Web tsc: exit 0.
- eslint on the 10 touched files: exit 0, with no findings.
- Full web vitest: 471 files and 4075 tests passed, exit 0.
  - That includes `back-everywhere` (87), `destination-routes` (52) and `manifest-page-coverage` (3).
- `prettier --check apps/web` and the receipt: clean.
