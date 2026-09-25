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
      <circle cx="11.5" cy="11.5" r="7.5" />
      <path d="M15.5 15.5 20 20" />
    </svg>
  );
}
