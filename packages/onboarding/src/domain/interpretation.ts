import type {
  OnboardingOptionView,
  OnboardingResponseValue,
  OnboardingStepPresentation,
} from "@capital-q/contracts";

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

function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // Sentence punctuation goes; a decimal point inside a figure stays.
      .replace(/[.,!?;:]+(?=\s|$)/g, "")
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9'+&/ .-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function wordsOf(text: string): readonly string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 0);
}

/** True when `phrase` occurs in `text` as whole words. */
function mentions(text: string, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle.length === 0) {
    return false;
  }
  const hay = ` ${normalise(text)} `;
  return hay.includes(` ${needle} `);
}

function optionMatches(
  text: string,
  options: readonly OnboardingOptionView[],
  aliases: Readonly<Record<string, readonly string[]>> | undefined,
): readonly OnboardingOptionView[] {
  const exact = normalise(text);
  const matched: OnboardingOptionView[] = [];
  for (const option of options) {
    // A short key ("in", "us", "gb") is a code, not a word a person says;
    // matching it would read "based in Lagos" as India.
    const names = [
      option.label,
      ...(option.optionKey.length >= 4
        ? [option.optionKey.replace(/_/g, " ")]
        : []),
      ...(aliases?.[option.optionKey] ?? []),
    ];
    if (
      names.some((name) => normalise(name) === exact) ||
      names.some((name) => mentions(text, name))
    ) {
      matched.push(option);
    }
  }
  return matched;
}

/** "3", "3m", "$1.8m", "250k", "1,000" → a plain decimal string, or null. */
export function parseFigure(text: string): string | null {
  const match =
    /(?:^|[^a-z0-9.])(?:[$£€]|usd|gbp|eur|ngn|kes|zar)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|mn|million|bn|b|billion|thousand)?(?![a-z0-9])/i.exec(
      text,
    );
  if (match === null) {
    return null;
  }
  const whole = (match[1] ?? "0").replace(/,/g, "");
  const fraction = match[2] ?? "";
  const suffix = (match[3] ?? "").toLowerCase();
  let value = Number.parseFloat(
    `${whole}${fraction.length > 0 ? `.${fraction}` : ""}`,
  );
  if (!Number.isFinite(value)) {
    return null;
  }
  if (suffix === "k" || suffix === "thousand") {
    value *= 1_000;
  } else if (suffix === "m" || suffix === "mn" || suffix === "million") {
    value *= 1_000_000;
  } else if (suffix === "b" || suffix === "bn" || suffix === "billion") {
    value *= 1_000_000_000;
  }
  if (!Number.isInteger(value) && Math.abs(value) >= 1) {
    value = Math.round(value * 100) / 100;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** A sentence carrying more than one thing, or a figure with context: Q reads it. */
function isNarrative(text: string): boolean {
  const words = wordsOf(text);
  const hasFigure = /\d/.test(text);
  return words.length >= 6 || (hasFigure && words.length >= 3);
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
      const matched = optionMatches(trimmed, presentation.options, stepAliases);
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
      const matched = optionMatches(trimmed, presentation.options, stepAliases);
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
      if (
        trimmed.length >= presentation.minLength &&
        trimmed.length <= presentation.maxLength &&
        !isNarrative(trimmed)
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
      if (YES.test(trimmed)) {
        return {
          kind: "ANSWER",
          value: { type: "CONFIRMATION", confirmed: true },
          summary: presentation.confirmLabel,
        };
      }
      if (NO.test(trimmed)) {
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
