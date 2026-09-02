import { z } from "zod";

/**
 * Whether reprocessing a message is safe.
 *
 * Delivery is at-least-once, so every consumer will eventually see a duplicate.
 * This classification says what that duplicate costs.
 *
 *   REPLAY_SAFE      Reprocessing rebuilds derived state and converges. A
 *                    projection rebuild or a recommendation refresh can be run
 *                    again without external consequence.
 *
 *   SIDE_EFFECTING   Reprocessing causes a consequence outside Capital Q or one
 *                    a person would notice: an email, a calendar invite, an
 *                    executed Q action. These require explicit dedupe before
 *                    the effect, not merely idempotent state writes.
 *
 * The classification is not permission to replay. It records what replay would
 * do, so the runtime can refuse where the answer is unacceptable.
 */
export const REPLAY_SAFETIES = ["REPLAY_SAFE", "SIDE_EFFECTING"] as const;

export type ReplaySafety = (typeof REPLAY_SAFETIES)[number];

export const ReplaySafetySchema = z.enum(REPLAY_SAFETIES);
