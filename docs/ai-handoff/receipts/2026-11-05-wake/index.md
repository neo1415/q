# “Hey Q” reliability and the corner button — 2026-11-05 (`fix/wake-reliability`)

Local `next dev` with provider keys set to `disabled-locally-000000000000`. Page: `/dev/explore` (fictional fixtures, real shell). Chromium used a fake microphone (`--use-fake-device-for-media-stream`) and had `cq.q.wake=on`. The script is in `shot.mjs.txt`.

| Width | Button (CSS px)   | Accessible name                                              | After Pause  |
| ----- | ----------------- | ------------------------------------------------------------ | ------------ |
| 1440  | 44×44 at 1380,776 | Listening for “Hey Q” · checking with browser speech service | 0 indicators |
| 390   | 44×44 at 330,720  | Listening for “Hey Q” · checking with browser speech service | 0 indicators |

The fake device plays a tone, so the gate opened and the button said “checking”. That is the honest HEARING state.

- `listening-*.png`: the button sits bottom inline-end, above the Q dock's bottom slot. It is not a banner.
- `popover-*.png`: tapping it shows the words, Pause and Turn off.
- `paused-*.png`: after Pause the corner is empty. Resume is in Settings → Q and in the Q room's microphone area.
