/**
 * Which Explore tile previews its pitch in the grid (owner 2026-10-16:
 * "Instagram-style motion"). Pure: the hook in grid-preview-player.tsx
 * feeds it what the browser says and renders one muted player for the
 * answer. One answer, so one player: no tile decides for itself.
 *
 * - Never while reduced motion is asked for (ADR-001: poster plus Play),
 *   on Save-Data or a 2g link, with the tab hidden, or while a pitch is
 *   open over the grid.
 * - With a mouse: the first tile plays while it is in view; a hovered tile
 *   takes over and keeps playing after the pointer leaves, until another
 *   is hovered. A tile out of view never plays.
 * - On touch: the most visible tile plays, switching as the person scrolls.
 */

/** The part of a tile that must be on screen before it may play. */
export const MIN_VISIBLE_RATIO = 0.4;

export type PreviewInput = {
  /** Media asset ids in rank order. */
  readonly order: readonly string[];
  /** Visible fraction of each tile (0-1); absent means not in view. */
  readonly visible: ReadonlyMap<string, number>;
  /** The last tile hovered, kept after the pointer leaves. */
  readonly hovered: string | null;
  /** A fine pointer that hovers (a mouse), rather than touch. */
  readonly canHover: boolean;
  readonly reducedMotion: boolean;
  /** Save-Data, or a 2g / slow-2g link. */
  readonly constrained: boolean;
  /** Tab hidden, or a pitch opened over the grid. */
  readonly suspended: boolean;
};

function inView(input: PreviewInput, id: string | null): id is string {
  return id !== null && (input.visible.get(id) ?? 0) >= MIN_VISIBLE_RATIO;
}

/** The one tile that plays, or null for none. */
export function chooseActivePreview(input: PreviewInput): string | null {
  if (input.reducedMotion || input.constrained || input.suspended) return null;
  if (input.canHover) {
    if (inView(input, input.hovered)) return input.hovered;
    const first = input.order[0] ?? null;
    return inView(input, first) ? first : null;
  }
  let best: string | null = null;
  let bestRatio = MIN_VISIBLE_RATIO;
  // Rank order, so the higher-ranked tile wins a tie.
  for (const id of input.order) {
    const ratio = input.visible.get(id) ?? 0;
    if (ratio > bestRatio || (best === null && ratio >= bestRatio)) {
      best = id;
      bestRatio = ratio;
    }
  }
  return best;
}

/** The parts of the Network Information API read here, all optional. */
export type LinkInfo = {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
};

/** Save-Data or a 2g link: the grid stays posters. */
export function linkIsConstrained(link: LinkInfo | undefined): boolean {
  if (link === undefined) return false;
  if (link.saveData === true) return true;
  return link.effectiveType === "2g" || link.effectiveType === "slow-2g";
}

/** How long a pointer must rest on a tile before the preview moves to it. */
export const HOVER_DWELL_MS = 200;

/** The parts of a playback grant this module reads. */
export type PreviewGrant = {
  readonly playbackUrl: string;
  readonly expiresAt: string;
};

/** A grant is reused until this long before it expires. */
export const GRANT_REUSE_MARGIN_MS = 30_000;

/** A request superseded by a newer one before it was sent. */
export class SupersededGrantRequest extends Error {
  constructor() {
    super("A newer preview was asked for.");
    this.name = "SupersededGrantRequest";
  }
}

/**
 * The grid's playback grants: one per pitch, reused until shortly before
 * it expires (the server still decides on every new grant), and at most
 * one request in flight. A request asked for while one is in flight waits;
 * a newer one replaces it, and the replaced one is rejected unsent, so a
 * pointer sweeping the grid never queues a grant per tile.
 */
export function createPreviewGrants<G extends PreviewGrant>(
  authorize: (companyId: string, mediaAssetId: string) => Promise<G>,
  now: () => number = Date.now,
): (companyId: string, mediaAssetId: string) => Promise<G> {
  const grants = new Map<string, G>();
  let busy = false;
  let waiting: {
    readonly companyId: string;
    readonly mediaAssetId: string;
    readonly resolve: (grant: G) => void;
    readonly reject: (error: unknown) => void;
  } | null = null;

  const usable = (mediaAssetId: string): G | null => {
    const grant = grants.get(mediaAssetId);
    if (grant === undefined) return null;
    const expires = Date.parse(grant.expiresAt);
    if (Number.isNaN(expires) || expires - GRANT_REUSE_MARGIN_MS <= now()) {
      grants.delete(mediaAssetId);
      return null;
    }
    return grant;
  };

  const pump = (): void => {
    if (busy || waiting === null) return;
    const job = waiting;
    waiting = null;
    const known = usable(job.mediaAssetId);
    if (known !== null) {
      job.resolve(known);
      pump();
      return;
    }
    busy = true;
    authorize(job.companyId, job.mediaAssetId)
      .then(
        (grant) => {
          grants.set(job.mediaAssetId, grant);
          job.resolve(grant);
        },
        (error: unknown) => job.reject(error),
      )
      .finally(() => {
        busy = false;
        pump();
      });
  };

  return (companyId, mediaAssetId) => {
    const known = usable(mediaAssetId);
    if (known !== null) return Promise.resolve(known);
    return new Promise<G>((resolve, reject) => {
      waiting?.reject(new SupersededGrantRequest());
      waiting = { companyId, mediaAssetId, resolve, reject };
      pump();
    });
  };
}
