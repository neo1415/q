import {
  PERSON_BRIEF_TOPICS,
  PersonBriefAssertionSchema,
  type ExternalPersonSource,
  type PersonAssertionClass,
  type PersonBriefAssertion,
  type PersonBriefTopic,
} from "@capital-q/contracts/q";

/**
 * Admission rules for the person brief (W2, 2026-10-10).
 *
 * A model (or any synthesiser) may PROPOSE assertions about a public
 * person; code decides which are admitted. The rules are structural, not
 * wordlists: an assertion is admitted only with a verbatim quote that
 * really occurs in a source it cites, so a preference, a view or an
 * investment interest cannot appear unless a source says it. A finance
 * executive is therefore never described as a venture investor by
 * inference alone, and absence is recorded as UNKNOWN, never as a trait.
 */

/** A source the synthesiser may cite, with the bounded text it can see. */
export type BriefSource = ExternalPersonSource & { readonly excerpt: string };

export type ProposedAssertion = {
  readonly topic: PersonBriefTopic;
  readonly text: string;
  readonly assertionClass: PersonAssertionClass;
  readonly sourceRefs: readonly number[];
  /** A verbatim passage from a cited source that supports the text. */
  readonly quote: string | null;
};

/** Brief topics that describe what a person wants or believes. */
const PREFERENCE_TOPICS: ReadonlySet<PersonBriefTopic> = new Set([
  "INVESTMENT_INTERESTS",
  "SECTORS",
  "EMPHASISED_QUESTIONS",
  "MARKET_VIEWS",
  "COMMUNICATION_STYLE",
  "RECURRING_TOPICS",
]);

/** A source older than this speaks of the past, not the present. */
export const STALE_AFTER_DAYS = 3 * 365;

/** A brief is reused for this long before a question refreshes it. */
export const BRIEF_FRESH_DAYS = 14;

function squash(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[\s ]+/gu, " ")
    .replace(/[“”"']/gu, "")
    .trim();
}

/** True when the quote occurs, whitespace- and case-insensitively, in the text. */
export function quoteOccursIn(quote: string, text: string): boolean {
  const q = squash(quote);
  return q.length >= 12 && squash(text).includes(q);
}

function ageDays(iso: string | null, now: Date): number | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now.getTime() - t) / 86_400_000;
}

export type AdmissionOutcome = {
  readonly admitted: readonly PersonBriefAssertion[];
  readonly rejected: readonly { topic: PersonBriefTopic; reason: string }[];
};

/**
 * Admit proposed assertions against the sources they cite. Classes are
 * checked, not trusted:
 *  - every non-UNKNOWN assertion cites real sources and carries a quote
 *    that occurs in one of them (preference topics: always);
 *  - VERIFIED_PUBLIC_FACT needs two sources on different domains, else it
 *    is a PUBLIC_STATEMENT (what one page says);
 *  - an assertion resting only on old sources is CONTRADICTORY_OR_STALE.
 */
export function admitAssertions(
  proposed: readonly ProposedAssertion[],
  sources: readonly BriefSource[],
  now: Date,
): AdmissionOutcome {
  const admitted: PersonBriefAssertion[] = [];
  const rejected: { topic: PersonBriefTopic; reason: string }[] = [];
  for (const item of proposed) {
    if (item.assertionClass === "UNKNOWN") {
      const unknown = PersonBriefAssertionSchema.safeParse({
        topic: item.topic,
        text: item.text,
        assertionClass: "UNKNOWN",
        sourceRefs: [],
        asOf: null,
      });
      if (unknown.success) admitted.push(unknown.data);
      continue;
    }
    const cited = [...new Set(item.sourceRefs)]
      .map((ref) => ({ ref, source: sources[ref] }))
      .filter(
        (entry): entry is { ref: number; source: BriefSource } =>
          entry.source !== undefined,
      );
    if (cited.length === 0) {
      rejected.push({ topic: item.topic, reason: "no real source cited" });
      continue;
    }
    const quote = item.quote;
    const quoted =
      quote !== null &&
      cited.some((entry) => quoteOccursIn(quote, entry.source.excerpt));
    if (!quoted) {
      rejected.push({
        topic: item.topic,
        reason: PREFERENCE_TOPICS.has(item.topic)
          ? "a preference or view needs a quote that a cited source contains"
          : "the quote is not in a cited source",
      });
      continue;
    }
    const domains = new Set(cited.map((entry) => entry.source.domain));
    let assertionClass = item.assertionClass;
    if (assertionClass === "VERIFIED_PUBLIC_FACT" && domains.size < 2) {
      assertionClass = "PUBLIC_STATEMENT";
    }
    const ages = cited.map((entry) => ageDays(entry.source.publishedAt, now));
    const dated = ages.filter((age): age is number => age !== null);
    if (
      dated.length === cited.length &&
      dated.every((a) => a > STALE_AFTER_DAYS)
    ) {
      assertionClass = "CONTRADICTORY_OR_STALE";
    }
    const newest = cited
      .map((entry) => entry.source.publishedAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1);
    const parsed = PersonBriefAssertionSchema.safeParse({
      topic: item.topic,
      text: item.text,
      assertionClass,
      sourceRefs: cited.map((entry) => entry.ref).slice(0, 6),
      asOf: newest ?? null,
    });
    if (parsed.success) admitted.push(parsed.data);
    else rejected.push({ topic: item.topic, reason: "invalid assertion" });
  }
  return { admitted, rejected };
}

/**
 * Every topic with no admitted assertion is recorded as UNKNOWN, so a
 * reader sees what was looked for and not found instead of a silent gap.
 */
export function withUnknowns(
  admitted: readonly PersonBriefAssertion[],
  displayName: string,
): readonly PersonBriefAssertion[] {
  const covered = new Set(admitted.map((a) => a.topic));
  const unknowns: PersonBriefAssertion[] = PERSON_BRIEF_TOPICS.filter(
    (topic) => !covered.has(topic),
  ).map((topic) => ({
    topic,
    text: `No public source found for ${displayName} on this.`,
    assertionClass: "UNKNOWN" as const,
    sourceRefs: [],
    asOf: null,
  }));
  return [...admitted, ...unknowns];
}

/**
 * Two sources that name different current employers are a contradiction
 * to show, not a choice to make: both stay, classed CONTRADICTORY_OR_STALE.
 */
export function roleContradictions(
  facts: readonly {
    readonly sourceRef: number;
    readonly organization: string | null;
    readonly asOf: string | null;
  }[],
): readonly PersonBriefAssertion[] {
  const withOrg = facts.filter(
    (fact): fact is typeof fact & { organization: string } =>
      fact.organization !== null && fact.organization.trim().length > 0,
  );
  const distinct = new Map<string, (typeof withOrg)[number]>();
  for (const fact of withOrg) {
    const key = squash(fact.organization);
    if (!distinct.has(key)) distinct.set(key, fact);
  }
  if (distinct.size < 2) return [];
  const list = [...distinct.values()];
  return [
    {
      topic: "CURRENT_ROLE",
      text: `Sources disagree on the current organisation: ${list
        .map((f) => f.organization)
        .join(" vs ")
        .slice(0, 300)}.`,
      assertionClass: "CONTRADICTORY_OR_STALE",
      sourceRefs: list.map((f) => f.sourceRef).slice(0, 6),
      asOf: null,
    },
  ];
}
