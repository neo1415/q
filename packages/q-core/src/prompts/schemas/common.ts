import { z } from "zod";

import {
  EvidenceStatusSchema,
  QCommunicationProfileSchema,
  QConfidenceLevelSchema,
  QFindingTypeSchema,
  QOperatingModeSchema,
  TruthClassSchema,
} from "@capital-q/contracts";

/**
 * Shared shapes for prompt variables and model outputs. The truth,
 * evidence and confidence vocabularies are Capital Q's existing contracts,
 * reused as-is (ADR-001; contracts/evidence; contracts/q): a model output
 * may only speak in those words.
 */

export const TEXT_MAX = 8_000;
export const STATEMENT_MAX = 1_000;
export const LIST_MAX = 24;

/** A bounded string a model may produce. */
export const ModelStatementSchema = z.string().trim().min(1).max(STATEMENT_MAX);

/**
 * One authorised fact handed to a prompt as context. Assembled by the Q
 * runtime from paths the Context Firewall permitted; the renderer never
 * fetches. `statement` is treated as DATA (it may quote a person or a
 * document) and is rendered inside the untrusted fence.
 */
export const AuthorisedFactSchema = z
  .object({
    /** Which authorised knowledge scope the fact came from. */
    scope: z.string().min(1).max(64),
    statement: z.string().trim().min(1).max(TEXT_MAX),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    /** Coarse source description, never a private identifier or path. */
    source: z.string().max(200).optional(),
    asOf: z.string().max(40).optional(),
  })
  .strict();
export type AuthorisedFact = z.infer<typeof AuthorisedFactSchema>;

export const AuthorisedFactsSchema = z.array(AuthorisedFactSchema).max(120);

/** A prior turn of the conversation, as data. */
export const ConversationTurnSchema = z
  .object({
    role: z.enum(["USER", "Q"]),
    content: z.string().trim().min(1).max(32_000),
  })
  .strict();
export const ConversationTurnsSchema = z.array(ConversationTurnSchema).max(64);

/** Variables every task prompt receives from the runtime, never from a client. */
export const TaskFrameSchema = {
  operatingMode: QOperatingModeSchema,
  communicationProfile: QCommunicationProfileSchema,
  /** Rendered communication guidance (from the profile), trusted text. */
  communicationGuidance: z.string().max(4_000),
  /** What the runtime honestly knows about its own limits, trusted text. */
  environmentNotes: z.string().max(2_000),
};

/** A finding as a model may state it: vocabulary only, no ids, no references. */
export const ModelFindingSchema = z
  .object({
    type: QFindingTypeSchema,
    statement: ModelStatementSchema,
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    confidence: QConfidenceLevelSchema,
    /** Which supplied fact(s) or user statements support it; free text, bounded. */
    basis: z.array(z.string().max(300)).max(8).default([]),
  })
  .strict();
export type ModelFinding = z.infer<typeof ModelFindingSchema>;

export const ClarifyingQuestionSchema = z
  .object({
    question: ModelStatementSchema,
    why: z.string().max(400),
  })
  .strict();
