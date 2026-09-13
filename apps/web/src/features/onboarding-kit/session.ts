/**
 * Journey-agnostic presentation shapes shared by every onboarding journey
 * (Founder, Investor). A journey supplies its own step views and responses;
 * the shell, progress and controller only need this much.
 */

import type {
  OnboardingInterviewQuestionView,
  OnboardingSessionView,
} from "@capital-q/contracts";

/** A question Q still wants answered, straight from the runtime view (CQ-PRE-REC-001). */
export type QuestionView = OnboardingInterviewQuestionView;

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
  /**
   * Questions Q still wants answered on this journey, most material first.
   * Persisted by the runtime; empty when nothing is left to ask.
   */
  readonly questions: readonly QuestionView[];
  /** Which adapter produced this view. Synthetic views say so on screen. */
  readonly source: { readonly adapter: string; readonly synthetic: boolean };
  /**
   * The runtime's own session view, when the client has it (CQ-PRE-REC-001).
   * The conversational interview works from this one step at a time; the
   * composite screens above never read it.
   */
  readonly raw?: OnboardingSessionView | undefined;
  /** Plain labels for reference ids the view mentions (taxonomy nodes), when fetched. */
  readonly labels?: Readonly<Record<string, string>> | undefined;
};

/** What the progress header needs; any journey view satisfies it. */
export type ProgressView = Pick<
  SessionPresentation<unknown>,
  "sections" | "steps" | "currentStepId"
>;
