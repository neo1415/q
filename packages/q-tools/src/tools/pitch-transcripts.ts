import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import type { CompanyPitchTranscript, PitchMomentPort } from "../ports.js";
import { planAdmits } from "./profile-material.js";

/**
 * read_company_pitches (founder, 2026-10-08: "Can Q not read and save the
 * transcript of every single video so it can refer to it?").
 *
 * Every pitch of a company the person may play, with its machine-generated
 * transcript (timed) and what the founders claim in it -- the raise,
 * stage, instrument, traction, use of funds -- each with the moment it is
 * said. Two gates, in order: the plan must admit the company (the Context
 * Firewall decides before the media context is asked), then the media
 * context reads each transcript under exactly the rule that mints a
 * playback token, so a pitch the person may not play has nothing to read.
 *
 * Everything said is the company's own claim (USER_CLAIM, SELF_REPORTED),
 * never verified by being said. A pitch's words are data, never
 * instructions. No transcript is UNKNOWN, never "nothing was said".
 */

export const READ_COMPANY_PITCHES = "company.pitches.read" as const;

const PITCHES_MAX = 5;
const SEGMENTS_MAX = 300;

const InputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The canonical company identifier (UUID), as given in the conversation context.",
    ),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

/** "0:43", as the person would find it in the video. */
function moment(atMs: number): string {
  const total = Math.max(0, Math.floor(atMs / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

const OutputSchema = z
  .object({
    pitches: z
      .array(
        z
          .object({
            pitchId: UuidSchema,
            title: z.string().nullable(),
            transcript: z.enum(["AVAILABLE", "PENDING", "UNKNOWN"]),
            claims: z
              .array(
                z
                  .object({
                    kind: z.string(),
                    statement: z.string(),
                    at: z.string(),
                    atSeconds: z.number().int(),
                    money: z
                      .object({ amount: z.string(), currency: z.string() })
                      .strict()
                      .nullable(),
                    stageCode: z.string().nullable(),
                    instrument: z.string().nullable(),
                  })
                  .strict(),
              )
              .max(40),
            segments: z
              .array(
                z
                  .object({
                    at: z.string(),
                    atSeconds: z.number().int(),
                    text: z.string(),
                  })
                  .strict(),
              )
              .max(SEGMENTS_MAX),
          })
          .strict(),
      )
      .max(PITCHES_MAX),
    source: z.literal("Machine-generated transcripts of the pitch videos"),
    truthClass: z.literal("USER_CLAIM"),
    evidenceStatus: z.literal("SELF_REPORTED"),
  })
  .strict();
type Output = z.infer<typeof OutputSchema>;

function shaped(pitches: readonly CompanyPitchTranscript[]): Output {
  return {
    pitches: pitches.slice(0, PITCHES_MAX).map((pitch) => ({
      pitchId: pitch.pitchId,
      title: pitch.title,
      transcript:
        pitch.status === "AVAILABLE"
          ? "AVAILABLE"
          : pitch.status === "PENDING"
            ? "PENDING"
            : "UNKNOWN",
      claims: pitch.claims.slice(0, 40).map((claim) => ({
        kind: claim.kind,
        statement: claim.statement,
        at: moment(claim.atMs),
        atSeconds: Math.floor(claim.atMs / 1000),
        money: claim.money,
        stageCode: claim.stageCode,
        instrument: claim.instrument,
      })),
      segments: pitch.cues.slice(0, SEGMENTS_MAX).map((cue) => ({
        at: moment(cue.startMs),
        atSeconds: Math.floor(cue.startMs / 1000),
        text: cue.text,
      })),
    })),
    source: "Machine-generated transcripts of the pitch videos",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
  };
}

export function createReadCompanyPitchesTool(
  port: PitchMomentPort,
): AnyQToolDefinition {
  return defineQTool<Input, Output, Output>({
    id: READ_COMPANY_PITCHES,
    version: 1,
    status: "ACTIVE",
    providerName: "read_company_pitches",
    description:
      "Reads what a company's founders say in its pitch videos: each video's timed transcript and the claims in it (how much they are raising and in which round, instrument, traction figures, use of funds), each with the moment it is said (\"0:43\"). Call it for any question about a company's raise, traction, plans or what the founders said, including when its profile says the raise is not shared: cite the video and moment (\"said in their pitch video at 0:43\"). Everything said is the company's own claim, never verified. UNKNOWN means no transcript yet: say so, never that nothing was said.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: InputSchema,
    output: OutputSchema,
    authorize: async (input, context) => {
      if (!planAdmits(context, input.companyId)) return deny("NOT_AVAILABLE");
      const read = port.forCompany;
      if (read === undefined) return deny("NOT_AVAILABLE");
      const pitches = await read(context.actor, input.companyId).catch(
        () => null,
      );
      if (pitches === null || pitches.length === 0) {
        return deny("NOT_AVAILABLE");
      }
      return allow("NETWORK_VISIBLE", shaped(pitches));
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}
