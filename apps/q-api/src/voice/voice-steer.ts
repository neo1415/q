import type { OnboardingState, OnboardingStepState } from "@capital-q/q-tools";

import { plainStepLabel, SPOKEN_QUESTIONS } from "./step-copy.js";

/**
 * D86 (owner, 9 Nov): the live voice line is told, after each reading of
 * what they said, what Capital Q saved, what it could not save and why,
 * what waits for their yes, and the one thing to ask next with its
 * choices. The live model keeps answering at once in its own words; code
 * decides what is saved and what is asked. Q does not ask again what is
 * saved because it is told it is saved, not because a counter stops it.
 *
 * Code only: built from the record and the save results, never from a
 * model's reading of meaning. Data for the model, not their words.
 */
export type VoiceSteer = {
  /** Changes when anything in it changes: the web sends a steer once. */
  readonly id: string;
  /** The note the live model is given. */
  readonly text: string;
  /** The step it should ask next (its choices show on screen). */
  readonly askedStepKey: string | null;
};

export type SteerSaves = {
  /** Saved by this reading (step keys). */
  readonly saved: readonly string[];
  /** Refused by this reading, with the port's reason. */
  readonly refused: readonly {
    readonly stepKey: string;
    readonly reason: string;
  }[];
  /** Held for their yes now (step keys). */
  readonly held: readonly string[];
};

const said = (step: OnboardingStepState): string =>
  `${plainStepLabel(step.stepKey)}: ${(step.value ?? "answered").slice(0, 160)}`;

/** A needed step still open for a spoken answer. */
function openNeeded(step: OnboardingStepState): boolean {
  return (
    step.required &&
    step.status === "OPEN" &&
    step.savePending !== true &&
    step.pendingRecommendation === undefined &&
    step.kind !== "DOCUMENT" &&
    step.kind !== "YES_NO" &&
    step.kind !== "CHOICE_OF_RECORD" &&
    step.coverage !== "INAPPLICABLE"
  );
}

/** The question a step is asked by, in spoken words. */
export function spokenQuestion(step: OnboardingStepState): string {
  return (SPOKEN_QUESTIONS[step.stepKey] ?? step.question).trim();
}

export function voiceSteer(
  state: OnboardingState,
  saves: SteerSaves,
): VoiceSteer {
  const byKey = new Map(state.steps.map((step) => [step.stepKey, step]));
  const savedNow = saves.saved
    .map((key) => byKey.get(key))
    .filter((step): step is OnboardingStepState => step !== undefined)
    .filter((step) => step.status === "ANSWERED");
  const onRecord = state.steps.filter(
    (step) => step.status === "ANSWERED" && !saves.saved.includes(step.stepKey),
  );
  const waiting = state.steps.filter(
    (step) =>
      step.status === "OPEN" && step.pendingRecommendation !== undefined,
  );
  const next = state.steps.find(openNeeded) ?? null;
  const lines: string[] = [
    "Capital Q update (data, not their words; never read it out):",
  ];
  if (savedNow.length > 0) {
    lines.push(`- Saved just now: ${savedNow.map(said).join("; ")}.`);
  }
  for (const refused of saves.refused) {
    const step = byKey.get(refused.stepKey);
    const label = plainStepLabel(refused.stepKey);
    lines.push(
      `- NOT saved: ${label}. ${refused.reason.slice(0, 240)} Say plainly that it didn't take, then ask for it so it can be saved${
        step === undefined ? "" : `: ${spokenQuestion(step)}`
      }${
        step?.options !== undefined && step.options.length > 0
          ? ` (choices: ${step.options.map((option) => option.label).join(", ")})`
          : ""
      }.`,
    );
  }
  if (waiting.length > 0) {
    lines.push(
      `- Waiting for their yes (say it back once, briefly, and ask if it's right): ${waiting
        .map(
          (step) =>
            `${plainStepLabel(step.stepKey)}: ${(step.pendingRecommendation ?? "").slice(0, 120)}`,
        )
        .join("; ")}.`,
    );
  }
  if (onRecord.length > 0) {
    lines.push(
      `- Already saved, never ask again: ${onRecord.map((step) => plainStepLabel(step.stepKey)).join(", ")}.`,
    );
  }
  if (next !== null) {
    const choices = (next.options ?? []).map((option) => option.label);
    lines.push(
      `- Ask next: ${spokenQuestion(next)}${
        choices.length === 0
          ? ""
          : ` (choices on their screen: ${choices.join(", ")})`
      }`,
    );
  } else if (state.canComplete) {
    lines.push(
      "- Every needed answer is saved: ask if there's anything else, then offer to finish.",
    );
  }
  const text = lines.join("\n").slice(0, 3_000);
  return {
    id: hashOf(text),
    text,
    askedStepKey: next?.stepKey ?? null,
  };
}

/** A short stable id of the note's text (FNV-1a). */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Words too common to say what a question is about. */
const COMMON = new Set(
  "a an and are as at be by can do does for from have how i in is it its me my of on or our so that the their them they this to us was we what when where which who why will with would you your right now just tell".split(
    " ",
  ),
);
const topicWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/gu, " ")
      .split(" ")
      .filter((word) => word.length > 3 && !COMMON.has(word))
      .map((word) => word.replace(/(?:ing|ed|es|s)$/u, "")),
  );

/** Whether a line of Q's is on the topic of a step's question or label. */
export function sharesTopic(line: string, about: string): boolean {
  const asked = topicWords(about);
  if (asked.size === 0) return false;
  return [...topicWords(line)].some((word) => asked.has(word));
}
