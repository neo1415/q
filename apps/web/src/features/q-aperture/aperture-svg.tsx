import { RING_RADIUS } from "./aperture-frame";
import type { QApertureState } from "./aperture-state";

/**
 * The aperture as SVG: what the shell paints before the shader loads, and
 * what stays wherever the shader should not run (no WebGL2, Save-Data, a
 * low-memory device, Q motion Off, forced colours). Same composition as
 * the shader's: a ring, the Q's tail, a bloom. The bloom is an SVG filter
 * on a static group, rasterised once; the only animation is the focus
 * sweep's rotation (transform) and the shutter (opacity), both in CSS and
 * both stilled by Calm, Off and reduced motion (globals.css).
 *
 * Coordinates: the box is -1..1 with y down, so the tail points to the
 * lower right as it does in the mark.
 */

const TAIL_FROM = RING_RADIUS - 0.1;
const TAIL_TO = RING_RADIUS + 0.14;
const DIAGONAL = Math.SQRT1_2;

export function ApertureSvg({
  state,
  pixels,
  progress,
  bloomId,
}: {
  readonly state: QApertureState;
  /** The box's CSS size: small marks keep a hairline stroke. */
  readonly pixels: number;
  readonly progress: number | null;
  readonly bloomId: string;
}) {
  const half = pixels / 2;
  const width =
    Math.max(0.05, 1.5 / half) * (state === "NEEDS_INPUT" ? 1.2 : 1);
  const radius =
    RING_RADIUS *
    (state === "LISTENING" ? 1.03 : state === "THINKING" ? 0.93 : 1);
  const circumference = 2 * Math.PI * radius;
  const known = state === "WORKING" && progress !== null;
  const arc = known
    ? Math.min(1, Math.max(0, progress)) * circumference
    : circumference * 0.14;
  // Speaking: the tail reaches further, the light projecting from it.
  const tailEnd = state === "SPEAKING" ? RING_RADIUS + 0.22 : TAIL_TO;
  const ring = (
    <>
      <circle cx="0" cy="0" r={radius} fill="none" strokeWidth={width} />
      <line
        x1={TAIL_FROM * DIAGONAL}
        y1={TAIL_FROM * DIAGONAL}
        x2={tailEnd * DIAGONAL}
        y2={tailEnd * DIAGONAL}
        strokeWidth={width}
        strokeLinecap="round"
      />
    </>
  );
  return (
    <svg
      viewBox="-1 -1 2 2"
      aria-hidden="true"
      focusable="false"
      className="cq-aperture-svg"
      data-state={state}
    >
      <defs>
        <filter id={bloomId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.07" />
        </filter>
      </defs>
      <g className="cq-aperture-svg-bloom" filter={`url(#${bloomId})`}>
        {ring}
        {state === "LISTENING" ? (
          <circle cx="0" cy="0" r={radius * 0.8} className="is-fill" />
        ) : null}
      </g>
      <g className="cq-aperture-svg-ring">{ring}</g>
      {state === "THINKING" || state === "WORKING" ? (
        <g className={known ? "cq-aperture-svg-arc" : "cq-aperture-svg-sweep"}>
          <circle
            cx="0"
            cy="0"
            r={radius}
            fill="none"
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={`${String(arc)} ${String(circumference)}`}
            // Start at twelve o'clock, going clockwise.
            transform="rotate(-90)"
          />
        </g>
      ) : null}
      {state === "COMPLETE" ? (
        <circle
          cx="0"
          cy="0"
          r={radius}
          fill="none"
          strokeWidth={width * 1.6}
          className="cq-aperture-svg-flash"
        />
      ) : null}
      {state === "NEEDS_APPROVAL" ? (
        <circle
          cx="0"
          cy="0"
          r={radius}
          fill="none"
          strokeWidth={width * 0.3}
          className="cq-aperture-svg-core"
        />
      ) : null}
    </svg>
  );
}
