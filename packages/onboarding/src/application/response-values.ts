import type { OnboardingResponseValue } from "@capital-q/contracts";
import type {
  OnboardingResponse,
  ValidatedOnboardingResponse,
} from "../contracts/index.js";

/**
 * Typed access to journey answers. A handler sees the responses already on
 * the path plus the one being committed; a provider sees the current path.
 * Every accessor returns null for "not answered" -- unknown stays unknown.
 */

export type ResponseValues = ReadonlyMap<string, OnboardingResponseValue>;

export function responseValues(
  current: ReadonlyMap<string, OnboardingResponse>,
  incoming?: ValidatedOnboardingResponse,
): ResponseValues {
  const values = new Map<string, OnboardingResponseValue>();
  for (const [stepKey, response] of current) {
    values.set(stepKey, response.value);
  }
  if (incoming !== undefined) {
    values.set(incoming.stepKey, incoming.value);
  }
  return values;
}

export function singleSelect(
  values: ResponseValues,
  stepKey: string,
): string | null {
  const value = values.get(stepKey);
  return value?.type === "SINGLE_SELECT" ? value.optionKey : null;
}

export function multiSelect(
  values: ResponseValues,
  stepKey: string,
): readonly string[] | null {
  const value = values.get(stepKey);
  return value?.type === "MULTI_SELECT" ? value.optionKeys : null;
}

/**
 * The answer "I don't know" to a step (D-OWN-1, DECISIONS 78): it settles
 * the step, needed or optional, and holds no value. Every step type takes
 * it as words, a taxonomy step included (DECISIONS 79: an unknown answer on
 * every mandatory step), and no accessor ever reads it as a value: unknown
 * stays unknown, never a website, a description or a category.
 */
export const NOT_KNOWN_ANSWER_TEXT = "I don't know";

/** Whether an answer is "I don't know" (case, quotes and spacing aside). */
export function isNotKnownAnswer(
  value: OnboardingResponseValue | null | undefined,
): boolean {
  return (
    value?.type === "TEXT" &&
    value.text
      .normalize("NFKC")
      .replace(/[\u2018\u2019]/gu, "'")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/\.$/u, "")
      .toLocaleLowerCase() === NOT_KNOWN_ANSWER_TEXT.toLocaleLowerCase()
  );
}

/** Their words for a step; null when unanswered or "I don't know". */
export function text(values: ResponseValues, stepKey: string): string | null {
  const value = values.get(stepKey);
  if (isNotKnownAnswer(value)) return null;
  return value?.type === "TEXT" ? value.text.trim() : null;
}

/** Exact decimal string as entered; never converted to a float. */
export function decimal(
  values: ResponseValues,
  stepKey: string,
): string | null {
  const value = values.get(stepKey);
  return value?.type === "RANGE" ? value.value : null;
}

/** A whole-number range answer, or null when absent or not an integer. */
export function integer(
  values: ResponseValues,
  stepKey: string,
): number | null {
  const raw = decimal(values, stepKey);
  if (raw === null || !/^\d{1,9}$/.test(raw)) {
    return null;
  }
  return Number.parseInt(raw, 10);
}

export function resourceIds(
  values: ResponseValues,
  stepKey: string,
): readonly string[] | null {
  const value = values.get(stepKey);
  return value?.type === "RESOURCE_REFERENCE" ? value.resourceIds : null;
}

export function confirmed(values: ResponseValues, stepKey: string): boolean {
  const value = values.get(stepKey);
  return value?.type === "CONFIRMATION" ? value.confirmed : false;
}

export function labelOf(
  options: readonly { readonly optionKey: string; readonly label: string }[],
  optionKey: string | null,
): { key: string; label: string } | null {
  if (optionKey === null) {
    return null;
  }
  const option = options.find((candidate) => candidate.optionKey === optionKey);
  return option === undefined
    ? null
    : { key: option.optionKey, label: option.label };
}

export function labelsOf(
  options: readonly { readonly optionKey: string; readonly label: string }[],
  optionKeys: readonly string[] | null,
): { key: string; label: string }[] | null {
  if (optionKeys === null) {
    return null;
  }
  return optionKeys.flatMap((key) => {
    const labelled = labelOf(options, key);
    return labelled === null ? [] : [labelled];
  });
}
