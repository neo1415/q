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
