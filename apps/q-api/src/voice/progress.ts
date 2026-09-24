import type { QVisibleStage } from "@capital-q/contracts";

/**
 * What Q says while a long answer is still being worked out (CQ-VOICE-010).
 *
 * A quick answer is simply given. Narrating it would be a verbal tic
 * before every reply ("One moment…", "Checking…"), which the voice
 * transcripts already showed reads worse than silence. A run that is
 * still working once the quick window has passed has shown itself to be
 * an investigation. It says what it is doing, in a few words, as the
 * orchestrator moves through its stages, so the person is not left
 * listening to nothing.
 *
 * The words come from the orchestrator's closed stage vocabulary
 * (contracts `q/stage.ts`). A model never writes them, they never name a
 * specialist or a tool, and they never promise a time.
 */

const PROGRESS_LINES: Readonly<Partial<Record<QVisibleStage, string>>> = {
  REVIEWING_COMPANY: "I'm going through the company's record.",
  CHECKING_EVIDENCE: "I'm checking what the evidence actually supports.",
  REVIEWING_INVESTOR_CRITERIA: "I'm looking at the investor criteria.",
  COMPARING_OPPORTUNITIES: "I'm comparing the opportunities now.",
  REVIEWING_RELATIONSHIP: "I'm looking at where things stand between you.",
  PREPARING_ANALYSIS: "I'm pulling the analysis together.",
};

/** Under this, a run is a quick answer and is not narrated. */
export const PROGRESS_QUIET_MS = 1_500;
/** An investigation is narrated in a line or two, not a commentary. */
export const PROGRESS_MAX_LINES = 2;

export type ProgressNarrator = {
  /**
   * The line for a stage the run has just entered, or null to say
   * nothing. `researchLine` gives what a move to public sources is announced
   * with. That line is always said at once: it tells the person the
   * answer will come from somewhere other than their own records, and
   * that is worth hearing however quick the search turns out to be.
   */
  readonly lineFor: (
    stage: QVisibleStage,
    options: {
      readonly answered: boolean;
      readonly researchLine: () => string;
    },
  ) => string | null;
};

export function createProgressNarrator(options: {
  readonly startedAt: number;
  readonly now?: (() => number) | undefined;
  readonly quietMs?: number | undefined;
  readonly maxLines?: number | undefined;
}): ProgressNarrator {
  const now = options.now ?? Date.now;
  const quietMs = options.quietMs ?? PROGRESS_QUIET_MS;
  const maxLines = options.maxLines ?? PROGRESS_MAX_LINES;
  const said = new Set<QVisibleStage>();
  return {
    lineFor: (stage, { answered, researchLine }) => {
      if (answered || said.has(stage)) return null;
      if (stage === "SEARCHING_PUBLIC_SOURCES") {
        said.add(stage);
        return researchLine();
      }
      const line = PROGRESS_LINES[stage];
      if (line === undefined) return null;
      if (now() - options.startedAt < quietMs) return null;
      const spokenProgress = [...said].filter(
        (s) => s !== "SEARCHING_PUBLIC_SOURCES",
      ).length;
      if (spokenProgress >= maxLines) return null;
      said.add(stage);
      return line;
    },
  };
}
