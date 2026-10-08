import type { QAnswerCard, QResultBlock } from "@capital-q/contracts";

/**
 * Facts to speak, not words to read (research 2026-10-07 §4, founder live
 * 2026-10-08, conversation c10b845f).
 *
 * The voice used to read sentences that code templates had composed for
 * the screen: "I've scored your top 10 companies… Halyard Security fits
 * best, at 8.8 out of 10, then Clearwater Assurance at 8.8 out of 10" to
 * "top three", and `Opening "Tensorgate".` to "tell me about the third
 * one". Code owns the facts: who, which score, which ties, what is not
 * known, how many were asked for. The voice owns the words, which it
 * chooses for the person in front of it, and is held to these facts by
 * `spokenFidelityIssues`. `fallback` is built from the same facts and
 * passes the same checks: it is what is said when no model can say it in
 * time.
 *
 * Pure: no model, no I/O. Only answers whose words code composed (a fit
 * sweep, a record opened, a page moved to) are turned into facts; an
 * answer a model wrote is spoken as before.
 */

export const SPOKEN_FACTS_VERSION = 1 as const;

export type SpokenFactsKind = "RANKED" | "RECORD" | "NAVIGATE";

export type SpokenItem = {
  readonly name: string;
  /** The score as said ("8.8"); null when there is none. */
  readonly score: string | null;
  /** "a seed-stage company in the United States"; null when not known. */
  readonly about: string | null;
  /** What they do, in their own one line; null when not known. */
  readonly does?: string | null | undefined;
  /** Their raise as said ("$2 million"); null when not visible. */
  readonly raise?: string | null | undefined;
  /** Measures that fit strongly, in plain words ("stage", "sector"). */
  readonly strengths: readonly string[];
  /** What is not known yet ("cheque size"). */
  readonly unknowns: readonly string[];
};

export type SpokenFacts = {
  readonly version: typeof SPOKEN_FACTS_VERSION;
  readonly kind: SpokenFactsKind;
  /** How many they asked for ("top three" is 3); null when they did not say. */
  readonly requested: number | null;
  /** What to say, in order: exactly the requested number when they asked. */
  readonly items: readonly SpokenItem[];
  /** Names among `items` that share a score: said as level, never ranked. */
  readonly ties: readonly (readonly string[])[];
  /** More beyond `items` at the same score as the last one said. */
  readonly alsoLevel: number;
  /** Names shown but not to be said this turn (count fidelity). */
  readonly others: readonly string[];
  /** Every one of these is said, in any words. */
  readonly mustSay: readonly string[];
  /** At most one caveat, and only when it changes a decision. */
  readonly caveat: string | null;
  /** The open door: what Q can do next, offered, never done. */
  readonly next: string | null;
  /** The detail is on their screen (cards or a page). */
  readonly onScreen: boolean;
  /** RECORD / NAVIGATE: where the screen went. */
  readonly place: string | null;
  /** RECORD: they asked to hear about it, not only to open it. */
  readonly talkAbout: boolean;
  /** Said when no model can say it in time; passes every check. */
  readonly fallback: string;
};

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

function numberOf(word: string): number | null {
  const digits = /^\d{1,2}$/u.test(word) ? Number(word) : null;
  if (digits !== null) return digits;
  const at = (NUMBER_WORDS as readonly string[]).indexOf(word.toLowerCase());
  return at < 0 ? null : at;
}

function sayNumber(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

const COUNT = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)`;
const COUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:top|best|first|leading|strongest)\s+${COUNT}\b`,
    "iu",
  ),
  new RegExp(
    String.raw`\b${COUNT}\s+(?:best|top|strongest|leading|most\s+aligned)\b`,
    "iu",
  ),
  new RegExp(
    String.raw`\b(?:show|give|list|name|tell)\s+me\s+${COUNT}\s+(?:companies|startups|names|ones|deals|investors|of\s+them)\b`,
    "iu",
  ),
];

/** How many they asked for, from their own words; null when they did not say. */
export function requestedCount(asked: string): number | null {
  for (const pattern of COUNT_PATTERNS) {
    const match = pattern.exec(asked);
    const n = match?.[1] === undefined ? null : numberOf(match[1]);
    if (n !== null && n >= 1 && n <= 10) return n;
  }
  if (
    /\b(?:the\s+best\s+(?:one|company|fit)|which\s+(?:one|company)\s+(?:is|fits)\s+(?:the\s+)?best|best\s+fit)\b/iu.test(
      asked,
    )
  ) {
    return 1;
  }
  return null;
}

function scoreWords(score: number): string {
  return String(Math.round(score * 10) / 10).replace(/\.0$/u, "");
}

const THE_PLACES =
  /^(?:United|Netherlands|Philippines|Czech|Dominican|Gambia|Bahamas|UAE|UK|US)\b/u;

/** "seed · United States" → "a seed-stage company in the United States". */
function aboutOf(line: string | null): string | null {
  if (line === null) return null;
  const parts = line.split("·").map((part) => part.trim());
  if (parts.length !== 2) return null;
  const [stage, place] = parts;
  if (stage === undefined || place === undefined) return null;
  if (stage.length === 0 || place.length === 0) return null;
  const staged = /^(?:pre-?seed|seed|growth|early|late)$/iu.test(stage)
    ? `${stage.toLowerCase()}-stage`
    : stage;
  const article = /^[aeiou]/iu.test(staged) ? "an" : "a";
  const where = THE_PLACES.test(place) ? `the ${place}` : place;
  return `${article} ${staged} company in ${where}`;
}

/** Their one line, clipped to what a person says in one breath. */
function doesOf(about: string | null | undefined): string | null {
  if (about === null || about === undefined) return null;
  const flat = about
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
  if (flat.length === 0) return null;
  const words = flat.split(" ");
  return words.length <= 18 ? flat : `${words.slice(0, 18).join(" ")}…`;
}

function itemOf(card: QAnswerCard): SpokenItem {
  const unknowns = card.reasons.flatMap((reason) => {
    const match = /^(.{3,40}?)\s+(?:is\s+)?not\s+known\b/iu.exec(reason);
    return match?.[1] === undefined ? [] : [match[1].toLowerCase()];
  });
  return {
    name: card.name,
    score: card.fit === null ? null : scoreWords(card.fit.score),
    about: aboutOf(card.line),
    does: doesOf(card.about),
    raise: card.raise ?? null,
    strengths: card.measures
      .filter((measure) => measure.level === "STRONG")
      .map((measure) => measure.label.toLowerCase())
      .slice(0, 3),
    unknowns,
  };
}

/** A small, stable choice: the same question gets the same words, others vary. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(options: readonly T[], seed: number, salt = 0): T {
  const chosen = options[(seed + salt * 7919) % options.length];
  if (chosen === undefined) throw new Error("pick from an empty list");
  return chosen;
}

/** "A, B and C". */
export function spokenList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function capitalised(text: string): string {
  return text.length === 0
    ? text
    : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** Consecutive items at one score, in order. */
function runsOf(items: readonly SpokenItem[]): SpokenItem[][] {
  const runs: SpokenItem[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (
      last !== undefined &&
      item.score !== null &&
      last[0]?.score === item.score
    ) {
      last.push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs;
}

function sharedUnknown(items: readonly SpokenItem[]): string | null {
  const first = items[0]?.unknowns[0];
  if (first === undefined) return null;
  return items.every((item) => item.unknowns.includes(first)) ? first : null;
}

function rankedFallback(
  facts: Omit<SpokenFacts, "fallback">,
  seed: number,
): string {
  const { items, requested, alsoLevel } = facts;
  const n = items.length;
  const runs = runsOf(items);
  const level = (count: number) =>
    count === 2
      ? pick(["neck and neck", "level", "tied"], seed, 1)
      : pick(["all level", "tied", "all on the same score"], seed, 1);
  const runWords = runs.map((run, index) => {
    const names = spokenList(run.map((item) => item.name));
    const score = run[0]?.score ?? null;
    if (score === null) return `${names}, not scored yet`;
    if (run.length === 1) {
      return index === 0 ? `${names} at ${score}` : `then ${names} at ${score}`;
    }
    return index === 0
      ? `${names}, ${level(run.length)} at ${score}`
      : `then ${names}, level at ${score}`;
  });
  const opener =
    requested === null
      ? pick(
          [
            "The strongest fits for your mandate:",
            "Best fits on your mandate:",
          ],
          seed,
        )
      : n === 1
        ? pick(["Your best fit:", "Top of the list:"], seed)
        : pick(
            [
              `Your top ${sayNumber(n)}:`,
              `So, the top ${sayNumber(n)}:`,
              `Right, top ${sayNumber(n)} for your mandate:`,
            ],
            seed,
          );
  const first = runWords.join("; ");
  const more =
    alsoLevel > 0
      ? ` ${capitalised(sayNumber(alsoLevel))} more ${alsoLevel === 1 ? "is" : "are"} on the same score${runs.length === 1 ? ", so it's close at the top" : ""}.`
      : "";
  const caveat = facts.caveat === null ? "" : ` ${facts.caveat}`;
  const door = pick(
    n === 1
      ? [
          "It's on screen. Want me to go through it?",
          "Card's up; want the detail?",
        ]
      : [
          "They're on screen. Want me to go through one?",
          "Cards are up; want the detail on any of them?",
          "I've put them on screen. Want me to dig into one?",
        ],
    seed,
    2,
  );
  return `${opener} ${first}.${more}${caveat} ${door}`;
}

function recordFallback(
  facts: Omit<SpokenFacts, "fallback">,
  seed: number,
): string {
  const item = facts.items[0];
  const name = item?.name ?? facts.place ?? "That one";
  const shown = pick(
    ["I've pulled them up.", "Their page is up.", "I've opened their page."],
    seed,
    3,
  );
  const does = item?.does ?? null;
  if (
    item === undefined ||
    (item.about === null && item.score === null && does === null)
  ) {
    return facts.talkAbout
      ? `${name}: ${shown} I haven't gone through them with you yet. Want me to?`
      : `${pick(["Here's", "Up now:"], seed)} ${name}. ${facts.next === null ? "" : "Want me to run through them?"}`.trim();
  }
  const ack = pick(["sure", "right", "good pick"], seed);
  const sentences: string[] = [`${name}, ${ack}.`];
  if (does !== null) {
    sentences.push(
      `${pick(["In a line:", "What they do:"], seed, 4)} ${does}.`,
    );
  }
  const who: string[] = [];
  if (item.about !== null) who.push(`They're ${item.about}`);
  if (item.raise !== null && item.raise !== undefined) {
    who.push(
      who.length === 0
        ? `They're raising ${item.raise}`
        : `raising ${item.raise}`,
    );
  }
  if (item.score !== null) {
    // "They're a seed-stage company in the United States, at 8.8 on your
    // mandate: stage and sector line up, but cheque size isn't known yet."
    let fit = `at ${item.score} on your mandate`;
    if (item.strengths.length > 0) {
      fit += `: ${spokenList(item.strengths)} line up`;
    }
    if (item.unknowns[0] !== undefined) {
      fit += `${item.strengths.length > 0 ? ", but" : ", and"} ${item.unknowns[0]} isn't known yet`;
    }
    sentences.push(
      who.length === 0
        ? `They're ${fit}.`
        : `${who.join(", ")}${who.length > 1 ? ", and" : ","} ${fit}.`,
    );
  } else {
    if (who.length > 0) sentences.push(`${who.join(", ")}.`);
    if (item.unknowns[0] !== undefined) {
      sentences.push(`${capitalised(item.unknowns[0])} isn't known yet.`);
    }
  }
  sentences.push(`${shown}${facts.talkAbout ? " Want me to go deeper?" : ""}`);
  return sentences.join(" ");
}

function navigateFallback(place: string, seed: number): string {
  if (/^home$/iu.test(place)) return pick(["Back home.", "Here's home."], seed);
  return pick(
    [`Here's ${place}.`, `${capitalised(place)} is up.`, `Over to ${place}.`],
    seed,
  );
}

/**
 * A page move said as a person says it, varied by what was asked
 * ("Here's Discover.", "Over to Discover."): never "Taking you to…".
 * `line` is the code's own destination line ("Taking you to Discover.",
 * "Opening your profile."); anything else comes back unchanged.
 */
export function naturalPlaceLine(line: string, asked: string): string {
  const place = navigatedPlace(line);
  if (place === null) return line;
  return navigateFallback(
    place.replace(/^home now$/iu, "home"),
    seedOf(`${asked}\u0000${line}`),
  );
}

const TALK =
  /\b(?:tell|about|what|who|how|describe|walk|run\s+(?:me\s+)?through|talk|explain)\b/iu;

/** The name in a code-made "Opening …" line, quoted or not. */
function openedName(text: string): string | null {
  const quoted = /["“]([^"”\n]{1,80})["”]/u.exec(text)?.[1];
  if (quoted !== undefined) return quoted.trim();
  const bare =
    /^Opening\s+(.{1,80}?)(?:'s\s+[a-z ]+|\s+in\s+Your companies)?\.$/u.exec(
      text.trim(),
    )?.[1];
  return bare === undefined ? null : bare.trim();
}

/** The place in a code-made navigation line ("Taking you to Discover."). */
function navigatedPlace(text: string): string | null {
  const trimmed = text.trim();
  if (/^(?:Back home|Here's home)\.$/u.test(trimmed)) return "home";
  const match =
    /^(?:Taking you(?:\s+to)?|Opening|Here's|Over to)\s+(.{1,60}?)(?:\s+now)?\.$/u.exec(
      trimmed,
    ) ?? /^(.{1,60}?)\s+is up\.$/u.exec(trimmed);
  if (match?.[1] === undefined) return null;
  const place = match[1];
  // A quoted name is a record opened, not a page.
  if (/["“”]/u.test(place)) return null;
  return place;
}

/**
 * The facts of one answer, when code composed its words; null when a
 * model wrote them (spoken as written). `shown` is what earlier answers on
 * the line put on screen, newest first, so "the third one" can be talked
 * about from its card.
 */
export function spokenFactsOf(input: {
  readonly asked: string;
  readonly text: string;
  readonly blocks: readonly QResultBlock[];
  readonly shown?: readonly QAnswerCard[] | undefined;
}): SpokenFacts | null {
  const seed = seedOf(`${input.asked}\u0000${input.text}`);
  const ranked = input.blocks.find(
    (block): block is Extract<QResultBlock, { kind: "ANSWER_CARDS" }> =>
      block.kind === "ANSWER_CARDS" &&
      block.cards.some((card) => card.fit !== null),
  );
  if (ranked !== undefined) {
    const scored = ranked.cards.filter((card) => card.fit !== null);
    const requested = requestedCount(input.asked);
    const n = Math.min(requested ?? 3, scored.length);
    const said = scored.slice(0, n).map(itemOf);
    const lastScore = said[said.length - 1]?.score ?? null;
    const rest = ranked.cards.filter(
      (card) => !said.some((item) => item.name === card.name),
    );
    const alsoLevel =
      lastScore === null
        ? 0
        : scored
            .slice(n)
            .filter(
              (card) =>
                card.fit !== null && scoreWords(card.fit.score) === lastScore,
            ).length;
    const ties = runsOf(said)
      .filter((run) => run.length > 1)
      .map((run) => run.map((item) => item.name));
    const unknown = sharedUnknown(said);
    const short =
      requested !== null && scored.length < requested
        ? `I could only score ${sayNumber(scored.length)} of them.`
        : null;
    const caveat =
      short ??
      (unknown === null
        ? null
        : `${capitalised(unknown)} isn't known for ${said.length === 1 ? "it" : "any of them"} yet.`);
    const scores = [
      ...new Set(
        said.flatMap((item) => (item.score === null ? [] : [item.score])),
      ),
    ];
    const facts: Omit<SpokenFacts, "fallback"> = {
      version: SPOKEN_FACTS_VERSION,
      kind: "RANKED",
      requested,
      items: said,
      ties,
      alsoLevel,
      others: rest.map((card) => card.name),
      mustSay: [...said.map((item) => item.name), ...scores],
      caveat,
      next:
        said.length === 1
          ? "offer to go through it"
          : "offer to go through any one of them",
      onScreen: true,
      place: null,
      talkAbout: false,
    };
    return { ...facts, fallback: rankedFallback(facts, seed) };
  }

  for (const block of input.blocks) {
    if (block.kind !== "UI_INTENT") continue;
    const intent = block.intent;
    if (intent.kind === "OPEN_RECORD_PAGE") {
      // The card the record was opened from, by its id first (the words
      // may already be natural), then by the name in a code-made line.
      const byId = (input.shown ?? []).find(
        (shown) =>
          shown.subject?.kind === "COMPANY" &&
          shown.subject.companyId === intent.id,
      );
      const name = openedName(input.text) ?? byId?.name ?? null;
      if (name === null) return null;
      const card =
        byId ??
        (input.shown ?? []).find(
          (shown) => shown.name.toLowerCase() === name.toLowerCase(),
        );
      const item = card === undefined ? null : itemOf(card);
      const talkAbout = TALK.test(input.asked);
      const facts: Omit<SpokenFacts, "fallback"> = {
        version: SPOKEN_FACTS_VERSION,
        kind: "RECORD",
        requested: null,
        items: item === null ? [] : [item],
        ties: [],
        alsoLevel: 0,
        others: [],
        mustSay: [
          name,
          ...(item?.score === null || item === null ? [] : [item.score]),
        ],
        caveat: null,
        next: talkAbout ? "offer to go deeper on them" : null,
        onScreen: true,
        place: name,
        talkAbout,
      };
      return { ...facts, fallback: recordFallback(facts, seed) };
    }
    if (intent.kind === "NAVIGATE") {
      const place = navigatedPlace(input.text);
      if (place === null) return null;
      const facts: Omit<SpokenFacts, "fallback"> = {
        version: SPOKEN_FACTS_VERSION,
        kind: "NAVIGATE",
        requested: null,
        items: [],
        ties: [],
        alsoLevel: 0,
        others: [],
        mustSay: [place.replace(/^your\s+/iu, "")],
        caveat: null,
        next: null,
        onScreen: true,
        place,
        talkAbout: false,
      };
      return { ...facts, fallback: navigateFallback(place, seed) };
    }
  }
  return null;
}

/** Cards an answer put on screen, for the next turn's "the third one". */
export function shownCardsOf(
  blocks: readonly QResultBlock[],
): readonly QAnswerCard[] {
  return blocks.flatMap((block) =>
    block.kind === "ANSWER_CARDS" ? block.cards : [],
  );
}

// ---------------------------------------------------------------------------
// Checks: what any spoken line built from facts must satisfy.

export const SPOKEN_FIDELITY_ISSUES = [
  "COUNT",
  "MUST_SAY",
  "TIE",
  "BANNED",
  "LENGTH",
  "NUMBER",
] as const;
export type SpokenFidelityIssue = (typeof SPOKEN_FIDELITY_ISSUES)[number];

export const SPOKEN_FACTS_WORDS_MAX = 60;

/** Template phrases a person heard as a robot (live 2026-10-07/08). */
export const BANNED_SPOKEN_PHRASES: readonly RegExp[] = [
  /\bOpening\s+["“]/u,
  /^\s*Taking you\b/iu,
  /\bPros and cons for each are on screen\b/iu,
  /\bfits best, at\b/iu,
  /\bout of 10\b[\s\S]*\bout of 10\b/iu,
  /\bI've scored your top \d+/iu,
  /^\s*(?:sure|got it|okay|ok|absolutely|certainly|great question)\b[,.!]/iu,
  /\b(?:ask_q|function call|mustSay|fallback)\b/u,
  /[{}[\]]/u,
];

function words(text: string): number {
  return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function mentions(said: string, name: string): boolean {
  const lower = said.toLowerCase();
  if (lower.includes(name.toLowerCase())) return true;
  // "Halyard" for "Halyard Security": a person shortens names.
  const head = name.split(/\s+/u)[0] ?? "";
  return (
    head.length >= 4 &&
    new RegExp(String.raw`\b${escape(head)}\b`, "iu").test(said)
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function saysScore(said: string, score: string): boolean {
  if (said.includes(score)) return true;
  const [whole, tenth] = score.split(".");
  const wholeWord = whole === undefined ? null : sayNumber(Number(whole));
  const tenthWord = tenth === undefined ? null : sayNumber(Number(tenth));
  if (wholeWord === null) return false;
  const spoken =
    tenthWord === null ? wholeWord : `${wholeWord} point ${tenthWord}`;
  return said.toLowerCase().includes(spoken);
}

const TIE_WORDS =
  /\b(?:level|tie|tied|ties|neck and neck|same score|joint|equal|both at|all at|all three at|each at)\b/iu;

/**
 * What is wrong with a spoken line for these facts; empty when it may be
 * said. Deterministic: an invariant code can check is never left to a
 * model to judge.
 */
export function spokenFidelityIssues(
  said: string,
  facts: SpokenFacts,
): readonly SpokenFidelityIssue[] {
  const issues = new Set<SpokenFidelityIssue>();
  for (const required of facts.mustSay) {
    const ok = /^\d+(?:\.\d)?$/u.test(required)
      ? saysScore(said, required)
      : mentions(said, required);
    if (!ok) issues.add("MUST_SAY");
  }
  if (facts.kind === "RANKED") {
    if (
      facts.others.some(
        (name) =>
          mentions(said, name) &&
          !facts.items.some((item) => mentions(item.name, name)),
      )
    ) {
      issues.add("COUNT");
    }
    if (facts.requested !== null) {
      for (const match of said.matchAll(
        new RegExp(
          String.raw`\b(?:top|scored|scored your top)\s+${COUNT}\b`,
          "giu",
        ),
      )) {
        const n = match[1] === undefined ? null : numberOf(match[1]);
        if (n !== null && n !== facts.items.length) issues.add("COUNT");
      }
    }
    if (facts.ties.length > 0) {
      const tiedFirst = facts.ties.some(
        (group) => group[0] === facts.items[0]?.name,
      );
      if (!TIE_WORDS.test(said)) issues.add("TIE");
      if (
        tiedFirst &&
        /\b(?:fits best|the best fit is|comes first|ahead of|edges)\b/iu.test(
          said,
        )
      ) {
        issues.add("TIE");
      }
      for (const group of facts.ties) {
        for (const name of group.slice(1)) {
          if (
            new RegExp(String.raw`\bthen\s+${escape(name)}`, "iu").test(said)
          ) {
            issues.add("TIE");
          }
        }
      }
    }
  }
  if (BANNED_SPOKEN_PHRASES.some((pattern) => pattern.test(said))) {
    issues.add("BANNED");
  }
  if (words(said) > SPOKEN_FACTS_WORDS_MAX) issues.add("LENGTH");
  const allowed = new Set<string>();
  for (const item of facts.items) {
    if (item.score !== null) allowed.add(item.score);
    // Their raise and their own one line are facts too ("$2 million").
    for (const text of [item.raise, item.does]) {
      for (const match of (text ?? "").matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
        allowed.add(match[0]);
      }
    }
  }
  const counts = [
    facts.items.length,
    facts.alsoLevel,
    facts.alsoLevel + facts.items.length,
    facts.items.length + facts.others.length,
    10,
    ...(facts.requested === null ? [] : [facts.requested]),
  ];
  for (const n of counts) allowed.add(String(n));
  for (const match of said.matchAll(/\b\d+(?:\.\d+)?\b/gu)) {
    if (!allowed.has(match[0])) issues.add("NUMBER");
  }
  return [...issues];
}

/**
 * The facts as the voice model reads them: plain JSON with nothing it
 * must not say (no ids, no internal names). The fallback travels too, as
 * an example of the content, never as the words.
 */
export function factsForVoice(
  facts: SpokenFacts,
): Readonly<Record<string, unknown>> {
  return {
    kind: facts.kind,
    ...(facts.requested === null ? {} : { askedFor: facts.requested }),
    items: facts.items.map((item) => ({
      name: item.name,
      ...(item.score === null ? {} : { fitOnTheirMandate: item.score }),
      ...(item.about === null ? {} : { about: item.about }),
      ...(item.does === null || item.does === undefined
        ? {}
        : { whatTheyDo: item.does }),
      ...(item.raise === null || item.raise === undefined
        ? {}
        : { raising: item.raise }),
      ...(item.strengths.length === 0 ? {} : { strongOn: item.strengths }),
      ...(item.unknowns.length === 0 ? {} : { notKnownYet: item.unknowns }),
    })),
    ...(facts.ties.length === 0 ? {} : { tiedTogether: facts.ties }),
    ...(facts.alsoLevel === 0 ? {} : { moreOnTheSameScore: facts.alsoLevel }),
    ...(facts.place === null ? {} : { onScreenNow: facts.place }),
    ...(facts.talkAbout ? { theyAskedToHearAboutIt: true } : {}),
    mustSay: facts.mustSay,
    ...(facts.caveat === null ? {} : { caveat: facts.caveat }),
    ...(facts.next === null ? {} : { next: facts.next }),
    detailOnScreen: facts.onScreen,
  };
}
