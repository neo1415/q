import type { QRehearsalTurnDto } from "@capital-q/contracts";

/**
 * Ties a review's note to the line of the transcript it is about
 * (rehearsal review option 2, 2026-10-21: "each note on the right points
 * into it"). The review names a moment in words, not a line number, so the
 * line is found by code: the turn of the person rehearsing that shares the
 * most of the moment's own words. A weak match is no match: the note then
 * says it is about the rehearsal as a whole, never a guessed line.
 */

const STOP = new Set([
  "the",
  "and",
  "but",
  "for",
  "with",
  "you",
  "your",
  "they",
  "their",
  "that",
  "this",
  "was",
  "were",
  "are",
  "had",
  "has",
  "have",
  "not",
  "when",
  "what",
  "which",
  "who",
  "how",
  "why",
  "said",
  "asked",
  "about",
  "into",
  "from",
  "then",
  "than",
  "only",
  "after",
  "before",
  "just",
  "also",
  "very",
  "out",
  "came",
  "one",
]);

function wordsOf(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}$%]+/gu) ?? []).filter(
      (word) => word.length >= 3 && !STOP.has(word),
    ),
  );
}

/** The index of the turn a moment is about, or null when none is clear. */
export function momentTurn(
  moment: string,
  turns: readonly QRehearsalTurnDto[],
  from: "YOU" | "THEM" = "YOU",
): number | null {
  const wanted = wordsOf(moment);
  if (wanted.size === 0) return null;
  let bestIndex = -1;
  let bestShared = 0;
  for (const [index, turn] of turns.entries()) {
    if (turn.from !== from) continue;
    const have = wordsOf(turn.text);
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    if (shared > bestShared) {
      bestIndex = index;
      bestShared = shared;
    }
  }
  // At least two of the moment's own words, and a third of them.
  return bestIndex >= 0 && bestShared >= 2 && bestShared / wanted.size >= 1 / 3
    ? bestIndex
    : null;
}

/**
 * The same rule for any list of texts (the first-stage report's findings
 * against the interview's answers): the index of the text sharing most of
 * the words, or null when the match is weak.
 */
export function bestMatch(
  text: string,
  candidates: readonly string[],
): number | null {
  return momentTurn(
    text,
    candidates.map((candidate) => ({
      from: "YOU" as const,
      text: candidate,
      at: "1970-01-01T00:00:00.000Z",
      mood: null,
      sawScreen: false,
    })),
  );
}

/** "4:07": how far into the rehearsal a line was said. */
export function atLabel(startedAt: string, at: string): string | null {
  const seconds = Math.round((Date.parse(at) - Date.parse(startedAt)) / 1_000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type EndMoment = {
  readonly moment: string;
  readonly why: string;
  /** The transcript line it is about; null when none is clear. */
  readonly line: number | null;
  /** How far in it was said; null when no line is clear. */
  readonly at: string | null;
};

/**
 * The end card's moments (owner 2026-10-24): the review's own strongest
 * and weakest, three each, in the review's order, each tied to its line
 * and time by code. Never ranked or invented here.
 */
export function endMoments(
  review: {
    readonly wentRight: readonly {
      readonly moment: string;
      readonly why: string;
    }[];
    readonly wentWrong: readonly {
      readonly moment: string;
      readonly why: string;
    }[];
  },
  turns: readonly QRehearsalTurnDto[],
  startedAt: string,
): { readonly strongest: EndMoment[]; readonly weakest: EndMoment[] } {
  const tie = (item: { readonly moment: string; readonly why: string }) => {
    const line = momentTurn(item.moment, turns);
    const turn = line === null ? undefined : turns[line];
    return {
      moment: item.moment,
      why: item.why,
      line,
      at: turn === undefined ? null : atLabel(startedAt, turn.at),
    };
  };
  return {
    strongest: review.wentRight.slice(0, 3).map(tie),
    weakest: review.wentWrong.slice(0, 3).map(tie),
  };
}

/** The note the board keeps: what went well and what to work on, with times. */
export function boardNotes(input: {
  readonly name: string;
  readonly duration: string;
  readonly strongest: readonly EndMoment[];
  readonly weakest: readonly EndMoment[];
}): string {
  const line = (one: EndMoment) =>
    `- ${one.at === null ? "" : `${one.at} `}${one.moment}: ${one.why}`;
  return [
    `Rehearsal with ${input.name}, ${input.duration}.`,
    "",
    "Strongest moments",
    ...(input.strongest.length === 0
      ? ["- None noted"]
      : input.strongest.map(line)),
    "",
    "To work on",
    ...(input.weakest.length === 0
      ? ["- None noted"]
      : input.weakest.map(line)),
  ]
    .join("\n")
    .slice(0, 8000);
}
