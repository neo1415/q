# ADR 0047: Discover v2: the caption scrim's contrast guard and pitch downloads

- Status: Accepted. The founder approved the Discover v2 mockups on 2026-10-04 ("perfect, I love this.. build it"), and the lead decided the open points the same day.
- Amends:
  - the founder feedback of 2026-09-27: "at least 92% scrim under every line" on the phone overlay;
  - spec §9.1–§9.3 (`docs/design/ux-direction-2026-09.md`), on keys and the desktop panel;
  - doc 20 §219, which this ADR applies rather than overrides.
- Implemented: `build/discover-62`.

## Context

The founder's screenshot showed the phone overlay: a near-solid 92% block covering about a third of the pitch, above the bottom navigation. That block existed so text over video kept 4.5:1. The founder asked for:

- the frame to be as open as possible while keeping the buttons and information;
- a progress bar;
- a speed choice;
- a long-press menu;
- downloads the founder controls, including by asking Q;
- proper loading and bad-network states.

## Decision

1. **A lighter caption scrim with a measured floor.**
   - The scrim sits behind the words only: a gradient from transparent down to 62% stage canvas under the first line of text, deepening to 76% at the bottom.
   - Composited over a pure white frame, the 62% floor is about sRGB 0.42, relative luminance 0.145. Stage text at L 0.98 reaches 5.2:1 on it.
   - Secondary caption text is 90% stage text (4.7:1 on the same floor), not the 62% muted token, which would fail (3.2:1).
   - Every line also carries a small dark halo.
   - The rail is one capsule at the same 62% floor rather than a pill per control.
   - The tabs and the sound control sit on the same floor in a 52 px band at the top of the stage.
   - The expanded caption ("more") deepens its scrim to 88%.
   - This supersedes the 92% rule. The guarantee it protected (≥ 4.5:1 on any frame) still holds.
2. **The nav stays solid and the video ends above it.** The 2 px progress bar sits on the seam. It is 4 px when paused and 6 px with a thumb and a time readout while dragged.
3. **The desktop panel follows the app's theme.**
   - The 9:16 stage stays on the stage tokens in both themes, with the rail beside it.
   - The intelligence panel and the sidebar use the app's theme, through `--cq-app-*` aliases computed at `:root`.
   - This amends the 2026-10-03 demo-audit choice of a night sidebar on Discover. The approved mockups show the light panel.
4. **Keys.**
   - ←/→ seek 5 s; `<` and `>` step the speed; `C` toggles captions.
   - J/K stay next/previous (spec §9.3); J/L seek was declined because J already moves the feed.
5. **Speed and the progress bar are client-only.** The speed (0.5–2×) is remembered per device in `localStorage`. Neither is sent anywhere or read as a signal. Viewing is not interest.
6. **Downloads are the founder's choice, per pitch, off by default (doc 20 §219).**
   - **Storage:** `media.media_assets.downloadable` (migration `20261205090000`), founder pitch only. The table stays server-only.
   - **Who sets it:** the owner (`media.manage`), versioned and audited (`media.asset.downloadable_set`).
   - **Q:** Q sets it through the existing `pitch.details.set` declaration (`set_pitch_sharing`, ADR 0040, CONSEQUENTIAL). Q prepares it and the founder approves a card that says copies already saved cannot be recalled. There is no new tool: the offered tool set is at its `MODEL_TOOLS_MAX` bound.
   - **Download:** `GET …/pitch/:mediaAssetId/download` decides on every request: the playback rule first, then the owner's permission (the owner may always save their own). Every refusal is the same not-found.
   - **The link:** a Cloudflare Stream MP4 (`POST /stream/:uid/downloads`), under a short-lived token that carries `downloadable: true`. Playback tokens never carry that claim. The browser fetches the file from the CDN; no byte passes through Capital Q.
7. **"No pitch to show yet"** is the wording wherever the API cannot say whether a pitch exists and is withheld. Unknown stays unknown.
8. **No Report** in the options until a report contract exists.

## Consequences

- The picture is visible behind the caption, and text keeps AA on the worst frame by construction rather than by luck. A test asserts the `--cq-feed-scrim-floor` value is not lowered without revisiting this ADR's arithmetic.
- The download link is a secret for one viewer. It is never logged or stored, and never placed in an event, audit record, analytics or ranking input.
- The download decision is recorded in the audit trail only.
