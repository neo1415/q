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
