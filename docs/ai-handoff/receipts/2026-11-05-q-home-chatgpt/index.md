# Q home like ChatGPT — receipts (2026-11-05)

Branch `fix/q-home-chatgpt` (from `fix/resume-asking-cv9ru3`). These come from the `/dev/q-nav?connected=1` harness, which renders the real `QConversationPanel` without the app shell. Nothing reaches Q or a provider. The "before" shots still show the harness strip at the top, and the old home's composer sat below the fold there. The "after" shots hide the strip.

Each set has four sizes: 1440×900 and 390×844, each in light and dark.

| State                             | Before                          | After                          |
| --------------------------------- | ------------------------------- | ------------------------------ |
| Empty home                        | `before-empty-<w>-<scheme>.png` | `after-empty-<w>-<scheme>.png` |
| Text typed (round Q becomes Send) | —                               | `after-typed-<w>-<scheme>.png` |
| After the first send, Chat view   | `before-chat-<w>-<scheme>.png`  | `after-sent-<w>-<scheme>.png`  |

## What changed

- **No large Q presence.** The particle "Q" field and the corner presence are gone from the Q home, in both the Q and Chat views. The aperture and presence code stay in their own modules. The Q view still shows its state line ("Listening", "Speaking"), captions and End.
- **The empty state** has three parts:
  - one greeting line ("What's on your mind today, David?");
  - the composer, centred;
  - at most three starter rows, each an icon and a line. Whatever waits on the person comes first (finish setup, verify), then the suggested questions.

  The Talk to Q button, stage line, RoomBelow, QNow and the arrival cards are no longer shown in the empty state.

- **After the first send,** the greeting and starters disappear and the composer moves to the foot of the thread. The person's messages are right-aligned bubbles and Q's answers sit on the left. This is unchanged from the existing thread.
- **Composer** (`QComposer variant="pill"`, opt-in, so other surfaces are unchanged):
  - a rounded pill, 768px max wide;
  - "+" (attach) at the leading edge and the placeholder "Ask Q";
  - one round trailing button: a gold **Q** ("Talk to Q", the existing `talk()`) while the field is empty, and a gold arrow ("Send") once there is text. Both are 44px.
- **Q | Chat** is now a sliding pill switch. It keeps `role="group"` and `aria-pressed`, the thumb moves with a CSS transform, and the motion is off under `prefers-reduced-motion`.
- **Top line** has the switch in the centre. On the right are icon-only Board (with its count), Conversations, and **More** (⋯), which holds Q's voice, Read answers aloud, Captions and Transcript. The scope chip (`ContextIndicator`) and `QCanSee` are removed from it.
- **Verify nudge:** on the Q home the shell's desktop "Verify you and …" row is hidden (CSS `:has(.cq-q-home)`). It now appears as a starter row instead. Every other page is unchanged.

## What was kept

- Tokens only, with the gold coming from the primary-action and accent tokens. There are no gradients, glows or backdrop blur.
- The 4 Nov neutral themes.
- Q's spoken welcome line (`welcomeLine` / `welcomeLead`) and the first-run choice. For a first-time person the greeting is "Are you here to raise capital, or to invest it?", with "Raising capital" and "Investing" as the starters.
