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

function cardBlock(card: IdentityCard): QAnswerCardsBlock | null {
  const s = card.subject;
  const reasons = [
    card.attributionLine ?? CONFIDENCE_WORDS[s.confidence],
    CONFIDENCE_WORDS[s.confidence],
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
            value:
              s.confidence === "STRONG" ? "strong" : s.confidence.toLowerCase(),
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
      },
    ],
    followUps,
  });
  return parsed.success ? parsed.data : null;
}

function candidatesBlock(
  candidates: readonly IdentityCandidate[],
): QAnswerCardsBlock | null {
  const parsed = QAnswerCardsBlockSchema.safeParse({
    kind: "ANSWER_CARDS",
    shape: "RESEARCH",
    title: "Which one?",
    cards: candidates.slice(0, 4).map((c, at) => ({
      key: `candidate-${String(at + 1)}-${(c.profileUrl ?? c.displayName).slice(-40)}`.slice(
        0,
        64,
      ),
      name: c.displayName.slice(0, 80),
      line: joinLine([c.role, c.organization, c.location]),
      about: c.profileUrl === null ? null : c.profileUrl.slice(0, 160),
      hue: (at % 7) + 1,
      fit: null,
      reasons: [CONFIDENCE_WORDS[c.confidence]],
      measures: [],
      view: null,
      said: null,
      sourceCount: 1,
      subject: null,
    })),
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

export function personSearchText(
  result: PersonSearchResult,
  ask: PersonAsk,
): string {
  const place = placeOf(ask);
  if (result.outcome === "MATCHED" && result.card !== null) {
    const s = result.card.subject;
    const where = joinLine([
      s.entityKind === "PERSON" ? s.role : null,
      s.organization,
      s.location,
    ]);
    const how =
      s.confidence === "STRONG"
        ? "It looks like a strong match."
        : "It is a plausible match, not a confirmed one.";
    const note = result.card.uncertainty[0];
    // Search-indexed findings are usable but said as reported.
    const reported =
      where === null
        ? s.displayName
        : `${s.displayName} is reportedly ${where.replace(/ · /gu, ", ")}`;
    return `${reported}. ${result.card.attributionLine ?? ""} ${how}${note === undefined ? "" : ` ${note}`} The card and its sources are on screen; I can research further or set up a rehearsal.`
      .replace(/\s+/gu, " ")
      .trim();
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
      ? cardBlock(result.card)
      : result.outcome === "AMBIGUOUS"
        ? candidatesBlock(result.candidates)
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
