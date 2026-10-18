import type {
  CriterionConfig,
  CriterionRequiredness,
} from "../contracts/index.js";

/**
 * Reading an investor's mandate into a DRAFT gate policy (P7: "investors
 * upload their mandate, and Q sets it up for them").
 *
 *   mandate text ≠ GateQ published policy
 *   a proposal ≠ a rule
 *
 * Closed-vocabulary; whether the mandate wants or rules out each mention
 * is a reading of meaning handed in (J7), never a list of negative words. A stage, country, region or sector
 * becomes a proposal only when Capital Q's own reference taxonomy names it;
 * anything else stays in the investor's words, where they read it. Nothing
 * here publishes: every proposal is a draft criterion the investor confirms,
 * edits or drops before a version carrying it is published, which is the
 * "material extracted facts need confirmation" rule made structural.
 *
 * Unknown stays unknown: a mandate that never mentions cheque size yields no
 * cheque criterion and an entry in `notFound`, never a default band. A
 * negated mention ("we don't do betting") is never read as an allow-list
 * entry; for sectors it is proposed as an exclusion the investor must
 * confirm, and for places it is reported, not guessed into a rule.
 */

/** One reference taxonomy node, as the reader needs it. */
export type MandateVocabularyNode = {
  readonly id: string;
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly displayName: string;
  readonly parentNodeId: string | null;
  /** ISO 3166-1 alpha-2 for a country node, otherwise null. */
  readonly iso2: string | null;
  /** Synonyms. Short ones (ISO codes, "VC") match case-sensitively. */
  readonly aliases: readonly string[];
};

export type MandateDimension = "STAGE" | "GEOGRAPHY" | "SECTOR" | "CHEQUE";

export type PolicyProposal = {
  readonly dimension: MandateDimension;
  readonly requiredness: CriterionRequiredness;
  readonly label: string;
  readonly config: CriterionConfig;
  /** Display names for each configured value, in config order. */
  readonly valueLabels: readonly string[];
  /** The investor's own sentence the proposal rests on. */
  readonly quote: string;
};

export type MandateReading = {
  readonly proposals: readonly PolicyProposal[];
  /** Dimensions the text never stated. Shown as "not in your mandate". */
  readonly notFound: readonly MandateDimension[];
  /** Places the text named negatively: reported, never turned into rules. */
  readonly excludedPlaces: readonly string[];
};

// v2 (J7): whether each mention is wanted or ruled out is read by meaning.
export const MANDATE_READER_VERSION = "gateq-mandate-reader.v2" as const;
export const MANDATE_TEXT_MAX_CHARS = 20_000;

export const SECTOR_VOCABULARY = "industry";
const STAGE_VOCABULARY = "company_stage";
const GEOGRAPHY_VOCABULARY = "geography";

/**
 * Whether the mandate wants each mention or rules it out, read by meaning
 * (founder brief J7, PREFERENCE_POLARITY), by the mention's position in
 * the normalised text. true: ruled out or avoided; false: wanted; null:
 * not read, or neither -- such a mention proposes nothing (unknown stays
 * unknown; a "we don't do betting" is never guessed into an allow-list).
 */
export type MentionPolarity = (index: number) => boolean | null;

type Hit = {
  readonly node: MandateVocabularyNode;
  readonly index: number;
  readonly negated: boolean | null;
};

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A hyphen inside a word reads as a space, so "pre-seed" is "pre seed".
 * Dashes between amounts or stages are kept: they are what makes a range.
 */
function normalise(text: string): string {
  return (
    text
      .replace(/(?<=[A-Za-z])[-‐‑](?=[A-Za-z])/g, " ")
      // A wrapped line is one sentence; a blank line still ends a paragraph.
      .replace(/(?<!\n)\n(?!\n)/g, " ")
      .replace(/[ \t]+/g, " ")
  );
}

/** Where a sentence ends: a full stop that is not a decimal point, or a break. */
const SENTENCE_END = /\.(?!\d)|[!?;\n]/g;

function sentenceAt(text: string, index: number): string {
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(SENTENCE_END)) {
    if (match.index < index) start = match.index + 1;
    else {
      end = match.index + 1;
      break;
    }
  }
  const sentence = text.slice(start, end).trim();
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

/**
 * Every mention of a vocabulary's nodes, longest phrase first, so "Series A"
 * is not also read as a stray "A" and "pre seed" is not also "seed".
 */
function findHits(
  text: string,
  nodes: readonly MandateVocabularyNode[],
  polarity: MentionPolarity,
): Hit[] {
  const phrases: {
    phrase: string;
    node: MandateVocabularyNode;
    exact: boolean;
  }[] = [];
  for (const node of nodes) {
    phrases.push({ phrase: node.displayName, node, exact: false });
    for (const alias of node.aliases) {
      // Two- and three-letter aliases are codes ("NG", "UK"): matching them
      // in lower case would read every "in" as India.
      phrases.push({ phrase: alias, node, exact: alias.length <= 3 });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  const taken: boolean[] = new Array<boolean>(text.length).fill(false);
  const hits: Hit[] = [];
  for (const { phrase, node, exact } of phrases) {
    const words = normalise(phrase).trim();
    if (words.length < 2) continue;
    const pattern = new RegExp(
      `(?<![A-Za-z0-9])${escape(words).replace(/ /g, "\\s+")}(?![A-Za-z0-9])`,
      exact ? "g" : "gi",
    );
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let i = start; i < end; i += 1) taken[i] = true;
      hits.push({
        node,
        index: start,
        negated: polarity(start),
      });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function readStages(
  text: string,
  nodes: readonly MandateVocabularyNode[],
  polarity: MentionPolarity,
): PolicyProposal | null {
  const hits = findHits(text, nodes, polarity).filter(
    (hit) => hit.negated === false,
  );
  if (hits.length === 0) return null;
  // Reference order is stage order (pre-seed → Series C+).
  const order = nodes.map((node) => node.canonicalCode);
  let codes = unique(hits.map((hit) => hit.node.canonicalCode));
  // "Pre-seed to Series A" means the stages between, too.
  for (let i = 0; i + 1 < hits.length; i += 1) {
    const a = hits[i];
    const b = hits[i + 1];
    if (a === undefined || b === undefined) continue;
    const between = text.slice(a.index, b.index);
    if (/\b(?:to|through|until)\b|–|—|\s-\s/i.test(between.slice(-24))) {
      const from = order.indexOf(a.node.canonicalCode);
      const to = order.indexOf(b.node.canonicalCode);
      if (from >= 0 && to > from) codes.push(...order.slice(from, to + 1));
    }
  }
  codes = unique(codes).sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const first = hits[0];
  return {
    dimension: "STAGE",
    requiredness: "REQUIRED",
    label: "Stage",
    config: { type: "STAGE", allowedStageCodes: codes },
    valueLabels: codes.map(
      (code) =>
        nodes.find((n) => n.canonicalCode === code)?.displayName ?? code,
    ),
    quote: first === undefined ? "" : sentenceAt(text, first.index),
  };
}

function countriesUnder(
  node: MandateVocabularyNode,
  nodes: readonly MandateVocabularyNode[],
): MandateVocabularyNode[] {
  if (node.iso2 !== null) return [node];
  return nodes
    .filter((child) => child.parentNodeId === node.id)
    .flatMap((child) => countriesUnder(child, nodes));
}

function readGeography(
  text: string,
  nodes: readonly MandateVocabularyNode[],
  polarity: MentionPolarity,
): { proposal: PolicyProposal | null; excluded: string[] } {
  const hits = findHits(text, nodes, polarity);
  const excluded = unique(
    hits
      .filter((hit) => hit.negated === true)
      .map((hit) => hit.node.displayName),
  );
  const allowed = hits.filter((hit) => hit.negated === false);
  // "Global" or "anywhere" is no geographic rule at all, not every country.
  if (
    allowed.length === 0 ||
    allowed.some((hit) => hit.node.canonicalCode === "global")
  ) {
    return { proposal: null, excluded };
  }
  const countries = unique(
    allowed.flatMap((hit) => countriesUnder(hit.node, nodes)),
  );
  if (countries.length === 0) return { proposal: null, excluded };
  const first = allowed[0];
  return {
    proposal: {
      dimension: "GEOGRAPHY",
      requiredness: "REQUIRED",
      label: "Where you're based",
      config: {
        type: "GEOGRAPHY",
        allowedCountries: countries
          .map((country) => country.iso2)
          .filter((iso): iso is string => iso !== null)
          .slice(0, 64),
      },
      valueLabels: countries.map((country) => country.displayName).slice(0, 64),
      quote: first === undefined ? "" : sentenceAt(text, first.index),
    },
    excluded,
  };
}

/** Only distinctive phrases: a four-letter word is too easily something else. */
function sectorNodes(
  nodes: readonly MandateVocabularyNode[],
): MandateVocabularyNode[] {
  return nodes.map((node) => ({
    ...node,
    aliases: node.aliases.filter((alias) => alias.length >= 4),
  }));
}

function readSectors(
  text: string,
  nodes: readonly MandateVocabularyNode[],
  polarity: MentionPolarity,
): PolicyProposal[] {
  const hits = findHits(text, sectorNodes(nodes), polarity);
  const proposals: PolicyProposal[] = [];
  const build = (
    selected: readonly Hit[],
    excluded: boolean,
  ): PolicyProposal | null => {
    const picked = unique(selected.map((hit) => hit.node)).slice(0, 64);
    const first = selected[0];
    if (picked.length === 0 || first === undefined) return null;
    const ids = picked.map((node) => node.id);
    return {
      dimension: "SECTOR",
      requiredness: "REQUIRED",
      label: excluded ? "Sectors we don't fund" : "Sector",
      config: excluded
        ? {
            type: "EXCLUDED_TAXONOMY",
            vocabularyCode: SECTOR_VOCABULARY,
            excludedNodeIds: ids,
          }
        : {
            type: "TAXONOMY",
            vocabularyCode: SECTOR_VOCABULARY,
            allowedNodeIds: ids,
          },
      valueLabels: picked.map((node) => node.displayName),
      quote: sentenceAt(text, first.index),
    };
  };
  const allowed = build(
    hits.filter((hit) => hit.negated === false),
    false,
  );
  if (allowed !== null) proposals.push(allowed);
  const excluded = build(
    hits.filter((hit) => hit.negated === true),
    true,
  );
  if (excluded !== null) proposals.push(excluded);
  return proposals;
}

const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  $: "USD",
  usd: "USD",
  us$: "USD",
  dollars: "USD",
  "€": "EUR",
  eur: "EUR",
  euros: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "₦": "NGN",
  ngn: "NGN",
  naira: "NGN",
  kes: "KES",
  zar: "ZAR",
};

const AMOUNT =
  /(\$|us\$|€|£|₦|usd|eur|gbp|ngn|kes|zar)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mn|million|thousand|bn)?\b\s?(usd|eur|gbp|ngn|kes|zar|dollars|euros|naira)?/gi;

type Amount = {
  readonly value: number;
  readonly currency: string | null;
  readonly index: number;
  readonly end: number;
};

function toDecimal(value: number): string {
  return Math.round(value).toString();
}

function readAmounts(text: string): Amount[] {
  const amounts: Amount[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const [, pre, digits, scale, post] = match;
    if (digits === undefined) continue;
    // A bare number with no currency and no scale is a year, a count, a
    // portfolio size: not money.
    if (pre === undefined && scale === undefined && post === undefined) {
      continue;
    }
    let value = Number(digits.replace(/,/g, ""));
    const unit = scale?.toLowerCase();
    if (unit === "k" || unit === "thousand") value *= 1_000;
    if (unit === "m" || unit === "mn" || unit === "million") value *= 1_000_000;
    if (unit === "bn") value *= 1_000_000_000;
    const symbol = (pre ?? post)?.toLowerCase();
    amounts.push({
      value,
      currency: symbol === undefined ? null : (CURRENCY_WORDS[symbol] ?? null),
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return amounts;
}

function readCheque(text: string): PolicyProposal | null {
  const cue =
    /\b(?:cheques?|checks?|tickets?|invest(?:s|ing)?|initial investment|first investment|write|writes|deploy)\b/gi;
  for (const cueMatch of text.matchAll(cue)) {
    const window = text.slice(cueMatch.index, cueMatch.index + 120);
    const stop = window.search(/\.(?!\d)|[;\n]/);
    const clause = stop > 0 ? window.slice(0, stop) : window;
    const amounts = readAmounts(clause);
    const first = amounts[0];
    if (first === undefined) continue;
    const second = amounts[1];
    const ranged =
      second !== undefined &&
      /^\s*(?:-|–|—|to|and)\s*$/i.test(clause.slice(first.end, second.index));
    const currency = first.currency ?? second?.currency ?? null;
    // No currency is unknown, not dollars.
    if (currency === null) continue;
    const upTo = /\b(?:up to|max(?:imum)?|at most)\s*$/i.test(
      clause.slice(0, first.index),
    );
    const min = upTo ? 0 : first.value;
    const max =
      ranged && second !== undefined ? second.value : upTo ? first.value : null;
    if (max !== null && max < min) continue;
    return {
      dimension: "CHEQUE",
      requiredness: "PREFERRED",
      label: "Cheque size",
      config: {
        type: "CHEQUE_COMPATIBILITY",
        currency,
        minCheque: toDecimal(min),
        maxCheque: max === null ? null : toDecimal(max),
      },
      valueLabels: [
        max === null
          ? `${currency} ${toDecimal(min)}+`
          : `${currency} ${toDecimal(min)}–${toDecimal(max)}`,
      ],
      quote: sentenceAt(text, cueMatch.index),
    };
  }
  return null;
}

/**
 * Every stage, place and sector the mandate names, with its sentence, for
 * the polarity reading (J7). The id is the mention's position, which is
 * what `readMandate` looks its polarity up by.
 */
export function mandateMentions(
  rawText: string,
  vocabulary: readonly MandateVocabularyNode[],
): readonly {
  readonly id: string;
  readonly term: string;
  readonly sentence: string;
}[] {
  const text = normalise(rawText.slice(0, MANDATE_TEXT_MAX_CHARS));
  const of = (code: string) =>
    vocabulary.filter((node) => node.vocabularyCode === code);
  const unread: MentionPolarity = () => null;
  const hits = [
    ...findHits(text, of(STAGE_VOCABULARY), unread),
    ...findHits(text, of(GEOGRAPHY_VOCABULARY), unread),
    ...findHits(text, sectorNodes(of(SECTOR_VOCABULARY)), unread),
  ];
  const seen = new Set<number>();
  return hits
    .filter((hit) => {
      if (seen.has(hit.index)) return false;
      seen.add(hit.index);
      return true;
    })
    .slice(0, 80)
    .map((hit) => ({
      id: String(hit.index),
      term: hit.node.displayName,
      sentence: sentenceAt(text, hit.index),
    }));
}

/**
 * Read one mandate: the same text, vocabulary and polarity reading give
 * the same draft. Without a reading every mention is unknown, and only
 * what needs no reading (a cheque band) is proposed.
 */
export function readMandate(
  rawText: string,
  vocabulary: readonly MandateVocabularyNode[],
  polarity: MentionPolarity = () => null,
): MandateReading {
  const text = normalise(rawText.slice(0, MANDATE_TEXT_MAX_CHARS));
  const of = (code: string) =>
    vocabulary.filter((node) => node.vocabularyCode === code);

  const stage = readStages(text, of(STAGE_VOCABULARY), polarity);
  const geography = readGeography(text, of(GEOGRAPHY_VOCABULARY), polarity);
  const sectors = readSectors(text, of(SECTOR_VOCABULARY), polarity);
  const cheque = readCheque(text);

  const proposals = [stage, geography.proposal, ...sectors, cheque].filter(
    (proposal): proposal is PolicyProposal => proposal !== null,
  );
  const found = new Set(proposals.map((proposal) => proposal.dimension));
  const notFound = (["STAGE", "GEOGRAPHY", "SECTOR", "CHEQUE"] as const).filter(
    (dimension) => !found.has(dimension),
  );
  return { proposals, notFound, excludedPlaces: geography.excluded };
}
