import type { DatabaseExecutor } from "@capital-q/database";
import type { UserId } from "@capital-q/security";

import {
  decideOnboardingNudge,
  EMPTY_NUDGE_STATE,
  minutesLeft,
  ONBOARDING_NUDGE_POLICY,
  recordNudgeChoice,
  recordNudgeShown,
  type OnboardingNudgeChoice,
  type OnboardingNudgePolicyConfig,
  type OnboardingNudgeProgress,
  type OnboardingNudgeState,
  type OnboardingNudgeSurface,
} from "../domain/nudge-policy.js";
import { createPostgresOnboardingNudgeStateRepository } from "../infrastructure/postgres-nudge-state-repository.js";
import {
  createOwnOnboardingSummaryReader,
  type OwnOnboardingSummary,
  type OwnOnboardingSummaryReader,
} from "./own-summary.js";

/**
 * Setup reminders for one person (founder directive 2026-09-27): the
 * versioned policy in domain/nudge-policy.ts applied to their own setup
 * and to what has already been said to them about it.
 *
 * Every call is keyed by the caller's own user id, which the composing app
 * takes from the authenticated principal and never from input: a person
 * can only ever read or change their own reminders.
 */

/** What a reminder says, as facts; the surface words it. */
export type OnboardingNudge = {
  readonly policyVersion: string;
  readonly journeyType: "founder" | "investor";
  readonly emphasis: "STRONG" | "LIGHT";
  readonly requiredCount: number;
  readonly doneCount: number;
  readonly minutesLeft: number;
  /** The journey's own names for what is left, a few at most. */
  readonly remainingTopics: readonly string[];
  /** The UTC day it was given for: one card per day, recognisably. */
  readonly day: string;
};

export type OnboardingNudgeStateRepository = {
  readonly find: (
    executor: DatabaseExecutor,
    userId: UserId,
  ) => Promise<OnboardingNudgeState | null>;
  readonly save: (
    executor: DatabaseExecutor,
    userId: UserId,
    state: OnboardingNudgeState,
    policyVersion: string,
  ) => Promise<void>;
};

export type OnboardingNudgeRequest = {
  readonly surface: OnboardingNudgeSurface;
  readonly conversationId?: string | null | undefined;
};

export type OnboardingNudges = {
  /** The reminder due now on this surface, if any. Changes nothing. */
  readonly peek: (
    userId: UserId,
    request: OnboardingNudgeRequest,
  ) => Promise<OnboardingNudge | null>;
  /** Records that a reminder peeked was actually given. */
  readonly markShown: (
    userId: UserId,
    request: OnboardingNudgeRequest,
  ) => Promise<void>;
  /**
   * For the Home briefing: today's reminder. When one is due it is recorded
   * as given; when it was already given on the briefing today, the same one
   * is returned again so a re-rendered page does not lose or change it (the
   * browser shows a card it already showed today only once). Otherwise null.
   */
  readonly claimBriefing: (userId: UserId) => Promise<OnboardingNudge | null>;
  /** "Remind me later" / "stop reminding me". */
  readonly choose: (
    userId: UserId,
    choice: OnboardingNudgeChoice,
  ) => Promise<void>;
  /** The setup to continue, when there is one unfinished. */
  readonly continueTarget: (
    userId: UserId,
  ) => Promise<"founder" | "investor" | null>;
};

const TOPICS_IN_NUDGE = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Q conversation id as stored; anything else is not remembered. */
function conversationKey(id: string | null | undefined): string | null {
  return id !== undefined && id !== null && UUID.test(id) ? id : null;
}

/**
 * The one setup a reminder is about. A person who has completed either
 * setup is set up: a stray session on the other side is not something to
 * chase them about. Founder first, as Home's own context is.
 */
export function nudgeJourney(
  summaries: readonly OwnOnboardingSummary[],
): OwnOnboardingSummary | null {
  if (summaries.some((summary) => summary.status === "COMPLETED")) return null;
  const active = summaries.filter((summary) => summary.status === "ACTIVE");
  return (
    active.find((summary) => summary.journeyType === "founder") ??
    active.find((summary) => summary.journeyType === "investor") ??
    null
  );
}

function progressOf(summary: OwnOnboardingSummary): OnboardingNudgeProgress {
  return {
    status: summary.status,
    requiredCount: summary.requiredCount,
    requiredDoneCount: summary.requiredDoneCount,
    lastActivityAt: new Date(summary.lastActivityAt),
  };
}

function nudgeOf(
  summary: OwnOnboardingSummary,
  emphasis: "STRONG" | "LIGHT",
  config: OnboardingNudgePolicyConfig,
  now: Date,
): OnboardingNudge | null {
  if (summary.journeyType !== "founder" && summary.journeyType !== "investor") {
    return null;
  }
  return {
    policyVersion: config.version,
    journeyType: summary.journeyType,
    emphasis,
    requiredCount: summary.requiredCount,
    doneCount: summary.requiredDoneCount,
    minutesLeft: minutesLeft(progressOf(summary), config),
    remainingTopics: summary.remainingTopics.slice(0, TOPICS_IN_NUDGE),
    day: now.toISOString().slice(0, 10),
  };
}

export function createOnboardingNudges(options: {
  readonly sql: DatabaseExecutor;
  readonly states?: OnboardingNudgeStateRepository | undefined;
  readonly summaries?: OwnOnboardingSummaryReader | undefined;
  readonly config?: OnboardingNudgePolicyConfig | undefined;
  readonly now?: (() => Date) | undefined;
}): OnboardingNudges {
  const config = options.config ?? ONBOARDING_NUDGE_POLICY;
  const now = options.now ?? (() => new Date());
  const states =
    options.states ?? createPostgresOnboardingNudgeStateRepository();
  const summaries =
    options.summaries ?? createOwnOnboardingSummaryReader({ sql: options.sql });

  const load = async (userId: UserId) => {
    const [journey, state] = await Promise.all([
      summaries.read(userId).then(nudgeJourney),
      states.find(options.sql, userId),
    ]);
    return { journey, state: state ?? EMPTY_NUDGE_STATE };
  };

  const evaluate = async (userId: UserId, request: OnboardingNudgeRequest) => {
    const at = now();
    const { journey, state } = await load(userId);
    const decision = decideOnboardingNudge({
      progress: journey === null ? null : progressOf(journey),
      state,
      now: at,
      surface: request.surface,
      conversationId: request.conversationId,
      config,
    });
    return { at, journey, state, decision };
  };

  const record = async (
    userId: UserId,
    request: OnboardingNudgeRequest,
    journey: OwnOnboardingSummary,
    state: OnboardingNudgeState,
    at: Date,
  ) => {
    await states.save(
      options.sql,
      userId,
      recordNudgeShown({
        state,
        progress: progressOf(journey),
        now: at,
        surface: request.surface,
        conversationId: conversationKey(request.conversationId),
      }),
      config.version,
    );
  };

  return {
    peek: async (userId, request) => {
      const { at, journey, decision } = await evaluate(userId, request);
      return journey === null || !decision.due
        ? null
        : nudgeOf(journey, decision.emphasis, config, at);
    },
    markShown: async (userId, request) => {
      const { at, journey, state, decision } = await evaluate(userId, request);
      if (journey === null || !decision.due) return;
      await record(userId, request, journey, state, at);
    },
    claimBriefing: async (userId) => {
      const request = { surface: "BRIEFING" as const };
      const { at, journey, state, decision } = await evaluate(userId, request);
      if (journey === null) return null;
      if (decision.due) {
        await record(userId, request, journey, state, at);
        return nudgeOf(journey, decision.emphasis, config, at);
      }
      const today = at.toISOString().slice(0, 10);
      if (
        decision.reason === "ALREADY_TODAY" &&
        state.lastSurface === "BRIEFING" &&
        state.lastShownAt?.toISOString().slice(0, 10) === today
      ) {
        const share = journey.requiredDoneCount / journey.requiredCount;
        return nudgeOf(
          journey,
          share <= config.strongAtOrBelow ? "STRONG" : "LIGHT",
          config,
          at,
        );
      }
      return null;
    },
    choose: async (userId, choice) => {
      const state =
        (await states.find(options.sql, userId)) ?? EMPTY_NUDGE_STATE;
      await states.save(
        options.sql,
        userId,
        recordNudgeChoice({ state, choice, now: now(), config }),
        config.version,
      );
    },
    continueTarget: async (userId) => {
      const journey = nudgeJourney(await summaries.read(userId));
      return journey === null ||
        (journey.journeyType !== "founder" &&
          journey.journeyType !== "investor")
        ? null
        : journey.journeyType;
    },
  };
}
