import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * The Investor Twin (founder direction 2026-09-30, C12): a founder
 * rehearses a meeting with an investor, played by Q from what the founder
 * may already see of them, then Q coaches them. The founder's own
 * practice: read and written by them only, never shown to the investor.
 */

export const Q_REHEARSALS_PATH = "/v1/q/rehearsals" as const;
export const Q_INVESTOR_REHEARSALS_PATH =
  "/v1/q/investors/:investorOrganisationId/rehearsals" as const;
export const Q_REHEARSAL_PATH = "/v1/q/rehearsals/:rehearsalId" as const;
export const Q_REHEARSAL_TURNS_PATH =
  "/v1/q/rehearsals/:rehearsalId/turns" as const;
export const Q_REHEARSAL_FINISH_PATH =
  "/v1/q/rehearsals/:rehearsalId/finish" as const;

export const qInvestorRehearsalsPath = (investorOrganisationId: string) =>
  Q_INVESTOR_REHEARSALS_PATH.replace(
    ":investorOrganisationId",
    encodeURIComponent(investorOrganisationId),
  );
export const qRehearsalPath = (rehearsalId: string) =>
  Q_REHEARSAL_PATH.replace(":rehearsalId", encodeURIComponent(rehearsalId));
export const qRehearsalTurnsPath = (rehearsalId: string) =>
  Q_REHEARSAL_TURNS_PATH.replace(
    ":rehearsalId",
    encodeURIComponent(rehearsalId),
  );
export const qRehearsalFinishPath = (rehearsalId: string) =>
  Q_REHEARSAL_FINISH_PATH.replace(
    ":rehearsalId",
    encodeURIComponent(rehearsalId),
  );

export const StartRehearsalRequestSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    /** How many questions the rehearsal should run to. */
    length: z.number().int().min(3).max(20).optional(),
  })
  .strict();
export type StartRehearsalRequest = z.infer<typeof StartRehearsalRequestSchema>;

export const RehearsalTurnRequestSchema = z
  .object({ text: z.string().trim().min(1).max(4_000) })
  .strict();
export type RehearsalTurnRequest = z.infer<typeof RehearsalTurnRequestSchema>;

export const QRehearsalTurnDtoSchema = z
  .object({
    from: z.enum(["INVESTOR", "FOUNDER"]),
    text: z.string().max(4_000),
    at: UtcTimestampSchema,
  })
  .strict();

const RatingSchema = z.enum(["STRONG", "SOLID", "NEEDS_WORK"]);

export const QRehearsalScorecardDtoSchema = z
  .object({
    overall: z.string().max(600),
    dimensions: z
      .array(
        z
          .object({
            name: z.enum([
              "CLARITY",
              "EVIDENCE",
              "HANDLING_PUSHBACK",
              "FIT_TO_THIS_INVESTOR",
              "THE_ASK",
            ]),
            rating: RatingSchema,
            note: z.string().max(300),
          })
          .strict(),
      )
      .max(5),
    strengths: z.array(z.string().max(300)).max(5),
    fixes: z
      .array(
        z
          .object({
            question: z.string().max(300),
            better: z.string().max(500),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export type QRehearsalScorecardDto = z.infer<
  typeof QRehearsalScorecardDtoSchema
>;

export const QRehearsalDtoSchema = z
  .object({
    id: UuidSchema,
    investorOrganisationId: UuidSchema,
    investorName: z.string().max(200),
    status: z.enum(["ACTIVE", "FINISHED"]),
    /** Who Q is playing, in Q's words, and how much rests on their own. */
    persona: z
      .object({
        summary: z.string().max(600),
        style: z.string().max(300),
        priorities: z.array(z.string().max(200)).max(6),
        grounding: z.enum(["THIN", "SOME", "RICH"]),
      })
      .strict(),
    turns: z.array(QRehearsalTurnDtoSchema).max(80),
    asked: z.number().int().min(0),
    length: z.number().int().min(3),
    scorecard: QRehearsalScorecardDtoSchema.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type QRehearsalDto = z.infer<typeof QRehearsalDtoSchema>;

export const QRehearsalListDtoSchema = z
  .object({
    rehearsals: z
      .array(
        z
          .object({
            id: UuidSchema,
            status: z.enum(["ACTIVE", "FINISHED"]),
            asked: z.number().int().min(0),
            createdAt: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type QRehearsalListDto = z.infer<typeof QRehearsalListDtoSchema>;
