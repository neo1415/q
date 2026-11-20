/**
 * VOICE-FIX (owner live 20 Nov 2026, voice session 40e55b83): "No, not
 * Tensorgate ... I don't want to do anything about them" was answered, two
 * turns later, by opening the Tensorgate rehearsal. A stated exclusion is
 * conversation state, held by code and respected on every later turn until
 * they bring the subject back themselves.
 *
 * The reader says what they excluded, by meaning (TURN_READER v96
 * `excludes`); this keeps the list. It lifts a name only when their own
 * words name it again on a turn that excludes nothing of it ("ok, back to
 * Tensorgate"): a name is theirs to bring back, never Q's.
 */
export const EXCLUSIONS_MAX = 8;

const key = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether their words name it (case, accents and spacing aside). */
function names(words: string, name: string): boolean {
  const wanted = key(name);
  if (wanted.length === 0) return false;
  const said = ` ${key(words)} `;
  return (
    said.includes(` ${wanted} `) ||
    said.replace(/ /gu, "").includes(wanted.replace(/ /gu, ""))
  );
}

export function nextExclusions(
  current: readonly string[],
  turn: {
    /** What the reader read them excluding this turn. */
    readonly excludes: readonly string[];
    /** Their words this turn. */
    readonly words: string;
  },
): readonly string[] {
  const fresh = turn.excludes
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 80);
  const freshKeys = new Set(fresh.map(key));
  // Named again, and not excluded again: they brought it back.
  const kept = current.filter(
    (name) => freshKeys.has(key(name)) || !names(turn.words, name),
  );
  const merged = [...kept];
  for (const name of fresh) {
    if (!merged.some((held) => key(held) === key(name))) merged.push(name);
  }
  return merged.slice(-EXCLUSIONS_MAX);
}

/** The answer's turn note while anything is excluded (trusted, code's). */
export function exclusionNote(excluded: readonly string[]): string | null {
  if (excluded.length === 0) return null;
  const listed = excluded
    .map((name) => `"${name.replace(/"/gu, "'")}"`)
    .join(", ");
  return `THEY ASKED YOU TO LEAVE OUT: ${listed}. Do not bring any of these up, suggest anything about them, or open, prepare or rehearse anything for them, unless they name one again themselves. Choose from everything else Capital Q holds for them.`;
}

/**
 * The answer's turn note when their yes answers a question of Q's that
 * offered several options and they did not say which: ask which, once,
 * and do nothing else (never pick one, least of all an earlier subject).
 */
export const CHOICE_UNCLEAR_NOTE =
  "THEIR YES ANSWERS YOUR LAST QUESTION, WHICH OFFERED MORE THAN ONE OPTION, AND THEY DID NOT SAY WHICH: ask in one short question which of the options you offered they mean, naming them briefly. Do not open, prepare, start or choose anything this turn, and never pick an earlier subject for them.";
