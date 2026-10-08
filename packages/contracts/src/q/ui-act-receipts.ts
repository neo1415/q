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

export const QUiActReceiptsRequestSchema = z
  .object({
    reports: z.array(QUiActReportSchema).min(1).max(Q_UI_ACT_RECEIPTS_MAX),
    manifest: QPageManifestSchema.optional(),
  })
  .strict();
export type QUiActReceiptsRequest = z.infer<typeof QUiActReceiptsRequestSchema>;

export const QUiActReceiptsResponseSchema = z
  .object({ accepted: z.number().int().min(0).max(Q_UI_ACT_RECEIPTS_MAX) })
  .strict();
export type QUiActReceiptsResponse = z.infer<
  typeof QUiActReceiptsResponseSchema
>;
