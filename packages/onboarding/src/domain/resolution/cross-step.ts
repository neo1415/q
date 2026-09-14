import type { OnboardingResponseValue } from "@capital-q/contracts";

import type { OnboardingStepConfiguration } from "../../definitions/schema.js";
import { parseFigure } from "../figure.js";
import { affirmativeText, clausesOf } from "../negation.js";
import { mentions, normalise } from "../text.js";
import {
  matchOptions,
  mentionedOptions,
  type OptionAliases,
} from "./options.js";

/**
 * One utterance may answer many questions (CQ-Q-VOICE-001 A §8-§9, §12).
 *
 * "I'm the founder and CEO. We're based in Lagos, we build software for
 * freight forwarders, and we're raising $1.5m mainly to hire salespeople
 * and expand into Ghana." is read against EVERY step of the journey the
 * person has not yet answered — not only the one Q just asked — and each
 * unambiguous hit becomes a proposal the person confirms, retained until
 * its step is reached. A hit that could mean several options becomes a
 * choice. A hit on an exclusion step becomes a confirmation question,
 * because the only route to a hard exclusion is the person's own answer.
 *
 * Deterministic and bounded: option vocabularies and alias tables, figures
 * next to the cue words a journey declares, and the definition's own
 * validation afterwards. No model, no invented key, no invented figure.
 */

export type InterviewStepCue =
  /** A range step answered by a figure near one of these words ("raising $1.5m"). */
  | { readonly kind: "FIGURE"; readonly cues: readonly string[] }
  /** Two range steps answered together by "$250k to $1m" (declared on the low step). */
  | { readonly kind: "FIGURE_RANGE"; readonly highStepKey: string }
  /** A hard-exclusion step: a mention is a question, never a value (declared on the hard step). */
  | { readonly kind: "EXCLUSION"; readonly softStepKey: string };

export type InterviewCues = Readonly<Record<string, InterviewStepCue>>;

export type CrossStepInput = {
  readonly stepKey: string;
  readonly status: "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "UNSEEN";
  readonly configuration: OnboardingStepConfiguration;
};

export type CrossStepReading =
  | {
      readonly kind: "PROPOSE";
      readonly stepKey: string;
      readonly value: OnboardingResponseValue;
      readonly summary: string;
    }
  | {
      readonly kind: "CHOOSE";
      readonly stepKey: string;
      readonly options: readonly {
        readonly optionKey: string;
        readonly label: string;
      }[];
    }
  | {
      readonly kind: "CONFIRM_EXCLUSION";
      readonly hardStepKey: string;
      readonly softStepKey: string;
      readonly optionKey: string;
      readonly label: string;
    };

export const CROSS_STEP_MAX_READINGS = 12;

type Aliases = Readonly<Record<string, OptionAliases>>;

const MONEY =
  /(?:[$£€]|usd|gbp|eur|ngn)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|m|mn|million|bn|b|billion|thousand)?/i;

/** "$250k to $1m", "250k-1m", "between $250k and $1m" → two figures. */
export function parseFigurePair(
  text: string,
): { readonly low: string; readonly high: string } | null {
  const pair = new RegExp(
    `(${MONEY.source})\\s*(?:-|–|—|to|and|up to)\\s*(${MONEY.source})`,
    "i",
  ).exec(text);
  if (pair === null) {
    return null;
  }
  const low = parseFigure(pair[1] ?? "");
  const high = parseFigure(pair[2] ?? "");
  if (low === null || high === null) {
    return null;
  }
  return Number.parseFloat(low) <= Number.parseFloat(high)
    ? { low, high }
    : { low: high, high: low };
}

function withinRange(
  figure: string,
  configuration: Extract<OnboardingStepConfiguration, { stepType: "range" }>,
): boolean {
  const value = Number.parseFloat(figure);
  return (
    value >= Number.parseFloat(configuration.min) &&
    value <= Number.parseFloat(configuration.max)
  );
}

/** The figure in the clause that carries one of the cue words, when it fits. */
function cuedFigure(
  text: string,
  cues: readonly string[],
  configuration: Extract<OnboardingStepConfiguration, { stepType: "range" }>,
): string | null {
  for (const clause of clausesOf(affirmativeText(text))) {
    if (!cues.some((cue) => mentions(clause, cue))) {
      continue;
    }
    const figure = parseFigure(clause);
    if (figure !== null && withinRange(figure, configuration)) {
      return figure;
    }
  }
  return null;
}

export function resolveAcrossSteps(input: {
  readonly text: string;
  readonly steps: readonly CrossStepInput[];
  readonly currentStepKey: string | null;
  readonly aliases: Aliases;
  readonly cues: InterviewCues;
}): readonly CrossStepReading[] {
  const readings: CrossStepReading[] = [];
  const text = input.text.trim();
  if (normalise(text).split(" ").length < 2) {
    return readings;
  }
  const byKey = new Map(input.steps.map((step) => [step.stepKey, step]));
  const claimedExclusionKeys = new Map<string, Set<string>>();

  // Exclusion steps first: a mention there is a question for the person,
  // and the same option is not then also proposed on the softer step.
  for (const step of input.steps) {
    const cue = input.cues[step.stepKey];
    if (
      cue?.kind !== "EXCLUSION" ||
      step.configuration.stepType !== "multi_select"
    ) {
      continue;
    }
    const soft = byKey.get(cue.softStepKey);
    const softAliases =
      soft === undefined ? undefined : input.aliases[soft.stepKey];
    const named = mentionedOptions(text, step.configuration.options, {
      ...(input.aliases[step.stepKey] ?? {}),
      ...(softAliases ?? {}),
    });
    for (const option of named) {
      readings.push({
        kind: "CONFIRM_EXCLUSION",
        hardStepKey: step.stepKey,
        softStepKey: cue.softStepKey,
        optionKey: option.optionKey,
        label: option.label,
      });
      const claimed = claimedExclusionKeys.get(cue.softStepKey) ?? new Set();
      claimed.add(option.optionKey);
      claimedExclusionKeys.set(cue.softStepKey, claimed);
      claimedExclusionKeys.set(step.stepKey, claimed);
    }
  }

  for (const step of input.steps) {
    if (readings.length >= CROSS_STEP_MAX_READINGS) {
      break;
    }
    if (step.stepKey === input.currentStepKey || step.status === "COMPLETED") {
      continue;
    }
    const cue = input.cues[step.stepKey];
    if (cue?.kind === "EXCLUSION") {
      continue;
    }
    const aliases = input.aliases[step.stepKey];
    const { configuration } = step;
    switch (configuration.stepType) {
      case "single_select": {
        const claimed = claimedExclusionKeys.get(step.stepKey) ?? new Set();
        const matched = matchOptions(
          text,
          configuration.options,
          aliases,
        ).filter((m) => !claimed.has(m.option.optionKey));
        const only = matched.length === 1 ? matched[0] : undefined;
        if (only !== undefined) {
          readings.push({
            kind: "PROPOSE",
            stepKey: step.stepKey,
            value: { type: "SINGLE_SELECT", optionKey: only.option.optionKey },
            summary: only.option.label,
          });
        } else if (matched.length > 1) {
          readings.push({
            kind: "CHOOSE",
            stepKey: step.stepKey,
            options: matched.map((m) => ({
              optionKey: m.option.optionKey,
              label: m.option.label,
            })),
          });
        }
        break;
      }
      case "multi_select": {
        const claimed = claimedExclusionKeys.get(step.stepKey) ?? new Set();
        const matched = matchOptions(text, configuration.options, aliases)
          .map((m) => m.option)
          .filter((option) => !claimed.has(option.optionKey));
        const exclusive = new Set(configuration.exclusiveOptionKeys);
        const chosen = matched.some((o) => exclusive.has(o.optionKey))
          ? matched.filter((o) => exclusive.has(o.optionKey)).slice(0, 1)
          : matched.slice(0, configuration.maxSelections);
        if (
          chosen.length >= Math.max(1, configuration.minSelections) &&
          chosen.length <= configuration.maxSelections
        ) {
          readings.push({
            kind: "PROPOSE",
            stepKey: step.stepKey,
            value: {
              type: "MULTI_SELECT",
              optionKeys: chosen.map((o) => o.optionKey),
            },
            summary: chosen.map((o) => o.label).join(", "),
          });
        }
        break;
      }
      case "range": {
        if (cue?.kind === "FIGURE_RANGE") {
          const high = byKey.get(cue.highStepKey);
          const pair = parseFigurePair(affirmativeText(text));
          if (
            pair !== null &&
            high?.configuration.stepType === "range" &&
            withinRange(pair.low, configuration) &&
            withinRange(pair.high, high.configuration)
          ) {
            readings.push({
              kind: "PROPOSE",
              stepKey: step.stepKey,
              value: { type: "RANGE", value: pair.low },
              summary: pair.low,
            });
            if (
              high.status !== "COMPLETED" &&
              high.stepKey !== input.currentStepKey
            ) {
              readings.push({
                kind: "PROPOSE",
                stepKey: high.stepKey,
                value: { type: "RANGE", value: pair.high },
                summary: pair.high,
              });
            }
          }
        } else if (cue?.kind === "FIGURE") {
          const figure = cuedFigure(text, cue.cues, configuration);
          if (figure !== null) {
            readings.push({
              kind: "PROPOSE",
              stepKey: step.stepKey,
              value: { type: "RANGE", value: figure },
              summary: figure,
            });
          }
        }
        break;
      }
      // Text, confirmation, upload and reference steps are not answered by a
      // sentence about something else; taxonomy references have their own path.
      case "short_text":
      case "long_text":
      case "voice_text":
      case "document_upload":
      case "confirmation":
      case "reference_select":
        break;
    }
  }
  // A range step named as the HIGH of a pair may already have been proposed.
  const seen = new Set<string>();
  return readings.filter((reading) => {
    const key =
      reading.kind === "CONFIRM_EXCLUSION"
        ? `x:${reading.hardStepKey}:${reading.optionKey}`
        : `${reading.kind}:${reading.stepKey}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
