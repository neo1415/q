/**
 * One voice line per tab (founder live 2026-10-05, Mai Soli 10:30-10:32).
 *
 * Every surface that talks (Q's first minute, the onboarding interview,
 * the dock) has its own `useVoiceInterview`, and each used to open its own
 * line without looking at the others: within two minutes one tab held a
 * welcome line, an interview line, its standard fallback and a second
 * standard line, all listening to the same microphone. Each heard the
 * person, and the other lines' Q, as speech -- the "it interrupts itself".
 *
 * This is the one owner. Opening and ending are serialised: a line is
 * opened only after the previous holder's line has been ended and awaited
 * (its transport closed, its `/turn` polling stopped), whoever held it.
 * Module state, deliberately: it is per tab, and a tab has one microphone.
 */

export type VoiceLineHolder = {
  /**
   * End this holder's line now. `reopening` is true when the same holder
   * is about to open its next line (a fallback, a renewal, a reconnect):
   * the transport and polling stop, the surface may stay on screen.
   */
  readonly release: (reopening: boolean) => Promise<void>;
};

let holder: VoiceLineHolder | null = null;
let queue: Promise<void> = Promise.resolve();
const watchers = new Set<() => void>();

function setHolder(next: VoiceLineHolder | null): void {
  if (holder === next) return;
  holder = next;
  for (const watcher of watchers) watcher();
}

/**
 * Be told when the tab's line is taken or given up. "Hey Q" (D2) stops
 * listening while any surface holds the line: one microphone, one owner.
 */
export function watchVoiceLine(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Open `next`'s line once whatever line is up has been ended. `open` runs
 * alone: two surfaces asking at once get one line each in turn, never two
 * at the same time.
 */
export function openVoiceLine<T>(
  next: VoiceLineHolder,
  open: () => Promise<T>,
): Promise<T> {
  return exclusive(async () => {
    const previous = holder;
    setHolder(null);
    if (previous !== null) {
      await previous.release(previous === next).catch(() => undefined);
    }
    setHolder(next);
    return open();
  });
}

/**
 * End `owner`'s line, after any open still in progress. A holder that no
 * longer holds the line ends only its own transport (`close`).
 */
export function endVoiceLine(
  owner: VoiceLineHolder,
  close: () => Promise<void>,
): Promise<void> {
  return exclusive(async () => {
    if (holder === owner) setHolder(null);
    await close().catch(() => undefined);
  });
}

/** Forget `owner` without waiting: it unmounted and closed its transport. */
export function dropVoiceLine(owner: VoiceLineHolder): void {
  if (holder === owner) setHolder(null);
}

/** Who holds the tab's line; for tests and diagnostics only. */
export function voiceLineHolder(): VoiceLineHolder | null {
  return holder;
}
