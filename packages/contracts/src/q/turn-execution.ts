import { z } from "zod";

/**
 * RC3 (Q voice audit, 15 Nov 2026; owner directive Phase 3 and 5): how
 * much work one turn is allowed to cost, decided from the turn reader's
 * structured reading -- never from the words by a model of its own.
 *
 * Audit evidence: a median of 6 model calls and 12 tool calls per run, and
 * 30 of 35 (investor) / 33 of 42 (founder) short contextual follow-ups
 * re-read the same context. A short contextual follow-up ("why?", "what
 * about the second one?", "say more about the risk") must not pay for a
 * full investigation; each class below names the lane it takes.
 *
 * The class is an execution budget, not authority: every lane still runs
 * under the run's PermittedContextPlan, and reused evidence is reused only
 * for the same tenant, actor, conversation and access context.
 */
export const TURN_EXECUTION_CLASSES = [
  /** A remark, thanks, a control word: no reads, no investigation. */
  "CONVERSATIONAL_ACK",
  /** A short follow-up about Q's last result: answered from its evidence. */
  "CONTEXTUAL_FOLLOW_UP",
  /** A question answered from context already prepared for this turn. */
  "ANSWER_FROM_CONTEXT",
  /** Go somewhere or work the screen. */
  "NAVIGATION",
  /** A query code answers from the app (discover, fit, what needs them). */
  "STRUCTURED_QUERY",
  /** One subject analysed in depth. */
  "COMPLEX_ANALYSIS",
  /** Several subjects or a compound ask: comparison, several parts. */
  "MULTI_SOURCE",
  /** They asked for the public web, news or current outside facts. */
  "PUBLIC_RESEARCH",
  /** Prepare, approve or execute something consequential. */
  "CONSEQUENTIAL_ACTION",
] as const;
export const TurnExecutionClassSchema = z.enum(TURN_EXECUTION_CLASSES);
export type TurnExecutionClass = z.infer<typeof TurnExecutionClassSchema>;

/**
 * Phase 5 (one authoritative result): Q's concise spoken form of the same
 * answer, written by the same model call from the same evidence. The voice
 * says this; the screen shows the full answer and its artifacts. It adds no
 * fact: code keeps it only when every figure and name in it also appears in
 * the full answer (q-core `spokenFormWithin`). Versioned so a reader can
 * tell which rule produced it.
 */
export const Q_SPOKEN_FORM_VERSION = 1 as const;
/** About three short spoken sentences. */
export const Q_SPOKEN_FORM_MAX_LENGTH = 480;
export const QSpokenFormSchema = z
  .object({
    version: z.literal(Q_SPOKEN_FORM_VERSION),
    text: z.string().trim().min(1).max(Q_SPOKEN_FORM_MAX_LENGTH),
  })
  .strict();
export type QSpokenForm = z.infer<typeof QSpokenFormSchema>;
