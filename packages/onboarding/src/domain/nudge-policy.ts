/**
 * When Q reminds a person to finish their setup (founder directive
 * 2026-09-27: "constantly reminds them to complete it, but not in an
 * incessant and annoying way").
 *
 * Pure and deterministic: no model decides whether to remind. The numbers
 * live in one versioned config so a change to the cadence is a reviewed
 * change with a new version, never a constant edited in a component.
 *
 * Investor trust over engagement: a reminder is a service to someone who
 * started and has not finished, never a lever for activity. It backs off
 * the longer it goes unanswered, it can be put off or turned off by a word,
 * and it stops the moment the setup is complete. Skipping is allowed and
 * unknown is a valid state; a reminder never demands an answer.
 */

export type OnboardingNudgePolicyConfig = {
  readonly version: string;
  /**
   * Whole calendar days between reminders, indexed by how many have been
   * given since the person last worked on their setup. The last entry is
   * the cap: never less often than that, never more often than the first.
   */
  readonly backoffDays: readonly number[];
  /** Past this share done, the reminder is lighter: it starts one step on. */
  readonly strongAtOrBelow: number;
  readonly lightBackoffOffset: number;
  /** "Remind me later". */
  readonly snoozeDays: number;
  /** Someone who worked on it this recently is mid-flow, not in need of a nudge. */
  readonly quietAfterActivityHours: number;
  /** For "about N minutes left"; a steady estimate, never a promise. */
  readonly secondsPerStep: number;
};

export const ONBOARDING_NUDGE_POLICY: OnboardingNudgePolicyConfig = {
  version: "onboarding-nudge/2026-09-27.1",
  backoffDays: [1, 2, 4, 7],
  strongAtOrBelow: 0.5,
  lightBackoffOffset: 1,
  snoozeDays: 3,
  quietAfterActivityHours: 12,
  secondsPerStep: 20,
};

/** Where a reminder is shown. Both draw on the one cadence. */
export const ONBOARDING_NUDGE_SURFACES = ["BRIEFING", "Q_NOTE"] as const;
export type OnboardingNudgeSurface = (typeof ONBOARDING_NUDGE_SURFACES)[number];

/** Where the person's own setup stands, from the authoritative record. */
export type OnboardingNudgeProgress = {
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly requiredCount: number;
  /** Required steps answered or skipped. */
  readonly requiredDoneCount: number;
  readonly lastActivityAt: Date;
};

/** What has been said to them about it, per person. */
export type OnboardingNudgeState = {
  readonly lastShownAt: Date | null;
  readonly lastSurface: OnboardingNudgeSurface | null;
  /** Reminders given since they last worked on their setup. */
  readonly shownCount: number;
  /** The Q conversation the last Q mention was in. */
  readonly lastConversationId: string | null;
  readonly snoozedUntil: Date | null;
  /** "Stop reminding me": holds until they next work on their setup. */
  readonly stoppedAt: Date | null;
};

export const EMPTY_NUDGE_STATE: OnboardingNudgeState = {
  lastShownAt: null,
  lastSurface: null,
  shownCount: 0,
  lastConversationId: null,
  snoozedUntil: null,
  stoppedAt: null,
};

export type OnboardingNudgeQuiet =
  | "NOT_STARTED"
  | "NOTHING_REQUIRED"
  | "COMPLETE"
  | "STOPPED"
  | "SNOOZED"
  | "RECENT_ACTIVITY"
  | "ALREADY_IN_CONVERSATION"
  | "ALREADY_TODAY"
  | "BACKING_OFF";

export type OnboardingNudgeDecision =
  | {
      readonly due: true;
      readonly emphasis: "STRONG" | "LIGHT";
      /** Share of required steps done, 0..1 (exclusive of 1). */
      readonly share: number;
    }
  | { readonly due: false; readonly reason: OnboardingNudgeQuiet };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC calendar day, as a whole number. The server has no local day. */
function dayNumber(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

/** Reminders given since they last worked on it; older ones do not count. */
export function nudgeStreak(
  state: OnboardingNudgeState,
  progress: OnboardingNudgeProgress,
): number {
  return state.lastShownAt !== null &&
    state.lastShownAt.getTime() > progress.lastActivityAt.getTime()
    ? state.shownCount
    : 0;
}

export function decideOnboardingNudge(input: {
  readonly progress: OnboardingNudgeProgress | null;
  readonly state: OnboardingNudgeState;
  readonly now: Date;
  readonly surface: OnboardingNudgeSurface;
  /** The Q conversation asking, for the Q_NOTE surface. */
  readonly conversationId?: string | null | undefined;
  readonly config?: OnboardingNudgePolicyConfig | undefined;
}): OnboardingNudgeDecision {
  const config = input.config ?? ONBOARDING_NUDGE_POLICY;
  const { progress, state, now } = input;
  if (progress === null || progress.status === "CANCELLED") {
    return { due: false, reason: "NOT_STARTED" };
  }
  if (progress.status === "COMPLETED") {
    return { due: false, reason: "COMPLETE" };
  }
  if (progress.requiredCount <= 0) {
    return { due: false, reason: "NOTHING_REQUIRED" };
  }
  if (progress.requiredDoneCount >= progress.requiredCount) {
    return { due: false, reason: "COMPLETE" };
  }
  // Stopped holds until they come back to their setup of their own accord.
  if (
    state.stoppedAt !== null &&
    progress.lastActivityAt.getTime() <= state.stoppedAt.getTime()
  ) {
    return { due: false, reason: "STOPPED" };
  }
  if (
    state.snoozedUntil !== null &&
    now.getTime() < state.snoozedUntil.getTime()
  ) {
    return { due: false, reason: "SNOOZED" };
  }
  if (
    now.getTime() - progress.lastActivityAt.getTime() <
    config.quietAfterActivityHours * 60 * 60 * 1000
  ) {
    return { due: false, reason: "RECENT_ACTIVITY" };
  }
  if (
    input.surface === "Q_NOTE" &&
    input.conversationId !== undefined &&
    input.conversationId !== null &&
    state.lastConversationId === input.conversationId
  ) {
    return { due: false, reason: "ALREADY_IN_CONVERSATION" };
  }
  const share = progress.requiredDoneCount / progress.requiredCount;
  const emphasis = share <= config.strongAtOrBelow ? "STRONG" : "LIGHT";
  if (state.lastShownAt !== null) {
    const days = dayNumber(now) - dayNumber(state.lastShownAt);
    if (days < 1) return { due: false, reason: "ALREADY_TODAY" };
    const streak = nudgeStreak(state, progress);
    if (streak > 0) {
      const offset = emphasis === "LIGHT" ? config.lightBackoffOffset : 0;
      const index = Math.min(
        streak - 1 + offset,
        config.backoffDays.length - 1,
      );
      const wait = config.backoffDays[index] ?? 1;
      if (days < wait) return { due: false, reason: "BACKING_OFF" };
    }
  }
  return { due: true, emphasis, share };
}

/** The state once a reminder has been given on `surface`. */
export function recordNudgeShown(input: {
  readonly state: OnboardingNudgeState;
  readonly progress: OnboardingNudgeProgress;
  readonly now: Date;
  readonly surface: OnboardingNudgeSurface;
  readonly conversationId?: string | null | undefined;
}): OnboardingNudgeState {
  return {
    ...input.state,
    lastShownAt: input.now,
    lastSurface: input.surface,
    shownCount: nudgeStreak(input.state, input.progress) + 1,
    lastConversationId:
      input.surface === "Q_NOTE"
        ? (input.conversationId ?? null)
        : input.state.lastConversationId,
    snoozedUntil: null,
  };
}

export type OnboardingNudgeChoice = "LATER" | "STOP";

/** "Remind me later" or "stop reminding me". */
export function recordNudgeChoice(input: {
  readonly state: OnboardingNudgeState;
  readonly choice: OnboardingNudgeChoice;
  readonly now: Date;
  readonly config?: OnboardingNudgePolicyConfig | undefined;
}): OnboardingNudgeState {
  const config = input.config ?? ONBOARDING_NUDGE_POLICY;
  return input.choice === "LATER"
    ? {
        ...input.state,
        snoozedUntil: new Date(
          input.now.getTime() + config.snoozeDays * DAY_MS,
        ),
      }
    : { ...input.state, stoppedAt: input.now, snoozedUntil: null };
}

/** "About 3 minutes left": whole minutes, at least one. */
export function minutesLeft(
  progress: OnboardingNudgeProgress,
  config: OnboardingNudgePolicyConfig = ONBOARDING_NUDGE_POLICY,
): number {
  const remaining = Math.max(
    0,
    progress.requiredCount - progress.requiredDoneCount,
  );
  return Math.max(1, Math.ceil((remaining * config.secondsPerStep) / 60));
}
