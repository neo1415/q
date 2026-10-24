import type {
  WorkforceLiveStage,
  WorkforceLiveStageName,
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
} & Partial<Omit<WorkforceLiveStage, "stage" | "at">>;

export type LiveReport = (patch: LivePatch) => void;

const EMPTY: Omit<WorkforceLiveStage, "stage" | "at"> = {
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
  const base = before ?? { ...EMPTY, stage: patch.stage, at };
  const merged: WorkforceLiveStage = { ...base, at };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
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
