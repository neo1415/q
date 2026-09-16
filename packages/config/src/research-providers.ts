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
  /** The SERP API zone (control panel → Zones); search goes through Bright Data only when set. */
  BRIGHT_DATA_SERP_ZONE: zone.optional(),
  /** The Web Unlocker zone; page extraction goes through Bright Data only when set. */
  BRIGHT_DATA_UNLOCKER_ZONE: zone.optional(),
};

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
};

export type ResearchProviderConfigStatus = {
  readonly tavily: "configured" | "unconfigured";
  readonly brightData: "configured" | "unconfigured";
  /** Both zones named: search and extraction may go through Bright Data. */
  readonly brightDataZones: "configured" | "unconfigured";
  readonly serpApi: "configured" | "unconfigured";
};

export function toResearchProviderSecrets(parsed: {
  readonly TAVILY_API_KEY?: string | undefined;
  readonly BRIGHT_DATA_API_KEY?: string | undefined;
  readonly BRIGHT_DATA_SERP_ZONE?: string | undefined;
  readonly BRIGHT_DATA_UNLOCKER_ZONE?: string | undefined;
  readonly SERP_API_KEY?: string | undefined;
}): ResearchProviderSecrets {
  return {
    serpApi:
      parsed.SERP_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.SERP_API_KEY),
    tavily:
      parsed.TAVILY_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.TAVILY_API_KEY),
    brightData:
      parsed.BRIGHT_DATA_API_KEY === undefined
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
  };
}
