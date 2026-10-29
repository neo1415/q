/**
 * The research dossier's admission rules (owner 2026-10-23), deterministic.
 *
 * A model reads public pages and proposes dated, sourced facts. Code admits
 * a fact only when the source it names exists and every number it states
 * appears in that source's own text: a figure no page carried is a figure
 * the model made up, and it never reaches a document. Admitted facts are
 * deduplicated and ranked so every line of enquiry is represented before
 * any one of them gets its tenth fact.
 *
 * A public page's statement is not verified by Capital Q: it is what that
 * source says, with the source and its date. Truth class stays the
 * document's to label (UNKNOWN truth, DOCUMENT_SUPPORTED evidence).
 */

export const FACT_KINDS = [
  "FIGURE",
  "FACT",
  "COMPETITOR",
  "ALTERNATIVE",
  "REGULATION",
  "TREND",
  "RISK",
  "NEWS",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export type ProposedFact = {
  readonly statement: string;
  /** The number the fact turns on, as the source wrote it; null for none. */
  readonly figure: string | null;
  /** When the fact was true ("2023", "Q2 2025"), as the source said; null: undated. */
  readonly asOf: string | null;
  /** The source's number (S1 = 1). */
  readonly source: number;
  readonly lane: string;
  readonly kind: FactKind;
  /**
   * Investigation (2026-10-29): what the figure measures and what it is
   * about, as the reader labelled them -- hints code uses to group facts
   * for cross-checking, never a judgement of agreement. Absent: unlabelled.
   */
  readonly measure?: string | null | undefined;
  readonly entity?: string | null | undefined;
};

/** A proposed fact whose source exists and carries every number it states. */
export type VerifiedFact = ProposedFact & {
  readonly domain: string;
  readonly title: string | null;
  readonly url: string;
  readonly publishedAt: string | null;
};

export type AdmittedFact = VerifiedFact & {
  /** F1, F2 ... in ranked order. */
  readonly id: string;
};

export type FactRefusal =
  | "UNKNOWN_SOURCE"
  | "FIGURE_NOT_IN_SOURCE"
  | "ENTITY_NOT_IN_SOURCE"
  | "DUPLICATE"
  | "EMPTY";

export type FactRefusals = readonly {
  readonly statement: string;
  readonly reason: FactRefusal;
}[];

export type DossierSource = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly excerpt: string;
};

export const DOSSIER_MAX_FACTS = 60;

/** Numbers in a text, normalised: "1,200,000" -> "1200000", "4.5" stays. */
export function numbersIn(text: string): readonly string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/gu) ?? [])
    .map((raw) => raw.replace(/,(?=\d{3}\b)/gu, "").replace(/,/gu, ""))
    .map((value) => value.replace(/\.0+$/u, ""))
    .filter((value) => value.length > 0);
}

/** The scale a figure is written in: "bn", "m", "%" ... null: none said. */
type Scale = "T" | "B" | "M" | "K" | "%" | null;

const SCALED =
  /\d[\d,]*(?:\.\d+)?(?:\s?(%|percent\b|per cent\b|trillion\b|tn\b|billion\b|bn\b|b\b|million\b|mn\b|m\b|mil\b|thousand\b|k\b))?/giu;

function scaleOf(raw: string | undefined): Scale {
  const unit = (raw ?? "").toLowerCase();
  if (unit === "") return null;
  if (unit === "%" || unit.startsWith("per")) return "%";
  if (unit === "trillion" || unit === "tn") return "T";
  if (unit === "billion" || unit === "bn" || unit === "b") return "B";
  if (unit === "million" || unit === "mn" || unit === "m" || unit === "mil")
    return "M";
  return "K";
}

/** Each number in a text with the scale written after it. */
function scaledNumbersIn(
  text: string,
): readonly { readonly value: string; readonly scale: Scale }[] {
  return [...text.matchAll(SCALED)].flatMap((match) => {
    const value = numbersIn(match[0])[0];
    return value === undefined ? [] : [{ value, scale: scaleOf(match[1]) }];
  });
}

/**
 * Whether every number a fact states occurs in its source's text. A
 * figure written with a scale ("$778m", "32%") is matched only by the same
 * number written with the same scale or with none ("778" in a table
 * headed "$m"); the same digits at another scale ("778 billion", "778%")
 * are a different figure.
 */
export function numbersSupported(
  fact: Pick<ProposedFact, "statement" | "figure">,
  sourceText: string,
): boolean {
  const available = scaledNumbersIn(sourceText);
  const stated = [
    ...scaledNumbersIn(fact.figure ?? ""),
    ...scaledNumbersIn(fact.statement),
  ];
  return stated.every((one) =>
    available.some(
      (page) =>
        page.value === one.value &&
        (one.scale === null || page.scale === null || page.scale === one.scale),
    ),
  );
}

/**
 * The organisation a fact is about, when the reader named one as a proper
 * name ("Corpay", "Yellow Card"; never a market label like "global B2B
 * payments"): it must be named on the fact's own page. Live 2026-10-29
 * (run A): Corpay's and Payoneer's revenues were filed under an FXC
 * Intelligence page that names neither -- a fact carried across pages
 * the reader read together.
 */
export function entityOnPage(
  entity: string | null | undefined,
  sourceText: string,
): boolean {
  const name = entity?.trim() ?? "";
  const words = name.split(/\s+/u).filter((word) => word.length > 0);
  const proper =
    words.length > 0 &&
    words.length <= 3 &&
    words.every((word) => /^[\p{Lu}\p{N}]/u.test(word));
  if (!proper) return true;
  const compact = (text: string) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return compact(sourceText).includes(compact(name));
}

/** One key per statement, however it is spaced or punctuated. */
export function factKey(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recency(fact: ProposedFact, publishedAt: string | null): number {
  const years = [
    ...(fact.asOf ?? "").matchAll(/\b(19|20)\d{2}\b/gu),
    ...(publishedAt ?? "").matchAll(/\b(19|20)\d{2}\b/gu),
  ].map((match) => Number(match[0]));
  return years.length === 0 ? 0 : Math.max(...years);
}

/**
 * Code's admission test, without ranking: the source exists, every number
 * is on it, and the statement is not one already kept (`seen`: statements
 * an earlier round kept, which this call extends).
 */
export function verifyFacts(
  proposed: readonly ProposedFact[],
  sources: readonly DossierSource[],
  seen: Set<string> = new Set<string>(),
): {
  readonly verified: readonly VerifiedFact[];
  readonly refused: FactRefusals;
} {
  const byIndex = new Map(sources.map((source) => [source.index, source]));
  const refused: { statement: string; reason: FactRefusal }[] = [];
  const verified: VerifiedFact[] = [];
  for (const fact of proposed) {
    const statement = fact.statement.trim();
    if (statement.length === 0) {
      refused.push({ statement, reason: "EMPTY" });
      continue;
    }
    const source = byIndex.get(fact.source);
    if (source === undefined) {
      refused.push({ statement, reason: "UNKNOWN_SOURCE" });
      continue;
    }
    const page = `${source.title ?? ""} ${source.excerpt}`;
    if (!numbersSupported(fact, page)) {
      refused.push({ statement, reason: "FIGURE_NOT_IN_SOURCE" });
      continue;
    }
    if (!entityOnPage(fact.entity, page)) {
      refused.push({ statement, reason: "ENTITY_NOT_IN_SOURCE" });
      continue;
    }
    const key = factKey(statement);
    if (seen.has(key)) {
      refused.push({ statement, reason: "DUPLICATE" });
      continue;
    }
    seen.add(key);
    verified.push({
      ...fact,
      statement,
      domain: source.domain,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
    });
  }
  return { verified, refused };
}

/**
 * Rank verified facts: one fact per line of enquiry in turn (coverage
 * first), and within a line the better-tiered source first (`tierOf`,
 * higher first: an official source before the press), then facts with a
 * figure, then the most recent, then the order they were proposed.
 */
export function rankFacts<F extends VerifiedFact>(
  facts: readonly F[],
  maxFacts: number = DOSSIER_MAX_FACTS,
  tierOf: (fact: F) => number = () => 0,
): readonly (F & { readonly id: string })[] {
  const lanes = new Map<string, { fact: F; order: number }[]>();
  facts.forEach((fact, order) => {
    const list = lanes.get(fact.lane) ?? [];
    list.push({ fact, order });
    lanes.set(fact.lane, list);
  });
  for (const list of lanes.values()) {
    list.sort(
      (a, b) =>
        tierOf(b.fact) - tierOf(a.fact) ||
        Number(b.fact.figure !== null) - Number(a.fact.figure !== null) ||
        recency(b.fact, b.fact.publishedAt) -
          recency(a.fact, a.fact.publishedAt) ||
        a.order - b.order,
    );
  }
  const ranked: F[] = [];
  const queues = [...lanes.values()];
  while (ranked.length < maxFacts && queues.some((list) => list.length > 0)) {
    for (const list of queues) {
      const one = list.shift();
      if (one !== undefined && ranked.length < maxFacts) ranked.push(one.fact);
    }
  }
  return ranked.map((fact, position) => ({
    ...fact,
    id: `F${String(position + 1)}`,
  }));
}

/**
 * Admit, deduplicate and rank proposed facts: verifyFacts, then rankFacts
 * (one fact per line of enquiry in turn; within a line facts with a
 * figure, then the most recent, then the order they were proposed).
 */
export function admitFacts(
  proposed: readonly ProposedFact[],
  sources: readonly DossierSource[],
  maxFacts: number = DOSSIER_MAX_FACTS,
): {
  readonly admitted: readonly AdmittedFact[];
  readonly refused: FactRefusals;
} {
  const { verified, refused } = verifyFacts(proposed, sources);
  return { admitted: rankFacts(verified, maxFacts), refused };
}
