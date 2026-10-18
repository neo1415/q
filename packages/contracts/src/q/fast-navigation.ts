import { z } from "zod";

import {
  QNavigateIntentSchema,
  QOpenRecordPageIntentSchema,
  QOpenSettingsIntentSchema,
} from "./ui-intent.js";

/**
 * RECOVERY-2026-10 (workstream C, founder 2026-10-09: "stupid fast"): the
 * screen moves the moment the person's sentence ends. The browser sends
 * the final words (typed, or the voice line's final transcript); the Q API
 * reads them with code alone -- a page by its name, a record by its name,
 * the record authorised through open_page's own checks as the person --
 * and answers in tens of milliseconds. Q's full answer still runs and
 * talks about it; the screen does not move twice.
 *
 * Words travel here exactly as they travel in a run (the person's own
 * message); nothing comes back but a closed intent.
 */
export const Q_FAST_NAVIGATION_PATH = "/v1/q/navigation/resolve" as const;
export const Q_FAST_NAVIGATION_TEXT_MAX = 300;

export const QFastNavigationRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_FAST_NAVIGATION_TEXT_MAX),
    /**
     * False while they are still speaking (an interim transcript): the
     * answer is used to prefetch only, never to move.
     */
    final: z.boolean(),
  })
  .strict();
export type QFastNavigationRequest = z.infer<
  typeof QFastNavigationRequestSchema
>;

export const QFastNavigationResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("NAVIGATE"),
      intent: z.union([
        QNavigateIntentSchema,
        QOpenSettingsIntentSchema,
        QOpenRecordPageIntentSchema,
      ]),
      /** Server time spent resolving, for the latency budget. */
      ms: z.number().int().min(0).max(60_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("LEAVE_TO_Q"),
      ms: z.number().int().min(0).max(60_000),
    })
    .strict(),
]);
export type QFastNavigationResponse = z.infer<
  typeof QFastNavigationResponseSchema
>;
