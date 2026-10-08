import { z } from "zod";

import {
  COMPANY_EDITABLE_FIELDS,
  QCapabilitySchema,
  QConfidenceLevelSchema,
} from "@capital-q/contracts";

import { ModelSentenceGesturesEnumSchema } from "../../speech/gesture.js";
import {
  AuthorisedFactsSchema,
  ClarifyingQuestionSchema,
  ConversationTurnsSchema,
  LIST_MAX,
  ModelFindingSchema,
  ModelStatementSchema,
  TaskFrameSchema,
  TEXT_MAX,
} from "./common.js";
import {
  CompanyDimensionCoverageSchema,
  CompanyIntelligenceFindingSchema,
  CompanyMaterialChangeSchema,
} from "./company-intelligence.js";

/**
 * COMPANY_ANALYST (CQ-Q-006 §31): analyse supplied authorised company
 * context as an institutional investment analyst, and answer the person.
 *
 * Variables: what the person asked (untrusted), the authorised facts the
 * runtime assembled (untrusted data, each carrying its truth class), the
 * prior turns (untrusted), and the trusted frame. No score, no ranking,
 * no InvestIQ result: those come from authorised services or not at all.
 */
export const CompanyAnalystVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    capability: QCapabilitySchema,
    /** The person's current message. UNTRUSTED. */
    userMessage: z.string().trim().min(1).max(TEXT_MAX),
    /** Earlier turns of this conversation, oldest first. UNTRUSTED. */
    conversation: ConversationTurnsSchema,
    /** Authorised facts about the subject(s), with truth classes. UNTRUSTED data. */
    authorisedFacts: AuthorisedFactsSchema,
    /** Plain description of the subject(s), trusted, e.g. "the person's own company". */
    subjectDescription: z.string().max(400),
  })
  .strict();
export type CompanyAnalystVariables = z.infer<
  typeof CompanyAnalystVariablesSchema
>;

export const COMPANY_ANALYST_UNTRUSTED = [
  "userMessage",
  "conversation",
  "authorisedFacts",
] as const;

/**
 * The analyst's answer. `answer` is the user-visible text; the rest is
 * structure the runtime can check and later surface as result blocks.
 * A recommendation is a recommendation: never a decision, never a score.
 */
export const CompanyAnalystResultSchema = z
  .object({
    /** Plain-English reply to the person. Markdown allowed, headings only when they help. */
    answer: z.string().trim().min(1).max(TEXT_MAX),
    /** CONCISE for simple factual/operational requests, ANALYTICAL for strategic ones. */
    responseShape: z.enum(["CONCISE", "ANALYTICAL"]),
    findings: z.array(ModelFindingSchema).max(LIST_MAX).default([]),
    /** Material things the supplied context does not establish. */
    missingEvidence: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** Supplied facts that conflict; both sides stated, neither chosen. */
    contradictions: z.array(ModelStatementSchema).max(LIST_MAX).default([]),
    /** True when the request could not be answered from the supplied context. */
    insufficientEvidence: z.boolean(),
    recommendation: z
      .object({
        statement: ModelStatementSchema,
        confidence: QConfidenceLevelSchema,
        assumptions: z.array(ModelStatementSchema).max(10).default([]),
        wouldChangeIf: z.array(ModelStatementSchema).max(10).default([]),
      })
      .strict()
      .nullable(),
    clarifyingQuestions: z.array(ClarifyingQuestionSchema).max(3).default([]),
    /** True when the person asked for something outside authorised context or policy. */
    declined: z.boolean().default(false),
  })
  .strict();
export type CompanyAnalystResult = z.infer<typeof CompanyAnalystResultSchema>;

export const COMPANY_ANALYST_SCHEMA_NAME = "CompanyAnalystResult";
export const COMPANY_ANALYST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// v2 (CQ-Q-020 §41-§42)
// ---------------------------------------------------------------------------

/**
 * v1's variables plus the trusted institutional frame the Company
 * Intelligence specialist establishes before any model runs (§15-§17,
 * §20-§22): open disagreements, figures past their useful life, changes
 * between recorded readings, and dimensions nothing supports.
 *
 * TRUSTED, and outside the untrusted fence, because it is Capital Q's own
 * deterministic reading of institutional state rather than anybody's
 * assertion. The prompt tells the model it may not overturn it — a
 * contradiction the server found is not a thing a model gets to resolve.
 *
 * Defaulted to the empty string so the conversational answer path, which
 * has no such frame, renders exactly as it did under v1.
 */
export const CompanyAnalystV2VariablesSchema =
  CompanyAnalystVariablesSchema.extend({
    institutionalNotes: z
      .string()
      .max(6_000)
      .default("Nothing was established in advance for this request."),
  }).strict();
export type CompanyAnalystV2Variables = z.infer<
  typeof CompanyAnalystV2VariablesSchema
>;

export const COMPANY_ANALYST_V2_UNTRUSTED = [
  ...COMPANY_ANALYST_UNTRUSTED,
] as const;

/**
 * v1's result plus the structured company reading (§13, §14, §60).
 *
 * Every new field is defaulted: a model that answers in the v1 shape still
 * validates, so adding the structure did not narrow what the conversational
 * path accepts. The specialist is what asks for these fields and what
 * checks them; nothing here is trusted merely because it parsed.
 */
/**
 * A statement the PERSON made about their own company in this message, for
 * Capital Q to record as their claim (CQ-Q-RESEARCH-001 §20-§21). The quote
 * must be their words verbatim: the runtime checks it against the message
 * and records nothing otherwise. A paraphrase or an inference is not this.
 */
export const UserStatementSchema = z
  .object({
    quote: z.string().trim().min(3).max(400),
    statement: z.string().trim().min(3).max(500),
    knowledgeKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/)
      .max(128),
    validFrom: z.iso.date().nullable().default(null),
  })
  .strict();
export type UserStatement = z.infer<typeof UserStatementSchema>;

/**
 * A change the PERSON asked for, in THIS message, to one of their own
 * company's declared profile fields (ADR 0011): "put our website as
 * x.com", "add that we're based in Lagos", "change the short description
 * to…". The quote is their words verbatim; the runtime checks it against
 * the message and proposes nothing otherwise. A fact merely stated is a
 * userStatement, not this; this is a request to change what the profile
 * says. Nothing here is applied: it becomes a proposal the person approves.
 */
export const ProfileUpdateSchema = z
  .object({
    field: z.enum(COMPANY_EDITABLE_FIELDS),
    /** The new value, in the field's own form; null clears the field. */
    value: z.string().trim().max(4_000).nullable(),
    quote: z.string().trim().min(3).max(400),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const CompanyAnalystV2ResultSchema = CompanyAnalystResultSchema.extend({
  companyFindings: z
    .array(CompanyIntelligenceFindingSchema)
    .max(LIST_MAX)
    .default([]),
  coverage: z.array(CompanyDimensionCoverageSchema).max(16).default([]),
  materialChanges: z.array(CompanyMaterialChangeSchema).max(12).default([]),
  /** Only when the person, in THIS message, states a fact about their own company. */
  userStatements: z.array(UserStatementSchema).max(5).default([]),
}).strict();
export type CompanyAnalystV2Result = z.infer<
  typeof CompanyAnalystV2ResultSchema
>;

export const COMPANY_ANALYST_V2_SCHEMA_NAME = "CompanyAnalystResult";
export const COMPANY_ANALYST_V2_SCHEMA_VERSION = 2;

/** v2's result plus what the person asked to change (ADR 0011). */
export const CompanyAnalystV3ResultSchema = CompanyAnalystV2ResultSchema.extend(
  {
    /** Only when the person, in THIS message, asks to change their own profile. */
    profileUpdates: z.array(ProfileUpdateSchema).max(6).default([]),
  },
).strict();
export type CompanyAnalystV3Result = z.infer<
  typeof CompanyAnalystV3ResultSchema
>;
export const COMPANY_ANALYST_V3_SCHEMA_VERSION = 3;

/**
 * What the person asked, in THIS message, to be called on Capital Q
 * (ADR 0011): "call me John", "change my name from Daniel to Dan". Their
 * own display name, never a company field. The quote is their words
 * verbatim; the runtime checks it against the message and proposes
 * nothing otherwise. Nothing is applied: it becomes a proposal they
 * approve.
 */
export const DisplayNameRequestSchema = z
  .object({
    value: z.string().trim().min(1).max(80),
    quote: z.string().trim().min(3).max(400),
  })
  .strict();
export type DisplayNameRequest = z.infer<typeof DisplayNameRequestSchema>;

/**
 * v3's result plus the person's request to be called something else, and
 * v2's variables plus what Capital Q remembers about them (ADR 0012).
 */
export const CompanyAnalystV4ResultSchema = CompanyAnalystV3ResultSchema.extend(
  {
    /** Only when the person, in THIS message, asks to be called something else. */
    displayName: DisplayNameRequestSchema.nullable().default(null),
  },
).strict();
export type CompanyAnalystV4Result = z.infer<
  typeof CompanyAnalystV4ResultSchema
>;
export const COMPANY_ANALYST_V4_SCHEMA_VERSION = 4;

/**
 * What the person asked Q to prepare or change, in THIS message
 * (ADR 0011, ADR 0013).
 *
 * "Prepare a short investment brief on my company" is PREPARE; "make the
 * executive summary shorter and less promotional", said while a brief is
 * open, is REVISE. Read as meaning rather than matched as words: a person
 * who says "could you put together something I can send round" is asking
 * for the same thing.
 *
 * `instruction` is the person's own steer in their own words, and it is
 * never an instruction to the system: it reaches the composer as a bounded
 * string of what they want said differently, not as authority over what
 * may be read. The artifact to revise is resolved by the server from the
 * conversation, never named here — a model that could name one could name
 * somebody else's.
 */
export const ARTIFACT_REQUEST_KINDS = ["PREPARE", "REVISE"] as const;
export const ArtifactRequestSchema = z
  .object({
    kind: z.enum(ARTIFACT_REQUEST_KINDS),
    /** The only kind this build composes. Reference data, not an enum. */
    artifactType: z.literal("INVESTMENT_BRIEF"),
    /** What they want, in their words. Empty when they simply asked for one. */
    instruction: z.string().trim().max(2_000).default(""),
    quote: z.string().trim().min(3).max(400),
  })
  .strict();
export type ArtifactRequest = z.infer<typeof ArtifactRequestSchema>;

/**
 * v4's result plus what the person asked Q to prepare (ADR 0013).
 *
 * Nothing here persists anything. The field is a reading; the answer seam
 * validates the quote against the message, resolves the subject from the
 * run's own authorised plan, and only then asks the artifact service to
 * write. A model that fills this field has asked, not acted.
 */
export const CompanyAnalystV5ResultSchema = CompanyAnalystV4ResultSchema.extend(
  {
    artifactRequest: ArtifactRequestSchema.nullable().default(null),
  },
).strict();
export type CompanyAnalystV5Result = z.infer<
  typeof CompanyAnalystV5ResultSchema
>;
export const COMPANY_ANALYST_V5_SCHEMA_VERSION = 5;

/**
 * v5's request, widened to the kinds QX-004 composes.
 *
 * A separate schema rather than an edit to v5's, because a published
 * prompt version is immutable: a run recorded against `company-analyst/v5`
 * must still be explainable by exactly the schema it ran under, and a
 * silently widened one would make that history a guess.
 *
 * The type stays a closed set here even though an artifact type is
 * reference data elsewhere. The two are different questions: storing and
 * returning a type this build has never heard of must work, and letting a
 * model name a type this build has no composer for must not — it would be
 * a request nothing could answer.
 */
export const ARTIFACT_REQUEST_TYPES = [
  "INVESTMENT_BRIEF",
  "PITCH_DECK",
] as const;

/**
 * How a founder said their deck should look, when they said.
 *
 * Named choices, because the alternative — a model emitting colours and
 * sizes per deck — is how every generated deck ends up looking like every
 * other one. Null is the common case and a perfectly good deck.
 */
export const ARTIFACT_VISUAL_DIRECTIONS = [
  "MINIMAL_INSTITUTIONAL",
  "DARK_TECHNICAL",
  "WARM_GROWTH",
] as const;

export const ArtifactRequestV2Schema = z
  .object({
    kind: z.enum(ARTIFACT_REQUEST_KINDS),
    artifactType: z.enum(ARTIFACT_REQUEST_TYPES),
    /** What they want, in their words. Empty when they simply asked for one. */
    instruction: z.string().trim().max(2_000).default(""),
    /** Only when they said how it should look; the composer decides otherwise. */
    visualDirection: z
      .enum(ARTIFACT_VISUAL_DIRECTIONS)
      .nullable()
      .default(null),
    quote: z.string().trim().min(3).max(400),
  })
  .strict();
export type ArtifactRequestV2 = z.infer<typeof ArtifactRequestV2Schema>;

/** v5's result, with the widened request (QX-004 §2, §3). */
export const CompanyAnalystV6ResultSchema = CompanyAnalystV4ResultSchema.extend(
  {
    artifactRequest: ArtifactRequestV2Schema.nullable().default(null),
  },
).strict();
export type CompanyAnalystV6Result = z.infer<
  typeof CompanyAnalystV6ResultSchema
>;
export const COMPANY_ANALYST_V6_SCHEMA_VERSION = 6;

/**
 * v6's result plus the sentences in which the model talks about acting
 * (CQ-QX-007).
 *
 * Q never acts in its prose: Capital Q says what was prepared, applied or
 * refused, from the action it actually created. Models still wrote "I have
 * prepared the update" and "this is ready for your approval" beside that
 * line — sometimes about a proposal that did not exist. Which sentences
 * are about acting is meaning, so the model reads it into this closed
 * field (ADR 0011); the runtime removes those sentences, verbatim, from
 * what the person reads. The field is never shown.
 *
 * Numbered 8 with the prompt version that introduced it; the schema
 * versions before it were numbered by the prompt that first carried them.
 */
export const CompanyAnalystV8ResultSchema = CompanyAnalystV6ResultSchema.extend(
  {
    actionTalk: z.array(ModelStatementSchema).max(6).default([]),
  },
).strict();
export type CompanyAnalystV8Result = z.infer<
  typeof CompanyAnalystV8ResultSchema
>;
export const COMPANY_ANALYST_V8_SCHEMA_VERSION = 8;

/**
 * v12 (founder design 2026-09-28): when the person asks to compare or
 * choose between two to four named companies, investors or options, the
 * analyst may also return them as cards: a name, a line under it, and the
 * few points that matter for what they asked. Side by side only: the
 * charter's rule stands, so there is no order, score or verdict, and
 * choosing stays the person's. Every point is written under the analyst's
 * evidence rules; an unknown stays unknown. Null when the answer is not a
 * comparison. The runtime turns it into a COMPARISON_CARDS block.
 */
export const ModelComparisonCardsSchema = z
  .object({
    title: z.string().trim().max(120).nullable().default(null),
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            subtitle: z.string().trim().max(120).nullable().default(null),
            points: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict();
export type ModelComparisonCards = z.infer<typeof ModelComparisonCardsSchema>;

export const CompanyAnalystV12ResultSchema =
  CompanyAnalystV8ResultSchema.extend({
    comparisonCards: ModelComparisonCardsSchema.nullable().default(null),
  }).strict();
export type CompanyAnalystV12Result = z.infer<
  typeof CompanyAnalystV12ResultSchema
>;
export const COMPANY_ANALYST_V12_SCHEMA_VERSION = 12;

/**
 * v14 (PRESENCE, founder direction 2026-10-01): what Q's particles form
 * while a sentence is said, chosen by the model from a closed set beside
 * the answer and clamped by code (`gesturesForReply`). Empty by default.
 */
export const CompanyAnalystV14ResultSchema =
  CompanyAnalystV12ResultSchema.extend({
    gestures: ModelSentenceGesturesEnumSchema,
  }).strict();
export type CompanyAnalystV14Result = z.infer<
  typeof CompanyAnalystV14ResultSchema
>;
export const COMPANY_ANALYST_V14_SCHEMA_VERSION = 14;

/**
 * What the model is told about `proposalStatus`, in the output schema
 * (the task text is at its size budget).
 */
export const PROPOSAL_STATUS_GUIDANCE =
  "true when the person asks about, or your reply touches on, whether a change, reminder, message, booking or other action is saved, approved, sent, booked, done, declined or waiting for approval. Never state that status yourself: put any sentence that does in actionTalk; Capital Q adds the real status from its approval records. Otherwise false.";

/**
 * v15 (live 2026-10-01, QA open item b): "yes, go ahead" with nothing
 * waiting was answered "The reminder has been saved". Whether a reply is
 * about the status of a proposal is meaning, so the model reads it into
 * this closed field (ADR 0011); the status itself is never the model's --
 * the runtime states it from the Approval Engine's records.
 */
export const CompanyAnalystV15ResultSchema =
  CompanyAnalystV14ResultSchema.extend({
    proposalStatus: z
      .boolean()
      .default(false)
      .describe(PROPOSAL_STATUS_GUIDANCE),
  }).strict();
export type CompanyAnalystV15Result = z.infer<
  typeof CompanyAnalystV15ResultSchema
>;
export const COMPANY_ANALYST_V15_SCHEMA_VERSION = 15;

/**
 * v17 (founder brief 2026-10-05, C1-C5; ADR 0053): "top three", a
 * comparison or a piece of research comes back as answer cards the page
 * lays out, not as a Markdown table or a PDF. The model reads; code
 * counts: each measure's level is the model's reading of the evidence
 * against what the person declared, and Capital Q computes the fit out of
 * 10 and the order from those levels. No number is written here.
 */
export const ANSWER_CARDS_GUIDANCE =
  'Fill when the answer is a set of things to see together: a ranked "top N" of companies or investors (RANKED, 1-10 cards), two to four things compared (SIDE_BY_SIDE, the same measures on every card, in the order asked) or the parts of a piece of research (RESEARCH, 2-5 cards, no measures). Else null. Never write a score, rank or percentage: give each measure a level and Capital Q computes the fit and the order. A level is how well what the evidence shows fits what the person declared (their mandate or their goal), never a verdict on the business; with no evidence the level is UNKNOWN. Reasons: up to three short plain sentences, evidence first. said: one short spoken sentence about that card, naming it. The answer text stays a short spoken summary; never repeat the cards as a table.';

export const ModelAnswerCardSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    line: z.string().trim().max(140).nullable().default(null),
    reasons: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
    measures: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(40),
            level: z.enum(["STRONG", "GOOD", "PARTIAL", "UNKNOWN"]),
            value: z.string().trim().max(80).nullable().default(null),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    view: z.string().trim().max(120).nullable().default(null),
    said: z.string().trim().max(300).nullable().default(null),
    citations: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  })
  .strict();
export type ModelAnswerCard = z.infer<typeof ModelAnswerCardSchema>;

export const ModelAnswerCardsSchema = z
  .object({
    shape: z.enum(["RANKED", "SIDE_BY_SIDE", "RESEARCH"]),
    title: z.string().trim().min(1).max(120),
    cards: z.array(ModelAnswerCardSchema).min(1).max(10),
    followUps: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
  })
  .strict()
  .describe(ANSWER_CARDS_GUIDANCE);
export type ModelAnswerCards = z.infer<typeof ModelAnswerCardsSchema>;

export const CompanyAnalystV17ResultSchema =
  CompanyAnalystV15ResultSchema.extend({
    answerCards: ModelAnswerCardsSchema.nullable().default(null),
  }).strict();
export type CompanyAnalystV17Result = z.infer<
  typeof CompanyAnalystV17ResultSchema
>;
export const COMPANY_ANALYST_V17_SCHEMA_VERSION = 17;

/**
 * v19 (Q room W5, R8): one-pagers and memos as well as briefs and decks.
 * A separate request schema, as v6's was, so v17/v18 runs stay explained
 * by the closed set they ran under.
 */
export const ARTIFACT_REQUEST_TYPES_V3 = [
  "INVESTMENT_BRIEF",
  "PITCH_DECK",
  "ONE_PAGER",
  "MEMO",
] as const;
export const ArtifactRequestV3Schema = ArtifactRequestV2Schema.extend({
  artifactType: z.enum(ARTIFACT_REQUEST_TYPES_V3),
}).strict();
export type ArtifactRequestV3 = z.infer<typeof ArtifactRequestV3Schema>;

export const CompanyAnalystV19ResultSchema =
  CompanyAnalystV17ResultSchema.extend({
    artifactRequest: ArtifactRequestV3Schema.nullable().default(null),
  }).strict();
export type CompanyAnalystV19Result = z.infer<
  typeof CompanyAnalystV19ResultSchema
>;
export const COMPANY_ANALYST_V19_SCHEMA_VERSION = 19;

export const NOTHING_REMEMBERED =
  "Nothing is remembered about this person yet.";

export const CompanyAnalystV4VariablesSchema =
  CompanyAnalystV2VariablesSchema.extend({
    /**
     * What Capital Q remembers about this person and their earlier
     * conversations, rendered by the memory service from their own
     * recorded words. UNTRUSTED: it is what they told Capital Q.
     */
    memory: z.string().max(4_000).default(NOTHING_REMEMBERED),
    /**
     * v16 (prompt-cache order, 2026-10-02): this turn's own notes from
     * Capital Q, carried in the task's tail instead of the charter; steady
     * guidance stays in the charter. Trusted. Older versions do not read it.
     */
    turnNotes: z.string().max(9_400).default(""),
  }).strict();
export type CompanyAnalystV4Variables = z.infer<
  typeof CompanyAnalystV4VariablesSchema
>;

export const COMPANY_ANALYST_V4_UNTRUSTED = [
  ...COMPANY_ANALYST_V2_UNTRUSTED,
  "memory",
] as const;

export const CompanyAnalystV5VariablesSchema = CompanyAnalystV4VariablesSchema;
export type CompanyAnalystV5Variables = CompanyAnalystV4Variables;
export const COMPANY_ANALYST_V5_UNTRUSTED = COMPANY_ANALYST_V4_UNTRUSTED;
