/**
 * Reading a voice turn's answer back from the record (P10).
 *
 * A spoken answer reaches this screen only as speech; its result blocks --
 * answer cards above all -- are in the conversation's record once the run
 * finishes. The record used to be read twice on a fixed clock (at once and
 * 2.5 s later) and again when Q stopped speaking. A long answer (a ranked
 * top five takes several tool rounds) finished after all three reads, or
 * Q's speech ended a beat before the run was stored, and its cards never
 * appeared until something else happened to read the record again.
 *
 * So the record is read until it holds the run as finished: one read now,
 * then one every interval while the run is still going, with a ceiling
 * so a run that never ends does not read forever.
 */

/** Between reads while the run is still going. */
export const VOICE_REREAD_MS = 2_500;
/** At most this many reads for one voice turn (about a minute and a half). */
export const VOICE_REREAD_MAX = 36;

export type Reread = {
  /** Read the record; true once it holds the newest run as finished. */
  readonly read: () => Promise<boolean>;
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
  readonly intervalMs?: number | undefined;
  readonly max?: number | undefined;
};

const timeout = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

/** Start reading; the returned function stops it (a newer turn, unmount). */
export function rereadUntilSettled(options: Reread): () => void {
  const schedule = options.schedule ?? timeout;
  const intervalMs = options.intervalMs ?? VOICE_REREAD_MS;
  const max = options.max ?? VOICE_REREAD_MAX;
  let stopped = false;
  let cancelTimer: (() => void) | null = null;
  let reads = 0;
  const once = async () => {
    reads += 1;
    let settled: boolean;
    try {
      settled = await options.read();
    } catch {
      settled = false;
    }
    if (stopped || settled || reads >= max) return;
    cancelTimer = schedule(() => void once(), intervalMs);
  };
  void once();
  return () => {
    stopped = true;
    cancelTimer?.();
  };
}
