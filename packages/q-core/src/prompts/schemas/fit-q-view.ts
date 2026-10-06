import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * FIT_Q_VIEW (founder brief 2026-10-05, B4; ADR 0052). Q's view beside a
 * deterministic fit profile: Worth a look, Maybe or Probably not, with
 * reasons, the main risk and what to ask about.
 *
 * The fit itself is computed by code and is DATA here. Q's view never
 * changes it: the caller keeps the profile and takes only this verdict,
 * shown as a labelled Q_INFERENCE beside it. The model sees only what the
 * investor may already see: their own fit rows and the company's
 * network-visible one-liner.
 */

export const FIT_Q_VIEW_VERDICTS = [
  "WORTH_A_LOOK",
  "MAYBE",
  "PROBABLY_NOT",
] as const;

export const FitQViewRowSchema = z
  .object({
    parameter: z.string().min(1).max(40),
    outcome: z.enum([
      "STRONG",
      "PARTIAL",
      "MISMATCH",
      "UNKNOWN",
      "NO_PREFERENCE",
    ]),
    reason: z.string().max(200),
  })
  .strict();

export const FitQViewVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The deterministic fit rows. UNTRUSTED data. */
    rows: z.array(FitQViewRowSchema).min(1).max(12),
    /** The band and confidence in words, as shown. Data. */
    fitLabel: z.string().max(80),
    /** Company name and one-liner as the investor sees them. UNTRUSTED. */
    companyDescription: z.string().max(400),
  })
  .strict();
export type FitQViewVariables = z.infer<typeof FitQViewVariablesSchema>;

export const FIT_Q_VIEW_UNTRUSTED = ["rows", "companyDescription"] as const;

export const FitQViewResultSchema = z
  .object({
    verdict: z.enum(FIT_Q_VIEW_VERDICTS),
    /** Two or three reasons in one or two sentences. */
    summary: z.string().trim().min(1).max(400),
    mainRisk: z.string().trim().max(200).nullable(),
    /** What to ask about because it is unknown. */
    unknowns: z.array(z.string().trim().min(1).max(160)).max(3),
  })
  .strict();
export type FitQViewResult = z.infer<typeof FitQViewResultSchema>;

export const FIT_Q_VIEW_SCHEMA_NAME = "FitQViewResult";
export const FIT_Q_VIEW_SCHEMA_VERSION = 1;
