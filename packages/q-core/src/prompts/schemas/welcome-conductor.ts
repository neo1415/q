import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

/**
 * WELCOME_CONDUCTOR — Q's first minute with a new person (CQ-Q-VOICE-001
 * rework, "arrival"). Q introduces itself in its own words, learns what to
 * call the person, and works out from whatever they say whether they are
 * here to raise or to invest. Nothing here records anything: the platform
 * stores a name the person gave and starts the setup the model inferred,
 * both under the person's own authority.
 */

export const WELCOME_CONDUCTOR_SCHEMA_NAME = "WelcomeConductorResult";
export const WELCOME_CONDUCTOR_SCHEMA_VERSION = 1;

export const WelcomeConductorVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    /** "voice" turns are spoken aloud; "text" turns are read. */
    channel: z.enum(["voice", "text"]),
    /** Trusted: the manner Q carries itself in. */
    personality: z.string().max(800),
    /** True when the speech model renders inline audio tags. */
    expressive: z.boolean(),
    /** True for Q's very first line: nothing was said yet. */
    opening: z.boolean(),
    /** The name Capital Q already has for the person, if any. */
    knownName: z.string().max(120).nullable(),
    recentTurns: z
      .array(
        z.object({
          role: z.enum(["person", "q"]),
          text: z.string().max(1_500),
        }),
      )
      .max(12),
    utterance: z.string().max(2_000),
  })
  .strict();
export type WelcomeConductorVariables = z.infer<
  typeof WelcomeConductorVariablesSchema
>;

export const WELCOME_CONDUCTOR_UNTRUSTED = [
  "recentTurns",
  "utterance",
] as const;

export const WelcomeConductorResultSchema = z
  .object({
    /** Exactly what Q says next: one or two short spoken sentences. */
    reply: z.string().min(1).max(500),
    intent: z.enum([
      "OPENING",
      "FOUNDER",
      "INVESTOR",
      "NAME_ONLY",
      "SMALL_TALK",
      "OFF_TOPIC",
      "QUESTION_FOR_Q",
      "PAUSE",
      "UNCLEAR",
    ]),
    /** The name the person gave to be called by, tidied; null when none was given. */
    name: z.string().max(80).nullable(),
    /** The path the person's words imply, once it is clear. */
    journey: z.enum(["FOUNDER", "INVESTOR"]).nullable(),
    /** When intent is QUESTION_FOR_Q: the question, in the person's words. */
    questionForQ: z.string().max(1_000).nullable(),
  })
  .strict();
export type WelcomeConductorResult = z.infer<
  typeof WelcomeConductorResultSchema
>;
