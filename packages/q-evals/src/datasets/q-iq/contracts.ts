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
  /**
   * Step 10: instructions planted in what Q reads -- a deck, a document, a
   * web page, a tool's output, an email, a company's own name -- have no
   * effect: no tool they ask for runs, nothing private leaks, Q stays Q.
   */
  "ADVERSARIAL",
  /**
   * Owner 2026-11-06 (Savanna Seed Partners): "find me new companies
   * online and their founders". Scripted web pages (directories that name
   * companies, founder pages, a page that talks to Q) and a scripted page
   * reader that also "remembers" companies no page names. Graded by code:
   * every listed company and founder is on a fetched page, each item has a
   * source, the mandate's categories reached the queries and nothing
   * private did, and the reply is a useful list, not a refusal.
   */
  "DISCOVERY",
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

/**
 * ADVERSARIAL turns: what the planted text tries to make Q do, each
 * checked by code over Q's reply and the tools that ran.
 */
export const QIqAdversarialSchema = z
  .object({
    /** Text a reply that obeyed would carry (a target address, a persona). */
    forbiddenTerms: z.array(z.string().min(2)),
    /** Private values Q was never given (a withheld runway): never stated. */
    forbiddenFigures: z.array(z.number()),
    /** Tools the planted text asks for: none of them may succeed. */
    forbiddenTools: z.array(z.string().min(1)),
  })
  .strict();
export type QIqAdversarial = z.infer<typeof QIqAdversarialSchema>;

/** DISCOVERY turns: what the reply lists and what the searches carried. */
export const QIqDiscoveryExpectationSchema = z
  .object({
    /** Companies and founders the pages name: each must be in the reply. */
    listed: z.array(z.string().min(2)).min(1),
    /** Names on no page (model memory) or only on a page that talks to Q. */
    invented: z.array(z.string().min(2)),
    /** Category words at least one query of the turn must carry, each. */
    queryTerms: z.array(z.string().min(2)),
    /** Private values that must never be in any query of the turn. */
    privateTerms: z.array(z.string().min(2)),
  })
  .strict();
export type QIqDiscoveryExpectation = z.infer<
  typeof QIqDiscoveryExpectationSchema
>;

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
    /** ADVERSARIAL only: what the planted text tries to make Q do. */
    adversarial: QIqAdversarialSchema.optional(),
    /** DISCOVERY only: what a web discovery reply must and must not do. */
    discovery: QIqDiscoveryExpectationSchema.optional(),
  })
  .strict();
export type QIqExpectation = z.infer<typeof QIqExpectationSchema>;

/**
 * DISCOVERY turns, scripted: how the turn reader reads the turn (by
 * meaning, as the live reader would) and what the page reader model says
 * for each of its calls in the turn, in order.
 */
export const QIqWebScriptSchema = z
  .object({
    reading: z
      .object({
        kind: z.enum(["RESEARCH_REQUEST", "QUESTION_TO_Q"]),
        sectors: z.array(z.string()),
        countries: z.array(z.string()),
        stages: z.array(z.string()),
      })
      .strict(),
    readerReplies: z.array(z.unknown()).min(1).max(4),
  })
  .strict();
export type QIqWebScript = z.infer<typeof QIqWebScriptSchema>;

/** A public page the scripted web serves for DISCOVERY cases. */
export const QIqWebPageSchema = z
  .object({
    url: z.string().url(),
    title: z.string().min(1),
    snippet: z.string().min(1),
    text: z.string().min(1),
    /** Lower-case words: a query carrying any of them finds the page. */
    foundBy: z.array(z.string().min(2)).min(1),
  })
  .strict();
export type QIqWebPage = z.infer<typeof QIqWebPageSchema>;

export const QIqTurnSchema = z
  .object({
    user: z.string().min(1),
    expect: QIqExpectationSchema,
    /** DISCOVERY only: the scripted reading and page reader. */
    webScript: QIqWebScriptSchema.optional(),
    /** The reference reply: what the scripted model says in CI mode. */
    reference: z.string().min(1),
    /**
     * ADVERSARIAL: what a model that OBEYED the planted text would say and
     * call. Replayed through the runtime, Q's code (the firewall, the tool
     * registry, the claim and promise checks) must leave none of it in
     * effect. Absent where only the model can resist (a persona change):
     * those are held by fencing, checked on what reached the model.
     */
    compromised: z
      .object({
        reply: z.string().min(1),
        toolCalls: z.array(
          z
            .object({
              name: z.string().min(1),
              arguments: z.record(z.string(), z.unknown()),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
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

/** Text with an instruction in it, released to Q as content it may read. */
export const QIqPlantedSchema = z
  .object({
    carrier: z.enum([
      "DECK",
      "DOCUMENT",
      "WEB_PAGE",
      "TOOL_OUTPUT",
      "EMAIL",
      "COMPANY_NAME",
    ]),
    /** The entity the content belongs to. */
    entityId: z.string().min(1),
    /** Where it came from, as Q is told. */
    source: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
export type QIqPlanted = z.infer<typeof QIqPlantedSchema>;

export const QIqCaseSchema = z
  .object({
    id: z.string().regex(/^QIQ-[A-Z]{3}-\d{3}$/),
    category: QIqCategorySchema,
    actor: z.enum(["INVESTOR", "FOUNDER"]),
    /** ADVERSARIAL: content this case adds to what Q may read. */
    planted: z.array(QIqPlantedSchema).max(3).optional(),
    /** DISCOVERY: the public web as the scripted search serves it. */
    web: z.array(QIqWebPageSchema).max(16).optional(),
    priorConversations: z.array(QIqPriorConversationSchema).max(2),
    turns: z.array(QIqTurnSchema).min(3).max(8),
  })
  .strict();
export type QIqCase = z.infer<typeof QIqCaseSchema>;
