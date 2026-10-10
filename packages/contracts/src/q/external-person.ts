import { z } from "zod";

/**
 * An external person found through public sources (W2, 2026-10-10).
 *
 * A person who is NOT a Capital Q user: an investor, executive or founder
 * a member asked Q to find ("find Shadi Qishta, Doha, Qatar"). What Capital
 * Q holds about them is never a profile of record. It is a bounded set of
 * metadata, links, evidence references and derived summaries, each tied to
 * a public source and a date, scoped to the tenant (and user) that asked,
 * and refreshed on a freshness policy. Nothing here is a Person or a
 * Membership: Person != Organisation != Membership/Role.
 *
 * `confidence` is a categorical reading, never a percentage. Unknown stays
 * unknown: a field with no source is null, not guessed.
 */

export const EXTERNAL_PERSON_CONFIDENCES = [
  /** One profile fits name, place and role/organisation and nothing contradicts it. */
  "STRONG",
  /** Name fits and some of place, role or organisation; a namesake is possible. */
  "PLAUSIBLE",
  /** Name only. Shown, never attributed. */
  "WEAK",
] as const;
export const ExternalPersonConfidenceSchema = z.enum(
  EXTERNAL_PERSON_CONFIDENCES,
);
export type ExternalPersonConfidence = z.infer<
  typeof ExternalPersonConfidenceSchema
>;

/**
 * What was researched. The names keep "Person" (W4 builds on them) but a
 * subject may be an organisation or a government agency. An organisation
 * never carries a personal mandate or a human representative: rehearsals
 * against one use a labelled synthetic role, never a real individual.
 */
export const EXTERNAL_ENTITY_KINDS = [
  "PERSON",
  "ORGANIZATION",
  "GOVERNMENT_AGENCY",
] as const;
export const ExternalEntityKindSchema = z.enum(EXTERNAL_ENTITY_KINDS);
export type ExternalEntityKind = z.infer<typeof ExternalEntityKindSchema>;

/**
 * PREPARED_PUBLIC_SEED: loaded in advance from public sources and shown
 * instantly; RESEARCHED: built by a live search for this asker;
 * REFRESHING: a fresh search is running over an existing record.
 */
export const EXTERNAL_RESEARCH_STATUSES = [
  "PREPARED_PUBLIC_SEED",
  "RESEARCHED",
  "REFRESHING",
] as const;
export const ExternalResearchStatusSchema = z.enum(EXTERNAL_RESEARCH_STATUSES);
export type ExternalResearchStatus = z.infer<
  typeof ExternalResearchStatusSchema
>;

/**
 * A portrait or logo. Only our own stored asset is ever referenced: a
 * hotlinked LinkedIn or CDN URL is refused, and an attached image carries
 * its attribution and the licence or permission it is used under.
 */
export const ExternalEntityImageSchema = z
  .object({
    status: z.enum(["NOT_ATTACHED", "ATTACHED"]),
    assetUrl: z.string().url().max(2_048).nullable(),
    attribution: z.string().trim().max(300).nullable(),
    licenseNote: z.string().trim().max(300).nullable(),
  })
  .strict()
  .refine(
    (image) =>
      image.status === "NOT_ATTACHED"
        ? image.assetUrl === null
        : image.assetUrl !== null &&
          image.attribution !== null &&
          image.licenseNote !== null,
    { message: "an attached image names its asset, attribution and licence" },
  )
  .refine(
    (image) => {
      if (image.assetUrl === null) return true;
      const host = new URL(image.assetUrl).hostname.toLowerCase();
      return !/(^|\.)(linkedin\.com|licdn\.com)$/u.test(host);
    },
    { message: "a third-party profile image is never hotlinked" },
  );
export type ExternalEntityImage = z.infer<typeof ExternalEntityImageSchema>;
export const NO_EXTERNAL_ENTITY_IMAGE: ExternalEntityImage = {
  status: "NOT_ATTACHED",
  assetUrl: null,
  attribution: null,
  licenseNote: null,
};

/**
 * A short public quotation, only ever quoted from its source. Generated
 * dialogue is never presented as the person's words.
 */
export const ExternalEntityQuoteSchema = z
  .object({
    text: z.string().trim().min(1).max(300),
    /** The stored source row it came from. */
    sourceId: z.string().trim().min(1).max(64),
    speaker: z.string().trim().min(1).max(200),
    date: z.string().max(40).nullable(),
    use: z.literal("SOURCE_QUOTE_ONLY"),
  })
  .strict();
export type ExternalEntityQuote = z.infer<typeof ExternalEntityQuoteSchema>;

export const ExternalPersonIdSchema = z.string().uuid();
export type ExternalPersonId = z.infer<typeof ExternalPersonIdSchema>;

/**
 * The shape W4 (rehearsals) builds on: who the counterpart is, which
 * evidence supports it, and which version of the brief was current.
 */
export const ExternalPersonSubjectSchema = z
  .object({
    externalPersonId: ExternalPersonIdSchema,
    entityKind: ExternalEntityKindSchema.default("PERSON"),
    researchStatus: ExternalResearchStatusSchema.default("RESEARCHED"),
    /** True when the record should be refreshed before it is relied on. */
    requiresRefresh: z.boolean().default(false),
    image: ExternalEntityImageSchema.default(NO_EXTERNAL_ENTITY_IMAGE),
    quotes: z.array(ExternalEntityQuoteSchema).max(8).default([]),
    displayName: z.string().trim().min(1).max(200),
    /** Spellings and transliterations searched for (Arabic, Latin variants). */
    nameVariants: z.array(z.string().trim().min(1).max(200)).max(12),
    /** The public profile page chosen as the identity, or null. */
    profileUrl: z.string().url().max(2_048).nullable(),
    role: z.string().trim().max(200).nullable(),
    organization: z.string().trim().max(200).nullable(),
    location: z.string().trim().max(200).nullable(),
    /** The stored evidence bundle (public source refs); null before one exists. */
    evidenceBundleId: z.string().uuid().nullable(),
    /** Version of the derived brief; 0 when none has been built yet. */
    briefVersion: z.number().int().min(0),
    confidence: ExternalPersonConfidenceSchema,
  })
  .strict()
  .refine(
    (subject) => subject.entityKind === "PERSON" || subject.role === null,
    {
      message: "an organisation or agency has no personal role",
    },
  );
export type ExternalPersonSubject = z.infer<typeof ExternalPersonSubjectSchema>;

export const EXTERNAL_PERSON_SOURCE_MAX = 8;

export const ExternalPersonSourceSchema = z
  .object({
    /** Stable id of the stored source row (e.g. S01); null for a live result. */
    id: z.string().trim().min(1).max(64).nullable().default(null),
    description: z.string().trim().max(300).nullable().default(null),
    /** How the source stands as evidence, in words ("publicly documented"). */
    evidenceClass: z.string().trim().max(120).nullable().default(null),
    url: z.string().url().max(2_048),
    domain: z.string().max(253),
    title: z.string().max(300).nullable(),
    /** ISO date the source states for itself, else null. */
    publishedAt: z.string().max(40).nullable(),
    retrievedAt: z.string().max(40),
    /** Provider that surfaced it (tavily, serpapi, brightdata). */
    provider: z.string().max(40),
  })
  .strict();
export type ExternalPersonSource = z.infer<typeof ExternalPersonSourceSchema>;

/**
 * The identity card shown the moment a person is matched: code-built from
 * the provider results, no model in the path. `uncertainty` says what is
 * not settled, in plain words.
 */
export const IdentityCardSchema = z
  .object({
    entityKind: ExternalEntityKindSchema.default("PERSON"),
    subject: ExternalPersonSubjectSchema,
    sources: z
      .array(ExternalPersonSourceSchema)
      .min(1)
      .max(EXTERNAL_PERSON_SOURCE_MAX),
    uncertainty: z.array(z.string().max(200)).max(4),
    /** True while background enrichment is still running; the card updates. */
    enriching: z.boolean(),
    /** What the card offers next. Fixed vocabulary; the client words it. */
    actions: z.array(z.enum(["RESEARCH_FURTHER", "REHEARSE"])).max(2),
  })
  .strict()
  .refine((card) => card.entityKind === card.subject.entityKind, {
    message: "the card and its subject are the same kind of entity",
  });
export type IdentityCard = z.infer<typeof IdentityCardSchema>;

/** A plausible person among several; shown so the member can pick one. */
export const IdentityCandidateSchema = z
  .object({
    displayName: z.string().max(200),
    profileUrl: z.string().url().max(2_048).nullable(),
    role: z.string().max(200).nullable(),
    organization: z.string().max(200).nullable(),
    location: z.string().max(200).nullable(),
    confidence: ExternalPersonConfidenceSchema,
  })
  .strict();
export type IdentityCandidate = z.infer<typeof IdentityCandidateSchema>;

export const PERSON_SEARCH_OUTCOMES = [
  /** One strong match: the card is immediate. */
  "MATCHED",
  /** Several plausible people: ask the one question that tells them apart. */
  "AMBIGUOUS",
  /** Public sources show no one fitting. Said plainly; nothing invented. */
  "NOT_FOUND",
  /** Providers did not answer inside the budget. Not a finding. */
  "UNAVAILABLE",
] as const;
export const PersonSearchOutcomeSchema = z.enum(PERSON_SEARCH_OUTCOMES);

export const PersonSearchResultSchema = z
  .object({
    outcome: PersonSearchOutcomeSchema,
    card: IdentityCardSchema.nullable(),
    candidates: z.array(IdentityCandidateSchema).max(4),
    /** The single clarifying question for AMBIGUOUS; null otherwise. */
    clarifyingQuestion: z.string().max(240).nullable(),
    elapsedMs: z.number().int().min(0),
  })
  .strict();
export type PersonSearchResult = z.infer<typeof PersonSearchResultSchema>;

/**
 * Brief assertions. Every statement about a person carries one class and
 * at least one source, except UNKNOWN. A finance executive is not a
 * venture investor, and a preference is never invented: absence is UNKNOWN.
 */
export const PERSON_ASSERTION_CLASSES = [
  "VERIFIED_PUBLIC_FACT",
  "PUBLIC_STATEMENT",
  "REASONABLE_INFERENCE",
  "UNKNOWN",
  "CONTRADICTORY_OR_STALE",
] as const;
export const PersonAssertionClassSchema = z.enum(PERSON_ASSERTION_CLASSES);
export type PersonAssertionClass = z.infer<typeof PersonAssertionClassSchema>;

export const PERSON_BRIEF_TOPICS = [
  "BACKGROUND",
  "CURRENT_ROLE",
  "INVESTMENT_INTERESTS",
  "SECTORS",
  "AFFILIATIONS",
  "PUBLISHED_ACTIVITY",
  "PUBLIC_STATEMENTS",
  "INTERVIEWS_AND_CONFERENCES",
  "RECURRING_TOPICS",
  "EMPHASISED_QUESTIONS",
  "MARKET_VIEWS",
  "COMMUNICATION_STYLE",
] as const;
export const PersonBriefTopicSchema = z.enum(PERSON_BRIEF_TOPICS);
export type PersonBriefTopic = z.infer<typeof PersonBriefTopicSchema>;

export const PersonBriefAssertionSchema = z
  .object({
    topic: PersonBriefTopicSchema,
    text: z.string().trim().min(1).max(400),
    assertionClass: PersonAssertionClassSchema,
    /** Indexes into the brief's `sources`; empty only for UNKNOWN. */
    sourceRefs: z.array(z.number().int().min(0)).max(6),
    /** Date the supporting source states; null when it states none. */
    asOf: z.string().max(40).nullable(),
  })
  .strict()
  .refine(
    (a) => a.assertionClass === "UNKNOWN" || a.sourceRefs.length > 0,
    { message: "an assertion other than UNKNOWN names its source" },
  );
export type PersonBriefAssertion = z.infer<typeof PersonBriefAssertionSchema>;

export const PersonBriefSchema = z
  .object({
    externalPersonId: ExternalPersonIdSchema,
    entityKind: ExternalEntityKindSchema.default("PERSON"),
    quotes: z.array(ExternalEntityQuoteSchema).max(8).default([]),
    version: z.number().int().min(1),
    builtAt: z.string().max(40),
    /** After this the brief is stale and a question refreshes it. */
    freshUntil: z.string().max(40),
    sources: z
      .array(ExternalPersonSourceSchema)
      .max(EXTERNAL_PERSON_SOURCE_MAX * 2),
    assertions: z.array(PersonBriefAssertionSchema).max(60),
  })
  .strict()
  .refine(
    (brief) =>
      brief.entityKind === "PERSON" ||
      brief.assertions.every(
        (a) => a.topic !== "CURRENT_ROLE" && a.topic !== "COMMUNICATION_STYLE",
      ),
    { message: "an organisation has no personal role or communication style" },
  );
export type PersonBrief = z.infer<typeof PersonBriefSchema>;
