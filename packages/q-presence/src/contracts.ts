import { z } from "zod";

/**
 * Public presence (CQ-Q-PRESENCE-001).
 *
 * What the public web already says about a subject, read once when Capital
 * Q first knows enough to look, and refreshed rather than rebuilt. It is a
 * separate thing from the profile a person builds by talking to Q and
 * uploading documents: that is what they told us, this is what is already
 * out there, and the two are compared, never merged.
 *
 * Three rules this context exists to keep:
 *
 * Nothing here is truth. Every understanding it proposes is Q's reading of
 * a public page, carried as Q_INFERENCE with the page cited, and it goes
 * through the Knowledge Write Gate like anything else. No model writes.
 *
 * Observed signals are not a personality score. What a person publicly
 * says they focus on is an observation about a public statement; it is not
 * a trait, it carries no number, and the keys it uses are excluded from
 * every ranking feature until a packet says otherwise in writing
 * (doc 19 §204.8/§204.9 make founder-private and investor-private
 * behaviour leaking into ranking release-blocking).
 *
 * Only a subject the actor already owns. A person's own row, their
 * company, their investor organisation. Reading up on somebody else is a
 * different capability with different rules, and this one cannot express
 * it.
 */

export const PRESENCE_SUBJECT_TYPES = [
  "PERSON",
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const PresenceSubjectTypeSchema = z.enum(PRESENCE_SUBJECT_TYPES);
export type PresenceSubjectType = z.infer<typeof PresenceSubjectTypeSchema>;

export const PresenceSubjectSchema = z
  .object({
    subjectType: PresenceSubjectTypeSchema,
    subjectId: z.string().uuid(),
  })
  .strict();
export type PresenceSubject = z.infer<typeof PresenceSubjectSchema>;

/**
 * What may leave Capital Q in a query about this subject.
 *
 * An allowlist the caller assembles from things the person told us about
 * themselves in public terms: a name, a company name, a website, a link
 * they gave. Nothing derived, nothing private, nothing inferred. The
 * research context composes the actual query from these and may narrow
 * them further; it can never widen them.
 */
export const PresenceIdentitySchema = z
  .object({
    /** The display name, company name or fund name to search for. */
    name: z.string().trim().min(2).max(160),
    /** Their own website, when they gave one. */
    websiteUrl: z.string().trim().max(500).nullable().default(null),
    /** A public profile URL they gave (LinkedIn). Read directly, not searched. */
    profileUrl: z.string().trim().max(500).nullable().default(null),
    /** One more public term that disambiguates a common name ("Lagos", "fintech"). */
    qualifier: z.string().trim().max(80).nullable().default(null),
  })
  .strict();
export type PresenceIdentity = z.infer<typeof PresenceIdentitySchema>;

export const PRESENCE_BUILD_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "NOTHING_FOUND",
] as const;
export const PresenceBuildStatusSchema = z.enum(PRESENCE_BUILD_STATUSES);
export type PresenceBuildStatus = z.infer<typeof PresenceBuildStatusSchema>;

/** One attempt, as the log records it. Counts and timing; never content. */
export type PresenceBuild = {
  readonly id: string;
  readonly subject: PresenceSubject;
  readonly status: PresenceBuildStatus;
  readonly sourceCount: number;
  readonly understandingCount: number;
  readonly failureCode: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
};

/**
 * The knowledge keys a presence build may propose, and nothing else.
 *
 * A closed list because it is the seam where public text becomes something
 * Capital Q holds: a model that invents a key would be inventing a
 * category of understanding, and the gate would have no policy for it.
 *
 * `presence.signal.*` is the observed-signal namespace. It is what a
 * subject publicly says and publishes, never a judgement about them, and
 * it is excluded from ranking features by
 * PRESENCE_KEYS_EXCLUDED_FROM_RANKING below.
 */
export const PRESENCE_KEYS = [
  /** How the subject describes itself publicly, in one sentence. */
  "presence.self_description",
  /** What the public web says the subject does. */
  "presence.what_they_do",
  /** Where the public web places them. */
  "presence.location",
  /** A public milestone the web reports (a launch, a round, a partnership). */
  "presence.milestone",
  /** Publicly stated focus: sectors, stages, themes they say they care about. */
  "presence.signal.stated_focus",
  /** What they publicly publish about, as a topic, from their own posts. */
  "presence.signal.publishes_about",
  /** How they present themselves publicly: the register of their own words. */
  "presence.signal.public_voice",
] as const;
export const PresenceKeySchema = z.enum(PRESENCE_KEYS);
export type PresenceKey = z.infer<typeof PresenceKeySchema>;

/**
 * Keys no recommendation, ranking or match feature may read.
 *
 * Doc 19 makes it release-blocking that private behaviour must not alter
 * discovery. Observed public signals are not private, but they are Q's
 * reading of somebody's posts, and a founder should not rank higher for an
 * investor because a model liked how they write. A ranking packet that
 * wants them must say so explicitly and change this list.
 */
export const PRESENCE_KEYS_EXCLUDED_FROM_RANKING: readonly PresenceKey[] = [
  "presence.signal.stated_focus",
  "presence.signal.publishes_about",
  "presence.signal.public_voice",
];

export function isRankingEligiblePresenceKey(key: PresenceKey): boolean {
  return !PRESENCE_KEYS_EXCLUDED_FROM_RANKING.includes(key);
}

/** What a build did, for the caller that asked for it. */
export type PresenceOutcome =
  | {
      readonly status: "COMPLETED";
      readonly buildId: string;
      readonly sourceCount: number;
      readonly understandingCount: number;
    }
  | {
      readonly status: "NOTHING_FOUND";
      readonly buildId: string;
    }
  | {
      readonly status: "SKIPPED";
      /** A build for this subject is recent enough, or one is running. */
      readonly reason: "RECENT" | "IN_PROGRESS" | "NOT_CONFIGURED";
    }
  | {
      readonly status: "FAILED";
      readonly buildId: string;
      readonly failureCode: string;
    };

/** How long a build stays current before a refresh is due. */
export const PRESENCE_REFRESH_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** A build that never reported back is not treated as still running. */
export const PRESENCE_BUILD_STALE_AFTER_MS = 10 * 60 * 1000;
/** Bounded so one arrival cannot spend a day's search quota. */
export const PRESENCE_BOUNDS = {
  maxReads: 3,
  maxSourcesPerRead: 5,
  maxSourcesTotal: 10,
  maxExcerptChars: 4_000,
  maxUnderstandings: 12,
} as const;
