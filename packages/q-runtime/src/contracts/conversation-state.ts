import { z } from "zod";

/**
 * Q intelligence step 2: the durable per-conversation state every model
 * step reads (q_runtime.conversation_states, 20261231250000).
 *
 * The ledger is built by CODE from the conversation's stored turns, blocks
 * and tool results; no model writes it. A model may later *point at* an
 * entry by its ledger ref ("E3"), never add an id: an id that is not in the
 * ledger was never shown to this person and is refused. Like the fact
 * labels (F1…), refs are per-conversation handles, not record ids.
 *
 * Unknown stays unknown: an entity named in words with no record behind it
 * keeps `id: null`; nothing here turns a name into a record.
 */

export const CONVERSATION_LEDGER_BUILDER_VERSION = "ledger-v1";
export const CONVERSATION_SUMMARY_GATE_VERSION = "summary-gate-v1";

export const LEDGER_ENTITY_KINDS = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
  "PERSON",
  "DOCUMENT",
  "PLAN",
  "FIGURE",
] as const;
export const QLedgerEntityKindSchema = z.enum(LEDGER_ENTITY_KINDS);
export type QLedgerEntityKind = z.infer<typeof QLedgerEntityKindSchema>;

/** How an entity reached the conversation. */
export const LEDGER_VIAS = [
  /** Named in the person's own words. */
  "SAID_BY_THEM",
  /** Named in Q's words. */
  "SAID_BY_Q",
  /** One of Q's answer cards. */
  "CARD",
  /** In a comparison Q showed. */
  "COMPARED",
  /** A record Q opened on their screen. */
  "OPENED",
  /** A document Q prepared or referenced. */
  "DOCUMENT",
  /** In a tool result Q read for this person. */
  "FETCHED",
] as const;
export const QLedgerViaSchema = z.enum(LEDGER_VIAS);
export type QLedgerVia = z.infer<typeof QLedgerViaSchema>;

export const QLedgerRefSchema = z.string().regex(/^E[1-9][0-9]{0,3}$/u);
export const QLedgerListRefSchema = z.string().regex(/^L[1-9][0-9]{0,3}$/u);

export const QLedgerEntitySchema = z
  .object({
    ref: QLedgerRefSchema,
    kind: QLedgerEntityKindSchema,
    /** The record id, when a record is behind it; null for a name only. */
    id: z.string().min(1).max(120).nullable(),
    name: z.string().min(1).max(120).nullable(),
    /** Message numbers (1 = the conversation's first message). */
    firstTurn: z.number().int().min(1),
    lastTurn: z.number().int().min(1),
    via: z.array(QLedgerViaSchema).max(LEDGER_VIAS.length),
    /** A person's or a figure's entity (their company), when known. */
    of: QLedgerRefSchema.nullable().default(null),
    /** A figure's value as shown ("$2.4M"); null otherwise. */
    value: z.string().min(1).max(60).nullable().default(null),
  })
  .strict();
export type QLedgerEntity = z.infer<typeof QLedgerEntitySchema>;

/** A list Q showed, in its order: "the second one" counts through it. */
export const QLedgerListSchema = z
  .object({
    ref: QLedgerListRefSchema,
    turn: z.number().int().min(1),
    via: z.enum(["Q_ANSWER", "COMPARISON"]),
    items: z.array(QLedgerRefSchema).min(1).max(24),
  })
  .strict();
export type QLedgerList = z.infer<typeof QLedgerListSchema>;

export const LEDGER_ENTITIES_MAX = 400;
export const LEDGER_LISTS_MAX = 60;

export const QConversationLedgerSchema = z
  .object({
    entities: z.array(QLedgerEntitySchema).max(LEDGER_ENTITIES_MAX),
    lists: z.array(QLedgerListSchema).max(LEDGER_LISTS_MAX),
  })
  .strict();
export type QConversationLedger = z.infer<typeof QConversationLedgerSchema>;

export const EMPTY_CONVERSATION_LEDGER: QConversationLedger = {
  entities: [],
  lists: [],
};

/**
 * Something the conversation left open: a correction to keep applying
 * ("Ledgerline means Ledgerfold"), a reference nothing bound, a pending
 * approval. Corrections come from the reader's reading of the words (a
 * model, by meaning), checked by code against the ledger.
 */
export const QOpenThreadSchema = z
  .object({
    kind: z.enum(["CORRECTION", "UNRESOLVED_REFERENCE", "PENDING_APPROVAL"]),
    turn: z.number().int().min(1),
    /** Their words, as data (UNTRUSTED when rendered). */
    phrase: z.string().min(1).max(120).nullable(),
    /** What it is about (for a correction: what they meant). */
    entityRefs: z.array(QLedgerRefSchema).max(6),
    /** For a correction: what it was mistaken for. */
    replacesRefs: z.array(QLedgerRefSchema).max(6).default([]),
  })
  .strict();
export type QOpenThread = z.infer<typeof QOpenThreadSchema>;

/**
 * Q intelligence step 5: what retrieval may use from the conversation to
 * rewrite "its burn" into "Silo Credit … burn" under that company's
 * filter. The ledger shown to this person this run (stored ledger plus the
 * reads the firewall kept), and the refs the reader bound this turn's
 * pointing words to, already checked against that ledger (step 3).
 * A search hint only: retrieval still narrows its own envelope and can
 * never widen it, and every chunk is authorised in SQL as before.
 */
export type QRetrievalFocus = {
  readonly ledger: QConversationLedger;
  readonly boundRefs: readonly string[];
};

export const OPEN_THREADS_MAX = 50;
export const QOpenThreadsSchema = z
  .array(QOpenThreadSchema)
  .max(OPEN_THREADS_MAX);

export type QConversationState = {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly ledger: QConversationLedger;
  readonly openThreads: readonly QOpenThread[];
  /** The newest message folded in; null before the first fold. */
  readonly throughMessageAt: string | null;
  readonly throughMessageId: string | null;
  readonly messagesFolded: number;
  readonly builderVersion: string;
  /** 0 for a state not yet stored. */
  readonly version: number;
};

/** One revision of the running summary (append-only). */
export type QConversationSummaryRevision = {
  readonly revision: number;
  /** Model-written working memory: UNTRUSTED wherever it is rendered. */
  readonly summary: string;
  readonly coversThroughAt: string;
  readonly coveredMessages: number;
};
