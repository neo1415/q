/**
 * Q on arrival (Zino, 2026-10-08: "it should know my timezone and greet me
 * according to the time -- good morning / afternoon -- then go straight
 * ahead to the work the agents have done, give me the lowdown, and bring
 * up the cards and ask me about each thing").
 *
 * Code owns the facts and a fallback line built from them; a voice that
 * speaks in its own words gets the same facts (SPOKEN_REPLY, research
 * 2026-10-07 §4). Pure: no model, no I/O, no clock of its own. Nothing
 * here is said unless a recorded fact supports it, and an activity count
 * that could not be read is absent, never zero.
 */

export type PartOfDay = "MORNING" | "AFTERNOON" | "EVENING" | "LATE";

/** Whether the runtime knows this IANA zone ("Africa/Lagos"). */
export function isTimeZone(zone: string | null | undefined): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The hour (0-23) in the person's zone; UTC when the zone is unknown. */
export function localHour(now: Date, zone: string | null | undefined): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: isTimeZone(zone) ? zone : "UTC",
  }).format(now);
  return Number(hour) % 24;
}

/** 05:00-11:59 morning, 12:00-16:59 afternoon, 17:00-21:59 evening, else late. */
export function partOfDay(
  now: Date,
  zone: string | null | undefined,
): PartOfDay {
  const hour = localHour(now, zone);
  if (hour >= 5 && hour < 12) return "MORNING";
  if (hour >= 12 && hour < 17) return "AFTERNOON";
  if (hour >= 17 && hour < 22) return "EVENING";
  return "LATE";
}

/** "Good afternoon, Zino." -- or, after 22:00, a late-hours hello. */
export function arrivalGreeting(input: {
  readonly firstName: string | null;
  readonly now: Date;
  readonly timeZone: string | null | undefined;
}): string {
  const name = input.firstName?.trim().split(/\s+/u)[0] ?? "";
  const named = name.length > 0 ? name : null;
  switch (partOfDay(input.now, input.timeZone)) {
    case "MORNING":
      return named === null ? "Good morning." : `Good morning, ${named}.`;
    case "AFTERNOON":
      return named === null ? "Good afternoon." : `Good afternoon, ${named}.`;
    case "EVENING":
      return named === null ? "Good evening." : `Good evening, ${named}.`;
    case "LATE":
      return named === null
        ? "Hello, you're up late."
        : `Hi ${named}, you're up late.`;
  }
}

// ---------------------------------------------------------------------------
// The lowdown: what the agents did since the person was last here.

/** One kind of thing done or received, with the names it touched. */
export type ActivityCount = {
  readonly n: number;
  /** The other side's names, newest first, at most a few. */
  readonly names: readonly string[];
};

/**
 * What was recorded since their last visit. A field that could not be read
 * is absent and says nothing; it is never read as zero.
 */
export type ArrivalActivity = {
  /** Messages Q sent for them. */
  readonly sent?: ActivityCount | undefined;
  /** Meetings Q set up. */
  readonly booked?: ActivityCount | undefined;
  /** Interest Q expressed on their behalf. */
  readonly interest?: ActivityCount | undefined;
  /** Messages Q drafted and held back for them to read. */
  readonly held?: ActivityCount | undefined;
  /** Replies from the other side of their relationships. */
  readonly replies?: ActivityCount | undefined;
  /** New relationships (matches, interest from the other side). */
  readonly matches?: ActivityCount | undefined;
};

export type ArrivalFacts = {
  readonly activity: ArrivalActivity;
  /** Decisions waiting on them now (approvals and held drafts). */
  readonly decisions: number;
  /** Hours since their last visit; null when this is the first one known. */
  readonly hoursAway: number | null;
};

export type Lowdown = {
  /** Nothing happened and nothing waits. */
  readonly quiet: boolean;
  /** The lowdown in one to three sentences, without the greeting. */
  readonly text: string;
  /** Names and counts any spoken version must carry. */
  readonly mustSay: readonly string[];
};

const NUMBER_WORDS = [
  "no",
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

function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function capitalised(text: string): string {
  return text.length === 0
    ? text
    : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** A small, stable choice: the same facts get the same words. */
export function arrivalSeed(text: string): number {
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

/** Named when one or two, counted otherwise. */
function who(item: ActivityCount, one: string, many: string): string {
  const names = item.names.slice(0, 2);
  if (item.n <= 2 && names.length === item.n) return list(names);
  return item.n === 1 ? one : `${count(item.n)} ${many}`;
}

function did(activity: ArrivalActivity): string[] {
  const parts: string[] = [];
  const sent = activity.sent;
  if (sent !== undefined && sent.n > 0) {
    const names = sent.names.slice(0, 2);
    parts.push(
      sent.n <= 2 && names.length === sent.n
        ? `replied to ${list(names)}`
        : `sent ${count(sent.n)} ${sent.n === 1 ? "message" : "messages"}`,
    );
  }
  const booked = activity.booked;
  if (booked !== undefined && booked.n > 0) {
    const names = booked.names.slice(0, 2);
    parts.push(
      booked.n === 1 && names.length === 1
        ? `booked your call with ${names[0] ?? ""}`
        : `set up ${count(booked.n)} ${booked.n === 1 ? "meeting" : "meetings"}`,
    );
  }
  const interest = activity.interest;
  if (interest !== undefined && interest.n > 0) {
    parts.push(
      `expressed interest in ${who(interest, "one company", "companies")}`,
    );
  }
  return parts;
}

function news(activity: ArrivalActivity): string[] {
  const parts: string[] = [];
  const replies = activity.replies;
  if (replies !== undefined && replies.n > 0) {
    parts.push(
      `${who(replies, "someone", "people")} wrote back`.replace(
        /^someone wrote back$/u,
        "you have a new reply",
      ),
    );
  }
  const matches = activity.matches;
  if (matches !== undefined && matches.n > 0) {
    parts.push(
      matches.n === 1
        ? matches.names[0] === undefined
          ? "there's a new match"
          : `${matches.names[0]} is a new match`
        : `${count(matches.n)} new matches came in`,
    );
  }
  const held = activity.held;
  if (held !== undefined && held.n > 0) {
    const names = held.names.slice(0, 1);
    parts.push(
      held.n === 1 && names.length === 1
        ? `I held back a message to ${names[0] ?? ""} for you to read`
        : `I held back ${count(held.n)} messages for you to read`,
    );
  }
  return parts;
}

function needs(decisions: number, seed: number): string | null {
  if (decisions <= 0) return null;
  if (decisions === 1) {
    return pick(["one thing needs you", "there's one thing for you"], seed, 3);
  }
  return pick(
    [
      `${count(decisions)} things need you`,
      `there are ${count(decisions)} things for you`,
    ],
    seed,
    3,
  );
}

/**
 * The lowdown, from recorded facts: what Q did, what came in, and how many
 * decisions wait. Quiet when nothing happened and nothing waits.
 */
export function lowdownOf(facts: ArrivalFacts): Lowdown {
  const seed = arrivalSeed(JSON.stringify(facts));
  const doneParts = did(facts.activity);
  const newsParts = news(facts.activity);
  const waits = needs(facts.decisions, seed);
  const mustSay = [
    ...(facts.activity.sent?.names ?? []).slice(0, 2),
    ...(facts.activity.booked?.names ?? []).slice(0, 1),
    ...(facts.activity.replies?.names ?? []).slice(0, 2),
  ];
  if (doneParts.length === 0 && newsParts.length === 0 && waits === null) {
    const away = facts.hoursAway !== null && facts.hoursAway >= 20;
    return {
      quiet: true,
      text: away
        ? pick(
            [
              "Quiet while you were away; nothing needs you.",
              "Nothing came in while you were away, and nothing needs you.",
            ],
            seed,
          )
        : pick(
            ["Quiet day, nothing needs you.", "All quiet; nothing needs you."],
            seed,
          ),
      mustSay: [],
    };
  }
  const since =
    facts.hoursAway === null
      ? null
      : facts.hoursAway >= 20
        ? pick(["While you were away,", "Since you were last in,"], seed, 1)
        : pick(["Since you were last here,", "Since earlier,"], seed, 1);
  const sentences: string[] = [];
  if (doneParts.length > 0) {
    const what = `I ${list(doneParts)}`;
    sentences.push(since === null ? `${what}.` : `${since} ${what}.`);
  }
  const tail = [...newsParts];
  if (waits !== null) tail.push(waits);
  if (tail.length > 0) {
    // "Halyard wrote back, and three things need you."
    const joined =
      tail.length === 1
        ? (tail[0] ?? "")
        : `${tail.slice(0, -1).join(", ")}, and ${tail[tail.length - 1] ?? ""}`;
    sentences.push(
      `${doneParts.length === 0 && since !== null ? `${since} ${joined}` : capitalised(joined)}.`,
    );
  }
  return { quiet: false, text: sentences.join(" "), mustSay };
}

// ---------------------------------------------------------------------------
// One decision card, as Q puts it to the person.

export type DecisionCardFacts = {
  /** Approval or a draft Q held back. */
  readonly kind: "APPROVAL" | "HELD";
  /** The other side's name, when known. */
  readonly counterpart: string | null;
  /** Their latest words, when they wrote last. */
  readonly theySaid: string | null;
  /** The exact message Q would send; null when the card is not a message. */
  readonly message: string | null;
  /** The card's own plain-language summary. */
  readonly summary: string;
};

/** The first sentence, clipped to about twenty words. */
export function gistOf(text: string, maxWords = 20): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  const first = /^(.+?[.!?])(?:\s|$)/u.exec(flat)?.[1] ?? flat;
  const words = first.split(" ");
  return words.length <= maxWords
    ? first
    : `${words.slice(0, maxWords).join(" ")}…`;
}

const COUNT_WORDS = [
  "",
  "One thing",
  "Two things",
  "Three things",
  "Four things",
  "Five things",
  "Six things",
] as const;

const WEEKDAY =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|next week)\b/iu;
const MEETING = /\b(call|meet|meeting|chat|catch up|catch-up|zoom|coffee)\b/iu;
const DECK = /\b(deck|pitch deck|attached|attachment|data ?room|one-pager)\b/iu;

/** One card in a few words, from its facts alone (never invented). */
function cardGist(card: DecisionCardFacts): string {
  const name = card.counterpart ?? "someone";
  if (card.kind === "HELD") return `the ${name} reply is held`;
  if (card.message === null) {
    const gist = gistOf(card.summary, 10).replace(/[.!?]$/u, "");
    return `${gist.charAt(0).toLowerCase()}${gist.slice(1)}`;
  }
  const said = card.theySaid ?? "";
  if (MEETING.test(said)) {
    const day = WEEKDAY.exec(said)?.[1];
    if (day === undefined) return `${name} wants a call`;
    const lower = day.toLowerCase();
    const when =
      lower.startsWith("this ") || lower.startsWith("next ")
        ? lower
        : lower === "today" || lower === "tomorrow"
          ? lower
          : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    return `${name} wants a call ${when}`;
  }
  if (DECK.test(said)) return `${name} sent their deck`;
  if (said.length > 0) return `${name} wrote back`;
  return `a message to ${name} is ready`;
}

/**
 * Every pending card in one sentence, up front (Zino, 2026-10-08: "Q
 * actually gives a summary of all the cards"): "Three things: the Spheros
 * reply is held, Tensorgate wants a call Thursday, and Clearwater sent
 * their deck." Null with no cards.
 */
export function summaryOfCards(
  cards: readonly DecisionCardFacts[],
): string | null {
  if (cards.length === 0) return null;
  const parts = cards.map(cardGist);
  const count = COUNT_WORDS[cards.length] ?? `${String(cards.length)} things`;
  const list =
    parts.length === 1
      ? (parts[0] ?? "")
      : parts.length === 2
        ? `${parts[0] ?? ""} and ${parts[1] ?? ""}`
        : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1) ?? ""}`;
  return `${count}: ${list}.`;
}

const ORDINALS = ["First", "Next", "Then", "After that"] as const;

/**
 * What Q says to put one card to the person, and asks; one question, then
 * stop. `position` is 1-based.
 */
export function cardLine(
  card: DecisionCardFacts,
  position: number,
  total: number,
): string {
  const seed = arrivalSeed(`${card.summary}|${String(position)}`);
  const lead =
    total <= 1
      ? ""
      : position === 1
        ? "First, "
        : position === total
          ? "Last one: "
          : `${pick(ORDINALS.slice(1), seed)}, `;
  const name = card.counterpart ?? "them";
  if (card.kind === "HELD") {
    return `${lead}I held back a message to ${name}. It's on screen; send it as it is, change it, or drop it?`;
  }
  if (card.message === null) {
    return `${lead}${gistOf(card.summary)} Shall I go ahead?`.replace(
      /\.\s+Shall/u,
      ". Shall",
    );
  }
  const said =
    card.theySaid === null
      ? `${lead}I've drafted a message to ${name}.`
      : `${lead}${name} wrote: "${gistOf(card.theySaid, 16)}" I've drafted a reply.`;
  return `${said} ${pick(["Send it?", "Want me to send it?", "Shall I send it?"], seed, 2)}`;
}

/** The facts of one card for a voice that speaks in its own words. */
export function cardFactsForVoice(
  card: DecisionCardFacts,
  position: number,
  total: number,
): Readonly<Record<string, unknown>> {
  return {
    position,
    of: total,
    kind:
      card.kind === "HELD" ? "a message Q held back" : "waiting for their yes",
    ...(card.counterpart === null ? {} : { to: card.counterpart }),
    ...(card.theySaid === null ? {} : { theyWrote: gistOf(card.theySaid, 30) }),
    ...(card.message === null
      ? { proposed: card.summary }
      : { draft: card.message.slice(0, 600) }),
    ask:
      card.kind === "HELD"
        ? "send it as it is, change it, or drop it"
        : "send it",
  };
}
