import type { ResponseValues } from "@capital-q/onboarding";

import {
  FOUNDER_STEPS,
  INTENT_OPTIONS,
  RAISING_OPTIONS,
} from "../definition/founder-v1.js";

/**
 * Final check 2026-10-30: a founder's first answer said "I'm raising for a
 * company" (F0.intent raising_now) and their raise answer said "Not right
 * now" (F6.raising not_now). Both stayed on record and nothing said so.
 *
 * Contradictions coexist until the person reconciles them: neither answer
 * is overwritten or preferred here. This only finds the disagreement, from
 * the two recorded option keys (never their words), as an open check the
 * conversation raises once and the read-back shows until it is settled.
 * Pure: the same answers, the same checks.
 */
export type FounderRecordCheck = {
  /** Stable for the same disagreement, so "raised once" holds across turns. */
  readonly id: string;
  readonly stepKeys: readonly string[];
  /** Capital Q's words for what is on the record, never theirs. */
  readonly fact: string;
};

const labelOf = (
  options: readonly { readonly optionKey: string; readonly label: string }[],
  key: string,
): string => options.find((o) => o.optionKey === key)?.label ?? key;

const selected = (values: ResponseValues, stepKey: string): string | null => {
  const value = values.get(stepKey);
  return value?.type === "SINGLE_SELECT" ? value.optionKey : null;
};

export function founderRecordChecks(
  values: ResponseValues,
): FounderRecordCheck[] {
  const intent = selected(values, FOUNDER_STEPS.intent);
  const raising = selected(values, FOUNDER_STEPS.raising);
  if (intent !== "raising_now" || raising !== "not_now") return [];
  return [
    {
      id: `RAISING_INTENT_VS_STATUS:${intent}:${raising}`,
      stepKeys: [FOUNDER_STEPS.intent, FOUNDER_STEPS.raising],
      fact: `On record, what brings you to Capital Q is "${labelOf(INTENT_OPTIONS, intent)}", and whether you are raising now is "${labelOf(RAISING_OPTIONS, raising)}".`,
    },
  ];
}
