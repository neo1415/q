import {
  WORKFORCE_LIVE_PASSED_MAX,
  type WorkforceLiveStage,
  type WorkforceLiveStageName,
} from "@capital-q/contracts";

/**
 * Owner 2026-10-24: the person sees their document being made. A step
 * reports where its work stands as it goes; the runner keeps the latest on
 * the job's row, and the conversation's card and the Work page read it.
 *
 * A report is a patch: what this moment knows (the research's counts, the
 * draft's headings), merged into what was reported before, so a revision
 * keeps the sections the first draft showed. Never awaited and never able
 * to fail the work.
 */
export type LivePatch = {
  readonly stage: WorkforceLiveStageName;
} & Partial<Omit<WorkforceLiveStage, "stage" | "at" | "passed">>;

export type LiveReport = (patch: LivePatch) => void;

const EMPTY: Omit<WorkforceLiveStage, "stage" | "at" | "passed"> = {
  questions: null,
  sources: null,
  facts: null,
  draft: null,
  drafts: null,
  title: null,
  sections: [],
  read: [],
  openPoints: null,
};

export function mergeLive(
  before: WorkforceLiveStage | null,
  patch: LivePatch,
  at: string,
): WorkforceLiveStage {
  const base = before ?? { ...EMPTY, stage: patch.stage, at, passed: [] };
  const merged: WorkforceLiveStage = { ...base, at };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  const passed = passedAfter(before, patch.stage);
  if (passed === undefined) delete merged.passed;
  else merged.passed = passed;
  return merged;
}

/**
 * Owner 2026-11-04 (N2): the stages really passed through, recorded as
 * each change happens, so the screen shows only stages that occurred (a
 * plan with no public reading never shows one). A job whose history was
 * not kept from its start (recorded before this existed) keeps none, so
 * the screen never claims an earlier stage did or did not happen.
 */
function passedAfter(
  before: WorkforceLiveStage | null,
  next: WorkforceLiveStageName,
): WorkforceLiveStageName[] | undefined {
  if (before === null) return [];
  const kept = before.passed;
  if (kept === undefined) return undefined;
  if (before.stage === next) return kept;
  return [...kept, before.stage].slice(-WORKFORCE_LIVE_PASSED_MAX);
}

/** A report that cannot throw: showing progress never stops the work. */
export function safeReport(report: LiveReport | undefined): LiveReport {
  return (patch) => {
    try {
      report?.(patch);
    } catch {
      // The screen's problem, never the work's.
    }
  };
}
