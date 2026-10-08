import { z } from "zod";

import { QPageManifestSchema } from "./screen-manifest.js";
import { QUiActIntentSchema, QUiActReceiptSchema } from "./ui-act.js";

/**
 * RECOVERY-2026-10 (workstream C, docs/recovery/specs/C-app-control.md
 * §3.2): the browser reports what came of Q's UI acts, so Q knows DONE,
 * TARGET_MISSING, NOT_APPLICABLE or FAILED and never claims an act it has
 * no receipt for. Additive beside the lead's frozen ui-act.ts.
 *
 * Each entry pairs the act Q's answer carried with its receipt; the page's
 * manifest after the acts rides along, so the next turn reads the new
 * screen. Ids and closed kinds only, as everywhere on the wire. The Q API
 * keys what it keeps by the actor it resolves itself, never by anything
 * in the body.
 */
export const Q_UI_ACT_RECEIPTS_PATH = "/v1/q/ui-act-receipts" as const;
export const Q_UI_ACT_RECEIPTS_MAX = 16;

export const QUiActReportSchema = z
  .object({
    intent: QUiActIntentSchema,
    receipt: QUiActReceiptSchema,
  })
  .strict()
  .refine((report) => report.intent.actId === report.receipt.actId, {
    message: "a receipt answers its own act",
    path: ["receipt", "actId"],
  });
export type QUiActReport = z.infer<typeof QUiActReportSchema>;

/**
 * An in-app route as the browser's router settled on it: fixed segments,
 * record ids and codes only (the app's own route map built it), never
 * labels or free text.
 */
export const QAppRouteSchema = z
  .string()
  .max(300)
  .regex(/^\/[A-Za-z0-9/_\-?=&.%#]*$/);

/**
 * INC-1 (2026-10-08): a move Q made ("open Shiftwell's data room") and
 * whether it landed -- DONE with the route the router settled on, or
 * FAILED when it never did -- so a move is never claimed without one.
 */
export const QNavigationReceiptSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("DONE"),
      expected: QAppRouteSchema.nullable(),
      route: QAppRouteSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("FAILED"),
      expected: QAppRouteSchema.nullable(),
    })
    .strict(),
]);
export type QNavigationReceipt = z.infer<typeof QNavigationReceiptSchema>;
export const Q_NAVIGATION_RECEIPTS_MAX = 8;

export const QUiActReceiptsRequestSchema = z
  .object({
    reports: z.array(QUiActReportSchema).max(Q_UI_ACT_RECEIPTS_MAX),
    navigations: z
      .array(QNavigationReceiptSchema)
      .max(Q_NAVIGATION_RECEIPTS_MAX)
      .optional(),
    manifest: QPageManifestSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.reports.length > 0 || (request.navigations?.length ?? 0) > 0,
    { message: "a report carries at least one receipt", path: ["reports"] },
  );
export type QUiActReceiptsRequest = z.infer<typeof QUiActReceiptsRequestSchema>;

export const QUiActReceiptsResponseSchema = z
  .object({
    accepted: z
      .number()
      .int()
      .min(0)
      .max(Q_UI_ACT_RECEIPTS_MAX + Q_NAVIGATION_RECEIPTS_MAX),
  })
  .strict();
export type QUiActReceiptsResponse = z.infer<
  typeof QUiActReceiptsResponseSchema
>;
