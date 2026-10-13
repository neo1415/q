import { z } from "zod";

import {
  ClaimIdSchema,
  FeatureIdSchema,
  SceneIdSchema,
  TourActorSchema,
  ValidUntilSchema,
  VerifierTypeSchema,
} from "./scene-evidence.js";
import {
  ApprovedQuestionIdSchema,
  TourActionSchema,
  type TourAction,
} from "./tour-action.js";

/**
 * Chapters and sealed scene scripts (blueprint §5 "Speech", §6, §8).
 *
 * A line that states a fact is bound to certified claim ids. Numbers, dates
 * and capability claims may come only from those claims, so a CONNECTIVE
 * line (no claims) may carry no digits. Whether a connective line implies
 * a capability is a human review point; the gate cannot read meaning.
 *
 * `timing` keeps Q honest about the screen: BEFORE_ACK lines narrate what
 * is about to happen while the action is pending; AFTER_ACK lines describe
 * it only once the host has acknowledged it visible.
 */

export const LineIdSchema = z.string().regex(/^l\.[a-z0-9][a-z0-9.-]{1,62}$/u);
export const ChapterIdSchema = z
  .string()
  .regex(/^ch\.[a-z0-9][a-z0-9.-]{1,62}$/u);
export type ChapterId = z.infer<typeof ChapterIdSchema>;

export const LINE_TIMINGS = ["BEFORE_ACK", "AFTER_ACK"] as const;
export const LineTimingSchema = z.enum(LINE_TIMINGS);

const DIGIT = /[0-9]/u;

export const SceneLineSchema = z
  .object({
    lineId: LineIdSchema,
    kind: z.enum(["CLAIM", "CONNECTIVE"]),
    text: z.string().trim().min(1).max(600),
    claimIds: z.array(ClaimIdSchema).max(8),
    timing: LineTimingSchema,
    /** Where the wording comes from: a blueprint section or manifest entry. */
    source: z.string().trim().min(1).max(120),
  })
  .strict()
  .refine((l) => l.kind !== "CLAIM" || l.claimIds.length > 0, {
    message: "a CLAIM line names the certified claims it states",
    path: ["claimIds"],
  })
  .refine((l) => l.kind !== "CONNECTIVE" || l.claimIds.length === 0, {
    message: "a CONNECTIVE line states no claim",
    path: ["claimIds"],
  })
  .refine((l) => l.kind !== "CONNECTIVE" || !DIGIT.test(l.text), {
    message: "numbers and dates come only from certified claims",
    path: ["text"],
  });
export type SceneLine = z.infer<typeof SceneLineSchema>;

export const ApprovedQuestionSchema = z
  .object({
    questionId: ApprovedQuestionIdSchema,
    text: z.string().trim().min(1).max(300),
  })
  .strict();
export type ApprovedQuestion = z.infer<typeof ApprovedQuestionSchema>;

export const SCRIPT_STATUSES = ["DRAFT", "OWNER_APPROVED"] as const;

export const SceneScriptSchema = z
  .object({
    sceneId: SceneIdSchema,
    chapterId: ChapterIdSchema,
    title: z.string().trim().min(1).max(120),
    /** Every certified feature this scene demonstrates. */
    featureIds: z.array(FeatureIdSchema).min(1).max(8),
    approvedClaimIds: z.array(ClaimIdSchema).max(32),
    actor: TourActorSchema,
    /** The route pattern the scene ends on; the resume point. */
    expectedRoute: z.string().regex(/^\/[A-Za-z0-9/_[\]-]{0,200}$/u),
    /** Executed one at a time, each only after the last is acknowledged. */
    actions: z.array(TourActionSchema).min(1).max(12),
    lines: z.array(SceneLineSchema).min(1).max(24),
    /** Said in SAFE_FALLBACK, when an action fails or times out. */
    fallbackLines: z.array(SceneLineSchema).min(1).max(4),
    /** The scene that replaces this one at tour start when it is uncertified. */
    fallbackSceneId: SceneIdSchema.nullable(),
    ackTimeoutMs: z.number().int().min(250).max(60_000),
  })
  .strict()
  .refine(
    (s) =>
      s.lines.every((l) =>
        l.claimIds.every((c) => s.approvedClaimIds.includes(c)),
      ),
    {
      message: "every line's claims are approved for the scene",
      path: ["lines"],
    },
  )
  .refine((s) => s.fallbackLines.every((l) => l.kind === "CONNECTIVE"), {
    message: "a fallback states no claim",
    path: ["fallbackLines"],
  })
  .refine(
    (s) => new Set(s.actions.map((a) => a.actionId)).size === s.actions.length,
    { message: "action ids are unique within a scene", path: ["actions"] },
  )
  .refine((s) => s.fallbackSceneId !== s.sceneId, {
    message: "a scene cannot be its own fallback",
    path: ["fallbackSceneId"],
  });
export type SceneScript = z.infer<typeof SceneScriptSchema>;

export const ChapterSchema = z
  .object({
    chapterId: ChapterIdSchema,
    title: z.string().trim().min(1).max(120),
    /** The atlas tab it belongs to (blueprint §3 Feature Atlas). */
    atlasTab: z.enum([
      "INVESTOR",
      "FOUNDER",
      "GATEQ",
      "Q_WORK",
      "MEETINGS",
      "TRUST",
      "DAILY",
      "REHEARSALS",
      "ADMIN",
    ]),
    sceneIds: z.array(SceneIdSchema).min(1).max(16),
  })
  .strict();
export type Chapter = z.infer<typeof ChapterSchema>;

export const TourScriptSchema = z
  .object({
    scriptId: z.string().regex(/^tour\.[a-z0-9][a-z0-9.-]{1,62}$/u),
    scriptVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$/u),
    status: z.enum(SCRIPT_STATUSES),
    /** What still needs a person before this may run for an audience. */
    reviewNote: z.string().trim().min(1).max(1000),
    chapters: z.array(ChapterSchema).min(1).max(32),
    scenes: z.array(SceneScriptSchema).min(1).max(64),
    questions: z.array(ApprovedQuestionSchema).max(64),
  })
  .strict()
  .refine(
    (t) => {
      const ids = new Set(t.scenes.map((s) => s.sceneId));
      return (
        ids.size === t.scenes.length &&
        t.chapters.every((c) => c.sceneIds.every((id) => ids.has(id)))
      );
    },
    { message: "scene ids are unique and every chapter scene exists" },
  )
  .refine(
    (t) => {
      const asked = new Set(t.questions.map((q) => q.questionId));
      return t.scenes.every((s) =>
        s.actions.every((a) => !hasQuestion(a) || asked.has(a.question)),
      );
    },
    { message: "every asked question is in the approved question table" },
  );
export type TourScript = z.infer<typeof TourScriptSchema>;

function hasQuestion(
  action: TourAction,
): action is Extract<TourAction, { question: string }> {
  return (
    action.kind === "buildComparison" || action.kind === "askApprovedQuestion"
  );
}

/**
 * One certification ledger entry, the machine form of a
 * CERTIFICATION_MANIFEST.md entry (same fields). `claimsAllowed` gains a
 * claim id per allowed statement so a script line can cite it.
 */
export const CERTIFICATION_STATUSES = [
  "PRODUCTION_LIVE_VERIFIED",
  "CODE_VERIFIED",
  "PARTIAL",
  "NOT_IMPLEMENTED",
  "CONCEPT",
] as const;
export const CertificationStatusSchema = z.enum(CERTIFICATION_STATUSES);
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>;

export const CertificationEntrySchema = z
  .object({
    featureId: FeatureIdSchema,
    status: CertificationStatusSchema,
    actorContext: TourActorSchema,
    fixture: z.string().trim().min(1).max(300),
    appCommit: z.string().trim().min(1).max(120),
    verifiedAt: z.string().trim().min(1).max(80),
    verifierType: VerifierTypeSchema,
    receipt: z.string().trim().min(1).max(300),
    claimsAllowed: z
      .array(
        z
          .object({
            claimId: ClaimIdSchema,
            text: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    claimsForbidden: z.array(z.string().trim().min(1).max(300)).max(16),
    validUntil: ValidUntilSchema,
  })
  .strict()
  .refine(
    (e) =>
      e.claimsAllowed.every((c) => c.claimId.startsWith(`${e.featureId}.`)),
    {
      message: "an entry's claims belong to its feature",
      path: ["claimsAllowed"],
    },
  );
export type CertificationEntry = z.infer<typeof CertificationEntrySchema>;

export const CertificationLedgerSchema = z
  .array(CertificationEntrySchema)
  .max(256)
  .refine((l) => new Set(l.map((e) => e.featureId)).size === l.length, {
    message: "one entry per feature",
  });
export type CertificationLedger = z.infer<typeof CertificationLedgerSchema>;
