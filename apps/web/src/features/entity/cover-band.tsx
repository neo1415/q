/**
 * A drawn banner for an organisation that has no cover (owner 2026-10-16:
 * every investor card carries an image; live check the same day: a flat
 * band with one accent hairline read as a broken image beside the
 * photographs). Two ridgelines over a sky, the same landscape language as
 * the photographed covers, drawn from the theme's own tokens so it reads in
 * both themes. The shape comes from the organisation's id (stable, never
 * random per render), so each card differs and stays the same. Nothing is
 * fetched or generated: real organisations are never given invented
 * imagery. Decorative only.
 */

const WIDTH = 400;
const HEIGHT = 100;

/** A small seeded generator: the same id always draws the same ridges. */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One ridge as a closed path: points across the width around `base` (a
 * fraction of the height), joined by smooth curves, then down to the
 * bottom edge.
 */
function ridge(
  next: () => number,
  base: number,
  swing: number,
  points: number,
): string {
  const ys = Array.from({ length: points + 1 }, () =>
    Math.round(HEIGHT * (base + (next() - 0.5) * swing)),
  );
  const step = WIDTH / points;
  let path = `M0 ${String(ys[0] ?? HEIGHT)}`;
  for (let i = 1; i <= points; i += 1) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const y0 = ys[i - 1] ?? HEIGHT;
    const y1 = ys[i] ?? HEIGHT;
    const mid = (x0 + x1) / 2;
    path += ` C${String(mid)} ${String(y0)} ${String(mid)} ${String(y1)} ${String(x1)} ${String(y1)}`;
  }
  return path;
}

/** A ridge line closed down to the bottom edge, for its fill. */
function filled(line: string): string {
  return `${line} L${String(WIDTH)} ${String(HEIGHT)} L0 ${String(HEIGHT)} Z`;
}

/**
 * The two ridges for one organisation (exported for its test): each
 * closed for its fill, and the far ridge's crest alone for its hairline.
 */
export function coverBandPaths(seed: string): {
  readonly far: string;
  readonly crest: string;
  readonly near: string;
} {
  const next = seeded(seed);
  const farBase = 0.42 + next() * 0.14;
  const nearBase = 0.68 + next() * 0.12;
  const crest = ridge(next, farBase, 0.3, 4 + Math.floor(next() * 3));
  const near = ridge(next, nearBase, 0.22, 3 + Math.floor(next() * 2));
  return { far: filled(crest), crest, near: filled(near) };
}

export function CoverBand({
  seed,
  className,
}: {
  readonly seed: string;
  readonly className?: string | undefined;
}) {
  const { far, crest, near } = coverBandPaths(seed);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      data-cover-band
    >
      <rect width={WIDTH} height={HEIGHT} fill="var(--cq-surface-subtle)" />
      <path d={far} fill="var(--cq-surface-strong)" />
      <path
        d={crest}
        fill="none"
        stroke="var(--cq-border-strong)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <path d={near} fill="var(--cq-accent-soft)" />
    </svg>
  );
}
