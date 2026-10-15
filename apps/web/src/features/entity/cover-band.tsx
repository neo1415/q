import type { CSSProperties } from "react";

/**
 * A quiet banner for an organisation that has no cover (owner 2026-10-16:
 * every investor card carries an image). A horizon drawn from the
 * theme's own tokens: a sky, a hairline of the accent at a height chosen
 * from the organisation's id (stable, never random per render), and the
 * ground. No picture is fetched and nothing is generated, so it costs
 * nothing and reads correctly in both themes. Decorative only.
 */
export function coverBandStyle(seed: string): CSSProperties {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const horizon = 48 + (hash % 28); // 48–75%: never centred, never at an edge
  const ground = hash % 2 === 0 ? "--cq-surface-strong" : "--cq-accent-soft";
  return {
    backgroundImage: `linear-gradient(to bottom, var(--cq-surface-subtle) 0%, var(--cq-surface-subtle) ${String(horizon)}%, var(--cq-accent) ${String(horizon)}%, var(--cq-accent) calc(${String(horizon)}% + 1px), var(${ground}) calc(${String(horizon)}% + 1px), var(${ground}) 100%)`,
  };
}

export function CoverBand({
  seed,
  className,
}: {
  readonly seed: string;
  readonly className?: string | undefined;
}) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={coverBandStyle(seed)}
      data-cover-band
    />
  );
}
