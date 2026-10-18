import { languageInfo } from "@capital-q/q-core/language";

import { definitionFor } from "./interview-steps.js";
import { coverageProfileFor } from "./onboarding-port.js";
import {
  FIXED_LEAD,
  OPTIONAL_ACKNOWLEDGEMENT_TAIL,
  RESEARCH_NOTHING_LINE,
  RESEARCH_STARTED_LINE,
} from "./quick-acknowledgement.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import { HAND_STEP_COPY } from "./step-copy-language.js";

/**
 * Warms the onboarding acknowledgement copy in a language (owner direction
 * via lead, 2026-10-16). Live on AH, French chosen: each new field's label
 * and question was a first sighting, so the code-written reply waited for
 * translations and the model replied (6-8 s). When a language is chosen,
 * or onboarding starts in one, every line a code-written reply can need is
 * sent through the same translation path in the background: the fixed
 * lead, every field label, every choice, every step question and the
 * optional tail. All of it is product copy (PUBLIC); no person's words.
 * The UI_TRANSLATION daily cap still decides; nothing here waits.
 */

/** The most texts one localise call takes (answer-words MAX_TEXTS). */
const CHUNK = 40;

function asQuestion(text: string): string {
  const trimmed = text.slice(0, 300).trim();
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

/** Every English line a code-written onboarding reply can say, for a journey. */
export function onboardingAcknowledgementCopy(
  journey: "founder" | "investor",
  /** Primary language subtag: lines it has hand copy for are left out. */
  primary?: string,
): readonly string[] {
  return [
    ...acknowledgementSentences(journey, primary),
    ...choiceLabels(journey),
  ];
}

/** The choices' own labels, translated whole (never as sentences with names lifted). */
export function choiceLabels(
  journey: "founder" | "investor",
): readonly string[] {
  const labels = new Set<string>();
  for (const step of definitionFor(journey).steps) {
    const configuration: unknown = step.configuration;
    const options =
      typeof configuration === "object" &&
      configuration !== null &&
      "options" in configuration &&
      Array.isArray(configuration.options)
        ? (configuration.options as readonly { readonly label?: unknown }[])
        : [];
    for (const option of options) {
      if (typeof option.label === "string") labels.add(option.label);
    }
  }
  return [...labels];
}

/** The sentence-like copy (lead, field labels, questions, tail, research lines). */
export function acknowledgementSentences(
  journey: "founder" | "investor",
  primary?: string,
): readonly string[] {
  const hand = primary === undefined ? undefined : HAND_STEP_COPY[primary];
  const lines = new Set<string>([
    FIXED_LEAD,
    RESEARCH_STARTED_LINE,
    RESEARCH_NOTHING_LINE,
  ]);
  if (hand === undefined) lines.add(OPTIONAL_ACKNOWLEDGEMENT_TAIL);
  for (const field of Object.values(coverageProfileFor(journey).fields)) {
    if (field?.label !== undefined) lines.add(field.label.toLowerCase());
  }
  for (const step of definitionFor(journey).steps) {
    if (hand?.questions[step.stepKey] !== undefined) continue;
    const spoken = SPOKEN_QUESTIONS[step.stepKey];
    if (spoken !== undefined) lines.add(asQuestion(spoken));
    lines.add(asQuestion(step.configuration.prompt));
  }
  return [...lines].filter((line) => line.trim().length > 1);
}

export type AcknowledgementWarmup = {
  /** Starts warming a language once per process; returns at once. */
  readonly warm: (
    actor: { readonly tenantId: string; readonly userId: string },
    language: string,
    journeys?: readonly ("founder" | "investor")[],
  ) => void;
};

export function createAcknowledgementWarmup(dependencies: {
  /** Choice labels whole (translateLines); absent, they go with the rest. */
  readonly localiseLabels?:
    | ((
        actor: { readonly tenantId: string; readonly userId: string },
        language: string,
        labels: readonly string[],
        options: { readonly cachedOnly: true },
      ) => Promise<unknown>)
    | undefined;
  readonly localise: (
    actor: { readonly tenantId: string; readonly userId: string },
    language: string,
    texts: readonly string[],
    options: { readonly cachedOnly: true },
  ) => Promise<unknown>;
  readonly logger?:
    | {
        readonly info: (
          object: Record<string, unknown>,
          message: string,
        ) => void;
        readonly warn: (
          object: Record<string, unknown>,
          message: string,
        ) => void;
      }
    | undefined;
}): AcknowledgementWarmup {
  const warmed = new Set<string>();
  return {
    warm: (actor, language, journeys = ["founder", "investor"]) => {
      const info = languageInfo(language);
      if (info === null || info.primary === "en") return;
      for (const journey of journeys) {
        const key = `${journey}|${info.tag}`;
        if (warmed.has(key)) continue;
        warmed.add(key);
        const labels = dependencies.localiseLabels;
        const sentences =
          labels === undefined
            ? onboardingAcknowledgementCopy(journey, info.primary)
            : acknowledgementSentences(journey, info.primary);
        const lines = [
          ...sentences,
          ...(labels === undefined ? [] : choiceLabels(journey)),
        ];
        const chunksOf = (all: readonly string[]) => {
          const chunks: string[][] = [];
          for (let i = 0; i < all.length; i += CHUNK) {
            chunks.push(all.slice(i, i + CHUNK));
          }
          return chunks;
        };
        // cachedOnly: each call returns at once and leaves the missing
        // lines translating in the background, for the next reply.
        void Promise.all([
          ...chunksOf(sentences).map((chunk) =>
            dependencies.localise(actor, info.tag, chunk, { cachedOnly: true }),
          ),
          ...(labels === undefined
            ? []
            : chunksOf(choiceLabels(journey)).map((chunk) =>
                labels(actor, info.tag, chunk, { cachedOnly: true }),
              )),
        ])
          .then(() => {
            dependencies.logger?.info(
              { language: info.tag, journey, lines: lines.length },
              "onboarding acknowledgement copy warming",
            );
          })
          .catch((error: unknown) => {
            // Tried again by the next process or choice; replies fall back
            // to the model meanwhile.
            warmed.delete(key);
            dependencies.logger?.warn(
              { err: error, language: info.tag },
              "onboarding acknowledgement copy not warmed",
            );
          });
      }
    },
  };
}
