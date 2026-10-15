import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * GATEQ_DOSSIER_SYNTHESIS (lead decision 2026-10-15). Q's short, nonbinding
 * reading of ONE submitted GateQ application, for the investor it was sent
 * to. Its only inputs are the frozen dossier and transcript of that
 * submission; every point must cite the fact ids or transcript turns it
 * rests on, and the caller drops any point whose citations do not exist.
 * It never scores, ranks or recommends a decision.
 */
export const GateqDossierSynthesisVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The receiving investor organisation's display name. Trusted. */
    investorName: z.string().min(1).max(200),
    /** The frozen dossier's findings, one per line with ids. UNTRUSTED data. */
    findings: z.string().min(1).max(14_000),
    /** The frozen transcript, "turn N PERSON|Q: text". UNTRUSTED data. */
    transcript: z.string().max(14_000),
  })
  .strict();
export type GateqDossierSynthesisVariables = z.infer<
  typeof GateqDossierSynthesisVariablesSchema
>;

export const GATEQ_DOSSIER_SYNTHESIS_UNTRUSTED = [
  "findings",
  "transcript",
] as const;

export const GateqDossierSynthesisPointSchema = z
  .object({
    kind: z.enum(["STRENGTH", "RISK", "QUESTION"]),
    text: z.string().trim().min(1).max(400),
    /** sourceFactId values from FINDINGS this point rests on. */
    factIds: z.array(z.string().max(64)).max(4),
    /** Transcript turn numbers this point rests on. */
    turnSeqs: z.array(z.number().int().min(1).max(10_000)).max(4),
  })
  .strict();

export const GateqDossierSynthesisResultSchema = z
  .object({
    /** One or two sentences: what this application is, on its evidence. */
    takeaway: z.string().trim().min(1).max(600),
    points: z.array(GateqDossierSynthesisPointSchema).max(9),
  })
  .strict();
export type GateqDossierSynthesisResult = z.infer<
  typeof GateqDossierSynthesisResultSchema
>;

export const GATEQ_DOSSIER_SYNTHESIS_SCHEMA_NAME =
  "GateqDossierSynthesisResult";
export const GATEQ_DOSSIER_SYNTHESIS_SCHEMA_VERSION = 1;
