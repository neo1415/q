/**
 * Exactly one voice line produces audio in a tab (founder 2026-10-09:
 * "there were two voices talking at the same time").
 *
 * `voice-line.ts` serialises the surfaces that go through
 * `useVoiceInterview`. That never covered the lines started elsewhere (the
 * developer preview's GPT-Live call and its duplex and standard lines), and
 * a transport that came up late, after its surface had moved on, could
 * still play. This is the lower lock, at the audio itself: whoever starts
 * a line claims the tab's audio, and the claim stops the previous owner
 * first: GPT-Live closes its session and mutes and detaches its audio
 * element at once, the other lines end their transports.
 *
 * Module state, deliberately: it is per tab, and a tab has one speaker.
 */

export type VoiceAudioOwner = {
  /** Stop producing audio now (mute first), then close down. */
  readonly stop: () => void | Promise<void>;
};

let current: VoiceAudioOwner | null = null;
const watchers = new Set<() => void>();
const changed = () => {
  for (const watcher of watchers) watcher();
};

/**
 * Be told when the tab's audio is claimed or given up. "Hey Q" stops
 * listening while any line holds it: before, a standalone GPT-Live call
 * (the preview) held no voice line, so the wake word kept listening, heard
 * Q's own "Q" and opened a second line over it.
 */
export function watchVoiceAudio(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/**
 * Make `owner` the one line that may play. The previous owner is stopped
 * (and awaited) before this resolves. Claiming again as the owner is a
 * no-op, so a line's own fallbacks and renewals never stop themselves.
 */
export async function claimVoiceAudio(owner: VoiceAudioOwner): Promise<void> {
  if (current === owner) return;
  const previous = current;
  current = owner;
  changed();
  if (previous === null) return;
  // A line goes silent as soon as it is told to stop; closing its session
  // (and waiting for its final usage) can take longer, and never holds the
  // next line back past STOP_WAIT_MS.
  const stopping = Promise.resolve()
    .then(() => previous.stop())
    .catch(() => undefined);
  await Promise.race([
    stopping,
    new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS)),
  ]);
}

const STOP_WAIT_MS = 1_500;

/** Whether `owner` still holds the audio (a late line checks before it plays). */
export function ownsVoiceAudio(owner: VoiceAudioOwner): boolean {
  return current === owner;
}

/** Give the audio up; only its owner can. */
export function releaseVoiceAudio(owner: VoiceAudioOwner): void {
  if (current === owner) {
    current = null;
    changed();
  }
}

/**
 * Whether any voice line holds the tab's audio (a call is live). Q's moves
 * never fall back to a full page load then: it would end the call (C).
 */
export function voiceAudioHeld(): boolean {
  return current !== null;
}

/** For tests and diagnostics only. */
export function voiceAudioOwner(): VoiceAudioOwner | null {
  return current;
}
