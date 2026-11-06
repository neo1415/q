/**
 * Q intelligence step 11: where a turn's milliseconds go, per stage.
 *
 * A stage may run many times in one turn (the claim check runs on every
 * sentence); its times are summed, and how often it ran is counted. Only
 * stage names, durations and counts are kept -- never anything said -- so
 * the snapshot can go into the turn's log line as it is.
 *
 * The clock is injected, so a test reads exact figures.
 */
export type StageClock = {
  /** Runs `work`, adding the time it took to `stage`. */
  readonly time: <T>(stage: string, work: () => T) => T;
  /** Per stage: total milliseconds (two decimals) and runs. */
  readonly snapshot: () => Readonly<
    Record<string, { readonly ms: number; readonly runs: number }>
  >;
};

const monotonic = (): number => performance.now();

export function createStageClock(now: () => number = monotonic): StageClock {
  const totals = new Map<string, { ms: number; runs: number }>();
  return {
    time: (stage, work) => {
      const started = now();
      try {
        return work();
      } finally {
        const held = totals.get(stage) ?? { ms: 0, runs: 0 };
        held.ms += now() - started;
        held.runs += 1;
        totals.set(stage, held);
      }
    },
    snapshot: () =>
      Object.fromEntries(
        [...totals].map(([stage, { ms, runs }]) => [
          stage,
          { ms: Math.round(ms * 100) / 100, runs },
        ]),
      ),
  };
}
