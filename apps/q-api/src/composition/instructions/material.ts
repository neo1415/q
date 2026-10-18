import { STAGE_LADDER, stageInRange } from "@capital-q/discovery";
import {
  WOO_WORDS_MAX,
  type InstructionMessageAsk,
  type InstructionQuestionKind,
} from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

/**
 * What Q may say in a message it writes under a standing instruction (QA
 * run 8a1d57b9: four first messages were one sentence with the name
 * changed -- "Hi -- I've been following Tarmacly and would be glad to
 * compare notes. If useful, perhaps we could find a time to meet.").
 *
 * Two kinds of material, each fact with its source:
 *   - the SENDER's approved facts: an investor's declared mandate fields,
 *     or a founder's own company as the network sees it. These are also
 *     the only things a reply may answer from (cheque size only when the
 *     mandate declares one).
 *   - each COUNTERPART's network-visible material: a company's card as the
 *     investor's feed shows it, or an investor's network-visible profile.
 *     Never founder-private data: the reads are the recipient-facing
 *     projections, filtered by the same discoverability check the feed uses.
 *
 * Then code -- not the planner -- checks every message against that
 * material before anything is sent or asked: a first message must name a
 * grounded specific with its source; no message may claim history Q does
 * not have, propose a meeting the grant does not let Q book, state a
 * number the material does not hold, or run past about 60 words.
 */

export type MaterialFact = {
  /** What the fact is, in plain words ("stage", "what they do"). */
  readonly label: string;
  /** The fact itself, as the planner reads it. */
  readonly text: string;
  /** Where it comes from ("their Capital Q profile", "your declared mandate"). */
  readonly source: string;
  /** Words a message must carry to be grounded in this fact. */
  readonly anchors: readonly string[];
  /** A short label fact (stage, country) rather than a described one. */
  readonly kind: "LABEL" | "DESCRIPTION";
  /** The question this fact answers, when it is one of the sender's own. */
  readonly answers?: InstructionQuestionKind | undefined;
  /** The declared code behind a label fact (stage, country), when there is one. */
  readonly code?: string | undefined;
  /**
   * Live QA (ASK card f3e411b7): the sentence that answers `answers`,
   * composed by code from the declared fields alone. A reply uses it word
   * for word; nothing about the sender is generated freely.
   */
  readonly answer?: string | undefined;
  /** investment_role codes, for the role-in-a-round fact. */
  readonly roles?: readonly string[] | undefined;
};

/**
 * The sender's declared hard criteria a first message must sit inside
 * (live QA: Tallyloom, Series B, was told it "fits" a Seed-only mandate).
 * Undeclared is open; a counterpart's unknown stage or country is unknown,
 * never outside.
 */
export type SenderCriteria = {
  readonly minStageCode: string | null;
  readonly maxStageCode: string | null;
  /** Declared countries (geography.country, including), upper case; empty: open. */
  readonly countries: readonly string[];
  /** Hard-excluded countries, upper case. */
  readonly excludedCountries: readonly string[];
};

export type SenderMaterial = {
  readonly side: "INVESTOR" | "COMPANY";
  readonly facts: readonly MaterialFact[];
  /** An investor's declared criteria; absent for a founder. */
  readonly criteria?: SenderCriteria | undefined;
};

export type InstructionMaterial = {
  readonly sender: SenderMaterial;
  /** Network-visible material per counterpart id (company or investor organisation). */
  readonly counterparts: ReadonlyMap<string, readonly MaterialFact[]>;
};

export type LabelOf = (
  code: string,
  vocabularyCode?: string,
) => string | undefined;

// ---------------------------------------------------------------------------
// Building facts (deterministic; nothing invented, unknown stays out)
// ---------------------------------------------------------------------------

const STOP = new Set(
  "about above after again against along among another because before being below between both build builds building company companies could every first from have helps their there these they this those through under using where which while with within without would your yours other into over such than that them then what when will also more most some only very just across based "
    .trim()
    .split(/\s+/u),
);

/** The distinctive words of a description: what a grounded message repeats. */
export function distinctiveWords(text: string, max = 14): readonly string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/u)) {
    const word = raw.replace(/^-+|-+$/gu, "");
    if (word.length < 5 || STOP.has(word) || /^\d+$/u.test(word)) continue;
    seen.add(word);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function label(
  name: string,
  text: string,
  source: string,
  answers?: InstructionQuestionKind,
  code?: string,
): MaterialFact {
  return {
    label: name,
    text,
    source,
    anchors: [text.toLowerCase()],
    kind: "LABEL",
    ...(answers === undefined ? {} : { answers }),
    ...(code === undefined ? {} : { code }),
  };
}

function described(name: string, text: string, source: string): MaterialFact {
  const flat = text.replace(/\s+/gu, " ").trim().slice(0, 300);
  return {
    label: name,
    text: flat,
    source,
    anchors: distinctiveWords(flat),
    kind: "DESCRIPTION",
  };
}

const humanCode = (code: string, labels: LabelOf): string =>
  labels(code) ?? code.replace(/_/gu, " ");

/** A company's card, as an investor's feed (or the founder's own page) shows it. */
export function companyCardFacts(
  card: {
    readonly currentStageCode: string | null;
    readonly headquartersCountry: string | null;
    readonly shortDescription: string | null;
  },
  labels: LabelOf,
  source: string,
): readonly MaterialFact[] {
  const facts: MaterialFact[] = [];
  if (card.currentStageCode !== null) {
    const stage = humanCode(card.currentStageCode, labels);
    facts.push({
      ...label("stage", stage, source, "STAGES", card.currentStageCode),
      answer: `We're at ${stage}.`,
    });
  }
  if (card.headquartersCountry !== null) {
    const place = humanCode(card.headquartersCountry, labels);
    facts.push({
      ...label(
        "based in",
        place,
        source,
        "GEOGRAPHIES",
        card.headquartersCountry,
      ),
      answer: `We're based in ${place}.`,
    });
  }
  if (card.shortDescription !== null && card.shortDescription.trim() !== "") {
    facts.push(described("what they do", card.shortDescription, source));
  }
  return facts;
}

/** An investor's network-visible profile, as a founder's Discover shows it. */
export function investorProfileFacts(
  profile: {
    readonly investorType: string | null;
    readonly hqCountry: string | null;
    readonly publicDescription: string | null;
  },
  labels: { readonly code: LabelOf; readonly investorType: LabelOf },
  source: string,
): readonly MaterialFact[] {
  const facts: MaterialFact[] = [];
  if (profile.investorType !== null) {
    facts.push(
      label(
        "investor type",
        labels.investorType(profile.investorType) ??
          humanCode(profile.investorType, labels.code),
        source,
      ),
    );
  }
  if (profile.hqCountry !== null) {
    facts.push(
      label("based in", humanCode(profile.hqCountry, labels.code), source),
    );
  }
  if (
    profile.publicDescription !== null &&
    profile.publicDescription.trim() !== ""
  ) {
    facts.push(described("their focus", profile.publicDescription, source));
  }
  return facts;
}

/** The shape of a declared mandate this needs (InvestorMandateSnapshot fits). */
export type MandateLike = {
  readonly cheque: {
    readonly currency: string;
    readonly min?: string | undefined;
    readonly typical?: string | undefined;
    readonly max?: string | undefined;
  } | null;
  readonly stage: {
    readonly minStageCode: string | null;
    readonly maxStageCode: string | null;
  };
  readonly constraints: readonly {
    readonly dimension: string;
    readonly operator: string;
    readonly value:
      | { readonly kind: "codes"; readonly values: readonly string[] }
      | { readonly kind: string };
    readonly isHardExclusion: boolean;
  }[];
  readonly taxonomyPreferences: readonly {
    readonly vocabularyCode: string;
    readonly canonicalCode: string;
    readonly isExclusion: boolean;
  }[];
};

/** "250000" -> "250,000"; exact, never rounded through a float. */
function grouped(amount: string): string {
  const [whole = "", fraction] = amount.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === undefined || /^0*$/u.test(fraction)
    ? withCommas
    : `${withCommas}.${fraction}`;
}

const INCLUDING = new Set(["EQ", "IN", "GTE", "LTE", "BETWEEN"]);

/** The investor's own declared mandate, as facts they approved. */
export function mandateFacts(
  mandate: MandateLike,
  labels: LabelOf,
  source = "your declared mandate",
): readonly MaterialFact[] {
  const facts: MaterialFact[] = [];
  const { minStageCode, maxStageCode } = mandate.stage;
  if (minStageCode !== null || maxStageCode !== null) {
    const low = minStageCode === null ? null : humanCode(minStageCode, labels);
    const high = maxStageCode === null ? null : humanCode(maxStageCode, labels);
    const text =
      low !== null && high !== null
        ? low === high
          ? low
          : `${low} to ${high}`
        : (low ?? high ?? "");
    facts.push({
      ...label("stages", text, source, "STAGES"),
      answer:
        low !== null && high !== null && low !== high
          ? `We invest from ${low} to ${high}.`
          : `We invest at ${text}.`,
      anchors: [low, high]
        .filter((part): part is string => part !== null)
        .map((part) => part.toLowerCase()),
    });
  }
  const codesOf = (dimension: string): string[] =>
    mandate.constraints
      .filter(
        (constraint) =>
          constraint.dimension === dimension &&
          !constraint.isHardExclusion &&
          INCLUDING.has(constraint.operator) &&
          constraint.value.kind === "codes",
      )
      .flatMap((constraint) =>
        "values" in constraint.value ? [...constraint.value.values] : [],
      );
  const included = mandate.taxonomyPreferences.filter(
    (preference) => !preference.isExclusion,
  );
  const sectors = [
    ...included
      .filter((preference) => preference.vocabularyCode !== "geography")
      .map(
        (preference) =>
          labels(preference.canonicalCode, preference.vocabularyCode) ??
          humanCode(preference.canonicalCode, labels),
      ),
    ...codesOf("sector").map((code) => humanCode(code, labels)),
  ];
  const places = [
    ...included
      .filter((preference) => preference.vocabularyCode === "geography")
      .map(
        (preference) =>
          labels(preference.canonicalCode, preference.vocabularyCode) ??
          humanCode(preference.canonicalCode, labels),
      ),
    ...codesOf("geography.country").map((code) => humanCode(code, labels)),
  ];
  const unique = (list: readonly string[]) => [...new Set(list)].slice(0, 8);
  if (sectors.length > 0) {
    const list = unique(sectors);
    facts.push({
      ...label("sectors", list.join(", "), source, "SECTORS"),
      answer: `We focus on ${list.join(", ")}.`,
      anchors: list.map((entry) => entry.toLowerCase()),
    });
  }
  if (places.length > 0) {
    const list = unique(places);
    facts.push({
      ...label("geographies", list.join(", "), source, "GEOGRAPHIES"),
      answer: `We invest in ${list.join(", ")}.`,
      anchors: list.map((entry) => entry.toLowerCase()),
    });
  }
  // Cheque size only when the mandate declares one: unknown stays out.
  const cheque = mandate.cheque;
  if (
    cheque !== null &&
    (cheque.typical !== undefined ||
      cheque.min !== undefined ||
      cheque.max !== undefined)
  ) {
    const money = (amount: string) => `${cheque.currency} ${grouped(amount)}`;
    const parts = [
      cheque.typical === undefined
        ? null
        : `typically ${money(cheque.typical)}`,
      cheque.min !== undefined && cheque.max !== undefined
        ? `range ${money(cheque.min)} to ${money(cheque.max)}`
        : cheque.min !== undefined
          ? `from ${money(cheque.min)}`
          : cheque.max !== undefined
            ? `up to ${money(cheque.max)}`
            : null,
    ].filter((part): part is string => part !== null);
    // A declared range is a declared fact, not a commitment: said exactly.
    const range =
      cheque.min !== undefined && cheque.max !== undefined
        ? `from ${money(cheque.min)} to ${money(cheque.max)}`
        : cheque.min !== undefined
          ? `from ${money(cheque.min)}`
          : cheque.max !== undefined
            ? `of up to ${money(cheque.max)}`
            : null;
    const answer =
      cheque.typical !== undefined
        ? `Our typical cheque is ${money(cheque.typical)}${range === null ? "" : `, within a range ${range}`}.`
        : `We write cheques ${range ?? ""}.`;
    facts.push({
      label: "cheque size",
      text: parts.join(", "),
      answer,
      source,
      // Grounded by the amounts themselves (numbersIn reads "250k" too).
      anchors: [cheque.typical, cheque.min, cheque.max]
        .filter((amount): amount is string => amount !== undefined)
        .map((amount) => String(Number(amount))),
      kind: "LABEL",
      answers: "CHEQUE_SIZE",
    });
  }
  const roleCodes = [...new Set(codesOf("investment_role"))];
  const roles = roleCodes.map((code) => humanCode(code, labels));
  if (roles.length > 0) {
    const list = unique(roles);
    facts.push({
      ...label("role in a round", list.join("; "), source, "LEAD_OR_FOLLOW"),
      roles: roleCodes,
      answer: roleAnswer(roleCodes, list),
      anchors: list.flatMap((entry) =>
        distinctiveWords(entry, 3).length > 0
          ? distinctiveWords(entry, 3)
          : [entry.toLowerCase()],
      ),
    });
  }
  return facts;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  lead: "lead rounds",
  co_invest: "co-invest alongside a lead",
  follow: "follow in later rounds",
};

/** "We lead rounds." / "We lead rounds and co-invest alongside a lead." */
function roleAnswer(codes: readonly string[], labelled: readonly string[]) {
  const words = codes.map((code) => ROLE_WORDS[code]);
  if (words.every((entry): entry is string => entry !== undefined)) {
    return `We ${words.join(" and ")}.`;
  }
  return `On rounds: ${labelled.join("; ")}.`;
}

/** The investor's declared hard criteria for a first message. */
export function mandateCriteria(mandate: MandateLike): SenderCriteria {
  const countries = (hard: boolean) =>
    mandate.constraints
      .filter(
        (constraint) =>
          constraint.dimension === "geography.country" &&
          constraint.isHardExclusion === hard &&
          (hard
            ? constraint.operator === "NOT_IN" || constraint.operator === "NEQ"
            : INCLUDING.has(constraint.operator)) &&
          constraint.value.kind === "codes",
      )
      .flatMap((constraint) =>
        "values" in constraint.value ? [...constraint.value.values] : [],
      )
      .map((code) => code.toUpperCase());
  return {
    minStageCode: mandate.stage.minStageCode,
    maxStageCode: mandate.stage.maxStageCode,
    countries: countries(false),
    excludedCountries: countries(true),
  };
}

export type OutsideCriterion = "STAGE" | "GEOGRAPHY";

/**
 * Where a counterpart is outside the sender's declared hard criteria; null
 * when inside, undeclared, or unknown. (Sector: a card carries no declared
 * sector code, so it is never judged outside on sector -- unknown is not a
 * no.)
 */
export function outsideCriteria(
  criteria: SenderCriteria | undefined,
  counterpart: readonly MaterialFact[],
): OutsideCriterion | null {
  if (criteria === undefined) return null;
  const stage = counterpart.find((fact) => fact.label === "stage")?.code;
  if (
    stage !== undefined &&
    (criteria.minStageCode !== null || criteria.maxStageCode !== null) &&
    (STAGE_LADDER as readonly string[]).includes(stage) &&
    !stageInRange(stage, criteria.minStageCode, criteria.maxStageCode)
  ) {
    return "STAGE";
  }
  const country = counterpart
    .find((fact) => fact.label === "based in")
    ?.code?.toUpperCase();
  if (
    country !== undefined &&
    (criteria.excludedCountries.includes(country) ||
      (criteria.countries.length > 0 && !criteria.countries.includes(country)))
  ) {
    return "GEOGRAPHY";
  }
  return null;
}

/**
 * The reply to their question about the sender's declared fields, composed
 * by code (deterministic templating); null when any part is not declared or
 * the question is about something else.
 */
export function factAnswer(
  kinds: readonly InstructionQuestionKind[],
  sender: readonly MaterialFact[],
): string | null {
  if (kinds.length === 0 || kinds.includes("OTHER")) return null;
  const parts: string[] = [];
  for (const kind of [...new Set(kinds)]) {
    const answer = sender.find((fact) => fact.answers === kind)?.answer;
    if (answer === undefined) return null;
    parts.push(answer);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// What the planner reads
// ---------------------------------------------------------------------------

function factLine(fact: MaterialFact): string {
  return `${fact.label}: ${fact.text} (source: ${fact.source})`;
}

/** WHO YOU WRITE AS: the sender's side and approved facts. */
export function senderLines(sender: SenderMaterial | null): string {
  if (sender === null) {
    return "Unknown side; no approved facts. Write nothing that states a fact about them.";
  }
  const register =
    sender.side === "INVESTOR"
      ? "An investor writing to founders about their companies."
      : "A founder writing to investors about their company.";
  const facts =
    sender.facts.length === 0
      ? ["No approved facts declared yet: state none."]
      : sender.facts.map((fact) => `- ${factLine(fact)}`);
  return [register, ...facts].join("\n").slice(0, 3_000);
}

/** One person's network-visible material, on their line under THEIR PEOPLE. */
export function materialLine(
  facts: readonly MaterialFact[] | undefined,
): string {
  if (facts === undefined || facts.length === 0) {
    return "material: none visible (write no first message to them)";
  }
  return `material: ${facts.map(factLine).join("; ")}`.slice(0, 900);
}

// ---------------------------------------------------------------------------
// The message check: code decides
// ---------------------------------------------------------------------------

/**
 * Tensorgate, 8 Oct: this was 65 while the planner (v7) and the woo check
 * ask for 60-120 words and allow up to 160, so a good 70-word reply was
 * refused MESSAGE_TOO_LONG on every re-plan. One ceiling: the woo check's.
 */
export const MESSAGE_WORDS_MAX = WOO_WORDS_MAX;

export const MESSAGE_PROBLEMS = [
  "UNGROUNDED_MESSAGE",
  "FALSE_HISTORY",
  "MEETING_NOT_ALLOWED",
  "MESSAGE_TOO_LONG",
  "UNGROUNDED_NUMBER",
  "UNANSWERED_QUESTION",
  "UNSUPPORTED_FIT",
  "UNGROUNDED_CLAIM",
] as const;
export type MessageProblem = (typeof MESSAGE_PROBLEMS)[number];

/**
 * History Q does not have, claimed: never, in any message it writes.
 *
 * Founder brief J7: kept as a deterministic guard. It reads Q's OWN draft,
 * never a person's words, and blocks a forbidden claim (invented shared
 * history) before anything is sent; a miss here is caught again by the
 * reviewer's GROUNDED rule, and a false hit only sends the draft back for
 * a redraft, never sends or decides anything.
 */
const FALSE_HISTORY =
  /\b(?:i(?:'|’)?ve|i have|we(?:'|’)?ve|we have)\s+been\s+(?:following|watching|tracking|keeping (?:an )?eye on)\b|\bbeen following\b|\bas (?:we|i) (?:discussed|mentioned|spoke)\b|\b(?:great|good|nice|lovely) (?:to|speaking|talking|chatting) (?:again|with you again)\b|\b(?:when|since) we (?:last )?(?:met|spoke|talked)\b|\bour (?:last|previous|earlier|recent) (?:call|chat|conversation|meeting)\b|\bfollowing up on our\b|\b(?:good|great) to reconnect\b|\bwe(?:'|’)?ve (?:met|spoken)\b/iu;

/** A call or a meeting proposed. */
const MEETING =
  /\b(?:meet|meeting|meet up|catch up|catch-up|a call|quick call|short call|intro call|hop on|jump on|zoom|google meet|teams call|coffee|find (?:a )?time|book (?:a |some )?time|grab (?:some )?time|schedule (?:a|some)|calendar|calendly|\d+\s?(?:-|to)?\s?min(?:ute)?s?\b)/iu;

/**
 * Live QA (instruction 76d6f281): "are there times that suit you for a
 * conversation?" and "What times work well to connect?" passed MEETING.
 * The planner now says what its last sentence asks (a typed field, the
 * primary rule); this is code's own reading of that last sentence, so a
 * mislabelled ask is caught too. Common scheduling forms only -- time and
 * times, call, meet, chat, connect, schedule, availability, calendar,
 * slot, "find a time" -- each in its scheduling sense, not "how do you
 * meet demand?".
 */
// Founder brief J7: kept, as FALSE_HISTORY above -- it checks Q's OWN
// draft for an ask the grant forbids (a meeting before they replied),
// beside the planner's typed field and the reviewer's ASK_TIMING; a hit
// only refuses or redrafts the message, it never acts.
const MEETING_ASK = new RegExp(
  [
    String.raw`\btimes?\b[^?]{0,40}\b(?:work|works|suit|suits|convenient|free|good|best|available|open)\b`,
    String.raw`\b(?:good|convenient|best|free|a) times?\b(?: (?:to|for|that|this|next))`,
    String.raw`\btime to (?:talk|chat|connect|meet|speak|catch up)\b`,
    String.raw`\bfind (?:a |some )?time\b`,
    String.raw`\bavailability\b`,
    String.raw`\b(?:are you|you're|you are|be) (?:\w+ )?(?:available|free)\b`,
    String.raw`\b(?:my|your|our) calendars?\b`,
    String.raw`\bcalendar (?:invite|link)\b`,
    String.raw`\b(?:my|your|our) diary\b`,
    String.raw`\bschedule (?:a|an|some|time|something)\b`,
    String.raw`\bscheduling (?:a|an|some) (?:call|meeting|chat|time)\b`,
    String.raw`\b(?:a|time|your) slots?\b`,
    String.raw`\bslots? (?:next|this|that|open|free|available)\b`,
    String.raw`\b(?:a|quick|short|brief|intro|video|phone|zoom) (?:call|chat|catch[- ]up|conversation)\b`,
    String.raw`\b(?:call|chat|talk|speak|connect|meet)(?: (?:next|this|soon|sometime|later|over|on|by)\b|\s*[?.!]*$)`,
    String.raw`\bmeet(?:ing)?\b(?! (?:demand|the (?:needs?|demand)|needs?|requirements?|targets?|regulat\w*|compliance))`,
  ].join("|"),
  "iu",
);

/** The last sentence of a message, where its ask is. */
export function finalSentence(body: string): string {
  const sentences = body
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => sentence.trim() !== "");
  return sentences[sentences.length - 1] ?? "";
}

/** Whether a sentence asks for a call, a meeting or a time. */
export function asksForMeeting(sentence: string): boolean {
  return MEETING_ASK.test(sentence);
}

/** A claim that the counterpart fits or matches the sender's focus. */
const FIT_CLAIM =
  /\bfits?\b|\bfitting\b|\b(?:good|great|strong|close|natural|clear) (?:fit|match)\b|\bmatch(?:es|ed)? (?:our|my|what (?:we|i))\b|\baligns? (?:well )?with (?:our|my)\b|\bin line with (?:our|my)\b|\bsweet spot\b|\bwheelhouse\b/iu;

/** Claims about the sender's role in a round, by investment_role code. */
const ROLE_CLAIMS: readonly (readonly [string, RegExp])[] = [
  [
    "lead",
    /\b(?:we|i)(?: \w+){0,2} lead\b|\blead(?:ing)? (?:the |a )?rounds?\b|\b(?:as|take) (?:the |a )?lead\b/iu,
  ],
  ["co_invest", /\bco-?invest\w*|\balongside (?:a |the |another )?lead\b/iu],
  [
    "follow",
    /\bfollow(?:ing)? (?:in|on) (?:later )?rounds?\b|\bfollow-?on\b/iu,
  ],
];

/** Where a fact comes from, said in the message. */
const SOURCE_CUE =
  /\b(?:profile|pitch|deck|website|site|listing|page|description|mandate|thesis|focus)\b/iu;

const SUFFIX: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
};

/**
 * The numbers a text states, as values: "$250k" and "USD 250,000" are the
 * same 250000. Small counts (<= 10) are words, not facts, and are skipped.
 */
export function numbersIn(text: string): readonly number[] {
  const out: number[] = [];
  const pattern =
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|thousand|mn|m|million|bn|b|billion|%)?(?![a-z])/giu;
  for (const match of text.matchAll(pattern)) {
    const digits = (match[1] ?? "").replace(/,/gu, "");
    const unit = (match[2] ?? "").toLowerCase();
    const value = Number(digits) * (SUFFIX[unit] ?? 1);
    if (!Number.isFinite(value)) continue;
    if (unit === "" && value <= 10) continue;
    out.push(value);
  }
  return out;
}

export type MessageCheckInput = {
  readonly body: string;
  /** Nothing has been sent in this thread yet (by Q or by them). */
  readonly first: boolean;
  /** The counterpart's network-visible material. */
  readonly counterpart: readonly MaterialFact[];
  /** The sender's approved facts. */
  readonly sender: readonly MaterialFact[];
  /** schedule.meeting.book is AUTO in the grant. */
  readonly bookingAuto: boolean;
  /** What their open question is about, when this answers one. */
  readonly answering?: readonly InstructionQuestionKind[] | undefined;
  /** The planner's own reading of what the last sentence asks. */
  readonly asks?: InstructionMessageAsk | null | undefined;
  /** Who writes: role claims are checked for an investor. */
  readonly side?: "INVESTOR" | "COMPANY" | undefined;
  /** The investor's declared criteria, for a claim of fit. */
  readonly criteria?: SenderCriteria | undefined;
  /**
   * Numbers the sender's own side already stated in this conversation
   * (Tensorgate, 8 Oct: the founder's "$180k contracts, 31m requests" in
   * his own first message). Repeating the person's own words is grounded.
   */
  readonly ownStated?: readonly number[] | undefined;
};

const normal = (text: string) =>
  text.toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim();

const hits = (text: string, fact: MaterialFact): number =>
  fact.anchors.filter((anchor) => anchor !== "" && text.includes(anchor))
    .length;

/** The first problem with a message, or null when code lets it through. */
export function checkMessage(input: MessageCheckInput): MessageProblem | null {
  const body = input.body.replace(/\s+/gu, " ").trim();
  const text = body.toLowerCase();
  const words = body === "" ? 0 : body.split(" ").length;
  if (words > MESSAGE_WORDS_MAX) return "MESSAGE_TOO_LONG";
  if (FALSE_HISTORY.test(body)) return "FALSE_HISTORY";
  if (
    !input.bookingAuto &&
    (input.asks === "MEETING" ||
      MEETING.test(body) ||
      asksForMeeting(finalSentence(body)))
  ) {
    return "MEETING_NOT_ALLOWED";
  }

  const declaredKinds = (input.answering ?? []).filter(
    (kind) => kind !== "OTHER",
  );
  // Every number stated must be one the material holds; answering their
  // question about the sender, only the sender's own declared facts (ASK
  // card f3e411b7: a "typical USD 600,000" no field declares).
  const known = new Set(
    [...(declaredKinds.length > 0 ? [] : input.counterpart), ...input.sender]
      .flatMap((fact) => [
        ...numbersIn(fact.text),
        ...fact.anchors.flatMap((anchor) => numbersIn(anchor)),
      ])
      // Not when answering their question about a declared field: that
      // answer comes from the declared facts alone (ASK card f3e411b7).
      .concat(declaredKinds.length > 0 ? [] : (input.ownStated ?? [])),
  );
  // A duration or a time proposed ("a 20 minute call", "at 3pm") is not
  // a fact about anyone.
  const stated = numbersIn(
    body.replace(
      /\d+(?::\d+)?\s?(?:-|to)?\s?(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?|am|pm)\b/giu,
      "",
    ),
  );
  if (stated.some((value) => !known.has(value))) {
    return "UNGROUNDED_NUMBER";
  }

  // A claim about the investor's role in a round matches the declared
  // field ("we can lead or co-invest" where only leading is declared: no).
  if (input.side === "INVESTOR") {
    const declared = new Set(
      input.sender.flatMap((fact) => [...(fact.roles ?? [])]),
    );
    if (
      ROLE_CLAIMS.some(
        ([code, claim]) => claim.test(body) && !declared.has(code),
      )
    ) {
      return "UNGROUNDED_CLAIM";
    }
  }

  // "Fits" or "matches" only where the company's stage is inside the
  // declared stages (when both ends are declared); unknown is not inside.
  const criteria = input.criteria;
  if (
    FIT_CLAIM.test(body) &&
    criteria !== undefined &&
    criteria.minStageCode !== null &&
    criteria.maxStageCode !== null
  ) {
    const stage = input.counterpart.find(
      (fact) => fact.label === "stage",
    )?.code;
    if (
      stage === undefined ||
      !stageInRange(stage, criteria.minStageCode, criteria.maxStageCode)
    ) {
      return "UNSUPPORTED_FIT";
    }
  }

  // A reply answers only from the sender's own facts: their declared
  // fields in code's own words, word for word.
  if (declaredKinds.length > 0) {
    const answer = factAnswer(declaredKinds, input.sender);
    if (answer === null) return "UNANSWERED_QUESTION";
    if (!normal(body).includes(normal(answer))) return "UNANSWERED_QUESTION";
  }

  if (!input.first) return null;
  // A first message names a grounded specific from their own material,
  // and where it comes from. Nothing visible: nothing specific to say.
  const concrete = input.counterpart.some((fact) =>
    fact.kind === "DESCRIPTION" ? hits(text, fact) >= 2 : false,
  );
  const labelled = input.counterpart.some(
    (fact) => fact.kind === "LABEL" && hits(text, fact) > 0,
  );
  const hasDescription = input.counterpart.some(
    (fact) => fact.kind === "DESCRIPTION",
  );
  const specific = hasDescription ? concrete : labelled;
  if (!specific || !SOURCE_CUE.test(body)) return "UNGROUNDED_MESSAGE";
  return null;
}

// ---------------------------------------------------------------------------
// Reading it, as the person
// ---------------------------------------------------------------------------

type CardLike = {
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly shortDescription: string | null;
};

export type InstructionMaterialReads = {
  /** Their own investor organisation, when they are an investor. */
  readonly ownInvestor: (
    actor: ActorContext,
  ) => Promise<{ readonly investorOrganisationId: string } | null>;
  /** Their own ACTIVE declared mandate, when there is one. */
  readonly ownMandate: (actor: ActorContext) => Promise<MandateLike | null>;
  /** Their own company's card, when they are a founder. */
  readonly ownCompanyCard: (actor: ActorContext) => Promise<CardLike | null>;
  /**
   * Company cards this person may see on the network (the feed's own
   * discoverability check); a company they may not see is simply absent.
   */
  readonly companyCards: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, CardLike>>;
  /** An investor's network-visible profile; null when it is not visible. */
  readonly investorProfile: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<{
    readonly investorType: string | null;
    readonly hqCountry: string | null;
    readonly publicDescription: string | null;
  } | null>;
  readonly labels: { readonly code: LabelOf; readonly investorType: LabelOf };
};

/** At most this many counterparts' material is read per firing. */
const MATERIAL_PEOPLE_MAX = 20;

export function createInstructionMaterialReader(
  reads: InstructionMaterialReads,
): (
  actor: ActorContext,
  people: readonly {
    readonly counterpartKind: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly counterpartId: string;
  }[],
) => Promise<InstructionMaterial> {
  return async (actor, people) => {
    const investor = await reads.ownInvestor(actor).catch(() => null);
    let sender: SenderMaterial;
    if (investor !== null) {
      const mandate = await reads.ownMandate(actor).catch(() => null);
      sender = {
        side: "INVESTOR",
        facts: mandate === null ? [] : mandateFacts(mandate, reads.labels.code),
        ...(mandate === null ? {} : { criteria: mandateCriteria(mandate) }),
      };
    } else {
      const card = await reads.ownCompanyCard(actor).catch(() => null);
      sender = {
        side: "COMPANY",
        facts:
          card === null
            ? []
            : companyCardFacts(card, reads.labels.code, "your company profile"),
      };
    }
    const reach = people.slice(0, MATERIAL_PEOPLE_MAX);
    const counterparts = new Map<string, readonly MaterialFact[]>();
    const companyIds = reach
      .filter((person) => person.counterpartKind === "COMPANY")
      .map((person) => person.counterpartId);
    const cards =
      companyIds.length === 0
        ? new Map<string, CardLike>()
        : await reads
            .companyCards(actor, companyIds)
            .catch(() => new Map<string, CardLike>());
    for (const [companyId, card] of cards) {
      counterparts.set(
        companyId,
        companyCardFacts(card, reads.labels.code, "their Capital Q profile"),
      );
    }
    for (const person of reach) {
      if (person.counterpartKind !== "INVESTOR_ORGANISATION") continue;
      const profile = await reads
        .investorProfile(actor, person.counterpartId)
        .catch(() => null);
      if (profile !== null) {
        counterparts.set(
          person.counterpartId,
          investorProfileFacts(
            profile,
            reads.labels,
            "their Capital Q profile",
          ),
        );
      }
    }
    return { sender, counterparts };
  };
}
