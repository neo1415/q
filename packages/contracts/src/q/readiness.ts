import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
import { QEvidenceRefSchema } from "./evidence-ref.js";
import {
  BlueprintExecutorSchema,
  BlueprintPillarSchema,
} from "./readiness-blueprint.js";

/**
 * The founder's readiness diagnosis (PADL #85 Layer 1, free; #106): for
 * each InvestIQ pillar, a status in words and the evidence behind it, what
 * could stop the raise, the action plan, and what Q still wants to know.
 *
 * Founder-private (Context Firewall): computed for the founder's own
 * company only, never shown to an investor, never read by ranking,
 * matching or discovery. Deterministic: a versioned rules config over the
 * company's records; no model, no score, no percentage. UNKNOWN means Q has
 * nothing to go on and is never counted against the company.
 */

export const READINESS_PATH = "/v1/readiness" as const;
/** `POST` body `{ done }`: the founder marks an action done, or reopens it. */
export const READINESS_ACTION_STATE_PATH =
  "/v1/readiness/actions/:actionKey/state" as const;
/** `POST`: answer one of Q's follow-up questions. */
export const READINESS_QUESTION_ANSWER_PATH =
  "/v1/readiness/questions/:questionId/answer" as const;
/** `POST`: set one aside ("not now"); nothing is written. */
export const READINESS_QUESTION_DISMISS_PATH =
  "/v1/readiness/questions/:questionId/dismiss" as const;

export const READINESS_STATUSES = [
  "STRONG",
  "DEVELOPING",
  "GAP",
  "UNKNOWN",
] as const;
export const ReadinessStatusSchema = z.enum(READINESS_STATUSES);
export type ReadinessStatus = z.infer<typeof ReadinessStatusSchema>;

/** The words a person sees. Unknown is neutral: "Not shared yet". */
export const READINESS_STATUS_LABELS: Readonly<
  Record<ReadinessStatus, string>
> = {
  STRONG: "Strong",
  DEVELOPING: "Developing",
  GAP: "Gap",
  UNKNOWN: "Not shared yet",
};

export const READINESS_EVIDENCE_SOURCES = [
  "CLAIM",
  "DECK",
  "DATA_ROOM",
  "PROFILE",
  "RAISE",
  "VERIFICATION",
] as const;

const ActionKeySchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const ReadinessEvidenceLineSchema = z
  .object({
    label: z.string().min(1).max(200),
    source: z.enum(READINESS_EVIDENCE_SOURCES),
    /** ADR-001 axes, separate; null where the source carries none (a deck reading). */
    truthClass: TruthClassSchema.nullable(),
    evidenceStatus: EvidenceStatusSchema.nullable(),
    /** A short word for the source's own state ("Clear", "In data room"). */
    note: z.string().max(80).nullable(),
    ref: QEvidenceRefSchema.nullable(),
  })
  .strict();
export type ReadinessEvidenceLine = z.infer<typeof ReadinessEvidenceLineSchema>;

export const ReadinessPillarSchema = z
  .object({
    pillar: BlueprintPillarSchema,
    label: z.string().min(1).max(60),
    status: ReadinessStatusSchema,
    /** One line: what Q can see, and what is missing. */
    summary: z.string().min(1).max(300),
    evidence: z.array(ReadinessEvidenceLineSchema).max(30),
    /** What would move it, from the rules' own words. */
    improve: z.array(z.string().min(1).max(200)).max(6),
  })
  .strict();
export type ReadinessPillar = z.infer<typeof ReadinessPillarSchema>;

export const ReadinessBlockerSchema = z
  .object({
    /** The rule's check id; the free diagnosis' finding id (Blueprint `closesGapId`). */
    id: z.string().min(1).max(60),
    pillar: BlueprintPillarSchema,
    /** MISSING: not shared. UNSUPPORTED: stated, no document behind it. CONTRADICTED: two readings. */
    kind: z.enum(["MISSING", "UNSUPPORTED", "CONTRADICTED"]),
    title: z.string().min(1).max(160),
    why: z.string().min(1).max(400),
    actionKey: ActionKeySchema,
  })
  .strict();
export type ReadinessBlocker = z.infer<typeof ReadinessBlockerSchema>;

export const READINESS_ACTION_STATES = [
  "OPEN",
  /** Q sees the evidence now; the action closed itself. */
  "DONE_BY_EVIDENCE",
  /** The founder ticked it; the pillar still moves only on evidence. */
  "MARKED_DONE",
] as const;

export const ReadinessActionSchema = z
  .object({
    key: ActionKeySchema,
    pillar: BlueprintPillarSchema,
    closesGapId: z.string().min(1).max(60),
    priority: z.enum(["NOW", "NEXT", "LATER"]),
    title: z.string().min(1).max(160),
    /** Why it matters to investors, in plain words. */
    why: z.string().min(1).max(400),
    next: z.string().min(1).max(300),
    doneWhen: z.string().min(1).max(300),
    owner: BlueprintExecutorSchema,
    ownerLabel: z.string().min(1).max(60),
    state: z.enum(READINESS_ACTION_STATES),
    doneAt: z.string().nullable(),
    /** Where the founder does it in the app. */
    href: z.string().max(200).nullable(),
    /** What to ask Q when Q can do it (it prepares; the founder approves). */
    askQ: z.string().max(300).nullable(),
  })
  .strict();
export type ReadinessAction = z.infer<typeof ReadinessActionSchema>;

export const ReadinessFollowUpSchema = z
  .object({
    questionId: UuidSchema,
    question: z.string().min(1).max(500),
    why: z.string().max(500).nullable(),
    reason: z.enum([
      "CONTRADICTION",
      "REQUIRED_AND_UNANSWERED",
      "AMBIGUITY",
      "MATERIAL_GAP",
      "EXCLUSION_CONFIRMATION",
    ]),
    pillar: BlueprintPillarSchema.nullable(),
    /** The competing figures behind a contradiction; the founder chooses. */
    readings: z.array(z.string().max(300)).max(6),
    /** One tap answers, in order; answer by index. */
    quickAnswers: z.array(z.string().min(1).max(120)).max(20),
    /** What a typed answer must be. NONE: only the quick answers. */
    typed: z.enum(["NUMBER", "TEXT", "NONE"]),
    /** False: this lives on another page now (`editHref`); it can be set aside. */
    answerable: z.boolean(),
    editHref: z.string().max(200).nullable(),
    askedAt: z.string(),
  })
  .strict();
export type ReadinessFollowUp = z.infer<typeof ReadinessFollowUpSchema>;

export const ReadinessDtoSchema = z
  .object({
    companyId: UuidSchema,
    rulesVersion: z.string().min(1).max(40),
    /** Revision of the stored assessment; moves only when the evidence changes. */
    revision: z.number().int().min(1),
    assessedAt: z.string(),
    stageCode: z.string().max(40).nullable(),
    pillars: z.array(ReadinessPillarSchema).max(8),
    blockers: z.array(ReadinessBlockerSchema).max(5),
    actions: z.array(ReadinessActionSchema).max(60),
    followUps: z.array(ReadinessFollowUpSchema).max(50),
    /** What Q could not assess, and why, in plain words. */
    uncertainty: z.array(z.string().min(1).max(300)).max(10),
  })
  .strict();
export type ReadinessDto = z.infer<typeof ReadinessDtoSchema>;

export const ReadinessActionStateRequestSchema = z
  .object({ done: z.boolean() })
  .strict();
export type ReadinessActionStateRequest = z.infer<
  typeof ReadinessActionStateRequestSchema
>;

export const ReadinessActionStateResultSchema = z
  .object({
    key: ActionKeySchema,
    state: z.enum(READINESS_ACTION_STATES),
  })
  .strict();

export const ReadinessQuestionAnswerRequestSchema = z
  .object({
    answer: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("QUICK"),
          index: z.number().int().min(0).max(19),
        })
        .strict(),
      z
        .object({
          kind: z.literal("TYPED"),
          text: z
            .string()
            .max(2000)
            .refine((text) => text.trim().length > 0, "say something"),
        })
        .strict(),
    ]),
  })
  .strict();
export type ReadinessQuestionAnswerRequest = z.infer<
  typeof ReadinessQuestionAnswerRequestSchema
>;

export const ReadinessQuestionResultSchema = z
  .object({
    questionId: UuidSchema,
    status: z.enum(["ANSWERED", "DISMISSED"]),
    /** How many follow-ups are still waiting. */
    remaining: z.number().int().min(0),
  })
  .strict();
export type ReadinessQuestionResult = z.infer<
  typeof ReadinessQuestionResultSchema
>;
