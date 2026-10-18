import {
  QSpeculationCancelledError,
  type QAnswerSpeculation,
} from "@capital-q/q-runtime";

/**
 * The hold a speculative answer runs under (voice speculation, latency2).
 *
 * A spoken answer may start before its turn has been read. Until the
 * conversation core adopts it, everything it would put in front of anyone
 * waits here in order: live sentences, visible stages. Storing the answer,
 * recording what was said and any tool that is not READ_ONLY wait on
 * `ready()`, which throws once the speculation is cancelled, so a cancelled
 * answer can never be heard, stored or acted on. Adopted, the held effects
 * run in the order they were made and everything after passes through.
 */
export type SpeculationGate = {
  /** Now when adopted, held in order while pending, never when cancelled. */
  readonly emit: (effect: () => void | Promise<void>) => void;
  /** Resolves once adopted and every held effect has run; throws when cancelled. */
  readonly ready: () => Promise<void>;
  readonly adopted: () => boolean;
};

export function speculationGate(
  speculation: QAnswerSpeculation | undefined,
): SpeculationGate | null {
  if (speculation === undefined) return null;
  let state: "PENDING" | "ADOPTED" | "CANCELLED" = "PENDING";
  let held: (() => void | Promise<void>)[] = [];
  // Effects run one after another, so a stage recorded before a sentence
  // is still before it once released.
  let tail: Promise<void> = Promise.resolve();
  const run = (effect: () => void | Promise<void>): void => {
    tail = tail.then(effect).catch(() => undefined);
  };
  const settled = speculation.decided.then(
    (adopted) => adopted,
    () => false,
  );
  void settled.then((adopted) => {
    state = adopted ? "ADOPTED" : "CANCELLED";
    const queue = held;
    held = [];
    if (adopted) for (const effect of queue) run(effect);
  });
  return {
    emit: (effect) => {
      if (state === "ADOPTED") run(effect);
      else if (state === "PENDING") held.push(effect);
    },
    ready: async () => {
      if (!(await settled)) throw new QSpeculationCancelledError();
      // The flush above is scheduled by the same settlement; let it start.
      await Promise.resolve();
      await tail;
    },
    adopted: () => state === "ADOPTED",
  };
}
