# Chat by default, Q as the voice view — receipts (2026-11-06)

Branch `fix/q-chat-default-voice-presence` (from `origin/fix/resume-asking-cv9ru3` @ `0a13cb2`). The owner's words: "the Q and Chat views look the same now. In ChatGPT, when you start voice the interface changes."

The screenshots come from the dev harness `/dev/q-nav?connected=1&shell=1`, with the harness strip hidden. Nothing reaches Q, the database or a provider. The "before" shots use the base commit's `q-conversation.tsx` and `globals.css` in the same harness. Each view was set through the stored choice `cq.q.view`.

| View      | Before                         | After                         |
| --------- | ------------------------------ | ----------------------------- |
| Chat      | `before-chat-<w>-<scheme>.png` | `after-chat-<w>-<scheme>.png` |
| Q (voice) | `before-q-<w>-<scheme>.png`    | `after-q-<w>-<scheme>.png`    |

The sizes are 1440×900 and 390×844, each in light and dark. Measured in the harness:

- **Before:** the Q view had no `[data-q-room-presence]` at either width.
- **After:** the Q view has it, 360 px tall at 1440 and 240 px at 390. The Chat view has none.

## What changed

1. **Chat is the default view.** With no stored choice, every width now opens on Chat. Before, a desktop opened on Q and a phone on Chat. A stored choice still wins. The server snapshot is `"chat"` as well, so the first paint matches. The in-memory fallback is now used only when storage is unavailable (private mode).
2. **Q is the voice view.** This restores the pre-789a1ecbd presence in `q-conversation.tsx`:
   - **Before the first word:** `ArrivalRoom` holds the room presence: `QAperture` with `room`, in `.cq-room-presence`, with `data-q-room-presence` set to `field` or `gathered`, fitted by `fitRoomPresence`. When the room has cards beside Q, it is the `filled` variant instead. Under it are the state line ("Listening", "Speaking") and `StageLine`. Then come the **Talk to Q** button (`.cq-room-talk`), `WakeResume` and `RoomBelow`. The composer sits at the foot, with Mute and End while a line is open.
   - **During a conversation:** `QPresenceStage` draws `QAperture` again: 200 px on the stage, 64 px compact and 44 px mini. Captions are unchanged.
   - The phone rule in `globals.css` that hid `[data-q-room-presence]` below 1024 px is gone, because the presence is the point of the Q view. The lumen and corner-mark hiding is kept.
3. **One brain, one conversation.** Both views read the same `useQSession()` turns and the same `talk()`, and there is no new voice path. A test switches views with the same thread and finds the person's words in both.
4. **Starting voice.**
   - The composer's gold **Q** button ("Talk to Q") switches to the Q view and calls the existing `talk()` in the same click. It is a user gesture, so a mic permission prompt is fine.
   - Switching to Q with the Q | Chat switch shows the presence **ready to talk**. Listening starts when they tap the **Talk to Q** button under the presence. That is the pre-change behaviour: the 2026-10-19 voice room had the same `.cq-room-talk` button calling the same `talk()`. It also keeps QO-46: the microphone never opens unless the person acts.
   - Leaving Q for Chat while a line is open calls the existing End (`voice.end("user")`). The words stay in the thread.
5. **Reduced motion.** `QAperture` already follows `useQMotion`, so under `prefers-reduced-motion` Full becomes **Calm**: a still light with no automatic motion. A test asserts `data-motion="calm"` on the room presence.
   - **Accessibility:** the presence wrappers are `aria-hidden` (decorative), because the state is given in words. The switch keeps `role="group"` and `aria-pressed`. Talk to Q and the composer's Q button are 44 px or more.
6. **Kept from the tidy:** one phone top bar, the message actions menu, and the cards controls in More. `q-home-tidy.test.tsx` passes 7 of 7.

There are no new strings. "Talk to Q" and "Opening your conversation…" are already in the catalog.

## Tests

- **New:** `apps/web/test/q-voice-view.test.tsx`, 7 tests:
  - the default is Chat;
  - a stored choice wins;
  - the Q view shows the room presence, and Chat doesn't;
  - the composer's Q button switches to Q and calls `talk()`;
  - the thread is shared across the switch;
  - leaving Q ends voice;
  - reduced motion gives a still presence.

  Against the base `q-conversation.tsx` and `globals.css`, 6 failed and 1 passed. The test that passed is "a stored choice still wins", which is a guard. The reduced-motion test was tightened to require the aperture, so it no longer passes vacuously. After the change, 7 of 7 pass.

- **Updated honestly:**
  - `q-home-chatgpt.test.tsx`: the switch starts on Chat. The round Q button now also moves to the Q view.
  - `home-fold.test.tsx`: the Q view draws the room fitted again, where before it asserted the room was absent.

## Gates (2026-11-06, exact results)

- `pnpm exec turbo run build --filter=./packages/*`: exit 0. There were 54 tasks, none of them cached (fresh container).
- Root tsc `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: exit 0.
- Web tsc (`apps/web`, `tsc --noEmit -p tsconfig.json`): exit 0.
- eslint on the 4 touched TS/TSX files (`NODE_OPTIONS=--max-old-space-size=6144`): exit 0, with no findings.
- Full web vitest (`vitest run apps/web`): 465 files and 4048 tests passed, exit 0.
  - That includes `back-everywhere` (87), `destination-routes` (52) and `manifest-page-coverage` (3).
  - It also includes the `control/app-routes` consumers.
- `prettier --check apps/web` and this receipt: clean.
