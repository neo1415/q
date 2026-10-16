import type { DatabaseExecutor } from "@capital-q/database";
import {
  createOwnOnboardingTranscriptReader,
  displayOnboardingValue,
} from "@capital-q/onboarding";
import type {
  OnboardingTranscriptPort,
  RecallMySetupOutput,
} from "@capital-q/q-tools";

import { definitionFor } from "../voice/interview-steps.js";
import { SPOKEN_QUESTIONS } from "../voice/step-copy.js";

/**
 * Lane ob1: the person's own setup conversation for recall_my_setup. The
 * reader is keyed by the actor's own user id; this only turns step keys
 * into the journey's own questions and values into words. Taxonomy and
 * mandate references stay counts (no extra lookups), and nothing is
 * summarised by a model.
 */
export function createOnboardingTranscriptPort(dependencies: {
  readonly sql: DatabaseExecutor;
}): OnboardingTranscriptPort {
  const reader = createOwnOnboardingTranscriptReader(dependencies);
  return {
    recall: async (actor, options): Promise<RecallMySetupOutput> => {
      const sessions = await reader.recall(actor.userId, options);
      const setups = sessions.map((session) => {
        const steps = new Map(
          definitionFor(session.journeyType).steps.map((s) => [s.stepKey, s]),
        );
        const questionOf = (stepKey: string | null): string | null => {
          if (stepKey === null) return null;
          const step = steps.get(stepKey);
          return (
            (
              SPOKEN_QUESTIONS[stepKey] ??
              step?.configuration.prompt ??
              null
            )?.slice(0, 300) ?? null
          );
        };
        const line = (l: (typeof session.lines)[number]) => ({
          at: l.at,
          text: l.text.slice(0, 1200),
          question: questionOf(l.stepKey),
        });
        return {
          journey: session.journeyType,
          status: session.status,
          answers: session.answers
            .flatMap((answer) => {
              const step = steps.get(answer.stepKey);
              if (step === undefined) return [];
              return [
                {
                  question: (
                    questionOf(answer.stepKey) ?? answer.stepKey
                  ).slice(0, 300),
                  answer: displayOnboardingValue(step, answer.value).slice(
                    0,
                    600,
                  ),
                },
              ];
            })
            .slice(0, 60),
          theirWords: session.lines
            .filter((l) => l.role === "PERSON")
            .map(line)
            .slice(0, 40),
          qSaid: session.lines
            .filter((l) => l.role === "Q")
            .map(line)
            .slice(0, 40),
        };
      });
      return {
        status: setups.length === 0 ? "NONE" : "FOUND",
        setups: setups.slice(0, 2),
      };
    },
  };
}
