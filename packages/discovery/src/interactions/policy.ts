import {
  type InteractionStrengthClass,
  type InteractionType,
} from "./contracts.js";

/**
 * What each interaction means, and who may write it (doc 19 §66, §167).
 *
 * Two rules live here because both are decisions rather than mechanics, and
 * both are the kind of thing that goes quietly wrong if it is spread across
 * call sites.
 */

/**
 * Semantic weight per type.
 *
 * Doc 19 §66: signals closer to a meeting carry more meaning than watching.
 * ATTENTION is "they looked", CONSIDERATION is "they did something
 * deliberate about it", CONTEXTUAL_DECISION is "they moved past it for now",
 * INTENT is the only class that means what it sounds like — and nothing a
 * client can write ever reaches it.
 *
 * A class, never a number. There is no ordering here, no arithmetic, and
 * REC-005 does not read it. Saying a save is "worth more" than a watch is a
 * ranking decision, and ranking decisions belong in a versioned config.
 */
const STRENGTH_BY_TYPE: Readonly<
  Record<InteractionType, InteractionStrengthClass>
> = {
  IMPRESSION: "ATTENTION",
  WATCH_MILESTONE: "ATTENTION",
  PROFILE_OPEN: "ATTENTION",
  ASK_Q: "CONSIDERATION",
  SAVE: "CONSIDERATION",
  UNSAVE: "CONSIDERATION",
  PASS: "CONTEXTUAL_DECISION",
  INTEREST_OBSERVED: "INTENT",
};

export function strengthClassFor(
  type: InteractionType,
): InteractionStrengthClass {
  return STRENGTH_BY_TYPE[type];
}

/**
 * Which types a client may ever write.
 *
 * INTEREST_OBSERVED is absent, and that absence is the whole point.
 * Expressing interest is a consequential act that creates relationship
 * state, and CQ-NET-010 owns it: it goes through the Network context, with
 * its own authorisation, its own audit and its own idempotency. A
 * recommendation interaction route that could write it would be a second,
 * quieter way to start a relationship — exactly the kind of parallel truth
 * the canonical entity rules exist to prevent.
 *
 * The type exists here so that when that canonical event does arrive, the
 * observation has somewhere honest to live, and so that the refusal below
 * is a tested behaviour rather than a missing case.
 */
const CLIENT_WRITABLE: ReadonlySet<InteractionType> = new Set([
  "IMPRESSION",
  "WATCH_MILESTONE",
  "PROFILE_OPEN",
  "ASK_Q",
  "SAVE",
  "UNSAVE",
  "PASS",
]);

export function isClientWritable(type: InteractionType): boolean {
  return CLIENT_WRITABLE.has(type);
}

/**
 * Which types are observations rather than decisions.
 *
 * An observation is a report about what a person saw; a decision changes
 * durable state they will meet again. The API separates them — bounded
 * telemetry ingest for one, explicit commands for the other — and this is
 * the single place that says which is which.
 */
const OBSERVATIONS: ReadonlySet<InteractionType> = new Set([
  "IMPRESSION",
  "WATCH_MILESTONE",
  "PROFILE_OPEN",
  "ASK_Q",
]);

export function isObservation(type: InteractionType): boolean {
  return OBSERVATIONS.has(type);
}
