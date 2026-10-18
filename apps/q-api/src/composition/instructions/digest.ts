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
  // The request's framing is not the goal: 'Please set this up as a
  // standing instruction for me: "Reply…"' is shown as 'Reply…'.
  const flat = goal
    .replace(/\s+/gu, " ")
    .replace(
      /^(?:please\s+)?(?:set (?:this|that) up|make (?:this|that)|create|add)\s+(?:as\s+)?(?:a\s+)?standing instructions?(?:\s+for me)?\s*[:,-]?\s*/iu,
      "",
    )
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
    .trim();
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
  all: readonly InstructionStepRow[],
): InstructionDigest | null {
  // What Q noted about its own work is on /work, not news.
  const steps = all.filter((step) => step.status !== "NOTED");
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

/**
 * What each kind of step Q did is, said as a person says it. Keyed by the
 * step's recorded action; anything not here is counted, never named.
 */
const DONE_PHRASES: Readonly<Record<string, readonly [string, string]>> = {
  "relationship.interest.express": [
    "expressed interest in 1 company",
    "expressed interest in {n} companies",
  ],
  "chat.message.send": ["sent 1 message", "sent {n} messages"],
  "schedule.meeting.book": ["set up 1 meeting", "set up {n} meetings"],
};

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/**
 * What Q says when they come back (voice or Home), composed from the
 * recorded steps by kind -- never from the goal's text (Zino live
 * 2026-10-07: 'I did 4 things for "Please set this up as a standing
 * instruction for me: "Reply…"' read his own setup instruction back to
 * him, cut mid-word).
 */
export function narrationOf(facts: {
  /** Steps done since they were last here, by recorded action. */
  readonly done: readonly { readonly action: string; readonly n: number }[];
  readonly needsYou: number;
}): string | null {
  const done = facts.done.filter((step) => step.n > 0);
  const total = done.reduce((sum, step) => sum + step.n, 0);
  if (total === 0 && facts.needsYou === 0) return null;
  const named: string[] = [];
  let other = 0;
  for (const step of done) {
    const phrase = DONE_PHRASES[step.action];
    if (phrase === undefined) other += step.n;
    else
      named.push(
        step.n === 1 ? phrase[0] : phrase[1].replace("{n}", String(step.n)),
      );
  }
  if (other > 0) {
    named.push(
      named.length === 0
        ? `took care of ${plural(other, "thing", "things")}`
        : `did ${plural(other, "other thing", "other things")}`,
    );
  }
  const did = total === 0 ? null : `I ${joinWords(named)}`;
  const waits =
    facts.needsYou === 0
      ? null
      : `${plural(facts.needsYou, "thing is", "things are")} waiting for your yes`;
  const them = facts.needsYou === 1 ? "it" : "them";
  return did === null
    ? `${capitalised(waits ?? "")}. Want to go through ${them}?`
    : waits === null
      ? `While you were away, ${did}. Want the rundown?`
      : `While you were away, ${did}, and ${waits}. Want to go through ${them}?`;
}

function capitalised(text: string): string {
  return text.length === 0
    ? text
    : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
