import type {
  ExternalPersonConfidence,
  ExternalPersonSource,
  IdentityCard,
} from "@capital-q/contracts/q";
import { NO_EXTERNAL_ENTITY_IMAGE } from "@capital-q/contracts/q";

import type { PublicWebSearchHit } from "../contracts.js";
import {
  countryName,
  mentionedCountries,
  regionCountries,
} from "../domain/geography.js";
import { publicDomainOf } from "../domain/url-safety.js";
import type { PublicWebResearchProvider } from "../ports.js";
import { createFallbackResearchProvider } from "../providers/fallback.js";

import {
  aliasKeyOf,
  cardFromKnownEntity,
  type KnownEntityIndex,
  type KnownEntityRecord,
} from "./known-entities.js";
import { externalPersonIdFor } from "./person-search.js";

/**
 * Counterpart discovery (D1, 2026-10-10): "top three Arab investors that
 * may be interested in this".
 *
 * Meaning is read upstream (the first read or the tool call turns the
 * member's words into region descriptors, a sector and a count); this file
 * is the deterministic rest. Order, by cost: the warm known-entity index
 * (instant, no web), then ONE bounded public web search only for the slots
 * still empty. Fit reasons are composed by code from public sector, stage
 * and place overlap, in soft words; interest is never claimed.
 *
 * CONTEXT FIREWALL: the only words that can leave are the member's own
 * region descriptors plus public taxonomy terms (sector, stage), each
 * checked by `publicTerm`. Nothing from the member's company records ever
 * reaches this function, and the query is built here, never forwarded.
 */

export const DISCOVERY_WEB_BUDGET_MS = 3_000;
export const DISCOVERY_COUNT = { default: 3, max: 5 } as const;

export type CounterpartAsk = {
  readonly tenantId: string;
  readonly userId: string;
  /** Region or nationality words as the member said them ("Arab", "Gulf"). */
  readonly regions: readonly string[];
  /** Public taxonomy sector and stage; anything not plainly a taxonomy term is dropped. */
  readonly sector?: string | null | undefined;
  readonly stage?: string | null | undefined;
  readonly count?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type DiscoveredCounterpart = {
  readonly card: IdentityCard;
  /** INVESTOR: invests. DOOR_OPENER: a promotion body, not a fund. */
  readonly role: "INVESTOR" | "DOOR_OPENER";
  /** Soft, code-composed reasons it could fit; never a claim of interest. */
  readonly fit: readonly string[];
  readonly source: "KNOWN_ENTITY" | "WEB";
};

export type CounterpartDiscovery = {
  readonly outcome: "FOUND" | "NONE" | "UNAVAILABLE";
  readonly candidates: readonly DiscoveredCounterpart[];
  readonly countries: readonly string[];
  readonly regionWords: readonly string[];
  readonly webSearched: boolean;
  readonly webQuery: string | null;
  readonly elapsedMs: number;
};

export type CounterpartDiscoverer = {
  readonly discover: (ask: CounterpartAsk) => Promise<CounterpartDiscovery>;
};

/** Words that mark private founder data; a term containing one never leaves. */
const PRIVATE_WORDS = new Set([
  "cash",
  "burn",
  "runway",
  "payroll",
  "salary",
  "salaries",
  "revenue",
  "mrr",
  "arr",
  "raise",
  "raising",
  "valuation",
  "deck",
  "document",
  "documents",
  "confidential",
  "private",
  "loan",
  "debt",
  "customers",
  "customer",
  "contract",
  "contracts",
  "bank",
  "account",
  "password",
  "secret",
]);

/**
 * A public taxonomy or region term: letters only (no digits, currency or
 * punctuation that carries a figure), short, and free of private-data words.
 * Null when it is anything else, which is then simply not sent.
 */
export function publicTerm(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const clean = text.replace(/_/gu, " ").replace(/\s+/gu, " ").trim();
  if (clean.length < 2 || clean.length > 40) return null;
  if (!/^[\p{L}][\p{L} &'-]*$/u.test(clean)) return null;
  const words = clean.toLowerCase().split(/[^\p{L}]+/u);
  if (words.some((word) => PRIVATE_WORDS.has(word))) return null;
  return clean;
}

const INVESTOR_TEXT =
  /\b(?:invest(?:or|ors|ment|ments|ing)?|venture capital|vc|funds?|private equity|angels?|asset management|family office)\b/iu;

function textOf(record: KnownEntityRecord): string {
  const line = record.profile["oneLine"];
  return [
    record.displayName,
    record.role,
    record.organization,
    typeof line === "string" ? line : null,
    ...record.facts.map((fact) => fact.claim),
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

/** Whether a prepared entity invests; judged from its role, organisation and description only. */
function tierOf(record: KnownEntityRecord): "INVESTOR" | "DOOR_OPENER" | null {
  if (record.entityKind === "GOVERNMENT_AGENCY") return "DOOR_OPENER";
  const line = record.profile["oneLine"];
  const own = [
    record.entityKind === "PERSON" ? record.role : null,
    record.organization,
    typeof line === "string" ? line : null,
    record.entityKind === "ORGANIZATION" ? record.displayName : null,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return INVESTOR_TEXT.test(own) ? "INVESTOR" : null;
}

function recordCountries(record: KnownEntityRecord): readonly string[] {
  const line = record.profile["oneLine"];
  return mentionedCountries(
    [
      record.location,
      record.organization,
      record.displayName,
      typeof line === "string" ? line : null,
    ]
      .filter((part): part is string => typeof part === "string")
      .join(" "),
  );
}

const STAGE_PATTERNS: Readonly<Record<string, RegExp>> = {
  pre_seed: /pre-?seed|early[- ]stage/iu,
  seed: /\bseed\b|early[- ]stage/iu,
  series_a: /series a\b|early[- ]stage|growth/iu,
  series_b: /series b\b|growth|expansion/iu,
  series_c_plus: /series c\b|growth|late[- ]stage|expansion/iu,
};

function sectorWords(sector: string): readonly string[] {
  return sector
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 2 && word !== "and" && word !== "the");
}

function overlapScore(
  text: string,
  sector: string | null,
  stage: string | null,
): { readonly sector: boolean; readonly stage: boolean } {
  const words = sector === null ? [] : sectorWords(sector);
  const stagePattern =
    stage === null
      ? undefined
      : STAGE_PATTERNS[stage.toLowerCase().replace(/\s+/gu, "_")];
  return {
    sector:
      words.length > 0 &&
      words.some((word) => text.toLowerCase().includes(word)),
    stage: stagePattern !== undefined && stagePattern.test(text),
  };
}

function fitLines(input: {
  readonly role: "INVESTOR" | "DOOR_OPENER";
  readonly country: string | null;
  readonly regionAsked: boolean;
  readonly sector: string | null;
  readonly stage: string | null;
  readonly overlap: { readonly sector: boolean; readonly stage: boolean };
  readonly describedAs: string | null;
}): string[] {
  const lines: string[] = [];
  if (input.role === "DOOR_OPENER") {
    lines.push("Not a fund, but it can open doors to local investors.");
  }
  if (input.country !== null) {
    lines.push(
      input.regionAsked
        ? `Based in ${input.country}, within the region you asked about.`
        : `Based in ${input.country}.`,
    );
  }
  if (input.describedAs !== null) {
    lines.push(`Described publicly as: ${input.describedAs}`.slice(0, 160));
  }
  if (input.role === "INVESTOR") {
    if (input.sector !== null) {
      lines.push(
        input.overlap.sector
          ? `Public material mentions ${input.sector}, so it could be a fit.`
          : `Its interest in ${input.sector} is not confirmed in the public material I hold.`,
      );
    }
    if (input.stage !== null && input.overlap.stage) {
      lines.push(
        `Reportedly backs companies at an early stage, close to ${input.stage.replace(/_/gu, " ")}.`,
      );
    }
  }
  return lines.slice(0, 5);
}

function oneLineOf(record: KnownEntityRecord): string | null {
  const line = record.profile["oneLine"];
  if (typeof line !== "string") return null;
  const clean = line
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.\s]+$/u, "");
  return clean.length === 0 ? null : clean.slice(0, 120);
}

type Draft = {
  readonly candidate: DiscoveredCounterpart;
  readonly score: number;
  readonly key: string;
};

function knownDrafts(input: {
  readonly index: KnownEntityIndex;
  readonly countries: readonly string[];
  readonly regionAsked: boolean;
  readonly filter: boolean;
  readonly sector: string | null;
  readonly stage: string | null;
}): readonly Draft[] {
  const drafts: Draft[] = [];
  for (const record of input.index.list()) {
    const role = tierOf(record);
    if (role === null) continue;
    const found = recordCountries(record);
    const inSet = found.filter((code) => input.countries.includes(code));
    // Unknown stays unknown: a prepared entity with no detectable place is
    // not claimed for a region.
    if (input.filter && inSet.length === 0) continue;
    const card = cardFromKnownEntity(record);
    if (card === null) continue;
    const overlap = overlapScore(textOf(record), input.sector, input.stage);
    const country = countryName(inSet[0] ?? found[0]);
    const base =
      role === "DOOR_OPENER"
        ? 0
        : record.entityKind === "ORGANIZATION"
          ? 30
          : 20;
    drafts.push({
      key: record.externalPersonId,
      score: base + (overlap.sector ? 5 : 0) + (overlap.stage ? 3 : 0),
      candidate: {
        card,
        role,
        source: "KNOWN_ENTITY",
        fit: fitLines({
          role,
          country,
          regionAsked: input.regionAsked,
          sector: input.sector,
          stage: input.stage,
          overlap,
          describedAs: oneLineOf(record),
        }),
      },
    });
  }
  return drafts.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidate.card.subject.displayName.localeCompare(
        b.candidate.card.subject.displayName,
      ),
  );
}

type WebFind = {
  readonly profileKey: string;
  readonly name: string;
  readonly kind: "PERSON" | "ORGANIZATION";
  readonly role: string | null;
  readonly organization: string | null;
  readonly hit: PublicWebSearchHit;
  readonly provider: string;
  readonly confidence: ExternalPersonConfidence;
  readonly countries: readonly string[];
};

const LINKEDIN_COMPANY = /linkedin\.com\/company\/([^/?#]+)/iu;
const LINKEDIN_PERSON = /linkedin\.com\/in\/([^/?#]+)/iu;

function webFindOf(
  hit: PublicWebSearchHit,
  provider: string,
  countries: readonly string[],
  filter: boolean,
): WebFind | null {
  const title = (hit.title ?? "").replace(/\s+/gu, " ").trim();
  const text = `${title} ${hit.snippet}`;
  if (!INVESTOR_TEXT.test(text)) return null;
  const found = mentionedCountries(text);
  const host = publicDomainOf(hit.url) ?? "";
  const tld = host.split(".").pop() ?? "";
  const tldCountry = [...countries].find((code) => code.toLowerCase() === tld);
  const inSet = found.filter((code) => countries.includes(code));
  if (filter && inSet.length === 0 && tldCountry === undefined) return null;
  const place = [...inSet, ...(tldCountry === undefined ? [] : [tldCountry])];
  const segments = title
    .replace(/\s*[|\-–·]\s*LinkedIn.*$/iu, "")
    .split(/\s+[-–|·]\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const first = segments[0];
  if (first === undefined || first.length > 80) return null;
  const company = LINKEDIN_COMPANY.exec(hit.url)?.[1];
  const person = LINKEDIN_PERSON.exec(hit.url)?.[1];
  if (company !== undefined) {
    return {
      profileKey: `discover:org:${company.toLowerCase()}`.slice(0, 120),
      name: first,
      kind: "ORGANIZATION",
      role: null,
      organization: null,
      hit,
      provider,
      confidence: "PLAUSIBLE",
      countries: place,
    };
  }
  if (person !== undefined) {
    return {
      profileKey: `discover:person:${person.toLowerCase()}`.slice(0, 120),
      name: first,
      kind: "PERSON",
      role: segments[1] ?? null,
      organization: segments[2] ?? null,
      hit,
      provider,
      confidence: "PLAUSIBLE",
      countries: place,
    };
  }
  // A site's own front page names an organisation; an article or list does not.
  let path: string;
  try {
    path = new URL(hit.url).pathname;
  } catch {
    return null;
  }
  if (path.replace(/\/+$/u, "").length > 0 || host.length === 0) return null;
  return {
    profileKey: `discover:site:${host.replace(/^www\./u, "")}`.slice(0, 120),
    name: first,
    kind: "ORGANIZATION",
    role: null,
    organization: null,
    hit,
    provider,
    confidence: "WEAK",
    countries: place,
  };
}

function sourceOf(find: WebFind, retrievedAt: string): ExternalPersonSource {
  return {
    id: null,
    description: null,
    evidenceClass: null,
    url: find.hit.url,
    domain: publicDomainOf(find.hit.url) ?? "",
    title: find.hit.title === null ? null : find.hit.title.slice(0, 300),
    publishedAt: find.hit.publishedAt,
    retrievedAt,
    provider: find.provider,
  };
}

export type DiscoveryPersist = (
  scope: { readonly tenantId: string; readonly userId: string },
  input: {
    readonly profileKey: string;
    readonly subject: IdentityCard["subject"];
    readonly sources: readonly ExternalPersonSource[];
  },
) => Promise<unknown>;

function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent: AbortSignal | undefined,
): Promise<T | null> {
  const own = new AbortController();
  return new Promise<T | null>((resolve) => {
    const done = (value: T | null): void => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
      resolve(value);
    };
    const timer = setTimeout(() => {
      own.abort();
      done(null);
    }, ms);
    const onParent = (): void => {
      own.abort();
      done(null);
    };
    if (parent?.aborted === true) return onParent();
    parent?.addEventListener("abort", onParent, { once: true });
    run(own.signal).then(done, () => done(null));
  });
}

export function createCounterpartDiscovery(dependencies: {
  readonly known: KnownEntityIndex;
  /** The individual indexes, fastest first; empty means no web search. */
  readonly providers: readonly PublicWebResearchProvider[];
  /** Saves a web-found counterpart for this asker so its Rehearse link opens. */
  readonly persist?: DiscoveryPersist | undefined;
  readonly clock?: (() => number) | undefined;
  readonly webBudgetMs?: number | undefined;
}): CounterpartDiscoverer {
  const now = dependencies.clock ?? (() => Date.now());
  const web =
    dependencies.providers.length === 0
      ? null
      : createFallbackResearchProvider({
          providers: dependencies.providers.slice(0, 2),
          parallelSearch: true,
          searchTimeoutMs: dependencies.webBudgetMs ?? DISCOVERY_WEB_BUDGET_MS,
        });

  return {
    discover: async (ask) => {
      const started = now();
      const count = Math.min(
        DISCOVERY_COUNT.max,
        Math.max(1, Math.trunc(ask.count ?? DISCOVERY_COUNT.default)),
      );
      const regionWords = ask.regions
        .map((word) => publicTerm(word))
        .filter((word): word is string => word !== null)
        .slice(0, 4);
      const countries = regionCountries(regionWords.join(" "));
      // Region words were given but mean no country we know: the prepared
      // set cannot be filtered honestly, so only the web is asked.
      const unresolved = regionWords.length > 0 && countries.length === 0;
      const filter = countries.length > 0;
      const sector = publicTerm(ask.sector);
      const stage = publicTerm(ask.stage);
      const regionAsked = regionWords.length > 0;

      const drafts = unresolved
        ? []
        : knownDrafts({
            index: dependencies.known,
            countries,
            regionAsked,
            filter,
            sector,
            stage,
          });
      const investors = drafts.filter((d) => d.candidate.role === "INVESTOR");
      const openers = drafts.filter((d) => d.candidate.role === "DOOR_OPENER");
      const picked: DiscoveredCounterpart[] = investors
        .slice(0, count)
        .map((d) => d.candidate);

      let webSearched = false;
      let webQuery: string | null = null;
      let webFailed = false;
      const missing = count - picked.length;
      if (missing > 0 && web !== null) {
        webSearched = true;
        // The whole query: public taxonomy words and the member's region words.
        webQuery = [
          sector,
          stage?.replace(/_/gu, " "),
          "venture capital investors",
          ...regionWords,
        ]
          .filter((part): part is string => part !== null && part !== undefined)
          .join(" ");
        const result = await bounded(
          (signal) =>
            web.search(
              {
                query: webQuery ?? "",
                maxResults: 6,
                freshness: "ANY",
                includeDomains: [],
              },
              { signal },
            ),
          dependencies.webBudgetMs ?? DISCOVERY_WEB_BUDGET_MS,
          ask.signal,
        );
        if (result === null) {
          webFailed = true;
        } else {
          const knownKeys = new Set<string>();
          const knownUrls = new Set<string>();
          for (const record of dependencies.known.list()) {
            for (const alias of [record.displayName, ...record.aliases]) {
              knownKeys.add(aliasKeyOf(alias));
            }
            if (record.profileUrl !== null) {
              knownUrls.add(
                record.profileUrl.replace(/\/+$/u, "").toLowerCase(),
              );
            }
          }
          const seen = new Set<string>();
          const finds: WebFind[] = [];
          for (const hit of result.hits) {
            const find = webFindOf(hit, web.code, countries, filter);
            if (find === null || seen.has(find.profileKey)) continue;
            if (
              knownKeys.has(aliasKeyOf(find.name)) ||
              knownUrls.has(hit.url.replace(/\/+$/u, "").toLowerCase())
            ) {
              continue;
            }
            seen.add(find.profileKey);
            finds.push(find);
          }
          const retrievedAt = new Date(now()).toISOString();
          const made = await Promise.all(
            finds.slice(0, missing).map(async (find) => {
              const sources = [sourceOf(find, retrievedAt)];
              const subject = {
                entityKind: find.kind,
                researchStatus: "RESEARCHED" as const,
                requiresRefresh: false,
                image: NO_EXTERNAL_ENTITY_IMAGE,
                quotes: [],
                externalPersonId: externalPersonIdFor(
                  ask.tenantId,
                  ask.userId,
                  find.profileKey,
                ),
                displayName: find.name.slice(0, 200),
                nameVariants: [],
                profileUrl: find.hit.url,
                role:
                  find.kind === "PERSON"
                    ? (find.role?.slice(0, 200) ?? null)
                    : null,
                organization: find.organization?.slice(0, 200) ?? null,
                location: countryName(find.countries[0]) ?? null,
                evidenceBundleId: null,
                briefVersion: 0,
                confidence: find.confidence,
              };
              // The Rehearse link needs a stored record for this asker.
              const saved =
                dependencies.persist === undefined
                  ? false
                  : await dependencies
                      .persist(
                        { tenantId: ask.tenantId, userId: ask.userId },
                        { profileKey: find.profileKey, subject, sources },
                      )
                      .then(() => true)
                      .catch(() => false);
              const card: IdentityCard = {
                entityKind: find.kind,
                subject,
                sources,
                uncertainty: [
                  "Found by a public web search; I have not confirmed it invests or its place.",
                ],
                attributionLine: `Reported by ${sources[0]?.domain ?? "a public page"} (search-indexed, not independently confirmed).`,
                summary: null,
                enriching: false,
                actions: saved
                  ? ["RESEARCH_FURTHER", "REHEARSE"]
                  : ["RESEARCH_FURTHER"],
              };
              const text = `${find.hit.title ?? ""} ${find.hit.snippet}`;
              const overlap = overlapScore(text, sector, stage);
              const candidate: DiscoveredCounterpart = {
                card,
                role: "INVESTOR",
                source: "WEB",
                fit: fitLines({
                  role: "INVESTOR",
                  country: countryName(find.countries[0]),
                  regionAsked,
                  sector,
                  stage,
                  overlap,
                  describedAs: null,
                }),
              };
              return {
                candidate,
                score: Number(overlap.sector) + Number(overlap.stage),
              };
            }),
          );
          made.sort((a, b) => b.score - a.score);
          picked.push(...made.map((m) => m.candidate));
        }
      }
      // A promotion body fills a slot only when no investor can: it is not a fund.
      for (const opener of openers) {
        if (picked.length >= count) break;
        picked.push(opener.candidate);
      }

      const final = picked.slice(0, count);
      return {
        outcome:
          final.length > 0 ? "FOUND" : webFailed ? "UNAVAILABLE" : "NONE",
        candidates: final,
        countries,
        regionWords,
        webSearched,
        webQuery,
        elapsedMs: Math.max(0, now() - started),
      };
    },
  };
}
