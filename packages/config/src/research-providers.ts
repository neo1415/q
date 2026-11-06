import { z } from "zod";

import { ProviderCredential } from "./model-providers.js";

/**
 * Public-web research providers (CQ-Q-RESEARCH-001). Keys are server-only,
 * revealed once at composition and handed to the adapter.
 *
 * Tavily: search + extract. Bright Data: the SERP API (search) and Web
 * Unlocker (extract) when their zones are named, and the LinkedIn public
 * profile datasets with the API key alone. Absent keys mean the matching
 * tools are not composed; nothing falls back to a provider that was not
 * configured.
 */

export const RESEARCH_PROVIDER_ENV_NAMES = [
  "TAVILY_API_KEY",
  "BRIGHT_DATA_API_KEY",
  "SERP_API_KEY",
  "SERPER_API_KEY",
  "SCRAPING_BEE_API",
  "SCRAPIG_BEE_API",
  "BRAVE_API",
  "BRAVE_SEARCH_API_KEY",
] as const;

const apiKey = z
  .string()
  .trim()
  .min(16, "expected a provider API key")
  .max(512, "expected a provider API key");

const zone = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{2,64}$/, "expected a Bright Data zone name");

export const researchProviderEnvShape = {
  TAVILY_API_KEY: apiKey.optional(),
  BRIGHT_DATA_API_KEY: apiKey.optional(),
  /** SerpApi (serpapi.com): a second Google index for search, behind Tavily. */
  SERP_API_KEY: apiKey.optional(),
  /** Serper.dev (google.serper.dev): Google results by one POST. */
  SERPER_API_KEY: apiKey.optional(),
  /** ScrapingBee: Google search and an HTML fetch for pages our egress cannot reach. */
  SCRAPING_BEE_API: apiKey.optional(),
  /** The same key under the name it was first deployed with (a typo kept for compatibility). */
  SCRAPIG_BEE_API: apiKey.optional(),
  /** Brave Search: its own web index, news and images (owner 2026-10-23). */
  BRAVE_API: apiKey.optional(),
  /** The same key under Brave's documented name. */
  BRAVE_SEARCH_API_KEY: apiKey.optional(),
  /** The SERP API zone (control panel → Zones); search goes through Bright Data only when set. */
  BRIGHT_DATA_SERP_ZONE: zone.optional(),
  /** The Web Unlocker zone; page extraction goes through Bright Data only when set. */
  BRIGHT_DATA_UNLOCKER_ZONE: zone.optional(),
  /** UK Companies House REST API key (BIZ-009); absent means the registry is skipped. */
  COMPANIES_HOUSE_API_KEY: z.string().trim().min(8).max(200).optional(),
  /**
   * SEC EDGAR's required contact User-Agent ("Capital Q ops@example.com",
   * BIZ-009); absent means EDGAR is skipped.
   */
  SEC_EDGAR_USER_AGENT: z.string().trim().min(8).max(200).optional(),
  /**
   * Research providers left out of the rotation although a key is set:
   * comma-separated codes from RETIRABLE_RESEARCH_PROVIDERS. Unset means
   * the owner's default (DECISIONS 65: ScrapingBee and Serper retired, so
   * Brave and Tavily carry public research with no failed-first calls);
   * set it empty to bring every keyed provider back. The adapters stay.
   */
  CQ_RESEARCH_PROVIDERS_RETIRED: z.string().trim().max(200).optional(),
};

/** The providers that can be retired by configuration. */
export const RETIRABLE_RESEARCH_PROVIDERS = [
  "serper",
  "scrapingbee",
  "serpapi",
  "brave",
  "tavily",
  "brightdata",
] as const;
export type RetirableResearchProvider =
  (typeof RETIRABLE_RESEARCH_PROVIDERS)[number];

/** DECISIONS 65 (owner, 2026-11-06). */
export const DEFAULT_RETIRED_RESEARCH_PROVIDERS: readonly RetirableResearchProvider[] =
  ["serper", "scrapingbee"];

/**
 * The retired set: the owner's default when unset, else what is listed.
 * An unknown code is ignored rather than failing the service's start (a
 * configuration typo must never take Q down); at worst a resting provider
 * is asked first and its breaker sets it aside.
 */
export function retiredResearchProviders(
  raw: string | undefined,
): ReadonlySet<RetirableResearchProvider> {
  if (raw === undefined) return new Set(DEFAULT_RETIRED_RESEARCH_PROVIDERS);
  const listed = new Set(
    raw.split(",").map((code) => code.trim().toLowerCase()),
  );
  return new Set(
    RETIRABLE_RESEARCH_PROVIDERS.filter((code) => listed.has(code)),
  );
}

export type BrightDataSecrets = {
  readonly apiKey: ProviderCredential;
  readonly serpZone: string | undefined;
  readonly unlockerZone: string | undefined;
};

export type ResearchProviderSecrets = {
  /** Tavily search + extract; absent means the research tools are not composed. */
  readonly tavily: ProviderCredential | undefined;
  /** Bright Data; absent means no profile lookups and no Bright Data search. */
  readonly brightData: BrightDataSecrets | undefined;
  /** SerpApi search; absent means one search index only. */
  readonly serpApi: ProviderCredential | undefined;
  /** Serper.dev search + page scrape; absent means that index is skipped. */
  readonly serper?: ProviderCredential | undefined;
  /** ScrapingBee Google search + HTML fetch; absent means that index is skipped. */
  readonly scrapingBee?: ProviderCredential | undefined;
  /** Brave Search web, news and images; absent means that index is skipped. */
  readonly brave?: ProviderCredential | undefined;
  /** Companies House; absent means investor research skips it. */
  readonly companiesHouse?: ProviderCredential | undefined;
  /** The contact EDGAR requires; absent means investor research skips it. */
  readonly secEdgarUserAgent?: string | undefined;
};

export type ResearchProviderConfigStatus = {
  readonly tavily: "configured" | "unconfigured";
  readonly brightData: "configured" | "unconfigured";
  /** Both zones named: search and extraction may go through Bright Data. */
  readonly brightDataZones: "configured" | "unconfigured";
  readonly serpApi: "configured" | "unconfigured";
  readonly serper: "configured" | "unconfigured";
  readonly scrapingBee: "configured" | "unconfigured";
  readonly brave: "configured" | "unconfigured";
};

export function toResearchProviderSecrets(parsed: {
  readonly TAVILY_API_KEY?: string | undefined;
  readonly BRIGHT_DATA_API_KEY?: string | undefined;
  readonly BRIGHT_DATA_SERP_ZONE?: string | undefined;
  readonly BRIGHT_DATA_UNLOCKER_ZONE?: string | undefined;
  readonly SERP_API_KEY?: string | undefined;
  readonly SERPER_API_KEY?: string | undefined;
  readonly SCRAPING_BEE_API?: string | undefined;
  readonly SCRAPIG_BEE_API?: string | undefined;
  readonly BRAVE_API?: string | undefined;
  readonly BRAVE_SEARCH_API_KEY?: string | undefined;
  readonly COMPANIES_HOUSE_API_KEY?: string | undefined;
  readonly SEC_EDGAR_USER_AGENT?: string | undefined;
  readonly CQ_RESEARCH_PROVIDERS_RETIRED?: string | undefined;
}): ResearchProviderSecrets {
  const retired = retiredResearchProviders(
    parsed.CQ_RESEARCH_PROVIDERS_RETIRED,
  );
  const keyed = (
    code: RetirableResearchProvider,
    key: string | undefined,
  ): ProviderCredential | undefined =>
    key === undefined || retired.has(code)
      ? undefined
      : new ProviderCredential(key);
  return {
    companiesHouse:
      parsed.COMPANIES_HOUSE_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.COMPANIES_HOUSE_API_KEY),
    secEdgarUserAgent: parsed.SEC_EDGAR_USER_AGENT,
    serper: keyed("serper", parsed.SERPER_API_KEY),
    scrapingBee: keyed(
      "scrapingbee",
      parsed.SCRAPING_BEE_API ?? parsed.SCRAPIG_BEE_API,
    ),
    brave: keyed("brave", parsed.BRAVE_API ?? parsed.BRAVE_SEARCH_API_KEY),
    serpApi: keyed("serpapi", parsed.SERP_API_KEY),
    tavily: keyed("tavily", parsed.TAVILY_API_KEY),
    brightData:
      parsed.BRIGHT_DATA_API_KEY === undefined || retired.has("brightdata")
        ? undefined
        : {
            apiKey: new ProviderCredential(parsed.BRIGHT_DATA_API_KEY),
            serpZone: parsed.BRIGHT_DATA_SERP_ZONE,
            unlockerZone: parsed.BRIGHT_DATA_UNLOCKER_ZONE,
          },
  };
}

export function researchProviderConfigStatus(
  secrets: ResearchProviderSecrets,
): ResearchProviderConfigStatus {
  return {
    tavily: secrets.tavily === undefined ? "unconfigured" : "configured",
    brightData:
      secrets.brightData === undefined ? "unconfigured" : "configured",
    brightDataZones:
      secrets.brightData?.serpZone !== undefined &&
      secrets.brightData.unlockerZone !== undefined
        ? "configured"
        : "unconfigured",
    serpApi: secrets.serpApi === undefined ? "unconfigured" : "configured",
    serper: secrets.serper === undefined ? "unconfigured" : "configured",
    scrapingBee:
      secrets.scrapingBee === undefined ? "unconfigured" : "configured",
    brave: secrets.brave === undefined ? "unconfigured" : "configured",
  };
}
