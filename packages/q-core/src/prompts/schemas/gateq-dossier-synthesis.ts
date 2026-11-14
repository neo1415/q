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

// ---------------------------------------------------------------------------
// v2 (owner decision 97, 2026-11-14): no count ceiling. A reading may take
// several calls -- one part of a long interview at a time, and a
// continuation when Q has more to write than one answer holds -- so each
// call is told what it is shown, what it is not shown and what earlier
// calls already wrote, and says whether it has more.
// ---------------------------------------------------------------------------

export const GateqDossierSynthesisV2VariablesSchema = z
  .object({
    ...TaskFrameSchema,
    investorName: z.string().min(1).max(200),
    /** Every frozen finding, one per line with ids. UNTRUSTED data. */
    findings: z.string().min(1).max(60_000),
    /** The turns shown in this call, "turn N PERSON|Q: text". UNTRUSTED data. */
    transcript: z.string().max(60_000),
    /**
     * Code's own words on what this call is shown: how many turns exist,
     * which are here and how many are not. Trusted.
     */
    coverage: z.string().min(1).max(1_000),
    /**
     * Points earlier calls of this reading already wrote, one per line, so
     * none is written twice; "(none)" on the first call. UNTRUSTED data.
     */
    written: z.string().min(1).max(60_000),
  })
  .strict();
export type GateqDossierSynthesisV2Variables = z.infer<
  typeof GateqDossierSynthesisV2VariablesSchema
>;

export const GATEQ_DOSSIER_SYNTHESIS_V2_UNTRUSTED = [
  "findings",
  "transcript",
  "written",
] as const;

/**
 * Prose bounds are what code stores; longer prose is clipped by the
 * gateway at a sentence end and code reports it. No list here has a count
 * bound: the output budget bounds one answer, and `more` says another is
 * needed.
 */
export const GateqDossierSynthesisPointV2Schema = z
  .object({
    kind: z.enum(["STRENGTH", "RISK", "QUESTION"]),
    importance: z.enum(["HIGH", "MEDIUM", "LOW"]).catch("MEDIUM"),
    text: z.string().trim().min(1).max(4_000),
    factIds: z.array(z.string().max(64)).default([]),
    turnSeqs: z.array(z.number().int().min(1).max(10_000)).default([]),
  })
  .strict();

export const GateqDossierSynthesisResultV2Schema = z
  .object({
    /** One or two sentences on the whole application; may be empty on a continuation. */
    takeaway: z.string().trim().max(4_000).default(""),
    points: z.array(GateqDossierSynthesisPointV2Schema).default([]),
    /** True when Q has more points than this answer holds. */
    more: z.boolean().default(false),
  })
  .strict();
export type GateqDossierSynthesisResultV2 = z.infer<
  typeof GateqDossierSynthesisResultV2Schema
>;

export const GATEQ_DOSSIER_SYNTHESIS_V2_SCHEMA_VERSION = 2;
