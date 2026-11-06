import type { PublicSourceLike } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import { countryWords, stageWords } from "./named-company-fact.js";
import type { MandateCategories } from "./own-mandate-answer.js";
import { Q_DEEP_TOOL_LOOP_BUDGET_MS } from "./tool-loop-budget.js";
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
const EXTRACT_TOOL = "extract_public_web";
const SEARCH_COMPANIES_TOOL = "search_companies";

/** Queries in the first round. */
export const DISCOVERY_QUERIES = { min: 3, max: 6 } as const;
/** Companies listed with no number asked. */
export const DISCOVERY_DEFAULT_COUNT = 8;
export const DISCOVERY_MAX_COUNT = 10;
/** Tool calls the whole discovery may make (the deep loop's call cap). */
export const DISCOVERY_MAX_TOOL_CALLS = 16;
/** Candidates searched for founders in round two. */
const FOUNDER_ROUND_MAX = 6;
/** Pages read further when a search returned only a snippet. */
const EXTRACT_MAX = 3;
/** No new round starts once this share of the budget is spent. */
const ROUND_CUTOFF = 0.6;

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
  readonly queries: readonly string[];
  /** From the mandate (true) or only the turn's own words (false). */
  readonly fromMandate: boolean;
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
  const candidates: string[] = [];
  const sectorList = sectors.length > 0 ? sectors : [""];
  const placeList = places.length > 0 ? places : [""];
  // One query per sector and place, interleaved so every category is
  // searched before any is searched twice.
  for (let i = 0; i < Math.max(sectorList.length, placeList.length); i += 1) {
    const sector = sectorList[i % sectorList.length] ?? "";
    const place = placeList[i % placeList.length] ?? "";
    candidates.push(join(sector, "startups", place, stageWord, String(year)));
  }
  candidates.push(
    join(
      sectorList[0] ?? "",
      "startup raised seed",
      placeList[0] ?? "",
      String(year),
    ),
    join(
      "new",
      sectorList[1] ?? sectorList[0] ?? "",
      "startups launches",
      placeList[1] ?? placeList[0] ?? "",
      String(year),
    ),
    join(
      sectorList[0] ?? "",
      "startups founders",
      placeList[2] ?? placeList[0] ?? "",
      String(year),
    ),
    join("new", sectorList[0] ?? "", "startups funding round", String(year)),
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
    queries,
    fromMandate,
  };
}

// --- grounding -------------------------------------------------------------

/** One form for comparing names with page text. */
export function normalForm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`]/gu, "'")
    .replace(/[‐-―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The name, as written, is in the text (not inside a longer word). */
export function namedIn(name: string, text: string): boolean {
  const needle = normalForm(name);
  if (needle.length < 2) return false;
  const hay = normalForm(text);
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const before = at === 0 ? "" : hay.charAt(at - 1);
    const after = hay.charAt(at + needle.length);
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

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
    known.map((company) => [normalForm(company.name), company] as const),
  );
  for (const item of proposed) {
    const name = item.name.trim().slice(0, 120);
    const key = normalForm(name);
    if (key.length < 2) continue;
    const naming = sources.filter((source) => namedIn(name, pageText(source)));
    if (naming.length === 0) continue;
    const text = naming.map(pageText).join("\n");
    const founders = item.founders
      .map((founder) => founder.trim())
      .filter(
        (founder) =>
          founder.length >= 3 &&
          normalForm(founder) !== key &&
          naming.some((source) => namedIn(founder, pageText(source))),
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
}): Promise<WebDiscoveryAnswer | null> {
  if (!input.available.has(RESEARCH_TOOL)) return null;
  const now = input.now ?? Date.now;
  const started = now();
  const budgetMs = input.budgetMs ?? Q_DEEP_TOOL_LOOP_BUDGET_MS;
  const roundMayStart = () => now() - started < budgetMs * ROUND_CUTOFF;
  const plan = planDiscovery(input.ask, input.mandate, new Date(now()));
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
          callId: `q-discovery-${String(DISCOVERY_MAX_TOOL_CALLS - callsLeft)}`,
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
  const research = async (queries: readonly string[], maxSources: number) => {
    const [query, ...also] = queries;
    if (query === undefined) return;
    const outcome = await call(RESEARCH_TOOL, {
      target: "GENERAL",
      query,
      ...(also.length === 0 ? {} : { alsoSearch: also }),
      maxSources,
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

  // Round 1: the plan's queries, two to a call, all at once.
  const pairs: string[][] = [];
  for (let i = 0; i < plan.queries.length; i += 2) {
    pairs.push(plan.queries.slice(i, i + 2));
  }
  await Promise.all(pairs.map((pair) => research(pair, 4)));
  if (answered === 0) {
    return {
      text:
        unavailable > 0
          ? "I tried to search the public web for companies that fit, but the search providers weren't available just now, so I have no public results to give you. Ask me again in a few minutes and I'll run it."
          : "I searched the public web for companies that fit, but the searches came back empty, so I have nothing specific I can put in front of you.",
      outcome: unavailable > 0 ? "UNAVAILABLE" : "NONE",
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
  const proposed =
    (await input.reader({
      looking:
        looking.length === 0 ? "new companies and their founders" : looking,
      sources: firstPages,
      attribution: input.attribution,
      signal: input.signal,
    })) ?? [];
  let companies = admitDiscoveries(proposed, firstPages);

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
    const asks = needFounders.map((company) => `${company.name} founder`);
    founderQueries.push(...asks);
    const founderPairs: string[][] = [];
    for (let i = 0; i < asks.length; i += 2) {
      founderPairs.push(asks.slice(i, i + 2));
    }
    await Promise.all(founderPairs.map((pair) => research(pair, 3)));
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
      const wanted = new Set(companies.map((c) => normalForm(c.name)));
      companies = admitDiscoveries(
        more.filter((item) => wanted.has(normalForm(item.name))),
        readable(),
        companies,
      );
    }
  }

  // Ranked: fit to what was searched, then founders known, then found first.
  const fits = new Map(
    companies.map((company) => [company.name, discoveryFit(company, plan)]),
  );
  const score = (company: DiscoveredCompany): number => {
    const fit = fits.get(company.name);
    return (
      (fit?.sector === "MATCH" ? 4 : 0) +
      (fit?.place === "MATCH" ? 2 : 0) +
      (fit?.stage === "MATCH" ? 1 : fit?.stage === "OUTSIDE" ? -3 : 0) +
      (company.founders.length > 0 ? 1 : 0)
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
    text: discoveryAnswerText(marked, plan, fetched),
    outcome: marked.length > 0 ? "FOUND" : "NONE",
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
): string {
  const looking = lookingLine(plan);
  const against =
    looking.length === 0
      ? ""
      : plan.fromMandate
        ? ` against your mandate (${looking})`
        : ` for ${looking}`;
  if (companies.length === 0) {
    return `I searched the public web${against}, but the pages I could read didn't name specific companies I could stand behind, so I won't guess. I can search again with a different angle (a city, a sub-sector or a recent accelerator batch) if you'd like.`;
  }
  const lines = companies.map((company, index) => {
    const fit = discoveryFit(company, plan);
    const founders =
      company.founders.length > 0
        ? `founded by ${listOf([...company.founders])}`
        : "founders not named in the sources I read";
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
    return `${String(index + 1)}. **${company.name}**, ${founders}.${does}${
      fit.line.length > 0 ? ` Fit: ${fit.line}.` : ""
    } Source: ${links}.${onQ}`;
  });
  const n = companies.length;
  return [
    `I searched the public web${against} and found ${String(n)} ${n === 1 ? "company" : "companies"}. These come from public web pages and are unverified: nothing here is checked by Capital Q, and anything marked unknown wasn't stated in the sources.`,
    lines.join("\n"),
    "Would you like me to look deeper into any of them, or prepare an introduction note for your approval? I won't contact anyone unless you approve it.",
  ].join("\n\n");
}
