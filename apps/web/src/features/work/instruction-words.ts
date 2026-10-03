/**
 * A standing instruction's summary, split for display (design-48).
 *
 * The Q API writes one line per instruction (ADR 0043):
 *   "<goal> -- <n> things on my own, the rest I ask; $<spent> of $<budget> this month."
 *   "Paused (<reason>): <goal>"
 * The page shows the person's own words as a quote, and the money as its
 * own line against its limit. This only re-arranges the server's words; a
 * line in any other shape is shown whole, never guessed at.
 */
export type InstructionWords = {
  readonly goal: string;
  readonly how: string | null;
  /** "$0.20 of $5.00 this month (USD)" -- the money against its limit. */
  readonly spend: string | null;
  readonly paused: string | null;
};

const RUNNING =
  /^(?<goal>[\s\S]+?) -- (?<how>[^;]+); \$(?<spent>\d+(?:\.\d+)?) of \$(?<budget>\d+(?:\.\d+)?) this month\.?$/u;
const PAUSED = /^Paused \((?<reason>[^)]*)\): (?<goal>[\s\S]+)$/u;

const money = (value: string): string => {
  const [whole, cents = ""] = value.split(".");
  return `$${whole ?? "0"}.${cents.padEnd(2, "0").slice(0, 2)}`;
};

export function instructionWords(summary: string | null): InstructionWords {
  if (summary === null)
    return { goal: "", how: null, spend: null, paused: null };
  const paused = PAUSED.exec(summary)?.groups;
  if (paused?.goal !== undefined) {
    return {
      goal: paused.goal,
      how: null,
      spend: null,
      paused: paused.reason ?? "waiting for you",
    };
  }
  const running = RUNNING.exec(summary)?.groups;
  if (
    running?.goal === undefined ||
    running.spent === undefined ||
    running.budget === undefined
  ) {
    return { goal: summary, how: null, spend: null, paused: null };
  }
  return {
    goal: running.goal,
    how: running.how?.trim() ?? null,
    spend: `${money(running.spent)} of ${money(running.budget)} this month (USD)`,
    paused: null,
  };
}
