/**
 * A recogniser's non-speech markup, out of a spoken turn's words (production
 * 2026-10-23: "Laughter Tell me about Halyard" was stored, read and
 * searched as said, by a person who never laughed). Transcription marks
 * sounds it heard in brackets -- "(laughter)", "[applause]", "*coughs*" --
 * and that markup is the recogniser's, not the person's words. Only marked
 * sounds are removed: an unmarked word is theirs, and what they meant is the
 * turn reader's to understand, not a word list's. The cause at the source --
 * noise transcribed as a sound -- is the realtime session's noise reduction.
 * A turn that was only such markup is left as it was, for the voice
 * channel's own handling of a sound that is not a turn.
 */

const SOUNDS =
  "laughter|laughs?|laughing|chuckles?|giggles?|applause|clapping|music|background music|noise|background noise|static|silence|cough(?:s|ing)?|clears? throat|throat clearing|sighs?|sniff(?:s|les)?|sneezes?|breath(?:s|ing)?|inaudible|unintelligible|indistinct|crosstalk|beep|foreign|no speech";

/** "(laughter)", "[Applause]", "{music}", "<noise>", "*coughs*". */
const BRACKETED = new RegExp(`[([{<*]\\s*(?:${SOUNDS})\\s*[)\\]}>*]`, "giu");

export function withoutNonSpeechTags(text: string): string {
  const stripped = text.replace(BRACKETED, " ").replace(/\s+/gu, " ").trim();
  return stripped.length === 0 ? text : stripped;
}
