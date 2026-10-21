import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

import {
  QNavigateIntentSchema,
  QOpenRecordPageIntentSchema,
  QOpenSettingsIntentSchema,
  QRecordPageSchema,
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
    /**
     * Lane 7: the company whose page is on screen, when there is one, so
     * "open the term sheet" looks in that company's data room. Input,
     * never proof: the document tool authorises the read as the person.
     */
    companyId: UuidSchema.optional(),
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

/**
 * Lane 7 (owner 2026-10-21: "names must NOT be required"): when the
 * screen's own reading of "open their deck" / "that one" is torn between
 * two or three records or documents it was already shown, the Q API picks
 * one. It keeps only the candidates the person may open (open_page's and
 * the document tool's own authorize steps, as them), and only then asks
 * one small, capped model call "which one". NONE: undecided in time; the
 * screen then takes its own best or offers the choice.
 *
 * Labels are the screen's words for things it already showed the person:
 * data, never instructions, and never shown to the model for a candidate
 * the person may not open.
 */
export const Q_NAVIGATION_CHOOSE_PATH = "/v1/q/navigation/choose" as const;
export const Q_NAVIGATION_CHOICES_MAX = 3;

export const QNavigationChoiceSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    page: QRecordPageSchema,
    id: UuidSchema,
    companyId: UuidSchema.optional(),
    label: z.string().trim().min(1).max(120),
  })
  .strict();
export type QNavigationChoice = z.infer<typeof QNavigationChoiceSchema>;

export const QNavigationChooseRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_FAST_NAVIGATION_TEXT_MAX),
    candidates: z
      .array(QNavigationChoiceSchema)
      .min(2)
      .max(Q_NAVIGATION_CHOICES_MAX),
  })
  .strict();
export type QNavigationChooseRequest = z.infer<
  typeof QNavigationChooseRequestSchema
>;

export const QNavigationChooseResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("CHOSEN"),
      key: z.string().trim().min(1).max(64),
      /** Whether a model was asked (false: only one was theirs to open). */
      model: z.boolean(),
      ms: z.number().int().min(0).max(60_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("NONE"),
      /** The keys the person may open, best first as sent. */
      allowed: z.array(z.string().trim().min(1).max(64)).max(3),
      ms: z.number().int().min(0).max(60_000),
    })
    .strict(),
]);
export type QNavigationChooseResponse = z.infer<
  typeof QNavigationChooseResponseSchema
>;
