import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { QArtifactIdSchema, QRunIdSchema } from "./ids.js";
import { QPublicFindingSchema } from "./finding.js";
import { QSubjectRefSchema } from "./subject.js";

/**
 * What Q prepares for somebody to read, keep and change (QX-003).
 *
 * An artifact is derived material: Q's own composition over what Capital Q
 * already holds. The invariant that governs every line below is that this
 * is a fourth thing, distinct from the three it is easy to collapse it
 * into:
 *
 *   generated artifact ≠ canonical truth ≠ verified evidence ≠ disclosure
 *
 * A brief saying a company has forty customers does not make that a fact
 * about the company, does not become evidence for it, and does not show it
 * to anybody. It records that Q wrote that sentence, from material the
 * reader was already authorised to see, at a moment in time. Findings
 * inside a section keep their own truth class, evidence status and
 * confidence exactly as they had them, so a reader can see which
 * sentences rest on what.
 *
 * Versions are rows, never an overwritten column. "Edit with Q" composes a
 * new version and the previous one stays readable, because somebody who
 * sent a brief to an investor last week needs to see what they sent.
 */

/**
 * What kind of thing Q prepared.
 *
 * Reference data, not a Postgres or TypeScript enum: the set grows, and a
 * deployment that has not heard of a type must be able to store and return
 * one rather than fail validation. `PITCH_DECK` is named here as the
 * extension point QX-004 fills; nothing in this packet generates one.
 */
export const Q_ARTIFACT_TYPES = ["INVESTMENT_BRIEF", "PITCH_DECK"] as const;
export type QArtifactType = (typeof Q_ARTIFACT_TYPES)[number];
export const QArtifactTypeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,47}$/, "expected an artifact type code");

/**
 * Whether it is ready to read.
 *
 * Preparation is a state of the artifact, not a spinner the browser
 * invents: a person who closes the tab while Q is composing comes back to
 * an artifact that says what it is doing. FAILED is a real resting state —
 * an artifact that could not be composed is not silently absent.
 */
export const Q_ARTIFACT_STATUSES = ["PREPARING", "READY", "FAILED"] as const;
export type QArtifactStatus = (typeof Q_ARTIFACT_STATUSES)[number];
export const QArtifactStatusSchema = z.enum(Q_ARTIFACT_STATUSES);

export const Q_ARTIFACT_TITLE_MAX = 160;
export const Q_ARTIFACT_SUMMARY_MAX = 600;
export const Q_ARTIFACT_SECTION_BODY_MAX = 6_000;
export const Q_ARTIFACT_SECTIONS_MAX = 24;
export const Q_ARTIFACT_FINDINGS_PER_SECTION_MAX = 12;
/** What a person may say when they ask Q to change one. */
export const Q_ARTIFACT_INSTRUCTION_MAX = 2_000;

/**
 * One section of a composed artifact.
 *
 * Prose and the findings it rests on, kept apart. The body is plain text
 * for the same reason a TEXT result block is: no sanitising renderer
 * exists, so no markup contract is promised, and a client escapes what it
 * is given. The findings are the public finding projection — the same one
 * a live answer uses — so a section can show which of its sentences are
 * verified, which are somebody's claim and which Q inferred.
 */
export const QArtifactSectionSchema = z
  .object({
    heading: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    body: z.string().trim().min(1).max(Q_ARTIFACT_SECTION_BODY_MAX),
    /**
     * What this section rests on. Empty is meaningful and common: a
     * section Q could write nothing grounded for says so rather than
     * being filled in convincingly.
     */
    findings: z
      .array(QPublicFindingSchema)
      .max(Q_ARTIFACT_FINDINGS_PER_SECTION_MAX)
      .default([]),
  })
  .strict();
export type QArtifactSection = z.infer<typeof QArtifactSectionSchema>;

/**
 * A deck, as the thing Q composes rather than the thing a renderer draws
 * (QX-004 §2.1, §3.3, §6).
 *
 * The same invariant governs it as governs a brief: a deck is derived
 * material. A slide saying a company has forty customers does not make
 * that a fact about the company. What is new here is that a deck says
 * things with shape as well as with sentences — a layout, a chart — and
 * both are content, chosen by Q and stored, never decided by whatever
 * renders it. Two renderers (a viewer, a PPTX writer) must be able to
 * produce the same deck, so neither may invent a number, a label or an
 * ordering that is not written down here.
 */
export const Q_SLIDE_LAYOUTS = [
  /** One line, large. An opening or a closing. */
  "TITLE",
  /** A single claim, with room around it. */
  "STATEMENT",
  /** A heading and a short list. */
  "BULLETS",
  /** Two short lists side by side (problem/solution, before/after). */
  "TWO_COLUMN",
  /** A chart with a heading and at most a line of framing. */
  "CHART",
  /** Somebody's words, attributed. */
  "QUOTE",
] as const;
export type QSlideLayout = (typeof Q_SLIDE_LAYOUTS)[number];
export const QSlideLayoutSchema = z.enum(Q_SLIDE_LAYOUTS);

/**
 * What a chart is allowed to be.
 *
 * Deliberately few, and deliberately deterministic: these are the shapes
 * a set of labelled numbers can be drawn as without a model deciding
 * anything at render time. A chart Q cannot express in one of them is a
 * chart Q does not draw, and the numbers stay in the prose.
 */
export const Q_CHART_KINDS = ["BAR", "COLUMN", "LINE", "DONUT"] as const;
export type QChartKind = (typeof Q_CHART_KINDS)[number];
export const QChartKindSchema = z.enum(Q_CHART_KINDS);

export const Q_CHART_POINTS_MAX = 12;

/**
 * One labelled number on a chart.
 *
 * The value is a decimal string, never a float: what Q read was "1.4" or
 * "38", and turning that into an IEEE double on the way in loses the
 * thing a reader would check. The unit is carried on the chart rather
 * than baked into each label, so an axis and a datum stay consistent.
 */
export const QChartPointSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    value: DecimalStringSchema,
  })
  .strict();
export type QChartPoint = z.infer<typeof QChartPointSchema>;

/**
 * A chart, with the reason it is allowed to exist.
 *
 * `grounding` is not decoration. QX-004 §4 requires every material number
 * to trace to something somebody said, something canonical, or authorised
 * evidence, and a chart is the easiest place in a deck to put a number
 * nobody ever gave. So a chart carries, in its own words, where its
 * numbers came from; a chart that cannot say is not composed, and the
 * slide is laid out without one.
 */
export const QChartSchema = z
  .object({
    kind: QChartKindSchema,
    /** What the numbers measure. Written on the chart, not inferred from it. */
    measure: z.string().trim().min(1).max(80),
    /** "USD" for money, "customers", "%", … Written beside the values. */
    unit: z.string().trim().min(1).max(24),
    points: z.array(QChartPointSchema).min(2).max(Q_CHART_POINTS_MAX),
    /** Where these numbers came from, in a sentence a reader can check. */
    grounding: z.string().trim().min(1).max(300),
  })
  .strict();
export type QChart = z.infer<typeof QChartSchema>;

export const Q_SLIDE_BULLETS_MAX = 6;
export const Q_SLIDE_BULLET_MAX = 180;
export const Q_DECK_SLIDES_MAX = 24;

/**
 * A photograph on a slide (founder direction 2026-09-29): a free stock
 * photo, never an image of a real person or company presented as theirs.
 * Only from the stock library's own image host, so a renderer fetches from
 * one known place and nowhere a model named. Credit travels with it.
 */
export const Q_SLIDE_IMAGE_HOST = "images.pexels.com" as const;
export const QSlideImageSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(600)
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            return url.protocol === "https:" && url.host === Q_SLIDE_IMAGE_HOST;
          } catch {
            return false;
          }
        },
        { message: "expected a stock photo URL" },
      ),
    alt: z.string().trim().min(1).max(200),
    credit: z.string().trim().min(1).max(120),
  })
  .strict();
export type QSlideImage = z.infer<typeof QSlideImageSchema>;

/** One slide. Its grounding lives in the matching section; this is its shape. */
export const QSlideSchema = z
  .object({
    layout: QSlideLayoutSchema,
    title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    /** One line under the title, where the layout has room for one. */
    subtitle: z.string().trim().min(1).max(240).optional(),
    bullets: z
      .array(z.string().trim().min(1).max(Q_SLIDE_BULLET_MAX))
      .max(Q_SLIDE_BULLETS_MAX)
      .default([]),
    /** The second column of a TWO_COLUMN slide; empty for every other layout. */
    bulletsRight: z
      .array(z.string().trim().min(1).max(Q_SLIDE_BULLET_MAX))
      .max(Q_SLIDE_BULLETS_MAX)
      .default([]),
    chart: QChartSchema.optional(),
    /** Attribution for a QUOTE. */
    attribution: z.string().trim().min(1).max(120).optional(),
    /**
     * What the founder would say over this slide. Theirs to read, never
     * shown on the slide, and never Q's reasoning about how it composed
     * it — a speaker note is content like any other.
     */
    note: z.string().trim().min(1).max(1_000).optional(),
    /**
     * The section this slide's grounding lives in. A slide shows a claim;
     * the section behind it shows what the claim rests on, with each
     * finding's own truth class and evidence status intact.
     */
    section: z
      .number()
      .int()
      .min(0)
      .max(Q_ARTIFACT_SECTIONS_MAX - 1),
    /** A photograph beside the words, when the deck has one for it. */
    image: QSlideImageSchema.optional(),
  })
  .strict();
export type QSlide = z.infer<typeof QSlideSchema>;

/**
 * How the deck should look, as a direction rather than a template.
 *
 * Three named directions because a founder can choose between three and
 * cannot choose between a hundred, and because the alternative — letting
 * a model emit colours and sizes per deck — produces exactly the generic
 * AI slide this packet exists to avoid. The architecture is not locked to
 * three: the value is reference data, and a renderer that has not heard
 * of a direction falls back to the institutional one.
 */
export const Q_VISUAL_DIRECTIONS = [
  "MINIMAL_INSTITUTIONAL",
  "DARK_TECHNICAL",
  "WARM_GROWTH",
] as const;
export type QVisualDirection = (typeof Q_VISUAL_DIRECTIONS)[number];
export const QVisualDirectionSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,31}$/, "expected a visual direction code");

/** A colour a person chose for their own deck, as #rrggbb. */
export const QDeckColourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "expected a hex colour");

export const QDeckSchema = z
  .object({
    slides: z.array(QSlideSchema).min(1).max(Q_DECK_SLIDES_MAX),
    direction: QVisualDirectionSchema.default("MINIMAL_INSTITUTIONAL"),
    /**
     * A brand colour the founder gave, as content: it describes their
     * company, it travels into a PPTX and a PDF, and it is not a design
     * token. Absent is the common case and a perfectly good deck — the
     * direction decides.
     */
    accent: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "expected a hex colour")
      .optional(),
    /**
     * Set when the mark on the deck is something Q drew rather than the
     * company's own. A deck-only draft is not a brand, and saying so is
     * the difference between a placeholder and a quiet rewrite of
     * somebody's identity (QX-004 §3.2).
     */
    markIsDraft: z.boolean().default(false),
    /**
     * The cover's look, only when the person asked for it in words ("make
     * the first page a green and white gradient, the name in black";
     * founder live 2026-09-29, ADR 0025). One colour is a fill, two are a
     * gradient from the first to the second. Content like the accent: it
     * describes their deck, never the Capital Q chrome. Absent is the
     * direction's own cover.
     */
    cover: z
      .object({
        background: z.array(QDeckColourSchema).min(1).max(2),
        titleInk: QDeckColourSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type QDeck = z.infer<typeof QDeckSchema>;

/**
 * The whole of one version's content.
 *
 * Bounded on every axis, and expressible only in these members. That is
 * the same guarantee the persisted result blocks give: what cannot be said
 * in this contract cannot be stored, so a provider payload, a retrieval
 * chunk, a tool scratchpad or anything resembling chain-of-thought has no
 * member to arrive in.
 */
export const QArtifactContentSchema = z
  .object({
    sections: z
      .array(QArtifactSectionSchema)
      .min(1)
      .max(Q_ARTIFACT_SECTIONS_MAX),
    /**
     * What Q could not establish, in its own words. Kept out of the
     * sections so it cannot be mistaken for content and so a reader can
     * see the shape of the gap at a glance. Unknown stays unknown.
     */
    gaps: z.array(z.string().trim().min(1).max(300)).max(24).default([]),
    /**
     * Present when this artifact is a deck. The sections stay where they
     * are and stay authoritative for grounding: every slide names the
     * section it rests on, so one reader looking at slides and another
     * looking at what is behind them are reading the same artifact rather
     * than two that drifted apart.
     */
    deck: QDeckSchema.optional(),
  })
  .strict();
export type QArtifactContent = z.infer<typeof QArtifactContentSchema>;

/** One composed version. Append-only: a later version never edits this one. */
export const QArtifactVersionSchema = z
  .object({
    artifactId: QArtifactIdSchema,
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    summary: z.string().trim().min(1).max(Q_ARTIFACT_SUMMARY_MAX),
    content: QArtifactContentSchema,
    /**
     * What the person asked for, when this version exists because they
     * asked for a change. Absent on the first version, which nobody
     * revised into being.
     */
    instruction: z.string().trim().max(Q_ARTIFACT_INSTRUCTION_MAX).optional(),
    /** The Q run that composed it. Provenance, never authorisation. */
    composedByRunId: QRunIdSchema.optional(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type QArtifactVersion = z.infer<typeof QArtifactVersionSchema>;

/** Enough to render a card or a list row, and nothing more. */
export const QArtifactSummarySchema = z
  .object({
    artifactId: QArtifactIdSchema,
    type: QArtifactTypeSchema,
    status: QArtifactStatusSchema,
    title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
    /** Absent while it is still being prepared, or if preparing failed. */
    summary: z.string().trim().max(Q_ARTIFACT_SUMMARY_MAX).optional(),
    /** What it is about. A reference the reader resolves under their own permissions. */
    subject: QSubjectRefSchema.optional(),
    currentVersion: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type QArtifactSummary = z.infer<typeof QArtifactSummarySchema>;

/** The artifact, its current version, and what came before it. */
export const QArtifactDetailSchema = z
  .object({
    artifact: QArtifactSummarySchema,
    /** Absent while PREPARING, and when preparing failed. */
    current: QArtifactVersionSchema.optional(),
    /**
     * Every version, newest first, without their content: a history list
     * should not carry the whole of every draft ever written.
     */
    history: z
      .array(
        z
          .object({
            version: z.number().int().min(1),
            title: z.string().trim().min(1).max(Q_ARTIFACT_TITLE_MAX),
            instruction: z
              .string()
              .trim()
              .max(Q_ARTIFACT_INSTRUCTION_MAX)
              .optional(),
            createdAt: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type QArtifactDetail = z.infer<typeof QArtifactDetailSchema>;

export const Q_ARTIFACTS_PATH = "/v1/q/artifacts" as const;
export const qArtifactPath = (artifactId: string) =>
  `${Q_ARTIFACTS_PATH}/${encodeURIComponent(artifactId)}`;
export const Q_ARTIFACT_VERSIONS_SUFFIX = "/versions" as const;

/**
 * PUBLIC. What a client may say when it asks Q to prepare one.
 *
 * What it may not say, and what fails validation if it tries: who it is,
 * which tenant or organisation owns the result, what it may read, or what
 * the content should be. Ownership and authority are resolved on the
 * server from the session; the subject is checked against them.
 */
export const CreateQArtifactRequestSchema = z
  .object({
    type: QArtifactTypeSchema,
    /** What it should be about. The server checks this is theirs to ask about. */
    subject: QSubjectRefSchema,
    /** Optional steer, in the person's own words. Never instructions to the system. */
    instruction: z.string().trim().max(Q_ARTIFACT_INSTRUCTION_MAX).optional(),
  })
  .strict();
export type CreateQArtifactRequest = z.infer<
  typeof CreateQArtifactRequestSchema
>;

/** PUBLIC. "Edit with Q": what to change, in the person's own words. */
export const ReviseQArtifactRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(Q_ARTIFACT_INSTRUCTION_MAX),
  })
  .strict();
export type ReviseQArtifactRequest = z.infer<
  typeof ReviseQArtifactRequestSchema
>;

export const ListQArtifactsResponseSchema = z
  .object({
    items: z.array(QArtifactSummarySchema).max(100),
    /** Cursor, never an offset: the list changes under the reader. */
    nextBefore: UtcTimestampSchema.optional(),
  })
  .strict();
export type ListQArtifactsResponse = z.infer<
  typeof ListQArtifactsResponseSchema
>;

/**
 * The files an artifact can be downloaded as (BIZ-001).
 *
 * Every artifact type exports as a PDF: a deck as one page per slide,
 * everything else as a printed document. PowerPoint is for types whose
 * content is slides. The set is closed on purpose — a route that takes a
 * format from the URL must be able to refuse anything else before it
 * opens a socket.
 */
export const Q_ARTIFACT_EXPORT_FORMATS = ["pdf", "pptx"] as const;
export type QArtifactExportFormat = (typeof Q_ARTIFACT_EXPORT_FORMATS)[number];
export const QArtifactExportFormatSchema = z.enum(Q_ARTIFACT_EXPORT_FORMATS);
export const Q_ARTIFACT_EXPORT_SUFFIX = "/export" as const;

/** Types whose content is slides, and so also write as PowerPoint. */
const Q_ARTIFACT_TYPES_WITH_SLIDES: ReadonlySet<string> = new Set([
  "PITCH_DECK",
]);

/**
 * What a card may offer for a type it knows only by code. The Q API still
 * decides from the stored content, and says so plainly if they disagree.
 */
export function qArtifactExportFormats(
  type: string,
): readonly QArtifactExportFormat[] {
  return Q_ARTIFACT_TYPES_WITH_SLIDES.has(type) ? ["pdf", "pptx"] : ["pdf"];
}

/**
 * Why an export was refused, in the problem document's `code`.
 *
 * Two refusals a person can act on and that are not "not found": the
 * artifact is still being prepared (or preparing failed), or it has no
 * such file (PowerPoint for a brief). The web turns each into its own
 * sentence rather than one generic failure.
 */
export const Q_ARTIFACT_EXPORT_REFUSALS = [
  "ARTIFACT_NOT_READY",
  "FORMAT_NOT_AVAILABLE",
] as const;
export type QArtifactExportRefusal =
  (typeof Q_ARTIFACT_EXPORT_REFUSALS)[number];
export const QArtifactExportRefusalSchema = z.enum(Q_ARTIFACT_EXPORT_REFUSALS);

export const ListQArtifactsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    before: UtcTimestampSchema.optional(),
    subjectId: UuidSchema.optional(),
  })
  .strict();
export type ListQArtifactsQuery = z.infer<typeof ListQArtifactsQuerySchema>;
