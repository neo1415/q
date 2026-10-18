/**
 * Spoken lines beside the stored thread.
 *
 * A spoken line is shown only until the same words arrive as a stored
 * turn. Every voice turn becomes a stored turn, so without this each
 * thing the person said appeared twice: once from the transcript as
 * they said it, once from the conversation when it was recorded.
 *
 * Compared as words, not characters: the recogniser's transcript and
 * the recorded turn differ in punctuation, casing and spacing, and a
 * person's sentence shown twice for that was the most-noticed thing on
 * the screen (2026-09-17).
 */

export type SpokenLine = {
  readonly id: string;
  readonly role: "user" | "q";
  readonly text: string;
  /**
   * The stored turn that was the thread's last when this line was first
   * heard: null before any, undefined when not known. Where the line sits
   * in the thread until it is stored itself.
   */
  readonly after?: string | null | undefined;
  /** G-R3: the voice turn it belongs to (A's line), when the line says. */
  readonly turnId?: string | undefined;
};

/**
 * One thread, in the order things were said (founder report 2026-10-01:
 * the voice page's chat was "not arranged properly -- top to bottom,
 * bottom to top"). A spoken line not yet stored used to be put after
 * every stored turn, so a greeting or a spoken-only line ("Alright,
 * leaving it as it is.") moved to the bottom as the conversation grew.
 * Each spoken line now sits after the stored turn that was last when it
 * was heard; one heard before any sits first; one whose turn is not in
 * view is at the end, where it was heard most recently.
 */
export function threadInOrder<
  S extends { readonly id: string },
  L extends { readonly after?: string | null | undefined },
>(stored: readonly S[], spokenOnly: readonly L[]): readonly (S | L)[] {
  const ids = new Set(stored.map((line) => line.id));
  const first = spokenOnly.filter((line) => line.after === null);
  const at = new Map<string, L[]>();
  const end: L[] = [];
  for (const line of spokenOnly) {
    if (line.after === null) continue;
    if (line.after !== undefined && ids.has(line.after)) {
      const list = at.get(line.after) ?? [];
      list.push(line);
      at.set(line.after, list);
    } else end.push(line);
  }
  const out: (S | L)[] = [...first];
  for (const line of stored) {
    out.push(line, ...(at.get(line.id) ?? []));
  }
  return [...out, ...end];
}

function asWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A stored turn, as much of it as the comparison needs. */
export type StoredTurnText = {
  readonly kind: "PERSON" | "Q";
  readonly text: string;
};

/**
 * The spoken lines not yet in the stored thread.
 *
 * A person's line is stored once the same words are. Q's spoken reply is
 * one line for the whole reply (`transcriptLineFor`), but what was spoken
 * is not the stored text word for word: the voice drops what cannot be
 * said and stops at a listener's limit. So a reply is placed by the
 * conversation's structure instead: it answers the person's line before
 * it, and once that line is stored with a Q turn after it, the stored
 * reply is the one shown.
 */
export function spokenNotYetStored(
  spoken: readonly SpokenLine[],
  storedTurns: readonly StoredTurnText[],
): readonly SpokenLine[] {
  const stored = new Set(storedTurns.map((turn) => asWords(turn.text)));
  /** Person turns, by words, that already have a stored reply after them. */
  const answered = new Set<string>();
  storedTurns.forEach((turn, index) => {
    if (turn.kind === "PERSON" && storedTurns[index + 1]?.kind === "Q") {
      answered.add(asWords(turn.text));
    }
  });
  const seen = new Set<string>();
  let before: SpokenLine | undefined;
  return spoken.filter((line) => {
    const asked = before;
    before = line;
    const words = asWords(line.text);
    if (words.length === 0 || stored.has(words)) {
      return false;
    }
    if (
      line.role === "q" &&
      asked?.role === "user" &&
      answered.has(asWords(asked.text))
    ) {
      return false;
    }
    // The same words twice from the transcript itself is one line.
    const key = `${line.role}:${words}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
