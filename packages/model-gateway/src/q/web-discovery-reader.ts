import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  WEB_DISCOVERY_READER_PAGES_MAX,
  WebDiscoveryReaderResultSchema,
  type WebDiscoveryCompany,
  type WebDiscoveryReaderResult,
  type WebDiscoveryReaderVariables,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * Owner 2026-11-06: the model that reads public pages (directories, lists,
 * news, company sites) and PROPOSES the companies and founders they name.
 * It is a reader; code admits (`admitDiscoveries` in web-discovery.ts): a
 * name that is not on a page fetched in this run is dropped. Its prompt
 * holds public page text inside the untrusted fences and public taxonomy
 * words; never a Capital Q record, figure, note or the person's words.
 */

const READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 2_400,
  attemptTimeoutMs: 12_000,
} as const;

export type WebDiscoveryReaderInput = {
  /** Public taxonomy words only ("fintech; seed; Nigeria"). */
  readonly looking: string;
  readonly sources: readonly {
    readonly url: string;
    readonly title: string | null;
    readonly publishedAt: string | null;
    readonly excerpt: string;
  }[];
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type WebDiscoveryReader = (
  input: WebDiscoveryReaderInput,
) => Promise<readonly WebDiscoveryCompany[] | null>;

export function createWebDiscoveryReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): WebDiscoveryReader {
  const registry = createDefaultPromptRegistry();
  return async (input) => {
    if (input.sources.length === 0) return [];
    const rendered = renderPrompt<WebDiscoveryReaderVariables>(registry, {
      task: "WEB_DISCOVERY_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied pages say.",
      variables: {
        looking: input.looking.slice(0, 600),
        sources: input.sources
          .slice(0, WEB_DISCOVERY_READER_PAGES_MAX)
          .map((source, index) => ({
            index,
            url: source.url.slice(0, 500),
            title: source.title === null ? null : source.title.slice(0, 300),
            publishedAt: source.publishedAt,
            excerpt: source.excerpt.slice(0, 6_000),
          })),
      },
    });
    try {
      const result =
        await dependencies.gateway.execute<WebDiscoveryReaderResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            budget: READER_BUDGET,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            // Public pages and public taxonomy words. Nothing confidential
            // is in the prompt, and nothing may be added to it.
            sensitivity: "INTERNAL",
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "RESEARCH",
              tenantId: input.attribution.tenantId,
              userId: input.attribution.userId,
              correlationId: input.attribution.correlationId,
            },
          },
          {
            schema: WebDiscoveryReaderResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
      if (result.output.kind !== "STRUCTURED") return null;
      const value = WebDiscoveryReaderResultSchema.safeParse(
        result.output.value,
      );
      return value.success ? value.data.companies : null;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, correlationId: input.attribution.correlationId },
        "web discovery reader produced nothing",
      );
      return null;
    }
  };
}
