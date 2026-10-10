import {
  PersonSearchResultSchema,
  QAnswerCardsBlockSchema,
  type ExternalPersonConfidence,
  type IdentityCandidate,
  type IdentityCard,
  type PersonSearchResult,
  type QAnswerCardLevel,
  type QAnswerCardsBlock,
} from "@capital-q/contracts/q";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

/**
 * W2: the answer to a PERSON_SEARCH request, built by code. The identity
 * card appears at once from the lookup tool's result (a prepared entity
 * from the known-entity index, or a bounded public search); the model
 * writes none of it. Null when the tool is not offered or failed, so the
 * full path answers instead. Never throws.
 */

const FIND_TOOL = "find_public_entity";

export type PersonAsk = {
  readonly name: string;
  readonly entityKind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  readonly city: string | null;
  readonly country: string | null;
  readonly organization: string | null;
  readonly role: string | null;
  readonly freshSearch: boolean;
};

export type PersonSources = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
}[];

export type PersonSearchAnswer = {
  readonly text: string;
  readonly block: QAnswerCardsBlock | null;
  readonly sources: PersonSources;
  readonly result: PersonSearchResult;
  readonly source: "KNOWN_ENTITY" | "WEB";
  readonly calls: readonly QToolCallOutcome[];
};

const LEVEL: Readonly<Record<ExternalPersonConfidence, QAnswerCardLevel>> = {
  STRONG: "STRONG",
  PLAUSIBLE: "PARTIAL",
  WEAK: "UNKNOWN",
};

const CONFIDENCE_WORDS: Readonly<Record<ExternalPersonConfidence, string>> = {
  STRONG: "Strong match on public sources",
  PLAUSIBLE: "Plausible match; not fully confirmed",
  WEAK: "Weak lead; a name match only",
};

function joinLine(parts: readonly (string | null)[]): string | null {
  const line = parts.filter((p): p is string => p !== null && p.length > 0);
  return line.length === 0 ? null : line.join(" · ").slice(0, 140);
}

function firstName(name: string): string {
  return name.split(/\s+/u)[0] ?? name;
}

/** The identity card as Q shows it, from a stored or searched card. */
export function identityCardBlock(
  card: IdentityCard,
  others: readonly IdentityCandidate[] = [],
): QAnswerCardsBlock | null {
  return cardBlock(card, others);
}

function cardBlock(
  card: IdentityCard,
  others: readonly IdentityCandidate[] = [],
): QAnswerCardsBlock | null {
  const s = card.subject;
  // A prepared entity is a record Capital Q chose to hold: its card carries
  // sourcing and freshness, never a "plausible match" hedge.
  const prepared = s.researchStatus === "PREPARED_PUBLIC_SEED";
  const reasons = [
    card.attributionLine ?? CONFIDENCE_WORDS[s.confidence],
    ...(prepared ? [] : [CONFIDENCE_WORDS[s.confidence]]),
    ...card.uncertainty.slice(0, 1),
  ].map((r) => r.slice(0, 160));
  const followUps = [
    ...(card.actions.includes("RESEARCH_FURTHER")
      ? [`Research ${firstName(s.displayName)} further`]
      : []),
    ...(card.actions.includes("REHEARSE")
      ? [`Rehearse with ${firstName(s.displayName)}`]
      : []),
  ].map((f) => f.slice(0, 120));
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    title: (s.entityKind === "PERSON" ? "Who I found" : "What I found").slice(
      0,
      120,
    ),
    cards: [
      {
        key: s.externalPersonId,
        name: s.displayName.slice(0, 80),
        line: joinLine([
          s.entityKind === "PERSON" ? s.role : null,
          s.organization,
          s.location,
        ]),
        about: s.profileUrl === null ? null : s.profileUrl.slice(0, 160),
        hue: 1,
        fit: null,
        reasons,
        measures: [
          {
            label: "Identity match",
            level: LEVEL[s.confidence],
            value: prepared
              ? "prepared"
              : s.confidence === "STRONG"
                ? "strong"
                : s.confidence.toLowerCase(),
          },
        ],
        view:
          s.researchStatus === "PREPARED_PUBLIC_SEED"
            ? "Prepared from public sources"
            : card.enriching
              ? "Researching further"
              : null,
        said: null,
        sourceCount: card.sources.length,
        subject: null,
        external: {
          externalPersonId: s.externalPersonId,
          profileUrl:
            s.profileUrl !== null && s.profileUrl.startsWith("https://")
              ? s.profileUrl
              : null,
          rehearse: card.actions.includes("REHEARSE"),
          // R5: an unclaimed canonical investor opens the investor rehearsal.
          ...(s.investorOrganisationId == null
            ? {}
            : { investorOrganisationId: s.investorOrganisationId }),
          sources: sourceLinks(card),
        },
      },
      // The other people the search could not rule out are cards too.
      ...candidateCards(others, 2),
    ],
    followUps,
  });
  return parsed.success ? parsed.data : null;
}

/** The card's sources as links: a title, else the host; https only. */
function sourceLinks(card: IdentityCard) {
  const seen = new Set<string>();
  const links: { label: string; url: string }[] = [];
  for (const source of card.sources) {
    if (!source.url.startsWith("https://") || seen.has(source.url)) continue;
    seen.add(source.url);
    links.push({
      label: (source.title ?? source.domain).slice(0, 120) || source.domain,
      url: source.url,
    });
    if (links.length >= 8) break;
  }
  return links;
}

/** One card per candidate, each with its own number so keys never collide. */
function candidateCards(
  candidates: readonly IdentityCandidate[],
  firstHue: number,
) {
  return candidates.slice(0, 4).map((c, at) => {
    const stored = c.externalPersonId ?? null;
    const https =
      c.profileUrl !== null && c.profileUrl.startsWith("https://")
        ? c.profileUrl
        : null;
    return {
      key: (
        stored ??
        `candidate-${String(at + 1)}-${(c.profileUrl ?? c.displayName).slice(-40)}`
      ).slice(0, 64),
      name: c.displayName.slice(0, 80),
      line: joinLine([c.role, c.organization, c.location]),
      about: c.profileUrl === null ? null : c.profileUrl.slice(0, 160),
      hue: ((firstHue - 1 + at) % 7) + 1,
      fit: null,
      reasons: [CONFIDENCE_WORDS[c.confidence]],
      measures: [],
      view: null,
      said: null,
      sourceCount: c.profileUrl === null ? 0 : 1,
      subject: null,
      ...(stored !== null || https !== null
        ? {
            external: {
              // A stored record can be rehearsed (C2); a web-only lead can
              // only open its public page until it is researched.
              externalPersonId: stored,
              profileUrl: https,
              rehearse: stored !== null,
              sources:
                https === null
                  ? []
                  : [
                      {
                        label: (c.displayName + " - public profile").slice(
                          0,
                          120,
                        ),
                        url: https,
                      },
                    ],
            },
          }
        : {}),
    };
  });
}

function candidatesBlock(
  candidates: readonly IdentityCandidate[],
  question: string | null,
): QAnswerCardsBlock | null {
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    // The one clarifying question heads the cards when it fits.
    title:
      question !== null && question.length <= 120 ? question : "Which one?",
    cards: candidateCards(candidates, 1),
    followUps: [],
  });
  return parsed.success ? parsed.data : null;
}

function sourcesOf(card: IdentityCard | null): PersonSources {
  if (card === null) return [];
  return card.sources.map((source, at) => ({
    index: at + 1,
    url: source.url,
    domain: source.domain,
    title: source.title,
    publishedAt: source.publishedAt,
    retrievedAt: source.retrievedAt,
  }));
}

function placeOf(ask: PersonAsk): string | null {
  return (
    [ask.city, ask.country]
      .filter((p): p is string => p !== null && p.length > 0)
      .join(", ") || null
  );
}

/** A value cut off with an ellipsis is no fact: unknown, never clipped. */
function whole(value: string | null): string | null {
  if (value === null) return null;
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length === 0 || /(?:\.{2,}|…)/u.test(clean) ? null : clean;
}

/**
 * "Shadi Qishta is a finance and business executive in Doha; ..." from the
 * entity's own one-line description. The description is a predicate
 * ("Qatar-based Islamic investment group"), a possessive phrase ("Qatar's
 * investment promotion agency") or a role; an article is added only where
 * the grammar needs one. Without a description, the stored role and
 * organisation say it.
 */
function preparedSentence(
  name: string,
  kind: IdentityCard["subject"]["entityKind"],
  summary: string | null,
  subject: IdentityCard["subject"],
): string {
  // Parentheticals ("(est. 2019)") are card detail, not spoken.
  const line =
    whole(summary)
      ?.replace(/\s*\([^)]*\)/gu, "")
      .replace(/[.;\s]+$/u, "") ?? null;
  if (line === null) {
    const role = kind === "PERSON" ? whole(subject.role) : null;
    const org = whole(subject.organization);
    const where = whole(subject.location);
    const bits = [
      role === null ? null : org === null ? role : `${role} at ${org}`,
      role === null && org !== null ? `with ${org}` : null,
      where === null ? null : `based in ${where}`,
    ].filter((part): part is string => part !== null);
    return bits.length === 0
      ? `Here is what I have on ${name} from public sources.`
      : `${name} is ${bits.join(", ")}.`;
  }
  const [first = ""] = line.split(/\s+/u);
  // Keep capitals on proper names ("Qatar-based", "Qatar's", "IFRS").
  const known = [name, subject.location, subject.organization]
    .filter((part): part is string => part !== null)
    .join(" ");
  // A possessive proper-noun phrase ("Alchemist Doha's Director …") keeps
  // its capitals and takes no article.
  const possessive = /^(?:\p{Lu}[\p{L}-]*\s+){0,3}\p{Lu}[\p{L}-]*['’]s\b/u.test(
    line,
  );
  const proper =
    possessive ||
    /[-'’]/u.test(first) ||
    /\p{Lu}.*\p{Lu}/u.test(first) ||
    known.includes(first);
  const body = proper ? line : line.replace(/^./u, (c) => c.toLowerCase());
  const article =
    possessive || /['’]s$/u.test(first)
      ? ""
      : /^[aeiou]/iu.test(body)
        ? "an "
        : "a ";
  return `${name} is ${article}${body}.`;
}

export function personSearchText(
  result: PersonSearchResult,
  ask: PersonAsk,
): string {
  const place = placeOf(ask);
  if (result.outcome === "MATCHED" && result.card !== null) {
    const s = result.card.subject;
    const offer = result.card.actions.includes("REHEARSE")
      ? "Want me to research further or set up a rehearsal?"
      : "Want me to research further?";
    // A prepared entity: one natural sentence from its own description.
    // Freshness and sourcing stay in the card; no identity hedging for a
    // record Capital Q prepared on purpose.
    if (s.researchStatus === "PREPARED_PUBLIC_SEED") {
      return `${preparedSentence(s.displayName, s.entityKind, result.card.summary ?? null, s)} ${offer}`;
    }
    // A searched candidate: said as reported, with role and organisation
    // only when they are whole, and the confidence in plain words.
    const role = whole(s.entityKind === "PERSON" ? s.role : null);
    const org = whole(s.organization);
    const place = whole(s.location);
    const job =
      role !== null && org !== null
        ? `${role} at ${org}`
        : (role ?? (org === null ? null : `with ${org}`));
    const facts = [
      job === null ? null : `reportedly ${job}`,
      place === null ? null : `based in ${place}`,
    ].filter((part): part is string => part !== null);
    const described =
      facts.length === 0
        ? `${s.displayName} turns up in public sources`
        : `${s.displayName} is ${facts.join(", ")}`;
    const lead =
      s.confidence === "STRONG"
        ? "This looks like the right person: "
        : s.confidence === "PLAUSIBLE"
          ? "This could be who you mean: "
          : "I only have a name match so far: ";
    return `${s.entityKind === "PERSON" ? lead : ""}${described}. ${offer}`;
  }
  if (result.outcome === "AMBIGUOUS") {
    return (
      result.clarifyingQuestion ??
      `I found more than one ${ask.name}. Which one do you mean?`
    );
  }
  if (result.outcome === "NOT_FOUND") {
    return `I searched public sources and found no one called ${ask.name}${place === null ? "" : ` in ${place}`}. A company or city would help me narrow it.`;
  }
  return "Public search isn't answering right now, so I can't say either way. Try again in a moment.";
}

export async function runPersonSearch(input: {
  readonly ask: PersonAsk;
  readonly tools: Pick<QToolPort, "execute">;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
}): Promise<PersonSearchAnswer | null> {
  const { ask, tools, context, available } = input;
  if (!available.has(FIND_TOOL)) return null;
  const calls: QToolCallOutcome[] = [];
  const outcome = await tools
    .execute(
      {
        callId: "q-find-public-entity",
        name: FIND_TOOL,
        arguments: {
          name: ask.name,
          entityKind: ask.entityKind,
          city: ask.city,
          country: ask.country,
          organization: ask.organization,
          role: ask.role,
          freshSearch: ask.freshSearch,
        },
      },
      context,
    )
    .catch(() => null);
  if (outcome === null) return null;
  calls.push(outcome);
  if (!outcome.result.ok) return null;
  const data = outcome.result.data as {
    result?: unknown;
    source?: unknown;
  } | null;
  const parsed = PersonSearchResultSchema.safeParse(data?.result);
  if (!parsed.success) return null;
  const result = parsed.data;
  const block =
    result.outcome === "MATCHED" && result.card !== null
      ? cardBlock(result.card, result.candidates)
      : result.outcome === "AMBIGUOUS"
        ? candidatesBlock(result.candidates, result.clarifyingQuestion)
        : null;
  return {
    text: personSearchText(result, ask),
    block,
    sources: sourcesOf(result.card),
    result,
    source: data?.source === "KNOWN_ENTITY" ? "KNOWN_ENTITY" : "WEB",
    calls,
  };
}
