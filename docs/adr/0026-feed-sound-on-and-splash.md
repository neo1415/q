# ADR 0026: Discover plays with sound, after a cold-start splash

Status: Accepted (2026-09-29, founder direction)
Amends: CLAUDE.md "Feed and media" ("One active player, muted, playsinline"); doc 20 muted-autoplay default

## Context

The founder: Discover "should be blasting out loud" and start "immediately the
splash screen is done, like TikTok". The locked rule started every pitch muted.
The founder also supplied a cold-start splash (particle Q, 4.8 s formation).

## Decision

- Pitches play with sound by default. Browsers refuse sound before the person's
  first gesture; the player then plays muted and turns the sound on at the first
  tap or key anywhere, unless the person muted it. The sound control shows what
  they actually hear.
- Reduced motion is unchanged (ADR-001 D5): no automatic playback, poster plus
  explicit Play, and audio off until they enable it.
- One active player and `playsinline` still hold.
- A cold-start splash shows once per browser session (every home-screen launch
  of the installed app), over whichever page opened, including sign-in. It never
  shows on OAuth returns, public cards or share links, and never on internal
  navigation. The app loads underneath at the same time; a tap or key skips it.
  Discover holds the first pitch until the splash leaves, then plays it. Skipping
  the splash by tapping it also gives the browser the gesture it needs for sound.
- The installed app's OS launch screen uses the splash's navy, so the two read
  as one.

## Consequences

The first pitch after a cold start may play muted until the first tap on
browsers that block audible autoplay; that is the browser's rule, not ours.
