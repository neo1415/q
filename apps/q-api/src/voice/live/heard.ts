/**
 * V (production 2026-10-09 15:57 UTC): GPT-Live's input transcript for the
 * founder's fintech request came through as "(inaudible)" three times, and
 * each became a Q run with nothing to answer. A transcription marker,
 * empty text or filler alone is never a request: no Q run is created, and
 * the voice (which heard the audio itself) checks with the person instead.
 * The browser applies the same rule first (bridge.ts); this is the second
 * look, so no client can start a run on nothing.
 */

const MARKER =
  /[([]\s*(?:inaudible|unintelligible|indistinct|crosstalk|silence|noise|music|laughter|laughs|applause|blank[_ ]audio|no speech|unclear)[^)\]]{0,40}[)\]]/giu;

/** Hesitations only; "yes", "okay", "mhm" and "uh-huh" can answer Q. */
const FILLER = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "erm",
  "hmm",
  "hm",
  "ah",
  "eh",
]);

/** The words, without the transcriber's markers. */
export function spokenWords(text: string): string {
  return text.replace(MARKER, " ").replace(/\s+/gu, " ").trim();
}

/** Whether there is anything to ask Q: some word that is not filler. */
export function heardRequest(text: string): boolean {
  return spokenWords(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .some((word) => word.length > 0 && !FILLER.has(word));
}

/** What the voice is told when nothing usable reached the backend. */
export const UNHEARD_COMMENTARY =
  "Their words did not reach the backend clearly, so nothing was asked. If you understood them, say back in a few words what you think they want and ask them to confirm; if you did not, ask them naturally to say it again. Do not say anything failed or went wrong.";
