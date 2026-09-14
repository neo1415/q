import { z } from "zod";

import { ProviderCredential } from "./model-providers.js";

/**
 * Public-web research provider credential (CQ-Q-RESEARCH-001 §4).
 *
 * Optional: q-api starts without it and the research tools are simply not
 * registered. The key is server-only — never NEXT_PUBLIC_, never a log
 * field, never a prompt, never a database row — and wrapped so that
 * stringifying configuration yields "[redacted]". The adapter reads it once
 * at composition through reveal(). Configuration reports presence only.
 */

export const RESEARCH_PROVIDER_ENV_NAMES = ["TAVILY_API_KEY"] as const;

const apiKey = z
  .string()
  .trim()
  .min(16, "expected a provider API key")
  .max(512, "expected a provider API key");

export const researchProviderEnvShape = {
  TAVILY_API_KEY: apiKey.optional(),
};

export type ResearchProviderSecrets = {
  /** Tavily search + extract; absent means the research tools are not composed. */
  readonly tavily: ProviderCredential | undefined;
};

export type ResearchProviderConfigStatus = {
  readonly tavily: "configured" | "unconfigured";
};

export function toResearchProviderSecrets(parsed: {
  readonly TAVILY_API_KEY?: string | undefined;
}): ResearchProviderSecrets {
  return {
    tavily:
      parsed.TAVILY_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.TAVILY_API_KEY),
  };
}

/** Safe to log: whether the adapter exists, never what it holds. */
export function researchProviderConfigStatus(
  secrets: ResearchProviderSecrets,
): ResearchProviderConfigStatus {
  return {
    tavily: secrets.tavily === undefined ? "unconfigured" : "configured",
  };
}
