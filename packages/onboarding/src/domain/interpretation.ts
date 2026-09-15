import type {
  OnboardingResponseValue,
  OnboardingStepPresentation,
} from "@capital-q/contracts";

import { parseFigure } from "./figure.js";
import { matchedOptions } from "./resolution/options.js";
import { mentions, normalise, wordsOf } from "./text.js";

export { parseFigure } from "./figure.js";

/**
 * Deterministic reading of what a person said to Q about one step
 * (CQ-PRE-REC-001 §17-§19).
 *
 * The journey's own definition says what an answer may be; this module
 * only recognises when a sentence already is one — an option named in
 * plain words, a figure inside a range, a yes, a plain text answer — and
 * a handful of conversational moves: skip, I don't know, why, later,
 * upload. Nothing here consults a model, and nothing here decides that a
 * sentence it could not place means anything at all: that sentence goes
 * to Q's reading and comes back as suggestions the person confirms.
 *
 * Journeys widen recognition with alias tables (an investor writes
 * "Series A", a definition stores `series_a`); the runtime never guesses
 * beyond a table it was given.
 */

export type OnboardingUtteranceAliases = Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

export type StepInterpretation =
  | {
      readonly kind: "ANSWER";
      readonly value: OnboardingResponseValue;
      readonly summary: string;
    }
  | { readonly kind: "SKIP" }
  | { readonly kind: "WHY" }
  | { readonly kind: "UPLOAD" }
  | { readonly kind: "AMBIGUOUS"; readonly optionKeys: readonly string[] }
  | { readonly kind: "DECLINE" }
  /** Worth Q's reading: several facts, a figure with context, a preference in their own words. */
  | { readonly kind: "NARRATIVE" }
  | { readonly kind: "UNCLEAR" };

const SKIP =
  /^(?:skip|skip (?:this|it|that)(?: for now)?|next|pass|move on|later|not now|come back to (?:this|it|that)(?: later)?|(?:i(?:'| a)?ll )?come back to (?:this|it)(?: later)?)[.!]?$/i;
const DONT_KNOW =
  /^(?:i )?(?:don'?t|do not|dont) know(?: yet| that)?[.!]?$|^(?:not sure|no idea|unsure|no clue)(?: yet)?[.!]?$/i;
const WHY =
  /^(?:why|why (?:do you (?:need|ask|want)|does (?:this|that|it) matter|is (?:this|that) (?:needed|important|relevant))(?: (?:this|that|it))?|what(?:'s| is) (?:this|that) for)\??[.!]?$/i;
const UPLOAD =
  /\b(?:upload|attach|send (?:you )?(?:my|a|the) (?:deck|document|file|memo|model)|share (?:my|a|the) (?:deck|document|file|memo|model)|(?:my|the) deck (?:covers|has|says|answers)|let me upload)\b/i;
const YES =
  /^(?:yes|yep|yeah|yup|correct|right|that'?s right|looks right|looks good|confirmed?|sure|ok|okay|exactly|all good)[.!]?$/i;
const NO =
  /^(?:no|nope|not quite|not right|wrong|that'?s wrong|incorrect|not really|change (?:it|that|something))[.!]?$/i;

/** Option keys that already mean "I cannot say": a real answer, not a skip. */
const UNSURE_OPTION_KEYS = new Set([
  "unsure",
  "not_sure",
  "unknown",
  "none",
  "nothing_yet",
  "not_now",
  "no_preference",
]);

/** A sentence carrying more than one thing, or a figure with context: Q reads it. */
/**
 * A sentence with more in it than an option: six words or more, or a figure
 * with a few words. The interview places what it can and gives the rest to Q.
 */
export function isRichUtterance(text: string): boolean {
  return isNarrative(text);
}

/** From this many words on, a line is prose Q should read rather than a value. */
const NARRATIVE_WORDS = 6;

function isNarrative(text: string): boolean {
  const words = wordsOf(text);
  const hasFigure = /\d/.test(text);
  return words.length >= NARRATIVE_WORDS || (hasFigure && words.length >= 3);
}

export type InterpretableStep = {
  readonly stepKey: string;
  readonly required: boolean;
  readonly presentation: OnboardingStepPresentation;
  /** The step's server-assembled context, when it lists candidates to choose from. */
  readonly context?: Readonly<Record<string, unknown>> | undefined;
};

/** A candidate a reference step's context offers: an id and a name to say. */
export type ReferenceCandidate = {
  readonly id: string;
  readonly name: string;
};

const ONLY_ONE =
  /^(?:yes|yep|ok|okay|sure|that one|the only one|use it|use that|go ahead|fine|that's the one)[.!]?$/i;

/** Words that carry no name: "the growth fund" names "Growth Fund II". */
const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "that",
  "this",
  "one",
  "it",
  "my",
  "our",
  "please",
  "use",
  "pick",
  "choose",
  "select",
  "take",
  "go",
  "with",
  "let's",
  "lets",
]);

/**
 * True when every meaningful word the person said is a word of the name.
 * A partial name is enough; an unrelated word rules the candidate out.
 */
function namesPartially(text: string, name: string): boolean {
  const said = wordsOf(text).filter((w) => !FILLER_WORDS.has(w));
  if (said.length === 0) {
    return false;
  }
  const nameWords = new Set(wordsOf(name));
  return said.every((w) => nameWords.has(w));
}

/**
 * Candidates named by a step context, whatever the journey calls them:
 * `{ mandateId, name }` (investor mandates), `{ id, label }`,
 * `{ nodeId, label }`. Anything without an id and a name is ignored.
 */
export function referenceCandidatesOf(
  context: Readonly<Record<string, unknown>> | undefined,
): readonly ReferenceCandidate[] {
  const list = context?.["candidates"];
  if (!Array.isArray(list)) {
    return [];
  }
  const out: ReferenceCandidate[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = record["mandateId"] ?? record["id"] ?? record["nodeId"];
    const name = record["name"] ?? record["label"] ?? record["displayName"];
    if (typeof id === "string" && typeof name === "string" && name.length > 0) {
      out.push({ id, name });
    }
  }
  return out;
}

export function interpretUtterance(
  text: string,
  step: InterpretableStep,
  aliases: OnboardingUtteranceAliases = {},
): StepInterpretation {
  const trimmed = text.trim();
  const { presentation } = step;
  const stepAliases = aliases[step.stepKey];

  if (WHY.test(trimmed)) {
    return { kind: "WHY" };
  }
  if (UPLOAD.test(trimmed) && wordsOf(trimmed).length <= 16) {
    return { kind: "UPLOAD" };
  }
  if (SKIP.test(trimmed)) {
    return { kind: "SKIP" };
  }
  if (DONT_KNOW.test(trimmed)) {
    // A definition that offers "not sure" makes that the honest answer;
    // otherwise unknown stays unknown, which is what a skip records.
    if (
      presentation.stepType === "single_select" ||
      presentation.stepType === "multi_select"
    ) {
      const unsure = presentation.options.find((option) =>
        UNSURE_OPTION_KEYS.has(option.optionKey),
      );
      if (unsure !== undefined) {
        return {
          kind: "ANSWER",
          value:
            presentation.stepType === "single_select"
              ? { type: "SINGLE_SELECT", optionKey: unsure.optionKey }
              : { type: "MULTI_SELECT", optionKeys: [unsure.optionKey] },
          summary: unsure.label,
        };
      }
    }
    return { kind: "SKIP" };
  }

  switch (presentation.stepType) {
    case "single_select": {
      const matched = matchedOptions(
        trimmed,
        presentation.options,
        stepAliases,
      );
      const only = matched.length === 1 ? matched[0] : undefined;
      if (only !== undefined) {
        return {
          kind: "ANSWER",
          value: { type: "SINGLE_SELECT", optionKey: only.optionKey },
          summary: only.label,
        };
      }
      if (matched.length > 1) {
        return {
          kind: "AMBIGUOUS",
          optionKeys: matched.map((option) => option.optionKey),
        };
      }
      // Two-option yes/no steps answered as such.
      if (presentation.options.length === 2) {
        const [first, second] = presentation.options;
        if (YES.test(trimmed) && first !== undefined) {
          return {
            kind: "ANSWER",
            value: { type: "SINGLE_SELECT", optionKey: first.optionKey },
            summary: first.label,
          };
        }
        if (NO.test(trimmed) && second !== undefined) {
          return {
            kind: "ANSWER",
            value: { type: "SINGLE_SELECT", optionKey: second.optionKey },
            summary: second.label,
          };
        }
      }
      return isNarrative(trimmed) ? { kind: "NARRATIVE" } : { kind: "UNCLEAR" };
    }
    case "multi_select": {
      const matched = matchedOptions(
        trimmed,
        presentation.options,
        stepAliases,
      );
      const exclusive = new Set(presentation.exclusiveOptionKeys);
      const chosen = matched.some((option) => exclusive.has(option.optionKey))
        ? matched
            .filter((option) => exclusive.has(option.optionKey))
            .slice(0, 1)
        : matched.slice(0, presentation.maxSelections);
      if (
        chosen.length >= Math.max(1, presentation.minSelections) &&
        chosen.length <= presentation.maxSelections
      ) {
        return {
          kind: "ANSWER",
          value: {
            type: "MULTI_SELECT",
            optionKeys: chosen.map((option) => option.optionKey),
          },
          summary: chosen.map((option) => option.label).join(", "),
        };
      }
      return isNarrative(trimmed) ? { kind: "NARRATIVE" } : { kind: "UNCLEAR" };
    }
    case "range": {
      const figure = parseFigure(trimmed);
      if (figure !== null) {
        const value = Number.parseFloat(figure);
        const min = Number.parseFloat(presentation.min);
        const max = Number.parseFloat(presentation.max);
        if (value >= min && value <= max && wordsOf(trimmed).length <= 8) {
          return {
            kind: "ANSWER",
            value: { type: "RANGE", value: figure },
            summary: figure,
          };
        }
      }
      return isNarrative(trimmed) ? { kind: "NARRATIVE" } : { kind: "UNCLEAR" };
    }
    case "short_text": {
      // A short line is the answer ("E2E Rail 2024", "Northbank Capital"):
      // a figure inside a name does not make it a narrative, as it would on
      // a step that asks for a figure.
      if (
        trimmed.length >= presentation.minLength &&
        trimmed.length <= presentation.maxLength &&
        wordsOf(trimmed).length < NARRATIVE_WORDS
      ) {
        return {
          kind: "ANSWER",
          value: { type: "TEXT", text: trimmed },
          summary: trimmed,
        };
      }
      return trimmed.length > presentation.maxLength
        ? { kind: "NARRATIVE" }
        : isNarrative(trimmed)
          ? { kind: "NARRATIVE" }
          : { kind: "UNCLEAR" };
    }
    case "long_text":
    case "voice_text": {
      const maxLength = presentation.maxLength;
      if (trimmed.length <= maxLength) {
        return {
          kind: "ANSWER",
          value: { type: "TEXT", text: trimmed },
          summary: trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed,
        };
      }
      return { kind: "UNCLEAR" };
    }
    case "confirmation": {
      // The step's own labels ("Save my raise", "Looks right") are answers
      // too; a chip says exactly them.
      const exact = normalise(trimmed);
      if (YES.test(trimmed) || exact === normalise(presentation.confirmLabel)) {
        return {
          kind: "ANSWER",
          value: { type: "CONFIRMATION", confirmed: true },
          summary: presentation.confirmLabel,
        };
      }
      if (
        NO.test(trimmed) ||
        (presentation.declineLabel !== undefined &&
          exact === normalise(presentation.declineLabel))
      ) {
        return { kind: "DECLINE" };
      }
      return isNarrative(trimmed) ? { kind: "NARRATIVE" } : { kind: "UNCLEAR" };
    }
    case "document_upload":
      return { kind: "UPLOAD" };
    case "reference_select": {
      // A step whose context lists candidates (the investor's mandates) is
      // answered by naming one — or by assent when there is only one.
      const candidates = referenceCandidatesOf(step.context);
      if (candidates.length > 0) {
        const exact = normalise(trimmed);
        const named = candidates.filter(
          (candidate) =>
            normalise(candidate.name) === exact ||
            mentions(trimmed, candidate.name) ||
            namesPartially(trimmed, candidate.name),
        );
        const chosen =
          named.length === 1
            ? named[0]
            : named.length === 0 &&
                candidates.length === 1 &&
                ONLY_ONE.test(trimmed)
              ? candidates[0]
              : undefined;
        if (chosen !== undefined) {
          return {
            kind: "ANSWER",
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: presentation.resourceType,
              resourceIds: [chosen.id],
            },
            summary: chosen.name,
          };
        }
        if (named.length > 1) {
          return { kind: "UNCLEAR" };
        }
      }
      // Taxonomy and resource picks are made from search results the
      // person sees; a sentence about them is worth Q's reading instead.
      return isNarrative(trimmed) ? { kind: "NARRATIVE" } : { kind: "UNCLEAR" };
    }
  }
}
