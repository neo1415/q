import { z } from "zod";

import { LocalDateSchema, Rfc3339TimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
import { QContextLabelSchema, QFactCategorySchema } from "./firewall.js";

/**
 * Situation-first planning (owner 2026-10-28): the person's situation,
 * assembled by CODE from the typed reads Q's chat tools already make, run
 * as the asker, before anything is planned. A planner is handed this
 * dossier and cites its facts by `F<n>`; it never fetches.
 *
 * INTERNAL. A dossier is the asker's own context, never a disclosure: it
 * is not sent to a client, and every fact in it came through the same
 * authorisation the tool applies in chat. Each fact keeps its truth class,
 * evidence status and as-of separately (ADR-001), its provenance (which
 * typed read, which record), and the ADR-001 disclosure label it was read
 * under, so a later consumer can filter by scope before a model sees it.
 *
 * Unknown stays unknown: a source that could not be read (denied, timed
 * out, failed) is a section with status UNAVAILABLE and no facts, listed in
 * `unknowns`. It is never "none", never zero and never negative evidence.
 */

export const Q_SITUATION_VERSION = "situation/v1" as const;

export const Q_SITUATION_SIDES = ["FOUNDER", "INVESTOR"] as const;
export type QSituationSide = (typeof Q_SITUATION_SIDES)[number];
export const QSituationSideSchema = z.enum(Q_SITUATION_SIDES);

/** Where a section's facts were read from. Reference data, additive. */
export const Q_SITUATION_SOURCES = [
  // Both sides.
  /** What the person did recently (addendum 2): their own domain events. */
  "ACTIVITY",
  "RELATIONSHIPS",
  "MESSAGES",
  "SCHEDULE",
  "BOARD",
  "Q_WORK",
  "MEMORY",
  "Q_DAILY",
  "PUBLIC",
  // A founder's own company.
  "INTEREST",
  "PROSPECTS",
  "PROFILE",
  "DECK",
  "DATA_ROOM",
  "PITCH_VIDEO",
  "READINESS",
  "CLAIMS",
  "CAPITAL",
  // An investor's own organisation.
  "MANDATE",
  "GATEQ",
  "FEED_DECISIONS",
] as const;
export type QSituationSource = (typeof Q_SITUATION_SOURCES)[number];
export const QSituationSourceSchema = z.enum(Q_SITUATION_SOURCES);

/**
 * The sources that describe one side's own private position. A founder's
 * dossier never reads an investor's mandate, GateQ inbox or feed
 * decisions; an investor's never reads a founder's readiness, claims,
 * capital plan, deck coaching, data room, pitch video or incoming interest
 * as if they were the founder (an investor reaches a company only through
 * relationship-shared or granted reads, filed under RELATIONSHIPS).
 */
export const Q_SITUATION_SOURCES_BY_SIDE: Readonly<
  Record<QSituationSide, readonly QSituationSource[]>
> = {
  FOUNDER: [
    "ACTIVITY",
    "RELATIONSHIPS",
    "MESSAGES",
    "SCHEDULE",
    "BOARD",
    "Q_WORK",
    "MEMORY",
    "Q_DAILY",
    "PUBLIC",
    "INTEREST",
    "PROSPECTS",
    "PROFILE",
    "DECK",
    "DATA_ROOM",
    "PITCH_VIDEO",
    "READINESS",
    "CLAIMS",
    "CAPITAL",
  ],
  INVESTOR: [
    "ACTIVITY",
    "RELATIONSHIPS",
    "MESSAGES",
    "SCHEDULE",
    "BOARD",
    "Q_WORK",
    "MEMORY",
    "Q_DAILY",
    "PUBLIC",
    "PROSPECTS",
    "MANDATE",
    "GATEQ",
    "FEED_DECISIONS",
  ],
};

/**
 * Disclosure labels a side's dossier may never hold. A founder never holds
 * investor_private material; an investor never holds founder_private
 * material (doc 15 §19; the release-blocking Context Firewall invariant).
 */
export const Q_SITUATION_FORBIDDEN_LABELS: Readonly<
  Record<QSituationSide, readonly z.infer<typeof QContextLabelSchema>[]>
> = {
  FOUNDER: ["investor_private"],
  INVESTOR: ["founder_private"],
};

/**
 * READ: the read answered (its facts may be empty: the read said "none",
 * which is a fact about an authorised read, not an absence of one).
 * UNAVAILABLE: it could not be read; not known.
 * NOT_APPLICABLE: this source does not describe this side.
 */
export const Q_SITUATION_SECTION_STATUSES = [
  "READ",
  "UNAVAILABLE",
  "NOT_APPLICABLE",
] as const;
export type QSituationSectionStatus =
  (typeof Q_SITUATION_SECTION_STATUSES)[number];

/** Why a source is not known. Never the content of an error. */
export const Q_SITUATION_UNAVAILABLE_REASONS = [
  "TIMED_OUT",
  "NOT_PERMITTED",
  "FAILED",
  "NOT_OFFERED",
] as const;
export type QSituationUnavailableReason =
  (typeof Q_SITUATION_UNAVAILABLE_REASONS)[number];

/** The label a planner cites a fact by. Opaque and per-dossier. */
export const QSituationFactRefSchema = z
  .string()
  .regex(/^F[1-9][0-9]{0,2}$/u, "a situation fact is cited as F1..F999");
export type QSituationFactRef = z.infer<typeof QSituationFactRefSchema>;

/** What kind of record a fact is about, when it is about one. */
export const Q_SITUATION_RECORD_KINDS = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "RELATIONSHIP",
  "MESSAGE",
  "MEETING",
  "REMINDER",
  "BOARD_ITEM",
  "WORK_JOB",
  "DOCUMENT",
  "MANDATE",
  "MEMORY_ITEM",
  "DAILY_ITEM",
  "PUBLIC_PAGE",
] as const;
export type QSituationRecordKind = (typeof Q_SITUATION_RECORD_KINDS)[number];

/**
 * Where a fact came from: the typed read (tool name) that returned it, and
 * the record it is about. Server-internal provenance: the record id lets a
 * later step act on the right record; it grants nothing (every use is
 * re-authorised as the person).
 */
export const QSituationProvenanceSchema = z
  .object({
    tool: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/u),
    record: z
      .object({
        kind: z.enum(Q_SITUATION_RECORD_KINDS),
        id: z.string().trim().min(1).max(200),
      })
      .strict()
      .nullable(),
    /** A public page's address (PUBLIC and Q_DAILY facts only). */
    url: z
      .url({ protocol: /^https?$/u })
      .max(2000)
      .nullable(),
  })
  .strict();
export type QSituationProvenance = z.infer<typeof QSituationProvenanceSchema>;

export const Q_SITUATION_FACT_TEXT_MAX = 1_000;

/**
 * One fact. `statement` is written by code from the read (a formatter per
 * tool), never by a model; it is DATA when rendered into a prompt (it may
 * quote a person or a document). `asOf` is when the fact was true or
 * recorded: an instant or a calendar day; null when the read does not say.
 */
export const QSituationFactSchema = z
  .object({
    ref: QSituationFactRefSchema,
    statement: z.string().trim().min(1).max(Q_SITUATION_FACT_TEXT_MAX),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    asOf: z.union([Rfc3339TimestampSchema, LocalDateSchema]).nullable(),
    provenance: QSituationProvenanceSchema,
    /** The ADR-001 disclosure label the fact was read under. */
    label: QContextLabelSchema,
    /** For combination-risk policy (cash + burn + payroll). */
    category: QFactCategorySchema.nullable(),
  })
  .strict();
export type QSituationFact = z.infer<typeof QSituationFactSchema>;

export const Q_SITUATION_FACTS_PER_SECTION_MAX = 12;
export const Q_SITUATION_FACTS_MAX = 120;

export const QSituationSectionSchema = z
  .object({
    source: QSituationSourceSchema,
    status: z.enum(Q_SITUATION_SECTION_STATUSES),
    /** UNAVAILABLE only. */
    reason: z.enum(Q_SITUATION_UNAVAILABLE_REASONS).nullable(),
    facts: z.array(QSituationFactSchema).max(Q_SITUATION_FACTS_PER_SECTION_MAX),
    /** The read returned more than the section keeps. */
    truncated: z.boolean(),
  })
  .strict()
  .refine(
    (section) => section.status === "READ" || section.facts.length === 0,
    {
      message: "a source that was not read holds no facts",
      path: ["facts"],
    },
  )
  .refine(
    (section) =>
      (section.status === "UNAVAILABLE") === (section.reason !== null),
    {
      message: "an unavailable source says why, and only it",
      path: ["reason"],
    },
  );
export type QSituationSection = z.infer<typeof QSituationSectionSchema>;

/** Public-safe topics a bounded research step may look into. */
export const Q_SITUATION_TOPICS_MAX = 6;
export const QSituationTopicSchema = z.string().trim().min(2).max(120);

export const QSituationDossierSchema = z
  .object({
    version: z.literal(Q_SITUATION_VERSION),
    side: QSituationSideSchema,
    asOf: Rfc3339TimestampSchema,
    sections: z
      .array(QSituationSectionSchema)
      .min(1)
      .max(Q_SITUATION_SOURCES.length),
    /** The sources that could not be read: not known. */
    unknowns: z.array(QSituationSourceSchema).max(Q_SITUATION_SOURCES.length),
    /**
     * Topics derived by code from public-safe fields only (name, country,
     * sector labels, description; an investor's declared sectors and
     * geographies) -- never figures, claims or documents.
     */
    publicTopics: z.array(QSituationTopicSchema).max(Q_SITUATION_TOPICS_MAX),
  })
  .strict()
  .superRefine((dossier, ctx) => {
    const seenSources = new Set<QSituationSource>();
    const seenRefs = new Set<string>();
    const allowed = new Set(Q_SITUATION_SOURCES_BY_SIDE[dossier.side]);
    const forbidden = new Set(Q_SITUATION_FORBIDDEN_LABELS[dossier.side]);
    let total = 0;
    dossier.sections.forEach((section, index) => {
      if (seenSources.has(section.source)) {
        ctx.addIssue({
          code: "custom",
          message: "one section per source",
          path: ["sections", index, "source"],
        });
      }
      seenSources.add(section.source);
      if (!allowed.has(section.source) && section.status !== "NOT_APPLICABLE") {
        ctx.addIssue({
          code: "custom",
          message: `${section.source} does not describe the ${dossier.side.toLowerCase()} side`,
          path: ["sections", index, "status"],
        });
      }
      section.facts.forEach((fact, factIndex) => {
        total += 1;
        if (seenRefs.has(fact.ref)) {
          ctx.addIssue({
            code: "custom",
            message: "a fact label is used once per dossier",
            path: ["sections", index, "facts", factIndex, "ref"],
          });
        }
        seenRefs.add(fact.ref);
        if (forbidden.has(fact.label)) {
          ctx.addIssue({
            code: "custom",
            message: `a ${dossier.side.toLowerCase()} dossier never holds ${fact.label} material`,
            path: ["sections", index, "facts", factIndex, "label"],
          });
        }
        const url = fact.provenance.url;
        const pageAllowed =
          section.source === "PUBLIC" || section.source === "Q_DAILY";
        if (
          (section.source === "PUBLIC" && url === null) ||
          (!pageAllowed && url !== null)
        ) {
          ctx.addIssue({
            code: "custom",
            message: "public facts carry their page; private facts never do",
            path: ["sections", index, "facts", factIndex, "provenance", "url"],
          });
        }
      });
    });
    if (total > Q_SITUATION_FACTS_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `at most ${String(Q_SITUATION_FACTS_MAX)} facts`,
        path: ["sections"],
      });
    }
    const unavailable = dossier.sections
      .filter((section) => section.status === "UNAVAILABLE")
      .map((section) => section.source)
      .sort();
    const unknowns = [...dossier.unknowns].sort();
    if (
      unavailable.length !== unknowns.length ||
      unavailable.some((source, index) => source !== unknowns[index])
    ) {
      ctx.addIssue({
        code: "custom",
        message: "unknowns are exactly the sources that could not be read",
        path: ["unknowns"],
      });
    }
  });
export type QSituationDossier = z.infer<typeof QSituationDossierSchema>;

/** Every fact in a dossier, in section order. */
export function situationFacts(
  dossier: QSituationDossier,
): readonly QSituationFact[] {
  return dossier.sections.flatMap((section) => section.facts);
}
