import { z } from "zod";

/**
 * One reading of one conversational turn (CQ-QX-005; ADR 0011).
 *
 * Whatever surface a person is talking to — the onboarding interview, Q
 * on Home, the mini sheet, a microphone — every turn is one of a small
 * number of things, and which one it is decides what may happen next.
 * This is that closed vocabulary. A model reads the person's words into
 * it; nothing here is authority, and nothing here records anything. The
 * consumer's deterministic reducer decides what a reading is allowed to
 * do (`state.ts`), and it lets only two kinds write: an ANSWER, and an
 * explicit CORRECTION.
 *
 * Three axes are kept apart on purpose, because the live transcripts
 * collapsed them into one failure line:
 *
 * `kind` is what the person was doing. Asking Q a question is not a failed
 * answer; correcting an earlier answer is not a new one; "the last four"
 * is an answer that needs the option set to be read.
 *
 * `confidence` is how surely the words fix what was read. HIGH is written,
 * MEDIUM is read back once, LOW is asked about in a targeted way. It is
 * never a percentage and never a large leap made to keep the flow moving.
 *
 * `transcript` is how intelligible the words themselves were. It is the
 * ONLY thing that may blame speech recognition: an intelligible sentence
 * the reader could not place is a reasoning failure, and saying "could
 * you say it again?" to it is the lie the live sessions kept telling.
 */

export const TURN_KINDS = [
  /** Answers the question in hand, or another open question. */
  "ANSWER",
  /** Clarifies or narrows something they already said, without changing it. */
  "CLARIFICATION",
  /** Changes an earlier answer. The only other kind allowed to write. */
  "CORRECTION",
  /** Asks Q something: advice, an example, a definition, what Q thinks. */
  "QUESTION_TO_Q",
  /** Asks for something real, current or public that needs looking up. */
  "RESEARCH_REQUEST",
  /** Asks Q to do something with its hands (change a field, go somewhere). */
  "TOOL_REQUEST",
  /** The words themselves were noise, a fragment, or cut off. */
  "UNCLEAR_TRANSCRIPT",
  /** Unrelated to the conversation's job. */
  "OFF_TOPIC",
  /** A remark, a joke, an aside. Welcome; not an answer. */
  "SMALL_TALK",
  /** Pause, resume, thinking, stop: a control word, not content. */
  "CONTROL",
] as const;
export const TurnKindSchema = z.enum(TURN_KINDS);
export type TurnKind = z.infer<typeof TurnKindSchema>;

export const ReadingConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ReadingConfidence = z.infer<typeof ReadingConfidenceSchema>;

export const TranscriptQualitySchema = z.enum(["CLEAR", "NOISY", "FRAGMENT"]);
export type TranscriptQuality = z.infer<typeof TranscriptQualitySchema>;

const Target = z.string().min(1).max(80);

/**
 * "The last four", "both", "the second one", "same as before", "not that
 * one": a choice made by pointing at what is on screen rather than by
 * naming it. The model says HOW they pointed; code resolves it against
 * the option set the consumer actually showed (`references.ts`). A
 * reference is never a value on its own.
 */
export const OPTION_SELECTIONS = [
  "ALL",
  "NONE",
  "LAST",
  "FIRST",
  "ORDINAL",
  "SAME_AS_BEFORE",
  "EXCLUDE",
  /** "And the second one too": positions added to what they chose before. */
  "ADD",
  /**
   * "The second number you said", "go with what you said": a value Q
   * itself put forward last turn (the result's `offered`), by position.
   */
  "OFFERED",
  /**
   * "Both full time" after "two founders": the same value as another step
   * they just answered (`from`), resolved from the record, never guessed.
   */
  "VALUE_OF",
] as const;
export const OptionSelectionSchema = z.enum(OPTION_SELECTIONS);
export type OptionSelection = z.infer<typeof OptionSelectionSchema>;

export const OptionReferenceSchema = z
  .object({
    target: Target,
    select: OptionSelectionSchema,
    /** For LAST / FIRST: how many. Absent means one. */
    count: z.number().int().min(1).max(60).optional(),
    /** For ORDINAL / EXCLUDE / ADD / OFFERED: one-based positions. */
    ordinals: z.array(z.number().int().min(1).max(60)).max(20).optional(),
    /** For VALUE_OF: the step whose recorded value this one takes. */
    from: Target.optional(),
  })
  .strict();
export type OptionReference = z.infer<typeof OptionReferenceSchema>;

/**
 * Meaning the options could not hold (the grit rule).
 *
 * "It doesn't really matter as long as they've got the grit to do it" is
 * not "no preference": it says resilience matters and pedigree does not.
 * A closed field may still be set from it; what it MEANT is kept beside
 * the field, in the person's own terms, so a later reader — Q, or a human
 * — sees the preference rather than the enum's shadow of it.
 */
export const QualitativeMeaningSchema = z
  .object({
    target: Target,
    meaning: z.string().min(1).max(400),
  })
  .strict();
export type QualitativeMeaning = z.infer<typeof QualitativeMeaningSchema>;

/**
 * What kind of question the person asked Q, which decides where the
 * answer comes from — and whether anything leaves Capital Q to get it.
 *
 * ADVICE and ABOUT_CAPITAL_Q are answered in the turn from what Q knows.
 * OPTIONS and PROGRESS are answered by the consumer from authoritative
 * state. THEIR_OWN_RECORDS ("based on what you know about me") is answered
 * from authorised context first, never silently from the public web.
 * REAL_WORLD_EXAMPLE, PUBLIC_FACTS and (since 2026-09-29) ADVICE may become
 * a research task, only under the policy in `research-policy.ts`.
 */
export const QUESTION_KINDS = [
  "ADVICE",
  "OPTIONS",
  "PROGRESS",
  "ABOUT_CAPITAL_Q",
  "THEIR_OWN_RECORDS",
  "REAL_WORLD_EXAMPLE",
  "PUBLIC_FACTS",
] as const;
export const QuestionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

export const QuestionToQSchema = z
  .object({
    kind: QuestionKindSchema,
    /** The question in the person's own words, bounded. */
    text: z.string().min(1).max(1_000),
    /**
     * The steps a question about their own answers is about ("did gambling
     * go in as a hard no?", "did you save the 25k minimum?"). The consumer
     * answers it from what is actually stored — never the model's belief —
     * so Q cannot say "yes, that's recorded" about something that is not
     * (ACC round 3 #1). Empty for every other question.
     */
    // Bounded by a journey's length, not by a guess at how many a
    // question names: "what do you have on me?" names them all, and a
    // bound of six refused the whole reading, four times, and Q said its
    // reasoning service was unreachable (live, H fixture).
    about: z.array(z.string().min(1).max(80)).max(60).default([]),
  })
  .strict();
export type QuestionToQ = z.infer<typeof QuestionToQSchema>;

const SuggestedValue = z.union([
  z.string().max(2_000),
  z.array(z.string().max(120)).max(50),
  z.boolean(),
]);

/**
 * Something Q thinks they may also want, offered — never written.
 *
 * Declared Mandate ≠ Q Inference. "Given what you've told me, you may
 * also care about capital efficiency" stays a suggestion until the person
 * says so; the consumer holds it as a proposal awaiting confirmation and
 * writes it through the ordinary answer path only on a yes.
 */
export const InferenceSuggestionSchema = z
  .object({
    target: Target,
    value: SuggestedValue,
    because: z.string().min(1).max(300),
  })
  .strict();
export type InferenceSuggestion = z.infer<typeof InferenceSuggestionSchema>;

/**
 * Two things the person said that pull against each other, noticed the
 * way an analyst would — pre-seed plus "strong revenue growth must-have"
 * — and raised as a question, never as a validation error.
 */
export const TensionSchema = z
  .object({
    targets: z.array(Target).min(1).max(4),
    note: z.string().min(1).max(300),
  })
  .strict();
export type Tension = z.infer<typeof TensionSchema>;

export const ConversationTurnReadingSchema = z
  .object({
    kind: TurnKindSchema,
    confidence: ReadingConfidenceSchema,
    transcript: TranscriptQualitySchema,
    references: z.array(OptionReferenceSchema).max(6).default([]),
    qualitative: z.array(QualitativeMeaningSchema).max(6).default([]),
    question: QuestionToQSchema.nullable().default(null),
    suggestions: z.array(InferenceSuggestionSchema).max(4).default([]),
    tensions: z.array(TensionSchema).max(3).default([]),
    /**
     * Earlier answers the person is withdrawing entirely ("there's nothing
     * I'd avoid after all"). A correction can replace a value through the
     * ordinary answer; this is the closed field for taking one away, so
     * that "I've cleared that" is something the platform did rather than
     * something a model said. Only a CORRECTION may carry it.
     */
    clears: z.array(Target).max(4).default([]),
  })
  .strict();
export type ConversationTurnReading = z.infer<
  typeof ConversationTurnReadingSchema
>;

/** The reading with nothing in it: a consumer's stand-in when the model gave none. */
export const EMPTY_TURN_READING: ConversationTurnReading = {
  kind: "ANSWER",
  confidence: "HIGH",
  transcript: "CLEAR",
  references: [],
  qualitative: [],
  question: null,
  suggestions: [],
  tensions: [],
  clears: [],
};

/** The kinds that may put anything on the record. Everything else may not. */
export const WRITING_KINDS: ReadonlySet<TurnKind> = new Set<TurnKind>([
  "ANSWER",
  "CORRECTION",
]);

export function mayWrite(reading: Pick<ConversationTurnReading, "kind">) {
  return WRITING_KINDS.has(reading.kind);
}
