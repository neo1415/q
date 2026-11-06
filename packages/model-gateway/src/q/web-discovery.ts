import type { PublicSourceLike } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import { countryWords, stageWords } from "./named-company-fact.js";
import {
  namedIn,
  normalForm,
  onCompanySite,
  pageTiesPerson,
} from "./person-anchor.js";
import type { MandateCategories } from "./own-mandate-answer.js";
import type { WebDiscoveryReader } from "./web-discovery-reader.js";

/**
 * Web discovery (owner 2026-11-06, Savanna Seed Partners): "find me new
 * companies online and their founders" ran ONE search on the person's own
 * words, got directory pages and stopped, telling them to narrow by the
 * mandate Q already held. A capable analyst would read the mandate and go
 * and look. This is that, by code, through the existing tools:
 *
 *  1. a plan of 3-6 targeted public queries built from the mandate's (or
 *     the turn's) CATEGORIES -- sector, stage, geography -- with recent-time
 *     hints, run side by side through `research_public_web`;
 *  2. directory and list pages read further (`extract_public_web`), and
 *     the specific companies they name read out by WEB_DISCOVERY_READER;
 *  3. a second round per candidate for its founders;
 *  4. every company and founder name admitted only when it is on a page
 *     fetched in this run (nothing from model memory), deduped, and marked
 *     when it is already a canonical company on Capital Q through the
 *     authorised `search_companies` tool, never a table read;
 *  5. the answer composed by code: each company with founders, what it
 *     does, its fit to the mandate (unknown stays unknown) and its source
 *     links, labelled public web and unverified, with next steps offered
 *     for approval. No one is contacted.
 *
 * CONTEXT FIREWALL (outbound): a query is composed only from taxonomy
 * words, country names, fixed hint words and the year, and every query is
 * checked word by word against that vocabulary before it leaves
 * (`queryIsPublic`). A cheque size, a name, a figure or a note never
 * reaches a query. Round two searches a company's public name, read from
 * a public page in this run. The research tool composes its egress again
 * on its side.
 *
 * Bounded by the step 8 deep budget: at most Q_DEEP_TOOL_LOOP_MAX_CALLS
 * tool calls, no round started past the wall-clock budget, and the
 * reader's own model budget.
 */

export type WebDiscoveryAsk = NonNullable<QAnswerRequest["webDiscovery"]>;

const RESEARCH_TOOL = "research_public_web";
/** The call ids of discovery's own tool calls (code's, never a model's). */
export const DISCOVERY_CALL_PREFIX = "q-discovery-";
const EXTRACT_TOOL = "extract_public_web";
const SEARCH_COMPANIES_TOOL = "search_companies";

/** Queries in the first round. */
export const DISCOVERY_QUERIES = { min: 3, max: 4 } as const;
/** Companies listed with no number asked. */
export const DISCOVERY_DEFAULT_COUNT = 8;
export const DISCOVERY_MAX_COUNT = 10;
/** Tool calls the whole discovery may make (the deep loop's call cap). */
export const DISCOVERY_MAX_TOOL_CALLS = 16;
/**
 * Candidates searched for founders in round two: two to a call, so round
 * two is at most two research calls and the whole discovery at most five,
 * the research service's discovery budget per run.
 */
const FOUNDER_ROUND_MAX = 8;
/**
 * Pages each research call reads in full (spend: a page read is a paid
 * extract). A founder is usually named in a snippet or the first page.
 */
const ROUND_ONE_PAGES = 3;
const FOUNDER_ROUND_PAGES = 4;
/** Pages read further when a search returned only a snippet. */
const EXTRACT_MAX = 3;
/** No new round starts once this share of the budget is spent. */
const ROUND_CUTOFF = 0.7;
/**
 * Live 2026-11-06 (11180d8e6): eight companies listed, every one "founders
 * not named": round one and the page reads took past 60% of the 30 s deep
 * budget, so the founder round never started. A discovery is one errand
 * the person asked for and waits on (the visible stage says it is
 * searching); it gets its own wall clock, and the founder round may start
 * until 70% of it.
 */
export const DISCOVERY_BUDGET_MS = 45_000;
/**
 * Round 6 (live 2026-11-06 on f580935bb: one company listed after round
 * 4's filters): below this many, one more round with other angles runs.
 */
export const DISCOVERY_YIELD_FLOOR = 5;
/** Research calls one discovery makes: the research service's own budget. */
export const DISCOVERY_RESEARCH_CALLS_MAX = 6;

const STAGE_ORDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "growth",
] as const;

/** Fixed words a query may carry beside the categories and the year. */
const HINT_WORDS = [
  "startups",
  "startup",
  "new",
  "raised",
  "seed",
  "launches",
  "founders",
  "founder",
  "funding",
  "round",
  "founded",
  "launched",
  "to",
  "watch",
  "emerging",
  "accelerator",
  "cohort",
  "top",
] as const;

export type DiscoveryPlan = {
  /** The categories searched for, as words (for the answer and the reader). */
  readonly sectors: readonly string[];
  readonly places: readonly string[];
  readonly stages: readonly string[];
  /** Sector codes, country codes and stage codes, for fit. */
  readonly sectorCodes: readonly string[];
  readonly countryCodes: readonly string[];
  readonly stageCodes: readonly string[];
  readonly regionCodes: readonly string[];
  readonly queries: readonly string[];
  /** Some category came from the mandate (the turn did not name it). */
  readonly fromMandate: boolean;
  /** The turn itself named a sector, place or stage. */
  readonly askNamed: boolean;
};

const wordsOf = (code: string): string => code.replace(/_/gu, " ").trim();

function stageRange(min: string | null, max: string | null): string[] {
  const lo = min === null ? -1 : STAGE_ORDER.indexOf(min as never);
  const hi = max === null ? -1 : STAGE_ORDER.indexOf(max as never);
  if (lo < 0 && hi < 0) return [];
  const from = lo < 0 ? hi : lo;
  const to = hi < 0 ? lo : hi;
  return STAGE_ORDER.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Lower-case word tokens, for the outbound check. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * True when every word of the query is a category word, a hint word or the
 * year: nothing else can leave (CONTEXT FIREWALL for outbound queries).
 */
export function queryIsPublic(
  query: string,
  plan: Pick<DiscoveryPlan, "sectors" | "places" | "stages">,
  year: number,
): boolean {
  const allowed = new Set<string>([
    ...HINT_WORDS,
    String(year),
    String(year - 1),
    ...[...plan.sectors, ...plan.places, ...plan.stages].flatMap(tokens),
  ]);
  return tokens(query).every((token) => allowed.has(token));
}

/**
 * The query plan: the turn's own categories where it named any, else the
 * mandate's. Pure; the clock is passed in.
 */
export function planDiscovery(
  ask: WebDiscoveryAsk,
  mandate: MandateCategories | null,
  now: Date,
  /**
   * Round 4: a search for more, after a list in this conversation: other
   * angles (lists to watch, accelerators, seed funding), so the same pages
   * do not simply come back.
   */
  further = false,
): DiscoveryPlan {
  const year = now.getUTCFullYear();
  const askSectors = ask.sectors.filter((code) =>
    /^[a-z][a-z0-9_]{1,60}$/u.test(code),
  );
  const askCountries = ask.countries
    .filter((code) => /^[A-Za-z]{2}$/u.test(code))
    .map((code) => code.toUpperCase());
  const askStages = ask.stages
    .map((code) => code.toLowerCase())
    .filter((code) => /^[a-z][a-z0-9_]{1,40}$/u.test(code));
  const sectorCodes =
    askSectors.length > 0 ? askSectors : [...(mandate?.sectors ?? [])];
  const countryCodes =
    askCountries.length > 0 ? askCountries : [...(mandate?.countries ?? [])];
  const regionCodes = askCountries.length > 0 ? [] : (mandate?.regions ?? []);
  const stageCodes =
    askStages.length > 0
      ? askStages
      : mandate === null
        ? []
        : mandate.stages.length > 0
          ? [...mandate.stages]
          : stageRange(mandate.stageMin, mandate.stageMax);
  const fromMandate =
    mandate !== null &&
    (askSectors.length === 0 ||
      askCountries.length === 0 ||
      askStages.length === 0);
  const sectors = sectorCodes.slice(0, 3).map(wordsOf);
  const places = [
    ...countryCodes.slice(0, 3).map((code) => countryWords(code)),
    ...regionCodes.slice(0, 2).map(wordsOf),
  ].slice(0, 3);
  const stages = stageCodes.slice(0, 4).map((code) => stageWords(code));
  // The earliest stage reads best in a search ("pre-seed fintech startups").
  const stageWord = stages[0] ?? "";
  const join = (...parts: readonly string[]) =>
    parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" ");
  const categoryQueries: string[] = [];
  const sectorList = sectors.length > 0 ? sectors : [""];
  const placeList = places.length > 0 ? places : [""];
  // One query per sector and place, interleaved so every category is
  // searched before any is searched twice.
  for (let i = 0; i < Math.max(sectorList.length, placeList.length); i += 1) {
    const sector = sectorList[i % sectorList.length] ?? "";
    const place = placeList[i % placeList.length] ?? "";
    categoryQueries.push(
      join(sector, "startups", place, stageWord, String(year)),
    );
  }
  // Recency first (owner 2026-11-06: "NEW companies"; Jumo and M-Kopa are
  // long established): what was founded, launched or raised seed lately.
  const candidates: string[] = further
    ? [
        join(
          sectorList[0] ?? "",
          "startups to watch",
          placeList[0] ?? "",
          String(year),
        ),
        join(
          "emerging",
          sectorList[1] ?? sectorList[0] ?? "",
          "startups",
          placeList[1] ?? placeList[0] ?? "",
          String(year),
        ),
        join(
          sectorList[0] ?? "",
          "startup accelerator",
          placeList[2] ?? placeList[0] ?? "",
          String(year),
        ),
        join(
          sectorList[0] ?? "",
          "seed funding",
          placeList[0] ?? "",
          String(year - 1),
        ),
      ]
    : [...categoryQueries.slice(0, 1)];
  if (!further)
    candidates.push(
      join(
        "new",
        sectorList[0] ?? "",
        "startups founded",
        placeList[0] ?? "",
        String(year - 1),
      ),
      join(
        sectorList[1] ?? sectorList[0] ?? "",
        "startup raised seed",
        placeList[1] ?? placeList[0] ?? "",
        String(year),
      ),
      join(
        sectorList[0] ?? "",
        "startups launched",
        placeList[2] ?? placeList[0] ?? "",
        String(year),
      ),
      ...categoryQueries.slice(1),
    );
  const plan = { sectors, places, stages };
  const queries = [...new Set(candidates.map((q) => q.replace(/\s+/gu, " ")))]
    .filter((query) => tokens(query).length >= 3)
    .filter((query) => queryIsPublic(query, plan, year))
    .slice(0, DISCOVERY_QUERIES.max);
  return {
    sectors,
    places,
    stages,
    sectorCodes,
    countryCodes,
    stageCodes,
    regionCodes,
    queries,
    fromMandate,
    askNamed:
      askSectors.length > 0 || askCountries.length > 0 || askStages.length > 0,
  };
}

/**
 * Round 6: the top-up round's queries -- an accelerator cohort, then a list
 * per country -- none already sent, each checked like every other query.
 */
export function topUpQueries(
  plan: DiscoveryPlan,
  year: number,
  sent: readonly string[],
): string[] {
  const sectors = plan.sectors.length > 0 ? plan.sectors : [""];
  const places = plan.places.length > 0 ? plan.places : [""];
  const join = (...parts: readonly string[]) =>
    parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" ");
  const candidates = [
    join(
      sectors[0] ?? "",
      "startup accelerator cohort",
      places[0] ?? "",
      String(year),
    ),
    ...places.flatMap((place) =>
      sectors
        .slice(0, 2)
        .map((sector) => join("top", sector, "startups", place, String(year))),
    ),
  ];
  const already = new Set(sent.map((query) => query.toLowerCase()));
  return [...new Set(candidates)]
    .filter((query) => !already.has(query.toLowerCase()))
    .filter((query) => queryIsPublic(query, plan, year))
    .slice(0, 2);
}

// --- grounding -------------------------------------------------------------

// One form of names and the whole-word check, shared with person-anchor.ts.
export { namedIn, normalForm };

/** Most of a phrase's content words are on the page (a 5-letter stem). */
function supportedBy(phrase: string, text: string): boolean {
  const content = tokens(phrase).filter((token) => token.length >= 4);
  if (content.length === 0) return false;
  const hay = normalForm(text);
  const hits = content.filter((token) => hay.includes(token.slice(0, 5)));
  return hits.length / content.length >= 0.7;
}

export type FetchedSource = PublicSourceLike & {
  readonly excerpt: string;
  readonly extracted: boolean;
  /**
   * The research tool counted instruction-shaped passages on the page
   * (step 10). Such a page is never used to name a company: a page that
   * talks to Q is not a directory.
   */
  readonly risky?: boolean | undefined;
};

export type DiscoveredCompany = {
  readonly name: string;
  readonly founders: readonly string[];
  readonly does: string | null;
  readonly stage: string | null;
  readonly place: string | null;
  readonly sector: string | null;
  /** Pages fetched in this run that name it. */
  readonly sourceUrls: readonly string[];
  /** Already a canonical company on Capital Q (search_companies). */
  readonly onCapitalQ: boolean;
  /** The year a page says it was founded or launched; null when none does. */
  readonly founded?: number | null | undefined;
  /** The latest year a page says it raised money; null when none does. */
  readonly raised?: number | null | undefined;
};

type Proposed = {
  readonly name: string;
  readonly founders: readonly string[];
  readonly does: string | null;
  readonly sector: string | null;
  readonly stage: string | null;
  readonly place: string | null;
};

const pageText = (source: FetchedSource): string =>
  `${source.title ?? ""}\n${source.excerpt}`;

/**
 * A company's key across spellings of its name ("M-KOPA", "M Kopa"):
 * letters and digits only. Never used to admit a name, only to merge.
 */
export function companyKey(name: string): string {
  return normalForm(name).replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Code admits what the reader proposed: a company only when its name is on
 * a page fetched in this run; a founder only when a page that names the
 * company names them too; what it does, its stage and place only when the
 * page words support them (else unknown). Nothing a page does not carry
 * survives, whatever the reader wrote.
 */
export function admitDiscoveries(
  proposed: readonly Proposed[],
  sources: readonly FetchedSource[],
  known: readonly DiscoveredCompany[] = [],
): DiscoveredCompany[] {
  const out = new Map<string, DiscoveredCompany>(
    known.map((company) => [companyKey(company.name), company] as const),
  );
  for (const item of proposed) {
    const name = item.name.trim().slice(0, 120);
    const key = companyKey(name);
    if (key.length < 2) continue;
    const naming = sources.filter((source) => namedIn(name, pageText(source)));
    if (naming.length === 0) continue;
    const text = naming.map(pageText).join("\n");
    const founders = item.founders
      .map((founder) => founder.trim())
      .filter(
        (founder) =>
          founder.length >= 3 &&
          companyKey(founder) !== key &&
          // The same rule as any person Q holds against a record: the page
          // names the founder AND the company (person-anchor.ts).
          sources.some((source) =>
            pageTiesPerson(
              { text: pageText(source), domain: source.domain },
              { person: founder, company: name },
            ),
          ),
      );
    const stage =
      item.stage !== null && namedIn(item.stage, text) ? item.stage : null;
    const place =
      item.place !== null && namedIn(item.place, text) ? item.place : null;
    const sector =
      item.sector !== null && supportedBy(item.sector, text)
        ? item.sector
        : null;
    const does =
      item.does !== null && supportedBy(item.does, text) ? item.does : null;
    const prior = out.get(key);
    if (prior === undefined) {
      out.set(key, {
        name,
        founders: [...new Set(founders)].slice(0, 4),
        does,
        stage,
        place,
        sector,
        sourceUrls: naming.map((source) => source.url).slice(0, 4),
        onCapitalQ: false,
      });
    } else {
      const merged = [...prior.founders];
      for (const founder of founders) {
        if (!merged.some((f) => normalForm(f) === normalForm(founder))) {
          merged.push(founder);
        }
      }
      out.set(key, {
        ...prior,
        founders: merged.slice(0, 4),
        does: prior.does ?? does,
        stage: prior.stage ?? stage,
        place: prior.place ?? place,
        sector: prior.sector ?? sector,
        sourceUrls: [
          ...new Set([
            ...prior.sourceUrls,
            ...naming.map((source) => source.url),
          ]),
        ].slice(0, 4),
      });
    }
  }
  return [...out.values()];
}

/**
 * Live 2026-11-06: when the page reader fails, a reader failure must not
 * mean zero companies. A search result on a company's OWN site names it:
 * a run of words in the page title whose letters are exactly the site's
 * name ("About Kobo Harbour" on koboharbour.example, "Owo Rails | Payments
 * API" on owo-rails.com). A site named after its own title is also what
 * a publisher or a directory is, so the name must be corroborated: another
 * fetched page, on another domain, names it too. Deterministic, from
 * public page data only; what it finds still goes through
 * `admitDiscoveries`. It never names a founder or guesses what a company
 * does.
 */
export function namesFromCompanySites(
  sources: readonly FetchedSource[],
): Proposed[] {
  const found: Proposed[] = [];
  for (const source of sources) {
    if (source.risky === true || source.title === null) continue;
    const labels = source.domain
      .toLowerCase()
      .replace(/^www\./u, "")
      .split(".");
    const site = (labels[0] ?? "").replace(/[^a-z0-9]/gu, "");
    if (site.length < 3) continue;
    const words = source.title
      .split(/\s+/u)
      .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter((word) => word.length > 0);
    let best: string | null = null;
    for (let from = 0; from < words.length; from += 1) {
      for (let to = from + 1; to <= Math.min(words.length, from + 4); to += 1) {
        const span = words.slice(from, to).join(" ");
        const letters = span.toLowerCase().replace(/[^a-z0-9]/gu, "");
        if (letters === site && (best === null || span.length > best.length)) {
          best = span;
        }
      }
    }
    const name = best;
    const corroborated =
      name !== null &&
      sources.some(
        (other) =>
          other.risky !== true &&
          other.domain !== source.domain &&
          namedIn(name, pageText(other)),
      );
    if (name !== null && corroborated) {
      found.push({
        name,
        founders: [],
        does: null,
        sector: null,
        stage: null,
        place: null,
      });
    }
  }
  return found;
}

// --- what the pages say about one company ---------------------------------

/** A sentence of a page read in this run, with the page's site. */
export type PageSentence = {
  readonly text: string;
  readonly domain?: string | null | undefined;
};

/**
 * The sentences of the readable pages that name the company, and every
 * sentence of a page on the company's own site (it is about the company
 * whether or not a sentence repeats its name).
 */
function sentencesNaming(
  name: string,
  sources: readonly FetchedSource[],
  /** Other companies the pages name: a clause ends where one begins. */
  others: readonly string[] = [],
): PageSentence[] {
  return sources
    .filter((source) => source.risky !== true)
    .flatMap((source) => {
      const own = onCompanySite(source.domain, name);
      return pageText(source)
        .split(/(?<=[.!?])\s+|\n+/u)
        .filter((sentence) => own || namedIn(name, sentence))
        .map((sentence) => ({
          text: own ? sentence : clauseOf(name, sentence, others),
          domain: source.domain,
        }));
    });
}

/**
 * Round 4 (live 2026-11-06): a directory sentence names several companies
 * ("Aella, founded in 2019; Owo Rails, a pre-seed API founded in 2025…").
 * What it says about one of them runs from its name to the next company
 * the sentence names, so a year or a stage is never given to a neighbour.
 */
function clauseOf(
  name: string,
  sentence: string,
  others: readonly string[],
): string {
  // Lower-casing keeps every position, so the cut is exact.
  const lower = sentence.toLowerCase();
  const at = lower.indexOf(name.toLowerCase());
  if (at < 0) return sentence;
  const from = at + name.length;
  let end = sentence.length;
  for (const other of others) {
    if (other.length < 2 || companyKey(other) === companyKey(name)) continue;
    const next = lower.indexOf(other.toLowerCase(), from);
    if (next >= 0 && next < end) end = next;
  }
  return sentence.slice(at, end);
}

const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+){1,3}`;
/** How public pages state who founded or leads a company. */
const FOUNDER_SAID: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:co-?)?founded(?:\s+in\s+[\p{L}\p{N}]+)?\s+by\s+(${NAME})(?:,?\s+(?:and|&)\s+(${NAME}))?`,
    "gu",
  ),
  new RegExp(
    String.raw`\b(?:co-?founders?|founders?)\s+(?:are\s+|include\s+)?(${NAME})(?:,?\s+(?:and|&)\s+(${NAME}))?`,
    "gu",
  ),
  new RegExp(
    String.raw`\b(?:CEO|chief\s+executive|co-?founder|founder)(?:\s+and\s+(?:CEO|CTO|COO))?,?\s+(${NAME})`,
    "gu",
  ),
  new RegExp(
    String.raw`(${NAME}),?\s+(?:its\s+|the\s+)?(?:co-?founder|founder|CEO|chief\s+executive)\b`,
    "gu",
  ),
];
/** Words that make a capitalised phrase an organisation, place or title. */
const NOT_A_PERSON = new Set([
  "the",
  "our",
  "its",
  "his",
  "her",
  "their",
  "this",
  "ltd",
  "inc",
  "limited",
  "group",
  "bank",
  "capital",
  "ventures",
  "partners",
  "fund",
  "africa",
  "series",
  "seed",
  "startup",
  "startups",
  "company",
  "ceo",
  "cto",
  "coo",
  "founder",
  "co-founder",
  "chief",
  "executive",
]);

/**
 * Founders a sentence that names the company states ("founded by X and
 * Y", "CEO X", "X, its co-founder"): public page text only, and only in a
 * sentence that also names the company, so the person is tied to it
 * (person-anchor.ts). Used when the reader named none.
 */
export function foundersStated(
  company: string,
  sentences: readonly (string | PageSentence)[],
): string[] {
  const found: string[] = [];
  for (const said of sentences) {
    const sentence = typeof said === "string" ? said : said.text;
    const domain = typeof said === "string" ? null : (said.domain ?? null);
    for (const pattern of FOUNDER_SAID) {
      for (const match of sentence.matchAll(pattern)) {
        for (const raw of match.slice(1)) {
          if (raw === undefined) continue;
          const name = raw.trim();
          const words = name.split(/\s+/u);
          if (
            words.length < 2 ||
            words.some((word) => NOT_A_PERSON.has(word.toLowerCase())) ||
            namedIn(company, name) ||
            namedIn(name, company) ||
            !pageTiesPerson(
              { text: sentence, domain },
              { person: name, company },
            )
          ) {
            continue;
          }
          if (!found.some((known) => companyKey(known) === companyKey(name))) {
            found.push(name);
          }
        }
      }
    }
  }
  return found.slice(0, 4);
}

/**
 * The year a sentence that names the company says it was founded or
 * launched, and the latest year it says it raised money. Only years the
 * pages state; never inferred from a page's date.
 */
export function yearsStated(
  sentences: readonly (string | PageSentence)[],
  now: Date,
): { readonly founded: number | null; readonly raised: number | null } {
  const thisYear = now.getUTCFullYear();
  const texts = sentences.map((said) =>
    typeof said === "string" ? said : said.text,
  );
  const yearIn = (pattern: RegExp): number[] =>
    texts.flatMap((sentence) =>
      [...sentence.matchAll(pattern)]
        .map((match) => Number(match[1]))
        .filter((year) => year >= 1990 && year <= thisYear),
    );
  const founded = yearIn(
    /\b(?:founded|launched|established|started|incorporated)\b[^.;]{0,40}?\b((?:19|20)\d{2})\b/giu,
  );
  const raised = yearIn(
    /\b(?:raised|raises|secured|closed|announced)\b[^.;]{0,80}?\b(20\d{2})\b/giu,
  );
  return {
    founded: founded.length === 0 ? null : Math.min(...founded),
    raised: raised.length === 0 ? null : Math.max(...raised),
  };
}

/**
 * Fills what the reader left unknown from the sentences that name the
 * company, on any page read in this run (the listing, its own site, the
 * founder round's pages): founders, the founded and funding years, and
 * the searched sector and place when those sentences state them.
 */
export function enrichFromPages(
  company: DiscoveredCompany,
  sources: readonly FetchedSource[],
  plan: Pick<DiscoveryPlan, "sectors" | "places">,
  now: Date,
  others: readonly string[] = [],
): DiscoveredCompany {
  const sentences = sentencesNaming(company.name, sources, others);
  if (sentences.length === 0) return company;
  const text = sentences.map((sentence) => sentence.text).join(" ");
  const years = yearsStated(sentences, now);
  const founders =
    company.founders.length > 0
      ? company.founders
      : foundersStated(company.name, sentences);
  return {
    ...company,
    founders,
    sector:
      company.sector ??
      plan.sectors.find((sector) => namedIn(sector, text)) ??
      null,
    place:
      company.place ??
      plan.places.find((place) => namedIn(place, text)) ??
      null,
    founded: company.founded ?? years.founded,
    raised: company.raised ?? years.raised,
    // Round 4: the stage its own clause states ("raised a seed round").
    stage: company.stage ?? stageStated(text),
  };
}

const STAGE_NAMES: Readonly<Record<string, string>> = {
  pre_seed: "pre-seed",
  seed: "seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
  growth: "growth",
};

/** The funding stage a company's own clause states, as words; else null. */
function stageStated(text: string): string | null {
  const found = STAGE_SAID.find(([pattern]) => pattern.test(text));
  return found === undefined ? null : (STAGE_NAMES[found[1]] ?? null);
}

/** Generic words a list, a directory or a media name ends with. */
const LISTING_WORDS = new Set([
  "startups",
  "startup",
  "companies",
  "businesses",
  "founders",
  "investors",
  "list",
  "lists",
  "directory",
  "news",
  "digest",
  "magazine",
  "weekly",
]);

/**
 * Round 4 (live 2026-11-06: "African startups · raised in 2026" was the
 * african-startups.com directory): a name is a listing, not a company,
 * when it ends with a generic plural ("… startups", "… companies"),
 * starts with a ranking ("Top 10 …"), is a page's own title, or is the
 * site name of a page that names other companies (a directory's own name).
 * Over public page text and the reader's proposals, never anyone's words.
 */
export function isListingName(
  name: string,
  sources: readonly FetchedSource[],
  candidates: readonly string[],
): boolean {
  const words = normalForm(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (LISTING_WORDS.has(last)) return true;
  if (words[0] === "top" || /^\d+$/u.test(words[0] ?? "")) return true;
  const key = companyKey(name);
  return sources.some((source) => {
    if (source.title !== null && companyKey(source.title) === key) return true;
    if (!onCompanySite(source.domain, name)) return false;
    const text = pageText(source);
    const othersNamed = candidates.filter(
      (other) => companyKey(other) !== key && namedIn(other, text),
    );
    return othersNamed.length >= 2;
  });
}

/**
 * The companies and founders Q listed in its own earlier discovery replies
 * in this conversation ("1. **Numida** · founded 2022 — Founders: A and
 * B."), read from Q's own composed lines, never from the person's words.
 */
export function priorListings(
  qReplies: readonly string[],
): { readonly name: string; readonly founders: readonly string[] }[] {
  const out: { name: string; founders: string[] }[] = [];
  for (const reply of qReplies) {
    for (const line of reply.split("\n")) {
      const item = /^\d+\.\s+\*\*(.+?)\*\*(.*)$/u.exec(line.trim());
      if (item === null) continue;
      const name = (item[1] ?? "").trim();
      if (name.length < 2) continue;
      const said = /Founders: (.+?)\.(?:\s|$)/u.exec(item[2] ?? "");
      const founders =
        said === null
          ? []
          : (said[1] ?? "")
              .split(/,\s*|\s+and\s+/u)
              .map((founder) => founder.trim())
              .filter((founder) => founder.length > 2);
      if (!out.some((known) => companyKey(known.name) === companyKey(name))) {
        out.push({ name, founders });
      }
    }
  }
  return out;
}

// --- fit ---------------------------------------------------------------

export type DiscoveryFit = {
  readonly sector: "MATCH" | "UNKNOWN";
  readonly stage: "MATCH" | "OUTSIDE" | "UNKNOWN";
  readonly place: "MATCH" | "UNKNOWN";
  readonly line: string;
};

const STAGE_SAID: readonly (readonly [RegExp, string])[] = [
  [/\bpre[\s-]?seed\b/iu, "pre_seed"],
  [/\bseed\b/iu, "seed"],
  [/\bseries\s*a\b/iu, "series_a"],
  [/\bseries\s*b\b/iu, "series_b"],
  [/\bseries\s*c\b/iu, "series_c"],
  [/\bgrowth\b/iu, "growth"],
];

/**
 * Its fit to what was searched, from the page words admitted above only:
 * a category the pages do not state stays unknown, never a mismatch.
 */
export function discoveryFit(
  company: DiscoveredCompany,
  plan: DiscoveryPlan,
): DiscoveryFit {
  const about = [company.sector, company.does, company.name]
    .filter((part): part is string => part !== null)
    .join(" ");
  const sectorHit = plan.sectors.find((sector) => namedIn(sector, about));
  const stageCode =
    company.stage === null
      ? null
      : (STAGE_SAID.find(([pattern]) =>
          pattern.test(company.stage ?? ""),
        )?.[1] ?? null);
  const stage: DiscoveryFit["stage"] =
    stageCode === null
      ? "UNKNOWN"
      : plan.stageCodes.length === 0 || plan.stageCodes.includes(stageCode)
        ? "MATCH"
        : "OUTSIDE";
  const placeHit =
    company.place === null
      ? undefined
      : plan.places.find(
          (place) =>
            namedIn(place, company.place ?? "") ||
            namedIn(company.place ?? "", place),
        );
  const parts = [
    sectorHit !== undefined
      ? sectorHit
      : plan.sectors.length === 0
        ? null
        : `sector ${company.sector === null ? "not stated" : `"${company.sector}"`}`,
    stage === "UNKNOWN"
      ? plan.stages.length === 0
        ? null
        : "stage unknown"
      : stage === "MATCH"
        ? (company.stage ?? null)
        : `${company.stage ?? ""} (outside your stages)`,
    placeHit !== undefined
      ? placeHit
      : company.place !== null
        ? company.place
        : plan.places.length === 0
          ? null
          : "location unknown",
  ].filter((part): part is string => part !== null && part.length > 0);
  return {
    sector: sectorHit === undefined ? "UNKNOWN" : "MATCH",
    stage,
    place: placeHit === undefined ? "UNKNOWN" : "MATCH",
    line: parts.join(" · "),
  };
}

// --- the run -------------------------------------------------------------

export type WebDiscoveryAnswer = {
  readonly text: string;
  readonly outcome: "FOUND" | "NONE" | "UNAVAILABLE";
  /** The page reader failed and the companies came from the fallback only. */
  readonly readerFailed: boolean;
  readonly companies: readonly DiscoveredCompany[];
  /** Every page a listed company stands on, for the Sources block. */
  readonly sources: readonly PublicSourceLike[];
  readonly queries: readonly string[];
  readonly founderQueries: readonly string[];
  readonly toolCalls: number;
  readonly calls: readonly QToolCallOutcome[];
};

type ResearchData = {
  readonly status?: unknown;
  readonly sources?: readonly {
    readonly url?: unknown;
    readonly domain?: unknown;
    readonly title?: unknown;
    readonly publishedAt?: unknown;
    readonly retrievedAt?: unknown;
    readonly excerpt?: unknown;
    readonly extracted?: unknown;
    readonly instructionRiskSignals?: unknown;
  }[];
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function sourcesOf(outcome: QToolCallOutcome): {
  readonly status: string | null;
  readonly sources: FetchedSource[];
} {
  if (!outcome.result.ok) return { status: null, sources: [] };
  const data = outcome.result.data as ResearchData;
  const sources: FetchedSource[] = [];
  for (const source of data.sources ?? []) {
    const url = str(source.url);
    const domain = str(source.domain);
    const retrievedAt = str(source.retrievedAt);
    if (url === null || domain === null || retrievedAt === null) continue;
    sources.push({
      index: 0,
      url,
      domain,
      title: str(source.title),
      publishedAt: str(source.publishedAt),
      retrievedAt,
      excerpt: typeof source.excerpt === "string" ? source.excerpt : "",
      extracted: source.extracted === true,
      risky:
        typeof source.instructionRiskSignals === "number" &&
        source.instructionRiskSignals > 0,
    });
  }
  return {
    status: typeof data.status === "string" ? data.status : null,
    sources,
  };
}

function listOf(items: readonly string[], joiner = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1] ?? ""}`;
}

function lookingLine(plan: DiscoveryPlan): string {
  const parts = [
    plan.sectors.length > 0 ? listOf(plan.sectors, "or") : null,
    plan.stages.length > 0
      ? plan.stages.length > 2
        ? `${plan.stages[0] ?? ""} to ${plan.stages[plan.stages.length - 1] ?? ""}`
        : listOf(plan.stages, "or")
      : null,
    plan.places.length > 0 ? listOf(plan.places, "or") : null,
  ].filter((part): part is string => part !== null && part.length > 0);
  return parts.join("; ");
}

/** What was searched for, as a phrase ("fintech companies in Nigeria"). */
function lookingPhrase(plan: DiscoveryPlan): string | null {
  if (
    plan.sectors.length === 0 &&
    plan.stages.length === 0 &&
    plan.places.length === 0
  ) {
    return null;
  }
  const sectors =
    plan.sectors.length > 0 ? `${listOf(plan.sectors, "or")} ` : "";
  const stages =
    plan.stages.length === 0
      ? ""
      : plan.stages.length > 2
        ? ` at ${plan.stages[0] ?? ""} to ${plan.stages[plan.stages.length - 1] ?? ""}`
        : ` at ${listOf(plan.stages, "or")}`;
  const places =
    plan.places.length > 0 ? ` in ${listOf(plan.places, "or")}` : "";
  return `${sectors}companies${stages}${places}`;
}

/**
 * Runs the discovery through the run's own tool port (authorise, Context
 * Firewall, egress composition and the research breakers all apply).
 * Null when the research tool is not offered to this run: the caller then
 * keeps its ordinary path.
 */
export async function runWebDiscovery(input: {
  readonly ask: WebDiscoveryAsk;
  readonly mandate: MandateCategories | null;
  readonly tools: QToolPort;
  readonly context: QToolExecutionContext;
  readonly available: ReadonlySet<string>;
  readonly reader: WebDiscoveryReader;
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  readonly now?: (() => number) | undefined;
  readonly budgetMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  /**
   * Round 4: the companies (and founders) Q already listed in this
   * conversation (`priorListings`). "More" is new companies only.
   */
  readonly alreadyListed?:
    | readonly { readonly name: string; readonly founders: readonly string[] }[]
    | undefined;
}): Promise<WebDiscoveryAnswer | null> {
  if (!input.available.has(RESEARCH_TOOL)) return null;
  const now = input.now ?? Date.now;
  const started = now();
  const budgetMs = input.budgetMs ?? DISCOVERY_BUDGET_MS;
  const roundMayStart = () => now() - started < budgetMs * ROUND_CUTOFF;
  const prior = input.alreadyListed ?? [];
  const priorKeys = new Set(prior.map((one) => companyKey(one.name)));
  const plan = planDiscovery(
    input.ask,
    input.mandate,
    new Date(now()),
    prior.length > 0,
  );
  const calls: QToolCallOutcome[] = [];
  let callsLeft = DISCOVERY_MAX_TOOL_CALLS;
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<QToolCallOutcome | null> => {
    if (callsLeft <= 0) return null;
    callsLeft -= 1;
    const outcome = await input.tools
      .execute(
        {
          callId: `${DISCOVERY_CALL_PREFIX}${String(DISCOVERY_MAX_TOOL_CALLS - callsLeft)}`,
          name,
          arguments: args,
        },
        input.context,
      )
      .catch(() => null);
    if (outcome !== null) calls.push(outcome);
    return outcome;
  };
  const fetched = new Map<string, FetchedSource>();
  const keep = (sources: readonly FetchedSource[]): FetchedSource[] => {
    const fresh: FetchedSource[] = [];
    for (const source of sources) {
      const prior = fetched.get(source.url);
      if (prior === undefined) {
        fetched.set(source.url, source);
        fresh.push(source);
      } else if (source.excerpt.length > prior.excerpt.length) {
        fetched.set(source.url, {
          ...source,
          extracted: true,
          risky: source.risky === true || prior.risky === true,
        });
      }
    }
    return fresh;
  };
  let unavailable = 0;
  let answered = 0;
  let researchCalls = 0;
  const sentQueries: string[] = [];
  // The categories travel as codes: the research tool admits only real
  // taxonomy categories and ISO countries, by their public names, so the
  // mandate's categories reach the query although the person never said
  // them (egress.ts lets out only their own words otherwise).
  const categories = {
    sectors: plan.sectorCodes.slice(0, 6),
    countries: plan.countryCodes.slice(0, 6),
    stages: plan.stageCodes.slice(0, 6),
    regions: plan.regionCodes.slice(0, 6),
  };
  const research = async (
    queries: readonly string[],
    maxSources: number,
    pageNames?: readonly string[],
  ) => {
    const [query, ...also] = queries;
    if (query === undefined) return;
    if (researchCalls >= DISCOVERY_RESEARCH_CALLS_MAX) return;
    researchCalls += 1;
    sentQueries.push(...queries);
    const outcome = await call(RESEARCH_TOOL, {
      target: "GENERAL",
      query,
      ...(also.length === 0 ? {} : { alsoSearch: also }),
      maxSources,
      categories,
      // Round two: the companies' names, as the pages of this run wrote
      // them; the research tool searches a name only if it was there.
      ...(pageNames === undefined || pageNames.length === 0
        ? {}
        : { pageNames }),
    });
    if (outcome === null) return;
    const read = sourcesOf(outcome);
    if (read.status === "PROVIDER_UNAVAILABLE" || !outcome.result.ok) {
      unavailable += 1;
      return;
    }
    answered += 1;
    keep(read.sources);
  };

  // Round 1: the plan's queries, two to a call. The first call goes alone
  // and the rest side by side once it has landed: a refused or spent key
  // (ScrapingBee 401, Serper 402 live 2026-11-06, each asked five times
  // by calls already in flight) then rests behind its breaker before the
  // others start, and is skipped by them.
  const pairs: string[][] = [];
  for (let i = 0; i < plan.queries.length; i += 2) {
    pairs.push(plan.queries.slice(i, i + 2));
  }
  const [probe, ...others] = pairs;
  if (probe !== undefined) await research(probe, ROUND_ONE_PAGES);
  await Promise.all(others.map((pair) => research(pair, ROUND_ONE_PAGES)));
  if (answered === 0) {
    return {
      text:
        unavailable > 0
          ? "I tried to search the public web for companies that fit, but the search providers weren't available just now, so I have no public results to give you. Ask me again in a few minutes and I'll run it."
          : "I searched the public web for companies that fit, but the searches came back empty, so I have nothing specific I can put in front of you.",
      outcome: unavailable > 0 ? "UNAVAILABLE" : "NONE",
      readerFailed: false,
      companies: [],
      sources: [],
      queries: plan.queries,
      founderQueries: [],
      toolCalls: DISCOVERY_MAX_TOOL_CALLS - callsLeft,
      calls,
    };
  }

  // Directory and list pages that came back as a snippet only are read in
  // full, so the companies they name are in front of the reader.
  const shallow = [...fetched.values()]
    .filter((source) => !source.extracted)
    .slice(0, EXTRACT_MAX)
    .map((source) => source.url);
  if (
    shallow.length > 0 &&
    roundMayStart() &&
    input.available.has(EXTRACT_TOOL)
  ) {
    const outcome = await call(EXTRACT_TOOL, { urls: shallow });
    if (outcome !== null) {
      for (const source of sourcesOf(outcome).sources) {
        const prior = fetched.get(source.url);
        if (
          prior === undefined ||
          source.excerpt.length > prior.excerpt.length
        ) {
          fetched.set(source.url, {
            ...source,
            extracted: true,
            risky: source.risky === true || prior?.risky === true,
          });
        }
      }
    }
  }

  const looking = lookingLine(plan);
  const readable = () =>
    [...fetched.values()].filter((source) => source.risky !== true);
  const firstPages = readable();
  const proposed = await input.reader({
    looking:
      looking.length === 0 ? "new companies and their founders" : looking,
    sources: firstPages,
    attribution: input.attribution,
    signal: input.signal,
  });
  // The reader failing is never zero companies: the results on companies'
  // own sites name them (deterministic, admitted the same way).
  const readerFailed = proposed === null;
  const firstProposed = [
    ...(proposed ?? []),
    ...namesFromCompanySites(firstPages),
  ];
  const candidateNames = firstProposed.map((item) => item.name);
  let droppedListings = 0;
  const today = new Date(now());
  const thisYear = today.getUTCFullYear();
  // Round 4: a listing is not a company; what this conversation already
  // listed is not new; a company a page says is over 8 years old is not
  // new either. What the pages say is read before the founder round, so
  // its searches go to the companies still without a founder.
  let excludedPrior = 0;
  let droppedOld = 0;
  const priorFounders = new Map(
    prior.map((one) => [companyKey(one.name), one.founders] as const),
  );
  const settle = (list: readonly DiscoveredCompany[]): DiscoveredCompany[] =>
    list
      .map((company) =>
        enrichFromPages(company, readable(), plan, today, candidateNames),
      )
      .map((company) => {
        const known = priorFounders.get(companyKey(company.name));
        return company.founders.length === 0 &&
          known !== undefined &&
          known.length > 0
          ? { ...company, founders: [...known] }
          : company;
      })
      .filter((company) => {
        const old =
          company.founded !== null &&
          company.founded !== undefined &&
          company.founded < thisYear - 8;
        if (old) droppedOld += 1;
        return !old;
      });
  const admitRound = (
    items: readonly Proposed[],
    pages: readonly FetchedSource[],
    known: readonly DiscoveredCompany[],
  ): DiscoveredCompany[] => {
    const knownKeys = new Set(known.map((company) => companyKey(company.name)));
    return admitDiscoveries(items, pages).filter((company) => {
      const key = companyKey(company.name);
      if (knownKeys.has(key)) return false;
      if (isListingName(company.name, pages, candidateNames)) {
        droppedListings += 1;
        return false;
      }
      if (priorKeys.has(key)) {
        excludedPrior += 1;
        return false;
      }
      return true;
    });
  };
  let companies = settle(admitRound(firstProposed, firstPages, []));

  // Round 6: a yield floor. Round one's pages may name mostly lists and
  // long-established companies; below the floor, one more round with
  // other angles (an accelerator cohort, a list per country) runs while
  // the budget allows, and what it finds is admitted the same way.
  if (
    companies.length < DISCOVERY_YIELD_FLOOR &&
    roundMayStart() &&
    researchCalls < DISCOVERY_RESEARCH_CALLS_MAX
  ) {
    const extra = topUpQueries(plan, thisYear, sentQueries);
    if (extra.length > 0) {
      const before = new Set(fetched.keys());
      await research(extra, ROUND_ONE_PAGES);
      const newPages = readable().filter((source) => !before.has(source.url));
      if (newPages.length > 0) {
        const more = await input.reader({
          looking:
            looking.length === 0 ? "new companies and their founders" : looking,
          sources: newPages,
          attribution: input.attribution,
          signal: input.signal,
        });
        const items = [...(more ?? []), ...namesFromCompanySites(newPages)];
        candidateNames.push(...items.map((item) => item.name));
        companies = [
          ...companies,
          ...settle(admitRound(items, readable(), companies)),
        ];
      }
    }
  }

  // Round 2: founders for the candidates the pages left without one.
  const count = Math.min(
    input.ask.count ?? DISCOVERY_DEFAULT_COUNT,
    DISCOVERY_MAX_COUNT,
  );
  const founderQueries: string[] = [];
  const needFounders = companies
    .filter((company) => company.founders.length === 0)
    .slice(0, Math.min(FOUNDER_ROUND_MAX, count));
  if (needFounders.length > 0 && roundMayStart()) {
    const before = new Set(fetched.keys());
    const asks = needFounders.map((company) => `${company.name} founder CEO`);
    founderQueries.push(...asks);
    const founderPairs: string[][] = [];
    for (let i = 0; i < asks.length; i += 2) {
      founderPairs.push(asks.slice(i, i + 2));
    }
    // Within the research budget the top-up may have used.
    await Promise.all(
      founderPairs
        .slice(0, Math.max(0, DISCOVERY_RESEARCH_CALLS_MAX - researchCalls))
        .map((pair) =>
          research(
            pair,
            FOUNDER_ROUND_PAGES,
            pair.map((ask) => ask.replace(/ founder CEO$/u, "")),
          ),
        ),
    );
    const newPages = readable().filter((source) => !before.has(source.url));
    if (newPages.length > 0) {
      const more =
        (await input.reader({
          looking: `the founders of ${listOf(
            needFounders.map((company) => company.name),
          )}`,
          sources: newPages,
          attribution: input.attribution,
          signal: input.signal,
        })) ?? [];
      // Only founders of companies already found: round two never adds a
      // company the discovery round did not.
      const wanted = new Set(companies.map((c) => companyKey(c.name)));
      companies = admitDiscoveries(
        more.filter((item) => wanted.has(companyKey(item.name))),
        readable(),
        companies,
      );
    }
  }

  // What the founder round's pages say, read the same way (droppedOld
  // counts each company once: what round one dropped is gone).
  companies = settle(companies);

  // Ranked: new first (owner 2026-11-06: "NEW companies"), then fit to what
  // was searched, then founders known, then found first.
  const recency = (company: DiscoveredCompany): number =>
    (company.founded !== null && company.founded !== undefined
      ? company.founded >= thisYear - 3
        ? 3
        : company.founded < thisYear - 8
          ? -4
          : 0
      : 0) +
    (company.raised !== null &&
    company.raised !== undefined &&
    company.raised >= thisYear - 1
      ? 2
      : 0);
  const fits = new Map(
    companies.map((company) => [company.name, discoveryFit(company, plan)]),
  );
  const score = (company: DiscoveredCompany): number => {
    const fit = fits.get(company.name);
    return (
      (fit?.sector === "MATCH" ? 4 : 0) +
      (fit?.place === "MATCH" ? 2 : 0) +
      (fit?.stage === "MATCH" ? 1 : fit?.stage === "OUTSIDE" ? -3 : 0) +
      (company.founders.length > 0 ? 1 : 0) +
      recency(company)
    );
  };
  const listed = companies
    .map((company, order) => ({ company, order }))
    .sort((a, b) => score(b.company) - score(a.company) || a.order - b.order)
    .map(({ company }) => company)
    .slice(0, count);

  // Which are already canonical companies on Capital Q: the authorised
  // search, never a table read; a name match on its canonical name only.
  const marked = await Promise.all(
    listed.map(async (company) => {
      if (!input.available.has(SEARCH_COMPANIES_TOOL)) return company;
      const outcome = await call(SEARCH_COMPANIES_TOOL, {
        query: company.name.slice(0, 100),
        limit: 3,
      });
      if (outcome === null || !outcome.result.ok) return company;
      const items =
        (
          outcome.result.data as {
            readonly items?: readonly { readonly canonicalName?: unknown }[];
          }
        ).items ?? [];
      const onCapitalQ = items.some(
        (item) =>
          typeof item.canonicalName === "string" &&
          normalForm(item.canonicalName) === normalForm(company.name),
      );
      return onCapitalQ ? { ...company, onCapitalQ } : company;
    }),
  );

  const sources: PublicSourceLike[] = [];
  const urls = [...new Set(marked.flatMap((company) => company.sourceUrls))];
  for (const url of urls) {
    const source = fetched.get(url);
    if (source === undefined) continue;
    sources.push({
      index: sources.length + 1,
      url: source.url,
      domain: source.domain,
      title: source.title,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
    });
  }

  return {
    text: discoveryAnswerText(marked, plan, fetched, readerFailed, {
      further: prior.length > 0,
      excludedPrior,
      droppedOld,
      droppedListings,
    }),
    outcome: marked.length > 0 ? "FOUND" : "NONE",
    readerFailed,
    companies: marked,
    sources,
    queries: plan.queries,
    founderQueries,
    toolCalls: DISCOVERY_MAX_TOOL_CALLS - callsLeft,
    calls,
  };
}

/** The answer, composed by code from what was admitted. */
export function discoveryAnswerText(
  companies: readonly DiscoveredCompany[],
  plan: DiscoveryPlan,
  fetched: ReadonlyMap<string, FetchedSource>,
  /** The page reader failed; what is listed came from the results alone. */
  readerFailed = false,
  /** Round 4: a search for more, and what was left out and why. */
  left: {
    readonly further: boolean;
    readonly excludedPrior: number;
    readonly droppedOld: number;
    readonly droppedListings?: number | undefined;
  } = { further: false, excludedPrior: 0, droppedOld: 0 },
): string {
  const looking = lookingPhrase(plan);
  const against =
    looking === null
      ? ""
      : plan.fromMandate && !plan.askNamed
        ? ` against your mandate (${looking})`
        : ` for ${looking}`;
  const searched = left.further
    ? `I searched the public web further${against}`
    : `I searched the public web${against}`;
  const oldLine =
    left.droppedOld === 0
      ? ""
      : ` I left out ${String(left.droppedOld)} that the sources say were founded more than 8 years ago.`;
  if (companies.length === 0 && left.excludedPrior > 0) {
    return `${searched}, but the pages I read only named companies I've already listed in this conversation, so there's nothing new to add.${oldLine} I can try a different angle -- a specific city, a sub-sector or a recent accelerator batch -- if you'd like.`;
  }
  if (companies.length === 0 && readerFailed) {
    return `I searched the public web${against} and found pages to read, but I couldn't read them in time just now, so I won't guess at names. Ask me again in a moment and I'll read them again.`;
  }
  if (companies.length === 0) {
    return `I searched the public web${against}, but the pages I could read didn't name specific companies I could stand behind, so I won't guess. I can search again with a different angle (a city, a sub-sector or a recent accelerator batch) if you'd like.`;
  }
  const lines = companies.map((company, index) => {
    const fit = discoveryFit(company, plan);
    const founders =
      company.founders.length > 0
        ? `Founders: ${listOf([...company.founders])}`
        : "founders not named in the sources I read";
    const when =
      company.founded !== null && company.founded !== undefined
        ? ` · founded ${String(company.founded)}`
        : company.raised !== null && company.raised !== undefined
          ? ` · raised in ${String(company.raised)}`
          : "";
    const does =
      company.does === null
        ? ""
        : ` ${company.does.charAt(0).toUpperCase()}${company.does
            .slice(1)
            .replace(/[.\s]+$/u, "")}.`;
    const links = company.sourceUrls
      .map((url) => {
        const source = fetched.get(url);
        return source === undefined ? null : `[${source.domain}](${url})`;
      })
      .filter((link): link is string => link !== null)
      .join(", ");
    const onQ = company.onCapitalQ ? " Already on Capital Q." : "";
    return `${String(index + 1)}. **${company.name}**${when} — ${founders}.${does}${
      fit.line.length > 0 ? ` Fit: ${fit.line}.` : ""
    } Source: ${links}.${onQ}`;
  });
  const n = companies.length;
  // Round 6: what was left out, said with the count (owner: "found N
  // (left out M older than 8 years, K that were lists)").
  const lists = left.droppedListings ?? 0;
  const leftOut = [
    left.droppedOld > 0
      ? `${String(left.droppedOld)} that the sources say ${left.droppedOld === 1 ? "was" : "were"} founded more than 8 years ago`
      : null,
    lists > 0
      ? `${String(lists)} that ${lists === 1 ? "was a list or directory" : "were lists or directories"}`
      : null,
  ].filter((part): part is string => part !== null);
  const notes = [
    left.further && left.excludedPrior > 0
      ? `leaving out the ${String(left.excludedPrior)} I listed earlier`
      : null,
    leftOut.length > 0 ? `left out ${leftOut.join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  const found = `found ${String(n)} ${left.further ? "new " : ""}${n === 1 ? "company" : "companies"}${
    notes.length > 0 ? ` (${notes.join("; ")})` : ""
  }`;
  return [
    `${searched} and ${found}. These come from public web pages and are unverified: nothing here is checked by Capital Q, and anything marked unknown wasn't stated in the sources.`,
    lines.join("\n"),
    "Would you like me to look deeper into any of them, or prepare an introduction note for your approval? I won't contact anyone unless you approve it.",
  ].join("\n\n");
}
