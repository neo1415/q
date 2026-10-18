import { z } from "zod";

import {
  QCommunicationProfileSchema,
  QOperatingModeSchema,
} from "@capital-q/contracts";

import { ConversationTurnReadingSchema } from "../../conversation/reading.js";
import { SpeechCueSchema } from "../../speech/delivery.js";

/**
 * INTERVIEW_CONDUCTOR — Q conducting the onboarding interview
 * (CQ-Q-VOICE-001 rework: Q leads, the person talks).
 *
 * Inputs are the interview's state as Capital Q's own records hold it: what
 * is already answered, every step still open with its real options and
 * constraints, what Q last asked, anything Q read back and is waiting to
 * have confirmed, proposals lifted from the person's documents, and the
 * recent turns. The person's words are DATA.
 *
 * Output is what Q says next plus structured readings of what the person
 * just said — proposals that deterministic code validates, confirms and
 * records; nothing becomes a record because the model wrote it. A
 * navigation or a lookup is likewise a proposal: code checks it against a
 * fixed list and the person's own authority before anything moves.
 */

export const INTERVIEW_CONDUCTOR_SCHEMA_NAME = "InterviewConductorResult";
export const INTERVIEW_CONDUCTOR_SCHEMA_VERSION = 3;
export const INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION = 4;
export const INTERVIEW_CONDUCTOR_V5_SCHEMA_VERSION = 5;

const StepKey = z.string().min(1).max(64);

export const InterviewOpenStepSchema = z
  .object({
    stepKey: StepKey,
    question: z.string().max(400),
    /** What the answer must be. */
    kind: z.enum([
      "ONE_OF",
      "MANY_OF",
      "NUMBER",
      "SHORT_TEXT",
      "LONG_TEXT",
      "YES_NO",
      "CATEGORIES",
      "DOCUMENT",
    ]),
    required: z.boolean(),
    /** For ONE_OF / MANY_OF: the real choices. Answer with `key`. */
    options: z
      .array(
        z.object({
          key: z.string().max(64),
          label: z.string().max(120),
          description: z.string().max(300).optional(),
        }),
      )
      .max(50)
      .optional(),
    /** When the options list was cut short: how many more there are. */
    moreOptions: z.number().int().min(1).max(500).optional(),
    maxChoices: z.number().int().min(1).max(50).optional(),
    /** For NUMBER: the unit and bounds. Answer with a plain number in this unit. */
    unit: z.string().max(16).optional(),
    min: z.string().max(40).optional(),
    max: z.string().max(40).optional(),
    /** Trusted note from the definition, e.g. why Q asks. */
    note: z.string().max(400).optional(),
  })
  .strict();
export type InterviewOpenStep = z.infer<typeof InterviewOpenStepSchema>;

/** Where Q may take the person on request; code maps each to a route. */
export const INTERVIEW_DESTINATIONS = [
  "HOME",
  "PROFILE",
  "CAPITAL",
  "DISCOVER",
  "COMPANY_VISIBILITY",
  "INTERVIEW",
  "INTERVIEW_FOUNDER",
  "INTERVIEW_INVESTOR",
  "FORM",
] as const;
export const InterviewDestinationSchema = z.enum(INTERVIEW_DESTINATIONS);
export type InterviewDestination = z.infer<typeof InterviewDestinationSchema>;

export const InterviewConductorVariablesSchema = z
  .object({
    operatingMode: QOperatingModeSchema,
    communicationProfile: QCommunicationProfileSchema,
    communicationGuidance: z.string().max(4_000),
    environmentNotes: z.string().max(2_000),
    journey: z.enum(["founder", "investor"]),
    /** "voice" turns are spoken aloud; "text" turns are read. */
    channel: z.enum(["voice", "text"]),
    /** Trusted: the manner Q carries itself in (q-core personality registry). */
    personality: z.string().max(800),
    /** True when the speech model renders inline audio tags such as [laughs]. */
    expressive: z.boolean(),
    /** True for the very first line of a session: greet and ask, nothing was said yet. */
    opening: z.boolean(),
    /** How many times Q has already warned this person about derailing the interview. */
    warnings: z.number().int().min(0).max(3),
    /** Small talk and asides since the last recorded answer: the first two are welcome, later ones steer back. */
    tangents: z.number().int().min(0).max(9),
    knownAnswers: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(80),
    openSteps: z.array(InterviewOpenStepSchema).max(60),
    /** The step the interview is at; ask this next unless the person leads elsewhere. */
    currentStepKey: StepKey.nullable(),
    /** Values Q read back last time and is waiting to have confirmed. */
    pendingConfirmations: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(8),
    /** Values lifted from the person's own documents, unconfirmed; read back like a pending value. */
    documentProposals: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(20),
    /** Things the runtime could not record last turn, so Q can ask again plainly. */
    notes: z.array(z.string().max(300)).max(6),
    recentTurns: z
      .array(
        z.object({
          role: z.enum(["person", "q"]),
          text: z.string().max(1_500),
        }),
      )
      .max(16),
    utterance: z.string().max(2_000),
  })
  .strict();
export type InterviewConductorVariables = z.infer<
  typeof InterviewConductorVariablesSchema
>;

export const INTERVIEW_CONDUCTOR_UNTRUSTED = [
  "recentTurns",
  "utterance",
] as const;

/**
 * v3: v1's variables plus what Capital Q remembers about the person
 * (ADR 0012): how they want to be addressed, how their names are said,
 * what they corrected before. UNTRUSTED: rendered from their own
 * recorded words, never from anything Q concluded.
 */
export const InterviewConductorV3VariablesSchema =
  InterviewConductorVariablesSchema.extend({
    memory: z.string().max(4_000).default(""),
  }).strict();
export type InterviewConductorV3Variables = z.infer<
  typeof InterviewConductorV3VariablesSchema
>;

export const INTERVIEW_CONDUCTOR_V3_UNTRUSTED = [
  ...INTERVIEW_CONDUCTOR_UNTRUSTED,
  "memory",
] as const;

/**
 * v4 variables: v3's, plus what the person has already told Q that the
 * journey could not take yet.
 *
 * A sentence answers several things at once — "I'm the founder, we just
 * started investing, mostly fintech, and we're open globally" — and the
 * journey will only accept them in its own order. Everything past the
 * one step it is willing to take was being thrown away, so the question
 * came round again later as though it had never been asked, which is the
 * single behaviour that makes an interview feel like a form.
 *
 * The platform holds those readings and keeps trying to record them. It
 * tells the model what it is holding so that Q does not ask for a thing
 * it already has. CARRIED is the platform's own state, not the
 * transcript: it is trusted in the same way KNOWN ANSWERS is, and the
 * difference between them is that a carried value is not on the record
 * yet. Q may say it has it; Q may not say it is saved.
 */
export const InterviewConductorV4VariablesSchema =
  InterviewConductorV3VariablesSchema.extend({
    carried: z
      .array(
        z.object({
          stepKey: StepKey,
          question: z.string().max(400),
          value: z.string().max(400),
        }),
      )
      .max(20)
      .default([]),
  }).strict();
export type InterviewConductorV4Variables = z.infer<
  typeof InterviewConductorV4VariablesSchema
>;

export const INTERVIEW_CONDUCTOR_V4_UNTRUSTED = [
  ...INTERVIEW_CONDUCTOR_V3_UNTRUSTED,
] as const;

const AnswerValueSchema = z.union([
  z.string().max(2_000),
  z.array(z.string().max(120)).max(50),
  z.boolean(),
]);

export const InterviewConductorResultSchema = z
  .object({
    /** Exactly what Q says next. Conversational, first person, one or two sentences plus the next question. */
    reply: z.string().min(1).max(700),
    intent: z.enum([
      "ANSWER",
      "QUESTION_FOR_Q",
      "CORRECTION",
      "PAUSE",
      "RESUME",
      "THINKING",
      "SMALL_TALK",
      "OFF_TOPIC",
      "NAVIGATE",
      "LOOKUP",
      "PRONOUNCE",
      "SABOTAGE",
      "UNCLEAR",
      "OPENING",
    ]),
    /** Every step the person's words answered, as the step's own kind of value. */
    answers: z
      .array(
        z.object({
          stepKey: StepKey,
          value: AnswerValueSchema,
          confidence: z.enum(["HIGH", "MEDIUM"]),
        }),
      )
      .max(12),
    /** For CATEGORIES steps: plain phrases describing what was said; the platform maps them. */
    categoryPhrases: z
      .array(
        z.object({
          stepKey: StepKey,
          phrases: z.array(z.string().max(80)).min(1).max(8),
        }),
      )
      .max(4),
    /** Decisions on values Q read back earlier, or on document proposals. */
    confirmations: z
      .array(
        z.object({
          stepKey: StepKey,
          decision: z.enum(["CONFIRMED", "REJECTED", "REVISED"]),
          value: AnswerValueSchema.optional(),
        }),
      )
      .max(8),
    /** Optional steps the person set aside ("I don't know", "not now"). */
    skips: z.array(StepKey).max(6),
    /** The step Q is asking in `reply`, when it is asking one. */
    askNext: StepKey.nullable(),
    /** Whether the person should see the options for `askNext` on screen. */
    showOptions: z.boolean(),
    /** When intent is QUESTION_FOR_Q: the question, in the person's words. */
    questionForQ: z.string().max(1_000).nullable(),
    /** When intent is NAVIGATE: where the person asked to go. */
    navigate: InterviewDestinationSchema.nullable(),
    /** When intent is PRONOUNCE: the name or term, and how the person says it. */
    pronounce: z
      .object({
        term: z.string().min(1).max(60),
        sayAs: z.string().min(1).max(60),
      })
      .nullable(),
    /** When intent is LOOKUP and the spelling is confirmed: what to research on the public web. */
    lookup: z
      .object({
        kind: z.enum(["WEBSITE", "COMPANY", "PERSON"]),
        query: z.string().min(1).max(300),
      })
      .nullable(),
  })
  .strict();
export type InterviewConductorV3Result = z.infer<
  typeof InterviewConductorResultSchema
>;

/**
 * v3's result plus where the answer to a question already is
 * (QX-004 core gate §8).
 *
 * A separate schema rather than a field added to v1-v3's, because a
 * published prompt version is immutable: a run recorded against
 * `interview-conductor/v3` must stay explainable by exactly the schema it
 * ran under.
 *
 * "What sectors are there?" and "where are we so far?" are ordinary
 * things a person asks halfway through a form, and both were being sent
 * away to be researched — thirty seconds of silence, and then the field
 * asked again as though nothing had been said. Neither needs looking up.
 * The options are on the step and the progress is on the session, so the
 * model says WHICH of the two they meant and the runtime writes the
 * answer from the authoritative state.
 *
 * That is the ADR 0011 split exactly: reading what somebody meant is the
 * model's, and saying what is true is not.
 */
export const InterviewConductorV4ResultSchema =
  InterviewConductorResultSchema.extend({
    answerFromState: z.enum(["OPTIONS", "PROGRESS"]).nullable().default(null),
    /**
     * They asked to leave the rest of the optional questions and finish.
     *
     * Distinct from a skip, which is about the one step in hand. Somebody
     * who says "skip the optional detail, I'd like to finish" is asking
     * to leave a run of them, and answering that with a single skip walks
     * them into the next optional question — and the next, and the next.
     * Fifteen times, in the investor journey (local, 2026-09-22).
     *
     * The model reads the intent; the platform decides what it means.
     * Required steps are never skipped however anyone phrases it: they
     * are the journey's own statement of what it cannot do without.
     */
    skipRemainingOptional: z.boolean().default(false),
  }).strict();
export type InterviewConductorV4Result = z.infer<
  typeof InterviewConductorV4ResultSchema
>;

/**
 * How settled a reading is — separately from how confident the model is
 * that it read the right field.
 *
 * `confidence` answers "is this the step they meant"; this answers "do
 * the words fix the value". They come apart on exactly the question that
 * matters most: "maximum cheque is one hundred" names the field
 * unmistakably and leaves the amount completely open, because a hundred
 * what is the whole question. Recording 100 is wrong and guessing
 * 100,000,000 is worse, so the platform records neither and asks.
 */
export const AnswerClaritySchema = z.enum([
  /** The words fix the value; record it. */
  "SETTLED",
  /** A bare figure whose magnitude is not said: a hundred, fifty, three. */
  "SCALE_UNCLEAR",
  /** The quantity is fixed but what it counts is not. */
  "UNIT_UNCLEAR",
]);
export type AnswerClarity = z.infer<typeof AnswerClaritySchema>;

const AnswerV5Schema = z
  .object({
    stepKey: StepKey,
    value: AnswerValueSchema,
    confidence: z.enum(["HIGH", "MEDIUM"]),
    clarity: AnswerClaritySchema.default("SETTLED"),
  })
  .strict();

/**
 * v4's result, plus the three readings a turn needs that it had no field
 * for (Workstream A).
 *
 * All three are the ADR 0011 split: the model reads what somebody meant
 * into a closed vocabulary, and the platform decides what that means in
 * the domain. None of them is a value, and none of them records anything.
 *
 * **unrestricted** — "everywhere on the planet", "it can be anyone", "no
 * preference". This is a real answer and it is not a skip, but it is
 * rarely expressible as a list of option keys: the journey represents no
 * geographic restriction as an empty geography, and no role preference as
 * all three roles. Which of those it is depends on the step, so the step
 * decides. Without it, "everywhere on the planet" went to the taxonomy
 * classifier, matched nothing, recorded nothing, and the question came
 * back — three times, in the live transcript.
 *
 * **clarity** — see AnswerClaritySchema.
 *
 * **frustrated** — "I already told you", "I'm getting angry". Repeating
 * the parse that failed is the one response guaranteed to make it worse,
 * so the platform stops asking and reconciles instead.
 */
export const InterviewConductorV5ResultSchema =
  InterviewConductorV4ResultSchema.extend({
    answers: z.array(AnswerV5Schema).max(12),
    unrestricted: z
      .array(z.object({ stepKey: StepKey }).strict())
      .max(8)
      .default([]),
    frustrated: z.boolean().default(false),
  }).strict();
export type InterviewConductorV5Result = z.infer<
  typeof InterviewConductorV5ResultSchema
>;

/**
 * v6 result: v5's, plus one reading of the whole turn (CQ-QX-005).
 *
 * `intent` and `answers` say what the model took from the words. What
 * they never said is what the turn WAS — an answer, a question for Q, a
 * correction, a choice made by pointing at the screen, a sentence whose
 * meaning no option holds — and without that the runtime treated every
 * turn as an attempt to answer the question in hand, and every turn that
 * did not as a failure to hear. `reading` is the conversation core's
 * closed vocabulary for that (`conversation/reading.ts`); the runtime's
 * deterministic reducer decides what each kind may do, and only an
 * ANSWER or an explicit CORRECTION may write.
 *
 * Nullable with a null default so that a run recorded against an older
 * version, or a test double written for one, still parses: the runtime
 * derives a conservative reading from `intent` when none is given.
 */
export const INTERVIEW_CONDUCTOR_V6_SCHEMA_VERSION = 6;

export const InterviewConductorV6ResultSchema =
  InterviewConductorV5ResultSchema.extend({
    reading: ConversationTurnReadingSchema.nullable().default(null),
  }).strict();
export type InterviewConductorV6Result = z.infer<
  typeof InterviewConductorV6ResultSchema
>;

/**
 * v8 variables: v4's, plus what the conversation core knows about the
 * exchange that the session does not.
 *
 * `asked` is the question Q put on screen last with its options
 * NUMBERED, so that "the last four" and "the second one" can be read as
 * positions in that list and resolved by code. `conversation` is the
 * platform's own account of the exchange — a question of theirs being
 * answered, where to resume, a suggestion awaiting a yes, meaning held
 * beside a field, which subsystem is down — rendered as trusted text.
 */
export const InterviewConductorV8VariablesSchema =
  InterviewConductorV4VariablesSchema.extend({
    asked: z.string().max(2_000).default(""),
    conversation: z.string().max(2_000).default(""),
  }).strict();
export type InterviewConductorV8Variables = z.infer<
  typeof InterviewConductorV8VariablesSchema
>;

export const INTERVIEW_CONDUCTOR_V8_UNTRUSTED = [
  ...INTERVIEW_CONDUCTOR_V4_UNTRUSTED,
] as const;

/**
 * v7 result: v6's, plus how the reply should sound (CQ-VOICE-010).
 *
 * `delivery` sits beside `reply` and never inside it. The reply is what Q
 * said, and it is recorded, shown and remembered as written. Delivery is
 * for the speech layer alone, which renders it only where the voice can
 * and drops it everywhere else. It is a single cue rather than the whole
 * delivery object, because the conductor's request has no room for more
 * (`SpeechCueSchema`). Null by default: most replies need nothing, and a
 * run recorded against an older version still parses.
 */
export const INTERVIEW_CONDUCTOR_V7_SCHEMA_VERSION = 7;

export const InterviewConductorV7ResultSchema =
  InterviewConductorV6ResultSchema.extend({
    delivery: SpeechCueSchema.nullable().default(null),
    /**
     * Concrete values Q's own reply put in front of the person, per step,
     * in the order said ("25 or 30k?"), so that "the second number you
     * said" resolves against what Q actually offered (CQ-QX-005 round 2,
     * #9). Q's words are data here, never a value until the person picks.
     */
    offered: z
      .array(
        z
          .object({
            target: z.string().min(1).max(80),
            values: z
              .array(
                z.union([
                  z.string().max(200),
                  z.array(z.string().max(120)).max(20),
                  z.boolean(),
                ]),
              )
              .min(1)
              .max(6),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  }).strict();
export type InterviewConductorV7Result = z.infer<
  typeof InterviewConductorV7ResultSchema
>;

/** What the runtime works with: the newest shape. */
export type InterviewConductorResult = InterviewConductorV7Result;
