import { z } from "zod";

/**
 * A person's shared weekly allowance of provider video sessions, across the
 * GateQ video interview and video Rehearsals (owner decision 2026-10-15).
 * Enforced by the server and the database; this is only what the person is
 * told. Typing (GateQ) and the voice room (Rehearsals) are never limited.
 */
export const VideoAllowanceDtoSchema = z
  .object({
    weeklySessions: z.number().int().min(0).max(100),
    remaining: z.number().int().min(0).max(100),
    /** When this week's allowance starts again (Monday 00:00 UTC). */
    resetsAt: z.string().datetime(),
  })
  .strict();
export type VideoAllowanceDto = z.infer<typeof VideoAllowanceDtoSchema>;
