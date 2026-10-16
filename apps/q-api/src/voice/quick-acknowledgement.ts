import type { OnboardingRecordResult } from "@capital-q/q-tools";

/**
 * The reply code writes itself after a clean recording round (owner
 * 2026-10-16: a second model round only to say "got it" made a typed turn
 * 6 s at p50). When every answer the person gave was COMMITTED and their
 * words asked nothing else of the turn, what Q says is fully decided: what
 * was saved, in the record's own words, then the next question from
 * coverage. Saying it needs no model.
 *
 * It claims only what committed: the results come back from the write, so
 * "saved" is never said before the commit. Anything else in the round (a
 * refusal, an ambiguity, a held save, a finding to put to them, a check to
 * raise) needs judgement and goes to the model as before: null here.
 */

const LEADS = [
  "Got it, saved",
  "Thanks, that's on your record",
  "Noted and saved",
  "Great, saved",
] as const;

/** The longest a recorded value is read back; longer text is named, not quoted. */
const MAX_VALUE = 80;

export function quickAcknowledgement(input: {
  readonly results: readonly OnboardingRecordResult[];
  /** Each step's short label, from the journey's coverage profile. */
  readonly labelOf: (stepKey: string) => string | undefined;
  /** The question that comes next, from coverage; null when none does. */
  readonly next: {
    readonly question: string;
    readonly optional: boolean;
  } | null;
  /** Varies the opening so no two turns sound alike. */
  readonly turnIndex: number;
}): string | null {
  const { results, next } = input;
  if (results.length === 0 || next === null) return null;
  if (results.some((result) => result.outcome !== "COMMITTED")) return null;
  const items: string[] = [];
  for (const result of results) {
    // A fact kept with their notes (not a question on their path) reads as
    // its own line ("revenue: first revenue only"), never "anything else".
    const kept = /^(.*?) \(kept with their notes/u.exec(result.recorded ?? "");
    if (kept?.[1] !== undefined) {
      items.push(
        kept[1]
          .slice(0, MAX_VALUE)
          .replace(/^([^:]+):/u, (l) => l.toLowerCase()),
      );
      continue;
    }
    const label = input.labelOf(result.stepKey);
    // Their own sentence keeps its words, not its full stop ("schools..").
    const value = (result.recorded?.trim() ?? "").replace(/[.!?;:,\s]+$/u, "");
    if (label === undefined || value.length === 0) return null;
    // Each with its label, as a receipt ("stage: Seed"): a choice like
    // "Yes, actively" means nothing on its own; long text is named only.
    items.push(
      value.length > MAX_VALUE
        ? `your ${label.toLowerCase()}`
        : `${label.toLowerCase()}: ${value}`,
    );
  }
  const lead = LEADS[Math.abs(input.turnIndex) % LEADS.length] ?? LEADS[0];
  const said = items.join("; ");
  const ask = next.question.trim().endsWith("?")
    ? next.question.trim()
    : `${next.question.trim()}?`;
  return `${lead}: ${said}. ${ask}${next.optional ? " We can come back to this if you'd rather skip it." : ""}`;
}

/** Latin-script words only: the code-written reply is English (lane ml owns others). */
export function writtenInLatinScript(text: string): boolean {
  return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\s]*$/u.test(text);
}
