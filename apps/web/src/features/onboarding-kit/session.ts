/**
 * Journey-agnostic presentation shapes shared by every onboarding journey
 * (Founder, Investor). A journey supplies its own step views and responses;
 * the shell, progress and controller only need this much.
 */

export const STEP_STATUSES = [
  "pending",
  "current",
  "completed",
  "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type SectionSummary = {
  readonly id: string;
  readonly label: string;
};

export type StepSummary = {
  readonly id: string;
  readonly section: string;
  readonly title: string;
  readonly status: StepStatus;
};

export type StepBase<TKind extends string> = {
  readonly id: string;
  readonly kind: TKind;
  readonly section: string;
  readonly title: string;
  readonly prompt?: string | undefined;
  readonly help?: string | undefined;
  readonly optional: boolean;
  readonly privacyNote?: string | undefined;
  readonly primaryActionLabel?: string | undefined;
  readonly skipped: boolean;
};

export type SessionPresentation<TStep> = {
  readonly sessionId: string;
  readonly definitionVersion: string;
  readonly status: "in_progress" | "complete";
  readonly sections: readonly SectionSummary[];
  readonly steps: readonly StepSummary[];
  readonly currentStepId: string;
  /** Absent only once the session is complete. */
  readonly step: TStep | undefined;
  /** Which adapter produced this view. Synthetic views say so on screen. */
  readonly source: { readonly adapter: string; readonly synthetic: boolean };
};

/** What the progress header needs; any journey view satisfies it. */
export type ProgressView = Pick<
  SessionPresentation<unknown>,
  "sections" | "steps" | "currentStepId"
>;
