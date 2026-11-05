/**
 * Parts of the page that record from the microphone without a voice line
 * (the voice-note recorder) say so here, so "Hey Q" steps aside while they
 * record: one microphone, one listener. On iOS a second capture mutes the
 * first, and a wake word heard inside a voice note would open Q over it.
 * Module state, deliberately: it is per tab, and a tab has one microphone.
 */

let holds = 0;
const watchers = new Set<() => void>();

function changed(): void {
  for (const watcher of watchers) watcher();
}

/** Hold the microphone; call the result once to let go (extra calls do nothing). */
export function holdMicrophone(): () => void {
  holds += 1;
  changed();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    changed();
  };
}

export function microphoneHeld(): boolean {
  return holds > 0;
}

export function watchMicrophoneHolds(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/** Tests only. */
export function resetMicrophoneHolds(): void {
  holds = 0;
  changed();
}
