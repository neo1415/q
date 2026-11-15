/**
 * Live 2026-10-31 (Discover at 390): an AI-presented pitch carries its
 * label burned into the video's own lower third, which sits where the
 * caption does, so the label ran through the company's name. The label
 * is said by the app, in the caption's flow above the name, from the
 * provenance recorded with the video (its title names the AI presenter);
 * the caption's scrim then holds the frame's own text beneath it.
 */
export function aiPresenterLine(
  pitchTitle: string | null | undefined,
): string | null {
  return pitchTitle != null && /\bAI[- ]present(?:er|ed)\b/iu.test(pitchTitle)
    ? "AI presenter · AI-generated"
    : null;
}

/**
 * Where an AI-presented pitch's burned-in lower third begins, in percent
 * of the picture's height (sweep of 2026-11-05: the label row starts at
 * ~78%, the title bar runs ~82–94%). Our caption cues end above it, so
 * they never sit on the presenter's name, company and founder line.
 */
export const BURNED_TITLE_TOP = 77;

/** The title-safe top for a pitch, or null when its picture has no title. */
export function burnedTitleTop(
  pitchTitle: string | null | undefined,
): number | null {
  return aiPresenterLine(pitchTitle) === null ? null : BURNED_TITLE_TOP;
}

/**
 * Live 2026-11-15 (Discover at 1440, Watchly): a stage wider than the
 * portrait pitch crops its top and bottom (object-fit: cover), which put
 * the presenter's burned-in label row at the stage's very foot: a second,
 * larger "AI presenter · AI-generated" under the app's own line. Where the
 * crop is deep enough, the picture is shifted up just far enough that the
 * burned band falls outside the stage, so the label is said once, by the
 * app. Returns the object-position's vertical percent, or null when the
 * band cannot be cropped away (a phone's full-height pitch keeps it, with
 * the words lifted above it).
 */
export function burnedTitleCropY(input: {
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Where the burned band begins, in percent of the picture's height. */
  readonly titleTop: number | null;
}): number | null {
  const { boxWidth, boxHeight, frameWidth, frameHeight, titleTop } = input;
  if (
    titleTop === null ||
    boxWidth <= 0 ||
    boxHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return null;
  }
  const scale = Math.max(boxWidth / frameWidth, boxHeight / frameHeight);
  // The share of the picture's height the stage shows.
  const shown = boxHeight / (frameHeight * scale);
  // A small margin above the band, so its antialiased edge stays out too.
  const limit = (titleTop - 2) / 100;
  if (shown >= 1 || shown > limit) return null;
  const position = Math.min(0.5, (limit - shown) / (1 - shown));
  return Math.floor(Math.max(0, position) * 1000) / 10;
}
