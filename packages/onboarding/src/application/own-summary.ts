import type {
  OnboardingJourneyType,
  OnboardingResponseValue,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { UserId } from "@capital-q/security";

import type { OnboardingStepDefinition } from "../contracts/index.js";
import { computeProgress } from "../runtime/path.js";
import { createPostgresOnboardingDefinitionRepository } from "../infrastructure/postgres-definition-repository.js";
import {
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingStepStateRepository,
  createPostgresOnboardingSuggestionRepository,
} from "../infrastructure/postgres-session-repository.js";
import { createDefinitionCache, loadAggregate } from "./view.js";

/**
 * What a person has told Capital Q about themselves while setting up, as
 * facts (CQ-QX-007; acceptance directive — Home Q knowing the person).
 *
 * Read-only and the person's own: sessions are found by their user id and
 * nothing else, so this can only ever read the caller's own onboarding.
 * It returns FACTS — who they said they are, which steps are answered and
 * which are left, where they are now — never prose: how Q says any of it
 * belongs to the conversation, not here.
 *
 * Deliberately not the full session view: that view renders the current
 * step's server-side context (reviews, snapshots), which needs the journey
 * integrations a Q process does not compose. None of that is needed to
 * say who someone is and how far along they are.
 */
export type OwnOnboardingSummary = {
  readonly journeyType: OnboardingJourneyType;
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  /** What they said their role is, where the journey asks (I0 / F4). */
  readonly role: string | null;
  readonly answeredCount: number;
  readonly eligibleCount: number;
  /** The question they are on now, in the journey's own words. */
  readonly currentStep: string | null;
  /** Questions answered, in the journey's own words, path order. */
  readonly answered: readonly string[];
  /** Questions on their path not answered yet (skipped ones included). */
  readonly open: readonly string[];
};

export type OwnOnboardingSummaryReader = {
  readonly read: (userId: UserId) => Promise<readonly OwnOnboardingSummary[]>;
};

/** Where each journey asks the person's own role. Journey data, not language. */
const ROLE_STEP_KEYS: Readonly<Record<string, string>> = {
  investor: "I0.business_title",
  founder: "F4.founder_role",
};

const JOURNEYS: readonly OnboardingJourneyType[] = ["investor", "founder"];

const PROMPT_MAX = 160;
const LIST_MAX = 40;

function promptOf(step: OnboardingStepDefinition | undefined): string | null {
  const prompt = step?.configuration.prompt?.trim() ?? "";
  return prompt.length === 0 ? null : prompt.slice(0, PROMPT_MAX);
}

/** A role answer as the person gave it: their words, or the option's label. */
function roleOf(
  step: OnboardingStepDefinition | undefined,
  value: OnboardingResponseValue | undefined,
): string | null {
  if (step === undefined || value === undefined) return null;
  if (value.type === "TEXT") {
    const text = value.text.trim();
    return text.length === 0 ? null : text.slice(0, PROMPT_MAX);
  }
  if (value.type === "SINGLE_SELECT") {
    const configuration = step.configuration as {
      readonly options?: readonly {
        readonly optionKey: string;
        readonly label: string;
      }[];
    };
    return (
      configuration.options?.find(
        (option) => option.optionKey === value.optionKey,
      )?.label ?? null
    );
  }
  return null;
}

export function createOwnOnboardingSummaryReader(options: {
  readonly sql: DatabaseExecutor;
}): OwnOnboardingSummaryReader {
  const sessions = createPostgresOnboardingSessionRepository();
  const dependencies = {
    definitions: createPostgresOnboardingDefinitionRepository(),
    stepStates: createPostgresOnboardingStepStateRepository(),
    responses: createPostgresOnboardingResponseRepository(),
    suggestions: createPostgresOnboardingSuggestionRepository(),
  };
  const loadDefinition = createDefinitionCache(dependencies.definitions);
  return {
    read: async (userId) => {
      const summaries: OwnOnboardingSummary[] = [];
      for (const journeyType of JOURNEYS) {
        const session = await sessions.findLatest(
          options.sql,
          userId,
          journeyType,
        );
        if (session === null) continue;
        const aggregate = await loadAggregate(
          options.sql,
          dependencies,
          loadDefinition,
          session,
        );
        const progress = computeProgress(
          session,
          aggregate.path,
          aggregate.states,
        );
        const answered: string[] = [];
        const open: string[] = [];
        for (const step of progress.eligibleSteps) {
          const prompt = promptOf(aggregate.stepsByKey.get(step.stepKey));
          if (prompt === null) continue;
          if (step.status === "COMPLETED") answered.push(prompt);
          else open.push(prompt);
        }
        const roleKey = ROLE_STEP_KEYS[journeyType];
        summaries.push({
          journeyType,
          status: session.status,
          role:
            roleKey === undefined
              ? null
              : roleOf(
                  aggregate.stepsByKey.get(roleKey),
                  aggregate.currentResponses.get(roleKey)?.value,
                ),
          answeredCount: progress.completedEligibleStepCount,
          eligibleCount: progress.eligibleStepCount,
          currentStep:
            session.status === "ACTIVE" && session.currentStepKey !== null
              ? promptOf(aggregate.stepsByKey.get(session.currentStepKey))
              : null,
          answered: answered.slice(0, LIST_MAX),
          open: open.slice(0, LIST_MAX),
        });
      }
      return summaries;
    },
  };
}
