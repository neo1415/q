/**
 * The Q page's navigation icon: the mark's ring and tail as a plain line
 * icon at the navigation's size and stroke (ADR 0017: the aperture is the
 * mark; this is its unlit outline). No glow in the chrome -- the light
 * belongs to Q's presence, not its navigation entry.
 */
export function QNavIcon({
  size = 18,
  strokeWidth = 1.75,
  className,
  "aria-hidden": ariaHidden,
}: {
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly "aria-hidden"?: boolean | "true";
  readonly className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden={ariaHidden}
      className={className}
    >
      {/*
       * WORK-58: distinct from Search's magnifier beside it. The tail
       * crosses the ring, as a Q's does, and the core is lit: the mark's
       * near-white centre, drawn as a dot (no glow in the chrome).
       */}
      <circle cx="12" cy="11.5" r="7.5" />
      <path d="M13.6 13.4 19 19.5" />
      <circle cx="12" cy="11.5" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
