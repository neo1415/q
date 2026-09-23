/**
 * Conversational repair as an escalation ladder (CQ-QX-005 §6).
 *
 * Live, the same repair line came back word for word four times running,
 * and each repetition made the person less willing to rephrase. Repair
 * has to change strategy each time it fails, because a strategy that
 * failed once is the one thing known not to work.
 *
 * The ladder is deterministic over how many times repair has been tried
 * on the SAME topic, and it never repeats the strategy it just used. Each
 * rung is composed from state — what was heard, what Q holds, what the
 * step can take, what Q would interpret it as — rather than from a stock
 * apology, so two rungs cannot produce the same sentence.
 */

export const REPAIR_STRATEGIES = [
  /** Say what was heard and ask the same thing in different words. */
  "REPHRASE",
  /** Offer a concrete interpretation and ask whether that is it. */
  "OFFER_INTERPRETATION",
  /** Say plainly what is still missing and what can be taken. */
  "NAME_THE_GAP",
  /** Stop asking: offer to set it aside, type it, or come back later. */
  "OFFER_FALLBACK",
] as const;
export type RepairStrategy = (typeof REPAIR_STRATEGIES)[number];

export type RepairHistory = {
  readonly topic: string;
  readonly used: readonly RepairStrategy[];
};

/**
 * The next rung.
 *
 * Interpretation is preferred wherever the model produced one, because
 * "do you mean X?" is the question that gets a one-word answer. Without
 * one, the gap is named. The fallback is the floor: after three tries on
 * one topic, Q stops asking for it.
 */
export function nextRepair(
  history: RepairHistory | null,
  topic: string,
  context: { readonly hasInterpretation: boolean },
): RepairStrategy {
  const used = history !== null && history.topic === topic ? history.used : [];
  const last = used.at(-1);
  const attempt = used.length;
  let strategy: RepairStrategy;
  if (attempt === 0) {
    strategy = context.hasInterpretation ? "OFFER_INTERPRETATION" : "REPHRASE";
  } else if (attempt === 1) {
    strategy = context.hasInterpretation
      ? "OFFER_INTERPRETATION"
      : "NAME_THE_GAP";
  } else if (attempt === 2) {
    strategy = "NAME_THE_GAP";
  } else {
    strategy = "OFFER_FALLBACK";
  }
  // The floor is not a rung to stand on twice: past it, Q alternates
  // between naming the gap and offering the way out, so no two turns in
  // a row say the same thing.
  if (strategy === last) {
    strategy =
      strategy === "OFFER_INTERPRETATION" || strategy === "REPHRASE"
        ? "NAME_THE_GAP"
        : strategy === "NAME_THE_GAP"
          ? "OFFER_FALLBACK"
          : "NAME_THE_GAP";
  }
  return strategy;
}

export function recordRepair(
  history: RepairHistory | null,
  topic: string,
  strategy: RepairStrategy,
): RepairHistory {
  return history !== null && history.topic === topic
    ? { topic, used: [...history.used, strategy].slice(-8) }
    : { topic, used: [strategy] };
}

export type RepairSlots = {
  /** What the question is about, as a noun ("founding-team capabilities"). */
  readonly label: string;
  /** The question asked plainly, in fresh words. */
  readonly question: string;
  /** What Q would take it to mean, when it has a candidate. */
  readonly interpretation?: string | undefined;
  /** What the step can take, as labels. */
  readonly options?: readonly string[] | undefined;
  /** What Q already holds from them and is still getting on the record. */
  readonly held?: readonly string[] | undefined;
  /** Whether the person can set this one aside. */
  readonly optional: boolean;
};

/** The sentence for a rung, composed from the slots. */
export function composeRepair(
  strategy: RepairStrategy,
  slots: RepairSlots,
): string {
  const options = (slots.options ?? []).slice(0, 6);
  const canTake =
    options.length === 0 ? "" : ` I can take any of ${list(options)}.`;
  const held =
    slots.held === undefined || slots.held.length === 0
      ? ""
      : ` I do have ${list(slots.held.slice(0, 3))} from you.`;
  switch (strategy) {
    case "REPHRASE":
      return `Let me ask that differently. ${slots.question}`;
    case "OFFER_INTERPRETATION":
      return slots.interpretation === undefined
        ? `I heard the words, but I'm not sure which preference you want me to record.${canTake}`
        : `Do you mean ${slots.interpretation}? Say yes, or tell me what's different.`;
    case "NAME_THE_GAP":
      return `I heard you, and I'm still missing ${slots.label}.${held}${canTake}`;
    case "OFFER_FALLBACK":
      return slots.optional
        ? `I don't want to keep you on ${slots.label}. We can leave it for now and come back, or you can tap Type and put it in your own words.`
        : `I don't want to keep you on ${slots.label}, and I do need it to finish. Tapping Type and writing it in your own words is the surest way through.`;
  }
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1] ?? ""}`;
}
