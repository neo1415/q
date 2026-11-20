import {
  Q_VISIBLE_STAGE_LABELS,
  type QStageAbout,
  type QVisibleStage,
} from "@capital-q/contracts";

/**
 * HQ-3 (conversation audit §2.7, slice 4): when a turn's run really starts
 * work that takes a while (a tool or record stage: WORKING_STAGES), the
 * voice says what it is doing within a second, in the approved stage
 * wording, instead of three seconds of silence and then "Working on it."
 *
 * The words are the stage's approved label (Q_VISIBLE_STAGE_LABELS), or the
 * named form the screen's live line already shows for it ("Looking at
 * Halyard", web stage-line.tsx), with names only from the stage event's
 * own `about` (the run's authorised reads; never a model's words). Web
 * research is never about anything (R38): "Looking into it." No model turn:
 * the line is said verbatim through the holding path.
 */

/** How soon after a real tool stage starts its line is said. */
export const STAGE_PREAMBLE_AFTER_MS = 1_000;

function listed(names: readonly string[]): string {
  const [a, b, c] = names;
  if (a !== undefined && b !== undefined && c !== undefined) {
    return `${a}, ${b} and ${c}`;
  }
  if (a !== undefined && b !== undefined) return `${a} and ${b}`;
  return a ?? "";
}

const single =
  (template: (name: string) => string) =>
  (names: readonly string[]): string | null =>
    names.length === 1 && names[0] !== undefined ? template(names[0]) : null;

/** The stages whose line can name what they are about (as the screen does). */
const NAMED: Readonly<
  Partial<Record<QVisibleStage, (names: readonly string[]) => string | null>>
> = {
  REVIEWING_COMPANY: (names) => `Looking at ${listed(names)}`,
  COMPARING_OPPORTUNITIES: (names) =>
    names.length < 2 ? null : `Comparing ${listed(names)}`,
  CHECKING_EVIDENCE: single((name) => `Reading ${name}'s deck and documents`),
  REVIEWING_INVESTOR_CRITERIA: single((name) => `Reading ${name}'s mandate`),
  REVIEWING_RELATIONSHIP: single(
    (name) => `Checking where things stand with ${name}`,
  ),
};

function isVisibleStage(stage: string): stage is QVisibleStage {
  return Object.hasOwn(Q_VISIBLE_STAGE_LABELS, stage);
}

/**
 * The spoken line for a stage, as a sentence; null for a stage that is not
 * Q's own visible work. Approved wording only.
 */
export function stagePreamble(
  stage: string,
  about: QStageAbout | undefined,
): string | null {
  if (!isVisibleStage(stage)) return null;
  const names = about?.subjects ?? [];
  const named =
    names.length === 0 || stage === "SEARCHING_PUBLIC_SOURCES"
      ? null
      : (NAMED[stage]?.(names) ?? null);
  const words = named ?? Q_VISIBLE_STAGE_LABELS[stage];
  return /[.!?]$/u.test(words) ? words : `${words}.`;
}
