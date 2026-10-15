import { aliasKeyOf, sourceTally, sourceWasRead } from "./known-entities.js";
import type {
  EntityFactRecord,
  EntitySourceRecord,
  KnownEntityRecord,
} from "./known-entities.js";

/**
 * Follow-ups about a prepared entity, answered by code (2026-10-11).
 *
 * Live bug: "tell me more about this person" after a prepared Qatar card
 * had no code path. It went to the analyst, which searched the web and
 * said little. Everything the answer needs is already stored (facts with
 * topics, source excerpts, real quotes, rehearsal questions), so the
 * answer is composed here with no web search and no model call.
 *
 * Documented material (what a page says) and rehearsal guidance
 * (plausible questions, not their words) are kept apart in the text.
 * An unsupported field is named, never replaced by "little is known".
 */

export type FollowUpAspect =
  | "SAID"
  | "PRIORITIES"
  | "WHAT_THEY_DO"
  | "PITCH"
  | "QUESTIONS"
  | "BACKGROUND"
  | "SOURCES"
  | "OVERVIEW";

const wordsOf = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/** Asking for newer or other information than what was prepared. */
const FRESH =
  /\b(?:latest|newest|recent(?:ly)?|news|updates?|updated|fresh(?:er)?|refresh|search again|look (?:it |them |him |her )?up again|anything new|what'?s new|new information|today|this week|this month)\b/iu;

/** Requests to act (not to be told something) are other lanes' work. */
const ACTION =
  /\b(?:rehears\w*|practi[sc]e|simulat\w*|role[- ]?play|draft|write|email|e-mail|send|schedule|book|introduce|connect me|message|compare|versus|vs)\b/iu;

const ASPECTS: readonly { aspect: FollowUpAspect; test: RegExp }[] = [
  {
    aspect: "QUESTIONS",
    test: /\b(?:questions?|raise|push(?:es)? back|grill|probe|concerns?|objections?|challenge[sd]?|what (?:will|would|might|could) (?:they|he|she|\w+) ask)\b/iu,
  },
  {
    aspect: "PITCH",
    test: /\b(?:pitch|approach|prepare|prep|win over|convince|impress|position (?:myself|us|my))\b/iu,
  },
  {
    aspect: "SAID",
    test: /\b(?:said|says?|saying|stated?|states|quotes?|wrote|written|posts?|posted|interviews?|spoke|speaks?|talks?|talked|views?|opinions?|thinks?|stance|publicly|statements?)\b/iu,
  },
  {
    aspect: "WHAT_THEY_DO",
    test: /\b(?:actually do|what (?:does|do|is) .{0,40}\b(?:do|offer|provide)\b|what (?:they|it) do|services?|offerings?|products?|activities)\b/iu,
  },
  {
    aspect: "PRIORITIES",
    test: /\b(?:priorit\w*|cares?|care about|focus(?:es)?|looks? for|look for|wants?|criteria|thesis|mandate|interested|interests?|values?|back(?:s)?|invests? in)\b/iu,
  },
  {
    aspect: "BACKGROUND",
    test: /\b(?:background|career|experience|history|bio|biography|worked|resume|cv|who (?:is|are|was)|role|job|title|where .{0,20}from)\b/iu,
  },
  {
    aspect: "SOURCES",
    test: /\b(?:sources?|where did you (?:get|read|find)|how do you know|evidence|links?)\b/iu,
  },
  {
    aspect: "OVERVIEW",
    test: /\b(?:tell me more|more about|more on|more info\w*|know about|learn about|further|everything|overview|summary|summari[sz]e|brief(?:ing)?|anything else|what else|deeper|elaborate|go on)\b/iu,
  },
];

const PRONOUN_PERSON =
  /\b(?:him|he|his|her|hers|she|them|they|their|theirs|this (?:person|guy|man|woman|investor)|that (?:person|investor))\b/iu;
const PRONOUN_ORG =
  /\b(?:it|its|them|they|their|theirs|this (?:company|organi[sz]ation|agency|firm|fund|institution|one|body)|that (?:company|organi[sz]ation|agency|firm|fund)|the (?:agency|firm|company|organi[sz]ation))\b/iu;

const TOPIC_STOP = new Set([
  "the",
  "a",
  "an",
  "about",
  "on",
  "of",
  "in",
  "to",
  "for",
  "and",
  "or",
  "is",
  "are",
  "was",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "what",
  "who",
  "how",
  "when",
  "where",
  "which",
  "that",
  "this",
  "these",
  "those",
  "it",
  "his",
  "her",
  "their",
  "them",
  "him",
  "he",
  "she",
  "they",
  "said",
  "say",
  "says",
  "saying",
  "ever",
  "publicly",
  "any",
  "anything",
  "something",
  "me",
  "my",
  "i",
  "you",
  "we",
  "us",
  "with",
  "from",
  "by",
  "at",
  "as",
  "tell",
  "more",
  "else",
  "please",
  "can",
  "could",
  "would",
  "will",
  "might",
  "should",
  "stated",
  "wrote",
  "posted",
  "think",
  "thinks",
  "view",
  "views",
  "opinion",
  "statement",
  "statements",
  "interview",
  "interviews",
]);

export type FollowUpDecision = {
  readonly record: KnownEntityRecord;
  readonly aspect: FollowUpAspect;
  readonly topicWords: readonly string[];
};

const GENERIC_SINGLE = new Set([
  "invest",
  "investment",
  "investments",
  "capital",
  "qatar",
  "bank",
  "group",
  "fund",
  "llc",
  "agency",
  "al",
]);

function nameIndex(
  records: readonly KnownEntityRecord[],
): Map<string, KnownEntityRecord[]> {
  const index = new Map<string, KnownEntityRecord[]>();
  const add = (name: string, record: KnownEntityRecord): void => {
    const key = aliasKeyOf(name);
    if (key.length === 0) return;
    const list = index.get(key) ?? [];
    if (!list.includes(record)) list.push(record);
    index.set(key, list);
  };
  for (const record of records) {
    for (const name of [record.displayName, ...record.aliases])
      add(name, record);
    if (record.entityKind === "PERSON") {
      // First or last name alone is how people speak ("what has Muhannad said").
      for (const part of wordsOf(record.displayName)) {
        if (part.length >= 4) add(part, record);
      }
    }
  }
  return index;
}

function namedEntity(
  text: string,
  records: readonly KnownEntityRecord[],
): KnownEntityRecord | "SEVERAL" | null {
  const index = nameIndex(records);
  const words = wordsOf(text);
  const found = new Set<KnownEntityRecord>();
  for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
    for (let at = 0; at + size <= words.length; at += 1) {
      const window = words.slice(at, at + size);
      if (size === 1 && GENERIC_SINGLE.has(window[0] ?? "")) continue;
      const hit = index.get(aliasKeyOf(window.join(" ")));
      if (hit?.length === 1 && hit[0] !== undefined) found.add(hit[0]);
    }
  }
  if (found.size > 1) return "SEVERAL";
  return [...found][0] ?? null;
}

/**
 * Whether a turn is a follow-up about a prepared entity, and about what.
 * Null means "not mine": a bare lookup, an action, a request for fresh
 * information, or words that point at no prepared entity.
 */
export function decidePreparedFollowUp(input: {
  readonly utterance: string;
  readonly records: readonly KnownEntityRecord[];
  /** The prepared entity whose card Q showed last, when one is. */
  readonly lastShownId: string | null;
}): FollowUpDecision | null {
  const text = input.utterance.trim().slice(0, 400);
  if (text.length === 0 || FRESH.test(text) || ACTION.test(text)) return null;
  const named = namedEntity(text, input.records);
  if (named === "SEVERAL") return null;
  let record = named;
  if (record === null && input.lastShownId !== null) {
    const shown = input.records.find(
      (candidate) => candidate.externalPersonId === input.lastShownId,
    );
    if (
      shown !== undefined &&
      (shown.entityKind === "PERSON" ? PRONOUN_PERSON : PRONOUN_ORG).test(text)
    ) {
      record = shown;
    }
  }
  if (record === null) return null;
  const aspect = ASPECTS.find((entry) => entry.test.test(text))?.aspect;
  // A name with no ask is a lookup (the card lane's); not a follow-up.
  if (aspect === undefined) return null;
  const nameWords = new Set(
    [record.displayName, ...record.aliases].flatMap(wordsOf),
  );
  const after = text.match(/\b(?:about|on|regarding|around|re)\b(.*)$/iu)?.[1];
  const topicWords = wordsOf(after ?? "")
    .filter((word) => !TOPIC_STOP.has(word) && !nameWords.has(word))
    .filter((word) => word.length >= 3);
  return { record, aspect, topicWords: aspect === "SAID" ? topicWords : [] };
}

// ---------------------------------------------------------------- answers

const STATUS_WORD: Record<string, string> = {
  VERIFIED_AGAINST_SOURCE: "read and checked",
  FACT_EXTRACTED: "read",
  CONTENT_READ: "read",
  BLOCKED_OR_UNAVAILABLE: "could not be opened",
  NEEDS_REFRESH: "needs a refresh",
  LINK_DISCOVERED: "link only, not read",
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
};

const factsOf = (
  record: KnownEntityRecord,
  topics: readonly string[],
): readonly EntityFactRecord[] =>
  record.facts.filter(
    (fact) => fact.topic != null && topics.includes(fact.topic),
  );

/** Where a fact comes from, in the words the member can check. */
function citeOf(record: KnownEntityRecord, fact: EntityFactRecord): string {
  const hosts = [
    ...new Set(
      fact.sourceIds
        .map((id) => record.sources.find((s) => s.sourceId === id))
        .filter((s): s is EntitySourceRecord => s !== undefined)
        .map((s) => hostOf(s.url)),
    ),
  ].filter((host) => host.length > 0);
  const unread = fact.status === "LINK_DISCOVERED" ? ", not read" : "";
  return hosts.length === 0
    ? ""
    : ` (${hosts.slice(0, 2).join(", ")}${unread})`;
}

const bullets = (
  record: KnownEntityRecord,
  facts: readonly EntityFactRecord[],
  max = 6,
): string =>
  facts
    .slice(0, max)
    .map((fact) => `- ${fact.claim}${citeOf(record, fact)}`)
    .join("\n");

function rehearsalOf(
  record: KnownEntityRecord,
): readonly { topic: string; question: string }[] {
  const rich = record.profile["rehearsal"];
  if (Array.isArray(rich)) {
    const items = rich.flatMap((item: unknown) => {
      const row = item as { topic?: unknown; question?: unknown };
      return typeof row.question === "string"
        ? [
            {
              topic: typeof row.topic === "string" ? row.topic : "",
              question: row.question,
            },
          ]
        : [];
    });
    if (items.length > 0) return items;
  }
  const plain = record.profile["rehearsalQuestions"];
  return Array.isArray(plain)
    ? plain
        .filter((q: unknown): q is string => typeof q === "string")
        .map((question) => ({ topic: "", question }))
    : [];
}

function quotesOf(record: KnownEntityRecord): readonly string[] {
  const labels = record.profile["quoteLabels"];
  return record.quotes.map((quote, at) => {
    const label =
      Array.isArray(labels) && typeof labels[at] === "string"
        ? labels[at]
        : "from a public source";
    return `"${quote.text}" (${quote.speaker}, ${label})`;
  });
}

function tallyLine(record: KnownEntityRecord): string {
  const tally = sourceTally(record.sources);
  const unread = record.sources.filter((source) => !sourceWasRead(source));
  const tail =
    unread.length === 0
      ? ""
      : ` Not read: ${unread
          .slice(0, 4)
          .map(
            (source) =>
              `${hostOf(source.url)} (${(STATUS_WORD[source.status ?? "LINK_DISCOVERED"] ?? "link only").replace(", not read", "")})`,
          )
          .join(", ")}.`;
  return `Sources: ${tally.phrase}; prepared ${record.lastResearchedAt.slice(0, 10)}.${tail} Ask me to search again for anything newer.`;
}

const questionsBlock = (record: KnownEntityRecord): string => {
  const items = rehearsalOf(record).slice(0, 6);
  if (items.length === 0) {
    return `I have no prepared rehearsal questions for ${record.displayName}.`;
  }
  return `Questions they may raise (rehearsal guidance drawn from the documented points, not ${record.displayName}'s words):\n${items.map((item) => `- ${item.question}`).join("\n")}`;
};

const subjectOf = (record: KnownEntityRecord): string => record.displayName;

function summaryOf(record: KnownEntityRecord): string {
  const summary = record.profile["summary"];
  const line = record.profile["oneLine"];
  return typeof summary === "string" && summary.length > 0
    ? summary
    : typeof line === "string"
      ? line
      : `${record.displayName}.`;
}

function saidAnswer(
  record: KnownEntityRecord,
  topicWords: readonly string[],
): string {
  const name = subjectOf(record);
  const statements = factsOf(record, ["STATEMENT", "ARTICLE"]);
  const quotes = quotesOf(record);
  const matches = (text: string): boolean => {
    const low = wordsOf(text);
    return topicWords.some((word) =>
      low.some((w) =>
        w.startsWith(word.slice(0, Math.max(4, word.length - 2))),
      ),
    );
  };
  if (topicWords.length > 0) {
    const hitFacts = statements.filter((fact) => matches(fact.claim));
    // A source's own excerpt can carry the topic beyond the fact's summary.
    const hitSources = record.sources.filter(
      (source) => sourceWasRead(source) && matches(source.excerpt ?? ""),
    );
    const hitQuotes = quotes.filter(matches);
    if (hitFacts.length + hitQuotes.length + hitSources.length === 0) {
      const have = statements.length > 0 || quotes.length > 0;
      return `I have no public statement from ${name} on ${topicWords.join(" ")} in the sources I read.${have ? ` What I do have on record from ${name}:\n${bullets(record, statements, 4)}${quotes.length > 0 ? `\nIn their own words: ${quotes.slice(0, 2).join("; ")}` : ""}` : ""}\n\n${tallyLine(record)}`;
    }
    return `What ${name} has said on ${topicWords.join(" ")}, documented:\n${bullets(record, hitFacts, 5)}${hitQuotes.length > 0 ? `\nIn their own words: ${hitQuotes.slice(0, 2).join("; ")}` : ""}${hitFacts.length === 0 && hitSources.length > 0 ? `\nThe page ${hostOf(hitSources[0]?.url ?? "")} mentions it.` : ""}\n\n${tallyLine(record)}`;
  }
  if (statements.length === 0 && quotes.length === 0) {
    return `I have no public statements from ${name} in the sources I read.\n\n${tallyLine(record)}`;
  }
  return `What ${name} has said publicly, documented:\n${bullets(record, statements, 5)}${quotes.length > 0 ? `\nIn their own words: ${quotes.slice(0, 3).join("; ")}` : ""}\n\n${tallyLine(record)}`;
}

function fieldAnswer(
  record: KnownEntityRecord,
  lead: string,
  topics: readonly string[],
  missing: string,
): string {
  const facts = factsOf(record, topics);
  if (facts.length === 0) {
    return `${missing}\n\n${tallyLine(record)}`;
  }
  return `${lead}\n${bullets(record, facts)}\n\n${tallyLine(record)}`;
}

/** The answer text for a decided follow-up. Pure; no I/O. */
export function answerPreparedFollowUp(decision: FollowUpDecision): string {
  const { record, aspect } = decision;
  const name = subjectOf(record);
  switch (aspect) {
    case "SAID":
      return saidAnswer(record, decision.topicWords);
    case "PRIORITIES":
      return fieldAnswer(
        record,
        `What ${name} documents as priorities:`,
        ["PRIORITIES"],
        `I have no documented priorities for ${name} in the sources I read.`,
      );
    case "WHAT_THEY_DO":
      return fieldAnswer(
        record,
        record.entityKind === "PERSON"
          ? `What ${name} does, documented:`
          : `What ${name} does, from its own published material:`,
        record.entityKind === "PERSON"
          ? ["ROLE", "CAREER", "WHAT_THEY_DO"]
          : ["WHAT_THEY_DO", "IDENTITY", "ROLE"],
        `I have no documented description of what ${name} does beyond: ${summaryOf(record)}`,
      );
    case "BACKGROUND":
      return fieldAnswer(
        record,
        `${name}'s background, documented:`,
        ["IDENTITY", "ROLE", "CAREER"],
        `I have no documented background for ${name} beyond: ${summaryOf(record)}`,
      );
    case "QUESTIONS":
      return `${questionsBlock(record)}\n\n${tallyLine(record)}`;
    case "PITCH": {
      const basis = factsOf(record, [
        "PRIORITIES",
        "STATEMENT",
        "WHAT_THEY_DO",
      ]);
      const lead =
        basis.length === 0
          ? `I have no documented priorities for ${name} to build a pitch on.`
          : `What the sources document about ${name}, to build on:\n${bullets(record, basis, 5)}`;
      const caution =
        record.entityKind === "PERSON"
          ? ""
          : `\n${name} is an institution: prepare for a role-based conversation, not a personal one.`;
      return `${lead}${caution}\n\n${questionsBlock(record)}\n\n${tallyLine(record)}`;
    }
    case "SOURCES": {
      const rows = record.sources.map(
        (source) =>
          `- ${hostOf(source.url)}: ${STATUS_WORD[source.status ?? "LINK_DISCOVERED"] ?? "link only"}${source.readAt == null ? "" : ` on ${source.readAt.slice(0, 10)}`}`,
      );
      return `Where my information on ${name} comes from:\n${rows.join("\n")}\n\n${tallyLine(record)}`;
    }
    case "OVERVIEW": {
      const documented = factsOf(record, [
        "ROLE",
        "CAREER",
        "IDENTITY",
        "WHAT_THEY_DO",
        "STATEMENT",
        "PRIORITIES",
        "ARTICLE",
      ]);
      const quotes = quotesOf(record);
      return `${summaryOf(record)}\n\nDocumented:\n${bullets(record, documented, 8)}${quotes.length > 0 ? `\n\nIn their own words: ${quotes.slice(0, 2).join("; ")}` : ""}\n\n${questionsBlock(record)}\n\n${tallyLine(record)}`;
    }
  }
}
