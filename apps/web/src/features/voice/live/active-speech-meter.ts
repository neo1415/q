/** Actual played audio or provider-gated microphone speech; overlapping speech counts once. */
export function createActiveSpeechMeter(allowanceMs: number, at: number) {
  let previous = at;
  let activeMs = 0;
  return {
    sample(now: number, userSpeaking: boolean, qSpeaking: boolean) {
      // Delayed/background timers cannot silently charge an unobserved interval.
      const delta = Math.max(0, Math.min(250, now - previous));
      previous = now;
      if (userSpeaking || qSpeaking)
        activeMs = Math.min(allowanceMs, activeMs + delta);
      return Math.floor(activeMs);
    },
    activeMs: () => Math.floor(activeMs),
    remainingMs: () => Math.max(0, allowanceMs - Math.floor(activeMs)),
  };
}
