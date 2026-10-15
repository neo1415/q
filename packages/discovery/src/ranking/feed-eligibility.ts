import { z } from "zod";

/**
 * Discover feed eligibility (founder direction 2026-10-15).
 *
 * The Investor Discover feed is a video feed (PADL #99): an item an
 * investor cannot play is not a feed item. This policy adds one hard,
 * deterministic gate to the feed's pipeline, after REC-001 hard
 * eligibility and before ranking: a company is admitted to the feed only
 * when it has a playable pitch video right now.
 *
 * What it is NOT:
 * - not a REC-001 criterion. REC-001 also answers "may this investor act
 *   on / view / be reached by this company" (profile views, Save/Pass,
 *   founder connection requests). A company without a video must still be
 *   viewable, searchable, findable in Explore and known to Q, so the gate
 *   lives here, where only the feed reads it;
 * - not a ranking weight. A video never moves a company up or down; it
 *   decides membership of the video feed only, and a pitch never makes a
 *   company eligible by itself (PADL #58): REC-001 still has to pass;
 * - not inferred. "Playable" is the Media context's publishable-pitch rule
 *   (READY, ALLOWED, not PRIVATE, not removed or superseded), read through
 *   its port. Discovery never reads media tables.
 *
 * Versioned like the ranking config: a published version is never edited;
 * a change is a new version. It is a separate object from
 * `ranking-config.*` because it changes no scoring factor, and because
 * `ranking-config.v4` already names the fit profile config (ADR 0052).
 */
export const DiscoverFeedEligibilitySchema = z
  .object({
    version: z.string().regex(/^discover-feed-eligibility\.v[0-9]+$/),
    /** Only companies with a playable pitch video enter the feed. */
    requirePlayablePitch: z.boolean(),
    description: z.string().min(1).max(600),
  })
  .strict();
export type DiscoverFeedEligibility = z.infer<
  typeof DiscoverFeedEligibilitySchema
>;

export const DISCOVER_FEED_ELIGIBILITY_V1: DiscoverFeedEligibility =
  Object.freeze(
    DiscoverFeedEligibilitySchema.parse({
      version: "discover-feed-eligibility.v1",
      requirePlayablePitch: true,
      description:
        "The Investor Discover video feed admits only companies with a playable pitch video (Media's publishable-pitch rule). Applied after REC-001 and before ranking; never a weight. Search, Explore, profiles and Q lookups are unaffected.",
    }),
  );

/** The policy new feed slates and feed reads apply. */
export const DISCOVER_FEED_ELIGIBILITY_CURRENT = DISCOVER_FEED_ELIGIBILITY_V1;

/** Every published version, oldest first. Append, never edit. */
export const DISCOVER_FEED_ELIGIBILITY_VERSIONS: readonly DiscoverFeedEligibility[] =
  Object.freeze([DISCOVER_FEED_ELIGIBILITY_V1]);

/** The bounded reason a company is held out of the feed. */
export const FEED_WITHHELD_NO_PLAYABLE_PITCH = "NO_PLAYABLE_PITCH" as const;

/**
 * Which of these companies have a playable pitch video. Composed by the
 * app from the Media context's discoverable-pitch port. Cross-tenant like
 * that port: it answers only "is there a publishable pitch", nothing that
 * grants playback.
 */
export type PlayablePitchPort = {
  readonly companiesWithPlayablePitch: (
    companyIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
};

/**
 * A PlayablePitchPort over Media's batched `findDiscoverablePitches`,
 * chunked to that port's batch bound so a large pool is never refused.
 */
export function playablePitchPortFrom(source: {
  readonly findDiscoverablePitches: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, unknown>>;
  readonly batchMax: number;
}): PlayablePitchPort {
  const size = Math.max(1, Math.floor(source.batchMax));
  return {
    companiesWithPlayablePitch: async (companyIds) => {
      const ids = [...new Set(companyIds)];
      const out = new Set<string>();
      for (let at = 0; at < ids.length; at += size) {
        const found = await source.findDiscoverablePitches(
          ids.slice(at, at + size),
        );
        for (const id of found.keys()) out.add(id);
      }
      return out;
    },
  };
}

export type FeedAdmission<T> = {
  readonly admitted: readonly T[];
  /** Company ids held out, in input order. */
  readonly withheld: readonly string[];
};

/**
 * Pure: split candidates by the policy, keeping input order. When the
 * policy does not require a pitch, everything is admitted.
 */
export function admitToFeed<T extends { readonly companyId: string }>(
  policy: DiscoverFeedEligibility,
  candidates: readonly T[],
  playable: ReadonlySet<string>,
): FeedAdmission<T> {
  if (!policy.requirePlayablePitch) {
    return { admitted: candidates, withheld: [] };
  }
  const admitted: T[] = [];
  const withheld: string[] = [];
  for (const c of candidates) {
    if (playable.has(c.companyId)) admitted.push(c);
    else withheld.push(c.companyId);
  }
  return { admitted, withheld };
}

/**
 * The gate as the builder and the reader run it. Fails closed: when the
 * policy requires a pitch and no port was composed, or the port fails, no
 * company's video can be confirmed, so none is admitted. An unconfirmed
 * video is unknown, and unknown never becomes "has a video".
 */
export async function applyFeedEligibility<
  T extends { readonly companyId: string },
>(input: {
  readonly policy: DiscoverFeedEligibility;
  readonly port: PlayablePitchPort | undefined;
  readonly candidates: readonly T[];
}): Promise<FeedAdmission<T> & { readonly confirmed: boolean }> {
  const { policy, port, candidates } = input;
  if (!policy.requirePlayablePitch || candidates.length === 0) {
    return { admitted: candidates, withheld: [], confirmed: true };
  }
  let playable: ReadonlySet<string> | null = null;
  if (port !== undefined) {
    playable = await port
      .companiesWithPlayablePitch(candidates.map((c) => c.companyId))
      .catch(() => null);
  }
  if (playable === null) {
    return {
      admitted: [],
      withheld: candidates.map((c) => c.companyId),
      confirmed: false,
    };
  }
  return { ...admitToFeed(policy, candidates, playable), confirmed: true };
}
