import { z } from "zod";

/**
 * Q-IQ (Q Intelligence Plan, step 0): a fixed benchmark of multi-turn
 * conversations on FICTIONAL entities. Each turn records what a correct
 * reply must be about (entity ids), which figures it must and may contain,
 * and whether it should answer, say unknown, or ask one clarifying question.
 * Every one of those is asserted by code (CLAUDE.md: no LLM judges an
 * invariant code can assert); a separate rubric covers helpfulness only.
 */

export const Q_IQ_DATASET_VERSION = "q-iq-v1" as const;

export const Q_IQ_CATEGORIES = [
  "PRONOUNS_PEOPLE",
  "ORDINALS_LISTS",
  "FOLLOW_UPS",
  "CORRECTIONS",
  "COMPOUND",
  "UNKNOWN",
  "CONTRADICTIONS",
  "NUMBERS",
  "CROSS_CONVERSATION_MEMORY",
  "AMBIGUITY",
] as const;
export const QIqCategorySchema = z.enum(Q_IQ_CATEGORIES);
export type QIqCategory = z.infer<typeof QIqCategorySchema>;

export const QIqEntityKindSchema = z.enum([
  "COMPANY",
  "INVESTOR",
  "PERSON",
  "DOCUMENT",
]);

export const QIqEntitySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    kind: QIqEntityKindSchema,
    name: z.string().min(2),
    /** Other ways a correct reply may name it ("Ngozi" for Ngozi Eze). */
    aliases: z.array(z.string().min(2)),
  })
  .strict();
export type QIqEntity = z.infer<typeof QIqEntitySchema>;

/** One authorised fact. `figures` are the numbers the statement carries. */
export const QIqFactSchema = z
  .object({
    id: z.string().min(1),
    entityId: z.string().min(1),
    statement: z.string().min(1),
    figures: z.array(z.number()),
    source: z.string().min(1),
    truthClass: z.enum(["VERIFIED", "USER_CLAIM", "ESTIMATE"]),
    evidenceStatus: z.enum([
      "SELF_REPORTED",
      "DOCUMENT_SUPPORTED",
      "MULTI_SOURCE_SUPPORTED",
    ]),
    asOf: z.string().optional(),
  })
  .strict();
export type QIqFact = z.infer<typeof QIqFactSchema>;

export const QIqBehaviourSchema = z.enum(["ANSWER", "UNKNOWN", "CLARIFY"]);
export type QIqBehaviour = z.infer<typeof QIqBehaviourSchema>;

export const QIqExpectationSchema = z
  .object({
    behaviour: QIqBehaviourSchema,
    /** What the reply must be about. Empty for a pure clarify. */
    entityIds: z.array(z.string()),
    /** The confusable entities a wrong reading would answer about. */
    forbiddenEntityIds: z.array(z.string()),
    /** Figures a correct reply must state (any one rendering of the value). */
    requiredFigures: z.array(z.number()),
    /** Figures computed from the facts that a reply may also state. */
    derivedFigures: z.array(z.number()),
    /**
     * Words a correct reply must contain: each inner list is one-of
     * (["pass", "passing", "passed"]). Used for names and decisions.
     */
    requiredTerms: z.array(z.array(z.string().min(1)).min(1)),
    /** CLARIFY only: the readings the question must name. */
    clarifyOptions: z.array(z.string()),
    /** COMPOUND only: how many parts the ask has (reported, graded by figures/terms). */
    parts: z.number().int().min(1),
  })
  .strict();
export type QIqExpectation = z.infer<typeof QIqExpectationSchema>;

export const QIqTurnSchema = z
  .object({
    user: z.string().min(1),
    expect: QIqExpectationSchema,
    /** The reference reply: what the scripted model says in CI mode. */
    reference: z.string().min(1),
  })
  .strict();
export type QIqTurn = z.infer<typeof QIqTurnSchema>;

/** An earlier conversation with the same person, held as stored turns. */
export const QIqPriorConversationSchema = z
  .object({
    when: z.string().min(1),
    turns: z
      .array(
        z.object({ user: z.string().min(1), q: z.string().min(1) }).strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type QIqPriorConversation = z.infer<typeof QIqPriorConversationSchema>;

export const QIqCaseSchema = z
  .object({
    id: z.string().regex(/^QIQ-[A-Z]{3}-\d{3}$/),
    category: QIqCategorySchema,
    actor: z.enum(["INVESTOR", "FOUNDER"]),
    priorConversations: z.array(QIqPriorConversationSchema).max(2),
    turns: z.array(QIqTurnSchema).min(3).max(8),
  })
  .strict();
export type QIqCase = z.infer<typeof QIqCaseSchema>;
