import type {
  OnboardingJourneyType,
  OnboardingResponseValue,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createPostgresInvestorMandateRepository,
  InvestorOrganisationIdSchema,
} from "@capital-q/investors";
import type { UserId } from "@capital-q/security";

import type {
  OnboardingSession,
  OnboardingStepDefinition,
} from "../contracts/index.js";
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
  /**
   * Whether their setup is done, from the authoritative record: COMPLETED
   * when any of their sessions for the journey completed, or when what
   * the journey exists to produce is already live (an investor's ACTIVE
   * mandate) — however they got there, form or conversation.
   */
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  /** What made it complete; null while it is not. */
  readonly completedBy: OwnOnboardingCompletion;
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
  /** Required steps on their path, and how many are answered or skipped. */
  readonly requiredCount: number;
  readonly requiredDoneCount: number;
  /** The journey's own names for the parts with required steps still open. */
  readonly remainingTopics: readonly string[];
  /** When they last worked on this setup. */
  readonly lastActivityAt: string;
};

export type OwnOnboardingCompletion = "SESSION" | "ACTIVE_MANDATE" | null;

/**
 * The completion of a journey, from the authoritative state. The latest
 * session is navigation, not the outcome: a person who finished by the
 * form has an ACTIVE mandate while a session they never closed still
 * counts questions (ACC 2026-09-25: "setup still in progress, 13 of 32"
 * to an investor whose mandate was live). A cancelled session never
 * completes anything by itself, but it cannot undo an outcome either.
 */
export function settleOwnCompletion(input: {
  readonly latestStatus: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly anyCompletedSession: boolean;
  readonly activeMandate: boolean;
}): {
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly completedBy: OwnOnboardingCompletion;
} {
  if (input.latestStatus === "COMPLETED" || input.anyCompletedSession) {
    return { status: "COMPLETED", completedBy: "SESSION" };
  }
  if (input.activeMandate) {
    return { status: "COMPLETED", completedBy: "ACTIVE_MANDATE" };
  }
  return { status: input.latestStatus, completedBy: null };
}

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
  note: string | null = null,
): string | null {
  if (step === undefined || value === undefined) return null;
  // Their own words where the options could not hold them ("Founder"),
  // rather than the catch-all's label.
  if (
    value.type === "SINGLE_SELECT" &&
    value.optionKey === "other" &&
    note !== null &&
    note.trim().length > 0
  ) {
    return note.trim().slice(0, PROMPT_MAX);
  }
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
  const mandates = createPostgresInvestorMandateRepository();

  /** Their own sessions only: the predicate is the caller's user id. */
  const anyCompleted = async (
    userId: UserId,
    journeyType: OnboardingJourneyType,
  ): Promise<boolean> => {
    const rows = await options.sql`
      select 1 from onboarding.sessions s
       where s.user_id = ${userId}
         and s.journey_type = ${journeyType}
         and s.status = 'COMPLETED'
       limit 1`;
    return rows.length > 0;
  };

  /**
   * Whether the investor organisation their own session is bound to has
   * an ACTIVE mandate. Read through the investors context's public
   * repository, by the session's own tenant and subject; only the status
   * is used, never the mandate's content.
   */
  const activeMandate = async (
    session: OnboardingSession,
  ): Promise<boolean> => {
    if (session.journeyType !== "investor") return false;
    if (session.tenantId === null || session.subject === null) return false;
    if (session.subject.subjectType !== "INVESTOR_ORGANISATION") return false;
    const organisation = InvestorOrganisationIdSchema.safeParse(
      session.subject.subjectId,
    );
    if (!organisation.success) return false;
    const active = await mandates.list(
      options.sql,
      session.tenantId,
      organisation.data,
      { status: "ACTIVE", limit: 1 },
    );
    return active.length > 0;
  };

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
        const required = progress.eligibleSteps.filter((step) => step.required);
        const requiredDone = required.filter(
          (step) => step.status === "COMPLETED" || step.status === "SKIPPED",
        );
        const phaseLabels = new Map(
          aggregate.definition.version.schema.phases.map((phase) => [
            phase.phaseKey,
            phase.label,
          ]),
        );
        const remainingTopics = [
          ...new Set(
            required
              .filter(
                (step) =>
                  step.status !== "COMPLETED" && step.status !== "SKIPPED",
              )
              .map((step) =>
                step.phaseKey === undefined
                  ? undefined
                  : phaseLabels.get(step.phaseKey),
              )
              .filter((label): label is string => label !== undefined),
          ),
        ];
        for (const step of progress.eligibleSteps) {
          const prompt = promptOf(aggregate.stepsByKey.get(step.stepKey));
          if (prompt === null) continue;
          if (step.status === "COMPLETED") answered.push(prompt);
          else open.push(prompt);
        }
        const roleKey = ROLE_STEP_KEYS[journeyType];
        const completion = settleOwnCompletion({
          latestStatus: session.status,
          anyCompletedSession:
            session.status !== "COMPLETED" &&
            (await anyCompleted(userId, journeyType)),
          activeMandate:
            session.status !== "COMPLETED" && (await activeMandate(session)),
        });
        summaries.push({
          journeyType,
          status: completion.status,
          completedBy: completion.completedBy,
          role:
            roleKey === undefined
              ? null
              : roleOf(
                  aggregate.stepsByKey.get(roleKey),
                  aggregate.currentResponses.get(roleKey)?.value,
                  aggregate.currentResponses.get(roleKey)?.note ?? null,
                ),
          answeredCount: progress.completedEligibleStepCount,
          eligibleCount: progress.eligibleStepCount,
          currentStep:
            completion.status === "ACTIVE" && session.currentStepKey !== null
              ? promptOf(aggregate.stepsByKey.get(session.currentStepKey))
              : null,
          answered: answered.slice(0, LIST_MAX),
          open: open.slice(0, LIST_MAX),
          requiredCount: required.length,
          requiredDoneCount: requiredDone.length,
          remainingTopics: remainingTopics.slice(0, LIST_MAX),
          lastActivityAt: session.lastActivityAt,
        });
      }
      return summaries;
    },
  };
}
