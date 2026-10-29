import { z } from "zod";

import {
  OnboardingAskingAboutSchema,
  OnboardingJourneyTypeSchema,
  OnboardingTurnPendingSchema,
} from "../http/onboarding.js";
import { QConductSchema } from "./conduct.js";
import { QSentenceGesturesSchema } from "./presence.js";

/**
 * One turn of the Q interview, over HTTP (QX-004 core gate: one Q).
 *
 * Capital Q had grown two conversational implementations. The typed
 * onboarding screen composed its own replies in the browser from
 * templates — "Investor type: Angel investor. Noted." and then the step's
 * raw prompt, "Your firm" — while the spoken one ran the Q interviewer in
 * q-api. Two engines, two sets of rules, and the one a person actually
 * demos was the poorer of them: it asked for an organisation the person
 * had typed at registration two screens earlier.
 *
 * This is the seam that makes them one. The interviewer stays in q-api,
 * where it already is; this carries a turn to it and the outcome back, so
 * that a keyboard and a microphone differ in transport and not in what Q
 * knows or how it behaves.
 *
 * The caller's own bearer travels with the request, and the interviewer
 * reads and writes the onboarding session under exactly that authority —
 * no service credential, no ambient tenant. A typed turn can therefore do
 * precisely what the person could have done by tapping.
 */

export const Q_INTERVIEW_PATH = "/v1/q/interview" as const;
export const Q_INTERVIEW_TURN_SEGMENT = "/turn" as const;

/** PUBLIC. What the caller may say; nothing here is authority. */
export const QInterviewTurnRequestSchema = z
  .object({
    onboardingSessionId: z.string().uuid(),
    journeyType: OnboardingJourneyTypeSchema,
    /**
     * What the person said or typed. Empty opens the interview, which is
     * how a first screen asks Q for its greeting.
     */
    utterance: z.string().max(2_000),
    /**
     * A section of the founder profile the person came to fill (lane ov's
     * Overview links "/onboarding/founder?talk=1&section=<key>"): Q opens on
     * that section's question. A key of the shared profile-sections config;
     * unknown keys are ignored. Data, never authority.
     */
    focus: z
      .string()
      .regex(/^[a-z][a-z_]{0,39}$/)
      .optional(),

    /** How it arrived. Transport only: it changes nothing about the rules. */
    channel: z.enum(["text", "voice"]).default("text"),
    /** The conversation so far, oldest first. Untrusted: words, not authority. */
    recentTurns: z
      .array(
        z
          .object({
            role: z.enum(["person", "q"]),
            text: z.string().max(1_500),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    /** The review step whose confirm button they tapped (SayOnboardingRequest). */
    confirmReview: z.string().min(1).max(80).optional(),
  })
  .strict();
export type QInterviewTurnRequest = z.infer<typeof QInterviewTurnRequestSchema>;

/** One step Q is putting on screen, with whatever it should show. */
export const QInterviewAskingSchema = z
  .object({
    stepKey: z.string().min(1).max(80),
    kind: z.string().min(1).max(40),
    options: z
      .array(
        z
          .object({
            key: z.string().min(1).max(80),
            label: z.string().min(1).max(200),
            description: z.string().max(400).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
    maxChoices: z.number().int().min(1).max(60).optional(),
  })
  .strict();

/**
 * What Q said and what the runtime did about it.
 *
 * `reply` is Q's words and is rendered as given: a caller that composed
 * its own sentence from these fields would be the second implementation
 * again. `recorded` is the runtime's answer to what was written, and it
 * is the only evidence of that — never the prose.
 */
export const QInterviewTurnResponseSchema = z
  .object({
    reply: z.string().max(4_000),
    intent: z.string().min(1).max(40),
    asking: QInterviewAskingSchema.nullable(),
    recorded: z.array(z.string().max(80)).max(24),
    skipped: z.array(z.string().max(80)).max(48),
    /** A question Q is taking away to answer; the surface may show a hint. */
    questionForQ: z.string().max(1_000).nullable(),
    /** The subject Q has gone to read about in public, if any. */
    researching: z.string().max(200).nullable(),
    navigate: z.string().max(40).nullable(),
    handoff: z.literal("FORM").nullable(),
    /** True when no model could be reached and Q said so plainly. */
    degraded: z.boolean(),
    /**
     * The steps Q's reply actually asks about, in order (CQ-QX-008): what
     * the screen's choices and a test driver follow — Q, never the
     * journey's step cursor. Empty when the reply asks nothing.
     */
    askingAbout: OnboardingAskingAboutSchema,
    /** What is waiting on the person's decision, as Q would say it. */
    pending: OnboardingTurnPendingSchema,
    /**
     * Q's patience after this turn (founder direction 2026-09-30): the
     * screen sends them to look around (ROUTE_AWAY) or shows the account
     * paused (SUSPEND); the mood colours Q. Absent from older servers.
     */
    conduct: QConductSchema.optional(),
    /** PRESENCE: what Q's particles form for which sentence of the reply. */
    gestures: QSentenceGesturesSchema.optional(),
    /**
     * The onboarding conductor resumed a conversation already under way
     * (an empty-utterance opening on a kept thread): `reply` carries no
     * greeting and ends on the next unanswered step; speak it at once.
     * Absent from older servers and on a first opening.
     */
    resumed: z.literal(true).optional(),
    /**
     * The reply ends by putting a public finding to the person ("I found
     * maisolifoundation.org — is that your website?"). WEBSITE findings
     * are also held as a pending recommendation on the website step, so a
     * plain yes accepts it like any other. Absent when nothing is asked.
     */
    confirming: z
      .object({ kind: z.enum(["PERSON", "WEBSITE"]) })
      .strict()
      .optional(),
  })
  .strict();
export type QInterviewTurnResponse = z.infer<
  typeof QInterviewTurnResponseSchema
>;

/**
 * Turn latency 2026-10-21 (onboarding L9): a typed interview turn, streamed.
 * A caller that sends `Accept: text/event-stream` gets Q's reply one
 * finished sentence at a time (`sentence`), then the whole turn exactly as
 * the JSON route returns it (`result`), or one `problem` that stands for
 * the problem document the JSON route would have sent. A sentence is
 * display only: what was recorded is read from `result`, never from them.
 */
export const Q_INTERVIEW_STREAM_EVENTS = {
  SENTENCE: "sentence",
  /** What Q is doing now, from a real event in the turn (owner 2026-10-21). */
  STAGE: "stage",
  RESULT: "result",
  PROBLEM: "problem",
} as const;

/**
 * One stage of an interview turn, said as it happens: their words received
 * (READING), answers being saved (SAVING), a public look-up started
 * (LOOKING_UP), the reply being written (WRITING). Display only; never a
 * timer and never evidence that anything was saved.
 */
export const QInterviewStageSchema = z
  .object({
    stage: z.enum(["READING", "SAVING", "LOOKING_UP", "WRITING"]),
    label: z.string().min(1).max(200),
  })
  .strict();
export type QInterviewStage = z.infer<typeof QInterviewStageSchema>;

export const QInterviewSentenceSchema = z
  .object({ text: z.string().min(1).max(2_000) })
  .strict();
export type QInterviewSentence = z.infer<typeof QInterviewSentenceSchema>;
