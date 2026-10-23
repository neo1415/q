/**
 * A recogniser's non-speech tags, out of a spoken turn's words (production
 * 2026-10-23: "Laughter Tell me about Halyard" was stored, read and
 * searched as said). Transcription marks sounds it heard -- "(laughter)",
 * "[applause]", "*coughs*", or a bare "Laughter" before the words -- and
 * none of them is something the person said. Removed before the turn is
 * read or stored; a turn that was only such a sound is left as it was, for
 * the voice channel's own handling of a sound that is not a turn.
 */

const SOUNDS =
  "laughter|laughs?|laughing|chuckles?|giggles?|applause|clapping|music|background music|noise|background noise|static|silence|cough(?:s|ing)?|clears? throat|throat clearing|sighs?|sniff(?:s|les)?|sneezes?|breath(?:s|ing)?|inaudible|unintelligible|indistinct|crosstalk|beep|foreign|no speech";

/** "(laughter)", "[Applause]", "{music}", "<noise>", "*coughs*". */
const BRACKETED = new RegExp(`[([{<*]\\s*(?:${SOUNDS})\\s*[)\\]}>*]`, "giu");

/** One word that is only a sound, as a bare tag may be. */
const SOUND_WORD = new RegExp(`^(?:${SOUNDS})$`, "iu");

/** Its own word: the next starts a sentence, or the tag is punctuated off. */
const standsApart = (word: string, next: string | undefined): boolean =>
  /[.!,:;-]$/u.test(word) || (next !== undefined && /^\p{Lu}/u.test(next));

const bare = (word: string): string => word.replace(/[.!,:;-]+$/u, "");

export function withoutNonSpeechTags(text: string): string {
  const words = text.replace(BRACKETED, " ").trim().split(/\s+/u);
  // "Laughter Tell me…" but never "Music streaming startups…".
  while (
    words.length > 1 &&
    SOUND_WORD.test(bare(words[0] ?? "")) &&
    standsApart(words[0] ?? "", words[1])
  ) {
    words.shift();
  }
  // "…about Halyard. Laughter." -- a sentence already closed before it.
  while (
    words.length > 1 &&
    SOUND_WORD.test(bare(words[words.length - 1] ?? "")) &&
    /[.!?]$/u.test(words[words.length - 2] ?? "")
  ) {
    words.pop();
  }
  const stripped = words.join(" ").trim();
  return stripped.length === 0 ? text : stripped;
}
