/**
 * One active player per page (CLAUDE.md feed and media rules; R36).
 *
 * The Discover controller already keeps one card ACTIVE. Everywhere else a
 * pitch can be played on request (the founder's Pitch & media page, a
 * preview beside the current pitch), and two requests would otherwise mean
 * two videos talking over each other. So every player claims the page when
 * it starts, and the claim pauses whichever one held it before. This is
 * the whole mechanism: no player decides for itself that another may keep
 * going.
 */

/** All a claim needs of a media element: whether it runs, and a stop. */
export type PlayableMedia = Pick<HTMLMediaElement, "paused" | "pause">;

let active: PlayableMedia | null = null;

/** Called from a player's `play` event: this one is now the only one. */
export function claimActivePlayer(media: PlayableMedia): void {
  if (active !== null && active !== media && !active.paused) {
    active.pause();
  }
  active = media;
}

/** Called when a player unmounts, so a detached element is not kept. */
export function releaseActivePlayer(media: PlayableMedia): void {
  if (active === media) active = null;
}
