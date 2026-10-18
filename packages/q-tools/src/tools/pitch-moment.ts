import { z } from "zod";

import {
  UuidSchema,
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { boundScopeFor } from "../plan.js";
import type { PitchMomentPort } from "../ports.js";

/**
 * get_pitch_moment (R18: "Q watches the video with us").
 *
 * What is said in a pitch around a moment, with times, from the pitch's
 * provider-generated transcript. Two gates, in order:
 *
 *   1. the run's plan: the tool answers only for the pitch the person was
 *      authorised to be viewing when they asked (the Q API checked it with
 *      the playback rule before the run began), and only for a company the
 *      firewall bound;
 *   2. the media context, again, at execution: the transcript is read
 *      under exactly the rule that mints a playback token, so a pitch the
 *      person may not play has no transcript to them.
 *
 * No transcript is UNKNOWN, never "nothing was said"; a pause in speech is
 * an empty window, which is different. The text is machine-generated and
 * labelled so; it is never evidence that a claim in it is true.
 */

export const GET_PITCH_MOMENT = "pitch.moment.get" as const;

const PURPOSES: readonly QTaskClass[] = [
  "COUNTERPARTY_COMPANY_QUESTION",
  "OWN_COMPANY_QUESTION",
  "COMPARISON",
  "GENERAL_QUESTION",
];

export const GET_PITCH_MOMENT_WINDOW_MAX_SECONDS = 120;

export const GetPitchMomentInputSchema = z
  .object({
    pitchId: UuidSchema.describe(
      "The pitch being viewed, as given in the conversation context.",
    ),
    atSeconds: z
      .number()
      .int()
      .min(0)
      .max(7200)
      .describe(
        "The moment in the pitch, in seconds; the current playback position unless the person named another.",
      ),
    windowSeconds: z
      .number()
      .int()
      .min(1)
      .max(GET_PITCH_MOMENT_WINDOW_MAX_SECONDS)
      .default(20)
      .describe("How many seconds either side of the moment to include."),
  })
  .strict();
export type GetPitchMomentInput = z.infer<typeof GetPitchMomentInputSchema>;

export const GetPitchMomentOutputSchema = z
  .object({
    pitchId: UuidSchema,
    atSeconds: z.number().int(),
    /** AVAILABLE: the segments below. PENDING / UNKNOWN: no transcript to read. */
    transcript: z.enum(["AVAILABLE", "PENDING", "UNKNOWN"]),
    segments: z
      .array(
        z
          .object({
            fromSeconds: z.number(),
            toSeconds: z.number(),
            text: z.string(),
          })
          .strict(),
      )
      .max(200),
    source: z.literal("Machine-generated transcript of the pitch video"),
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();
export type GetPitchMomentOutput = z.infer<typeof GetPitchMomentOutputSchema>;

/** The pitch the Q API authorised as being viewed for this run, if any. */
export function viewedPitchIn(
  plan: PermittedContextPlan,
): { readonly mediaAssetId: string; readonly companyId: string } | null {
  const viewing = plan.viewing;
  if (viewing === undefined || viewing === null) return null;
  const bound =
    boundScopeFor(
      plan,
      "COMPANY_PROFILE",
      (filter) => filter.companyId === viewing.companyId,
    ) !== undefined;
  return bound
    ? { mediaAssetId: viewing.mediaAssetId, companyId: viewing.companyId }
    : null;
}

export function createGetPitchMomentTool(
  pitches: PitchMomentPort,
): AnyQToolDefinition {
  return defineQTool<
    GetPitchMomentInput,
    GetPitchMomentOutput,
    GetPitchMomentOutput
  >({
    id: GET_PITCH_MOMENT,
    version: 1,
    status: "ACTIVE",
    providerName: "get_pitch_moment",
    description:
      "What is said in the pitch video the person is watching around a moment, with times, from its machine-generated transcript. Call it whenever the person asks about something in the pitch -- what they just said, what a number was, what came before or after -- using the current playback position unless they name another moment. UNKNOWN means there is no transcript: say you can't hear the pitch yet, never that nothing was said.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("investor.view")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["COMPANY_PROFILE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: GetPitchMomentInputSchema,
    output: GetPitchMomentOutputSchema,
    authorize: async (input, { actor, plan }) => {
      const viewed = viewedPitchIn(plan);
      if (viewed === null || viewed.mediaAssetId !== input.pitchId) {
        return deny("NOT_AVAILABLE");
      }
      try {
        const moment = await pitches.momentAround(actor, {
          pitchId: input.pitchId,
          atMs: input.atSeconds * 1000,
          windowMs: input.windowSeconds * 1000,
        });
        if (moment === null) return deny("NOT_AVAILABLE");
        return allow("NETWORK_VISIBLE", {
          pitchId: input.pitchId,
          atSeconds: input.atSeconds,
          transcript:
            moment.status === "AVAILABLE"
              ? "AVAILABLE"
              : moment.status === "PENDING"
                ? "PENDING"
                : "UNKNOWN",
          segments:
            moment.status === "AVAILABLE"
              ? moment.cues.map((cue) => ({
                  fromSeconds: cue.startMs / 1000,
                  toSeconds: cue.endMs / 1000,
                  text: cue.text,
                }))
              : [],
          source: "Machine-generated transcript of the pitch video",
          truthClass: "USER_CLAIM",
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}
