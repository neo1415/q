import { z } from "zod";

/**
 * What a caller is asking Q to accomplish (doc 12 §7.1).
 *
 * A capability names a product outcome, never an internal route: there is no
 * FOUNDER_AGENT or MATCHING_AGENT here, and adding one would expose the
 * specialist layer that "one Q" exists to hide (QTA-001). The orchestrator
 * decides which specialists a capability needs; the client never does.
 *
 * Deliberately the six the Q architecture names and nothing more. New
 * capabilities are added when a packet implements the behaviour behind them.
 */
export const Q_CAPABILITIES = [
  /** A direct response to a question, grounded where material. */
  "ANSWER",
  /** Evidence-gathering work with specialists, retrieval and verification. */
  "INVESTIGATE",
  /** Two or more authorised subjects set against each other. */
  "COMPARE",
  /** A structured judgement about one subject: readiness, quality, fit. */
  "ASSESS",
  /** Map free text onto canonical taxonomy or vocabulary. */
  "CLASSIFY",
  /** Prepare a consequential action for human approval. Never executes it. */
  "PREPARE_ACTION",
] as const;

export type QCapability = (typeof Q_CAPABILITIES)[number];

export const QCapabilitySchema = z.enum(Q_CAPABILITIES);

/**
 * How much a mistake in this request could cost (doc 12 §8 `consequence`).
 *
 * Resolved by the server from the capability, the subject and policy. It is
 * never accepted from a client, because a caller who could declare their own
 * request low-consequence could route around every approval rule that keys
 * on it.
 */
export const Q_CONSEQUENCE_CLASSES = ["LOW", "MODERATE", "HIGH"] as const;

export type QConsequenceClass = (typeof Q_CONSEQUENCE_CLASSES)[number];

export const QConsequenceClassSchema = z.enum(Q_CONSEQUENCE_CLASSES);

/**
 * Where a Q request originates. Bounded so a run record or a log line can
 * attribute work to a client surface without accepting free text from that
 * surface. Additive: a new client is added here, never sent as an arbitrary
 * string.
 */
export const Q_SOURCE_APPLICATIONS = [
  "CAPITAL_Q_WEB",
  "CAPITAL_Q_MOBILE",
  "GATEQ",
  /** A trusted Capital Q process -- a worker, a scheduled job. */
  "INTERNAL",
] as const;

export type QSourceApplication = (typeof Q_SOURCE_APPLICATIONS)[number];

export const QSourceApplicationSchema = z.enum(Q_SOURCE_APPLICATIONS);

/** How the person is interacting with Q (doc 12 §8 `interaction.modality`). */
export const Q_MODALITIES = ["TEXT", "VOICE", "SYSTEM"] as const;

export type QModality = (typeof Q_MODALITIES)[number];

export const QModalitySchema = z.enum(Q_MODALITIES);

/**
 * The modalities a client may declare. SYSTEM is reserved for trusted
 * internal callers and is refused at the public boundary.
 */
export const Q_CLIENT_MODALITIES = ["TEXT", "VOICE"] as const;

export const QClientModalitySchema = z.enum(Q_CLIENT_MODALITIES);
