import { circlePath, isPictogram, pictogramPaths } from "./figure-library";
import type { PresenceFigureId } from "./presence-cue";

/**
 * A cued figure drawn still (Q Story S4): what reduced motion shows
 * instead of the particles flowing into it, and what a presence whose
 * canvas cannot draw shows at all. The same paths the particles are
 * sampled from (figure-library.ts), in Q's own colour, so the figure is
 * the same one either way. Decorative: what Q says carries the meaning.
 */

/** Frame units the canvas spans either side of centre (presence-figures.ts). */
const FRAME_HALF = 1.15;
/** Frame units per grid unit (figure-library.ts). */
const FRAME_PER_UNIT = 0.075;
const HALF = FRAME_HALF / FRAME_PER_UNIT;
const VIEW_BOX = `${12 - HALF} ${12 - HALF} ${HALF * 2} ${HALF * 2}`;

/** The letter Q as the mark draws it: a heavy ring and a square tail. */
const LETTER_Q_PATHS = [circlePath(11.3, 11.3, 7.3), "M14.5 14.5 L19.6 19.6"];

export function stillPaths(figure: PresenceFigureId): readonly string[] {
  return isPictogram(figure) ? pictogramPaths(figure) : LETTER_Q_PATHS;
}

export function PresenceFigureStill({
  figure,
}: {
  readonly figure: PresenceFigureId;
}) {
  const letter = figure === "LETTER_Q";
  return (
    <svg
      aria-hidden="true"
      viewBox={VIEW_BOX}
      data-q-figure-still={figure}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      fill="none"
      stroke="var(--cq-q-colour, var(--cq-accent))"
      strokeWidth={letter ? 3.2 : 1.35}
      strokeLinecap={letter ? "butt" : "round"}
      strokeLinejoin="round"
    >
      {stillPaths(figure).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
