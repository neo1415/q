/**
 * Cards that come and go with what Q is saying (Zino, 2026-10-08: "cards
 * appear and disappear based on what it's talking about"). Each line Q
 * says is matched by code -- never by a model -- against the stage's
 * groups and the names on its cards: a group Q reaches is revealed, a
 * card Q names comes into focus. Pure, so every rule is a test.
 */

export type StageGroup = "ACTIVITY" | "NEEDS_YOU" | "QUESTIONS" | "MATCHES";

export const STAGE_GROUPS: readonly StageGroup[] = [
  "ACTIVITY",
  "NEEDS_YOU",
  "QUESTIONS",
  "MATCHES",
];

/** One card on the stage, by the names Q might say it by. */
export type StageTarget = {
  readonly key: string;
  readonly group: StageGroup;
  readonly names: readonly string[];
};

const GROUP_WORDS: Readonly<Record<StageGroup, RegExp>> = {
  ACTIVITY:
    /\b(?:i (?:replied|sent|booked|set up|expressed|held|finished)|while you were away|since you were (?:last|away)|since earlier|wrote back|new match)/iu,
  NEEDS_YOU:
    /\b(?:needs? you|things? for you|thing for you|waiting (?:for|on) (?:you|your)|to approve|your (?:reply|approval|decision)|tell me what you'?d like done|couldn'?t check)/iu,
  QUESTIONS:
    /\b(?:still (?:want|wants) to know|investors will ask|question(?:s)? for you|answer (?:one|a question))/iu,
  MATCHES:
    /\b(?:compan(?:y|ies) (?:in your feed )?fits? your mandate|new compan(?:y|ies)|in your feed|fits best)/iu,
};

function normal(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * What a line of Q's reveals and which card it puts in focus: the card
 * named earliest in the line, or null when it names none.
 */
export function stageFocusFor(
  said: string,
  targets: readonly StageTarget[],
): { readonly reveal: readonly StageGroup[]; readonly focus: string | null } {
  const reveal: StageGroup[] = STAGE_GROUPS.filter((group) =>
    GROUP_WORDS[group].test(said),
  );
  const line = ` ${normal(said)} `;
  let focus: string | null = null;
  let at = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    for (const name of target.names) {
      const words = normal(name);
      // A name of one or two letters would match too much ("A", "Q").
      if (words.length < 3) continue;
      const index = line.indexOf(` ${words} `);
      if (index >= 0 && index < at) {
        at = index;
        focus = target.key;
        if (!reveal.includes(target.group)) reveal.push(target.group);
      }
    }
  }
  return { reveal, focus };
}

/**
 * Which groups to show now. Without a live line the whole stage is shown
 * at once; while Q is giving the briefing aloud, a group appears as Q
 * reaches it, and everything is shown once the briefing has been said
 * (or a few seconds have passed: a line that never matched hides
 * nothing for long).
 */
export function revealedGroups(input: {
  readonly present: readonly StageGroup[];
  readonly speaking: boolean;
  readonly reached: ReadonlySet<StageGroup>;
  readonly settled: boolean;
}): readonly StageGroup[] {
  if (!input.speaking || input.settled) return input.present;
  return input.present.filter((group) => input.reached.has(group));
}
