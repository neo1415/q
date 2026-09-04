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

export function text(values: ResponseValues, stepKey: string): string | null {
  const value = values.get(stepKey);
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
