import type { InstructionStepRow } from "./store.js";

/**
 * What Q tells the person about a standing instruction (ADR 0043 §8, S7),
 * composed by code from the recorded steps -- never a model's summary, so
 * nothing is claimed that did not happen. Three registers: NEEDS_YOU at
 * once (cards waiting, a pause), a digest at their cadence, and a line Q
 * says when they come back.
 */

const MAX_LINES = 8;

function goalOf(goal: string): string {
  const flat = goal.replace(/\s+/gu, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** NEEDS_YOU after a firing: what waits on their yes, in Q's words. */
export function needsYouNotice(input: {
  readonly goal: string;
  readonly asked: readonly string[];
  readonly overBudget: boolean;
}): { readonly title: string; readonly body: string } | null {
  if (input.asked.length === 0 && !input.overBudget) return null;
  const goal = goalOf(input.goal);
  if (input.overBudget) {
    return {
      title: `Q paused "${goal}": this month's budget is used`,
      body: "Approve the card to continue at a higher monthly budget, or leave it paused.",
    };
  }
  return {
    title: `${plural(input.asked.length, "thing needs", "things need")} your yes for "${goal}"`,
    body: input.asked
      .slice(0, MAX_LINES)
      .map((line) => `- ${line}`)
      .join("\n"),
  };
}

export type InstructionDigest = {
  readonly done: number;
  readonly asked: number;
  readonly cannot: number;
  readonly title: string;
  readonly body: string;
};

/** The digest of the steps since the last one; null when nothing happened. */
export function digestOf(
  goal: string,
  steps: readonly InstructionStepRow[],
): InstructionDigest | null {
  if (steps.length === 0) return null;
  const done = steps.filter((step) => step.status === "DONE");
  const asked = steps.filter((step) => step.status === "ASKED");
  const cannot = steps.filter(
    (step) => step.status === "REFUSED" || step.status === "FAILED",
  );
  const counts = [
    done.length === 0 ? null : `did ${plural(done.length, "thing", "things")}`,
    asked.length === 0
      ? null
      : `asked you about ${plural(asked.length, "step", "steps")}`,
    cannot.length === 0
      ? null
      : `couldn't do ${plural(cannot.length, "step", "steps")}`,
  ].filter((part): part is string => part !== null);
  const lines = [...done, ...asked, ...cannot]
    .slice(0, MAX_LINES)
    .map((step) => `- ${step.words}`);
  const more = steps.length - lines.length;
  return {
    done: done.length,
    asked: asked.length,
    cannot: cannot.length,
    title: `For "${goalOf(goal)}", Q ${counts.join(", ")}`.slice(0, 200),
    body: [
      ...lines,
      ...(more > 0 ? [`…and ${String(more)} more on /work.`] : []),
    ]
      .join("\n")
      .slice(0, 1_000),
  };
}

/** What Q says when they come back (voice or Home), from the same facts. */
export function narrationOf(facts: {
  readonly goal: string;
  readonly done: number;
  readonly needsYou: number;
}): string | null {
  if (facts.done === 0 && facts.needsYou === 0) return null;
  const did =
    facts.done === 0
      ? null
      : `I did ${plural(facts.done, "thing", "things")} for "${goalOf(facts.goal)}"`;
  const waits =
    facts.needsYou === 0
      ? null
      : `${plural(facts.needsYou, "thing needs", "things need")} your yes`;
  return did === null
    ? `For "${goalOf(facts.goal)}", ${waits ?? ""}. Want to go through ${facts.needsYou === 1 ? "it" : "them"}?`
    : waits === null
      ? `While you were away, ${did}. Want the rundown?`
      : `While you were away, ${did}, and ${waits}. Want to go through ${facts.needsYou === 1 ? "it" : "them"}?`;
}
