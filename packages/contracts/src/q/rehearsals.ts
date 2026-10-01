import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Rehearsals (C12 Investor Twin, generalised by REHEARSE, founder direction
 * 2026-10-01): a person rehearses a meeting with someone they are connected
 * to -- a founder with an investor, an investor with a company -- played by
 * Q from a persona built only from what the rehearsing person may see.
 * Their own practice: read and written by them only, never shown to the
 * other side, never evidence.
 */

export const Q_REHEARSALS_PATH = "/v1/q/rehearsals" as const;
export const Q_REHEARSAL_PARTNERS_PATH = "/v1/q/rehearsals/partners" as const;
export const Q_REHEARSAL_PERSONA_PATH =
  "/v1/q/rehearsals/persona/:counterpartKind/:counterpartId" as const;
export const Q_REHEARSAL_MEETING_PATH =
  "/v1/q/rehearsals/meetings/:meetingId" as const;
export const Q_INVESTOR_REHEARSALS_PATH =
  "/v1/q/investors/:investorOrganisationId/rehearsals" as const;
export const Q_REHEARSAL_PATH = "/v1/q/rehearsals/:rehearsalId" as const;
export const Q_REHEARSAL_TURNS_PATH =
  "/v1/q/rehearsals/:rehearsalId/turns" as const;
export const Q_REHEARSAL_FINISH_PATH =
  "/v1/q/rehearsals/:rehearsalId/finish" as const;
export const Q_REHEARSAL_SCREEN_PATH =
  "/v1/q/rehearsals/:rehearsalId/screen" as const;

export const REHEARSAL_COUNTERPART_KINDS = [
  "INVESTOR_ORGANISATION",
  "COMPANY",
] as const;
export const RehearsalCounterpartKindSchema = z.enum(
  REHEARSAL_COUNTERPART_KINDS,
);
export type RehearsalCounterpartKind = z.infer<
  typeof RehearsalCounterpartKindSchema
>;

const enc = encodeURIComponent;
export const qInvestorRehearsalsPath = (investorOrganisationId: string) =>
  Q_INVESTOR_REHEARSALS_PATH.replace(
    ":investorOrganisationId",
    enc(investorOrganisationId),
  );
export const qRehearsalPath = (rehearsalId: string) =>
  Q_REHEARSAL_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalTurnsPath = (rehearsalId: string) =>
  Q_REHEARSAL_TURNS_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalFinishPath = (rehearsalId: string) =>
  Q_REHEARSAL_FINISH_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalScreenPath = (rehearsalId: string) =>
  Q_REHEARSAL_SCREEN_PATH.replace(":rehearsalId", enc(rehearsalId));
export const qRehearsalPersonaPath = (
  kind: RehearsalCounterpartKind,
  counterpartId: string,
) =>
  Q_REHEARSAL_PERSONA_PATH.replace(":counterpartKind", enc(kind)).replace(
    ":counterpartId",
    enc(counterpartId),
  );
export const qRehearsalMeetingPath = (meetingId: string) =>
  Q_REHEARSAL_MEETING_PATH.replace(":meetingId", enc(meetingId));

/**
 * The browser's own cue on the voice line that the person raised their
 * hand. A fixed token the browser sends, never the person's words; the
 * rehearsal turn takes it out before anything reads the transcript.
 */
export const REHEARSAL_HAND_RAISED_SIGNAL = "[hand-raised]" as const;
/**
 * The browser's own cue that the person has said nothing for a while, so
 * the played person can react to the silence. Never the person's words.
 */
export const REHEARSAL_SILENCE_SIGNAL = "[silence]" as const;

/** How hard the person asks to be pushed. */
export const REHEARSAL_DIFFICULTIES = ["GENTLE", "REALISTIC", "TOUGH"] as const;
export const RehearsalDifficultySchema = z.enum(REHEARSAL_DIFFICULTIES);
export type RehearsalDifficulty = z.infer<typeof RehearsalDifficultySchema>;

export const RehearsalCounterpartSchema = z
  .object({
    kind: RehearsalCounterpartKindSchema,
    id: UuidSchema,
  })
  .strict();

export const StartRehearsalRequestSchema = z
  .object({
    /** Legacy (C12): a founder's rehearsal with an investor organisation. */
    investorOrganisationId: UuidSchema.optional(),
    counterpart: RehearsalCounterpartSchema.optional(),
    /** The booked call this rehearsal is for; checked to be theirs. */
    meetingId: UuidSchema.optional(),
    /** The voice the other person speaks with. */
    voice: z.enum(["FEMALE", "MALE"]).optional(),
    difficulty: RehearsalDifficultySchema.optional(),
    /** Kept for C12 callers; the meeting now runs to a natural close. */
    length: z.number().int().min(3).max(20).optional(),
  })
  .strict()
  .refine(
    (body) =>
      (body.investorOrganisationId === undefined) !==
      (body.counterpart === undefined),
    { message: "name exactly one counterpart" },
  );
export type StartRehearsalRequest = z.infer<typeof StartRehearsalRequestSchema>;

export const RehearsalTurnRequestSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(4_000) }).strict(),
  z.object({ cue: z.literal("HAND_RAISED") }).strict(),
]);
export type RehearsalTurnRequest = z.infer<typeof RehearsalTurnRequestSchema>;

/** One frame of the screen the person chose to share; never stored. */
export const REHEARSAL_SCREEN_MAX_CHARS = 480_000;
export const RehearsalScreenRequestSchema = z
  .object({
    image: z
      .string()
      .max(REHEARSAL_SCREEN_MAX_CHARS)
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type RehearsalScreenRequest = z.infer<
  typeof RehearsalScreenRequestSchema
>;

export const REHEARSAL_MOODS = [
  "WARM",
  "NEUTRAL",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
  "ANGRY",
  "SAD",
  "AUTHORITATIVE",
  "MEEK",
  "SARCASTIC",
  "AMUSED",
  "HAPPY",
  "DISAPPOINTED",
] as const;
export const REHEARSAL_OUTCOMES = [
  "INDECISIVE",
  "STRONG_LATER",
  "ADJOURNED",
  "DEAL_AGREED",
  "DECLINED",
  "LEFT_EARLY",
] as const;
export const RehearsalOutcomeSchema = z.enum(REHEARSAL_OUTCOMES);
export type RehearsalOutcome = z.infer<typeof RehearsalOutcomeSchema>;

export const QRehearsalTurnDtoSchema = z
  .object({
    /** THEM: the person Q plays. YOU: the person rehearsing. */
    from: z.enum(["THEM", "YOU"]),
    text: z.string().max(4_000),
    at: UtcTimestampSchema,
    mood: z.enum(REHEARSAL_MOODS).nullable(),
    /** A frame of their shared screen was in view for this line. */
    sawScreen: z.boolean(),
    /** How loud the played person said it, and any sound before it. */
    intensity: z.enum(["SOFT", "NORMAL", "RAISED"]).optional(),
    reaction: z.enum(["LAUGH", "CHUCKLE", "SIGH", "CRY"]).nullable().optional(),
  })
  .strict();
export type QRehearsalTurnDto = z.infer<typeof QRehearsalTurnDtoSchema>;

const RatingSchema = z.enum(["STRONG", "SOLID", "NEEDS_WORK"]);

export const REHEARSAL_DIMENSION_NAMES = [
  "CLARITY",
  "EVIDENCE",
  "HANDLING_PUSHBACK",
  "FIT_TO_THIS_PERSON",
  "THE_ASK",
  "QUESTION_QUALITY",
  "RAPPORT",
  "NEXT_STEPS",
  "DILIGENCE",
  "CONTROL",
  "FAIRNESS",
  "DECISION_CLARITY",
  "PROFESSIONALISM",
] as const;

export const QRehearsalReviewDtoSchema = z
  .object({
    overall: z.string().max(600),
    /** 0-100, computed by code from the ratings (never a model's number). */
    score: z.number().int().min(0).max(100).nullable(),
    dimensions: z
      .array(
        z
          .object({
            name: z.enum(REHEARSAL_DIMENSION_NAMES),
            rating: RatingSchema,
            note: z.string().max(300),
          })
          .strict(),
      )
      .max(5),
    wentRight: z
      .array(
        z
          .object({ moment: z.string().max(300), why: z.string().max(300) })
          .strict(),
      )
      .max(5),
    wentWrong: z
      .array(
        z
          .object({
            moment: z.string().max(300),
            why: z.string().max(300),
            better: z.string().max(500),
          })
          .strict(),
      )
      .max(6),
    tips: z.array(z.string().max(300)).max(6),
  })
  .strict();
export type QRehearsalReviewDto = z.infer<typeof QRehearsalReviewDtoSchema>;

export const PERSONA_SOURCE_KINDS = [
  "PROFILE",
  "MESSAGES",
  "CALLS",
  "PUBLIC_WEB",
  "PUBLIC_KNOWLEDGE",
  "PITCH_TRANSCRIPT",
  "DECK",
  "OWN_COMPANY",
] as const;
export type PersonaSourceKind = (typeof PERSONA_SOURCE_KINDS)[number];

export const QPersonaSourceDtoSchema = z
  .object({
    kind: z.enum(PERSONA_SOURCE_KINDS),
    label: z.string().max(200),
    /** A public https URL for a web source; null otherwise. */
    url: z.string().url().max(2048).nullable(),
  })
  .strict();
export type QPersonaSourceDto = z.infer<typeof QPersonaSourceDtoSchema>;

export const QRehearsalCounterpartDtoSchema = z
  .object({
    kind: RehearsalCounterpartKindSchema,
    id: UuidSchema,
    name: z.string().min(1).max(200),
  })
  .strict();
export type QRehearsalCounterpartDto = z.infer<
  typeof QRehearsalCounterpartDtoSchema
>;

export const QRehearsalPersonaDtoSchema = z
  .object({
    counterpart: QRehearsalCounterpartDtoSchema,
    summary: z.string().max(600),
    style: z.string().max(400),
    priorities: z.array(z.string().max(200)).max(6),
    grounding: z.enum(["THIN", "SOME", "RICH"]),
    sources: z.array(QPersonaSourceDtoSchema).max(24),
    refreshedAt: UtcTimestampSchema,
  })
  .strict();
export type QRehearsalPersonaDto = z.infer<typeof QRehearsalPersonaDtoSchema>;

export const QRehearsalDtoSchema = z
  .object({
    id: UuidSchema,
    counterpart: QRehearsalCounterpartDtoSchema,
    userRole: z.enum(["FOUNDER", "INVESTOR"]),
    status: z.enum(["ACTIVE", "FINISHED"]),
    outcome: RehearsalOutcomeSchema.nullable(),
    meetingId: UuidSchema.nullable(),
    voice: z.enum(["FEMALE", "MALE"]),
    difficulty: RehearsalDifficultySchema,
    /**
     * Counted by code from the transcript: their share of the words, their
     * longest answer, how many exchanges, how long. Never a model's number.
     */
    metrics: z
      .object({
        yourShareOfWords: z.number().int().min(0).max(100),
        longestAnswerWords: z.number().int().min(0),
        exchanges: z.number().int().min(0),
        minutes: z.number().int().min(0),
      })
      .strict(),
    /** Their previous finished score with the same person, if any. */
    previousScore: z.number().int().min(0).max(100).nullable(),
    persona: z
      .object({
        summary: z.string().max(600),
        style: z.string().max(400),
        priorities: z.array(z.string().max(200)).max(6),
        grounding: z.enum(["THIN", "SOME", "RICH"]),
      })
      .strict(),
    turns: z.array(QRehearsalTurnDtoSchema).max(160),
    review: QRehearsalReviewDtoSchema.nullable(),
    createdAt: UtcTimestampSchema,
    endedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type QRehearsalDto = z.infer<typeof QRehearsalDtoSchema>;

export const QRehearsalSummaryDtoSchema = z
  .object({
    id: UuidSchema,
    counterpart: QRehearsalCounterpartDtoSchema,
    status: z.enum(["ACTIVE", "FINISHED"]),
    outcome: RehearsalOutcomeSchema.nullable(),
    score: z.number().int().min(0).max(100).nullable(),
    exchanges: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type QRehearsalSummaryDto = z.infer<typeof QRehearsalSummaryDtoSchema>;

export const QRehearsalListDtoSchema = z
  .object({ rehearsals: z.array(QRehearsalSummaryDtoSchema).max(50) })
  .strict();
export type QRehearsalListDto = z.infer<typeof QRehearsalListDtoSchema>;

export const QRehearsalPartnersDtoSchema = z
  .object({
    role: z.enum(["FOUNDER", "INVESTOR"]).nullable(),
    upcoming: z
      .array(
        z
          .object({
            meetingId: UuidSchema,
            startsAt: UtcTimestampSchema,
            purpose: z.string().max(300),
            counterpart: QRehearsalCounterpartDtoSchema,
          })
          .strict(),
      )
      .max(20),
    people: z
      .array(
        z
          .object({
            counterpart: QRehearsalCounterpartDtoSchema,
            relationshipId: UuidSchema,
            state: z.string().max(40),
            lastRehearsal: z
              .object({
                id: UuidSchema,
                at: UtcTimestampSchema,
                score: z.number().int().min(0).max(100).nullable(),
                outcome: RehearsalOutcomeSchema.nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type QRehearsalPartnersDto = z.infer<typeof QRehearsalPartnersDtoSchema>;

export const QRehearsalMeetingDtoSchema = z
  .object({ counterpart: QRehearsalCounterpartDtoSchema })
  .strict();
export type QRehearsalMeetingDto = z.infer<typeof QRehearsalMeetingDtoSchema>;

/** The label every rehearsal surface shows (founder privacy direction). */
export function rehearsalSimulationLabel(name: string): string {
  return `AI rehearsal of ${name}, based on public and shared information`;
}
