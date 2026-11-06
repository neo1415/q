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

/**
 * Live 2026-11-06 (Savanna Seed, production c71eb2ee4): one call with nine
 * pages (~5,000 tokens in, up to 2,400 out) timed out twice at 12 s, so the
 * discovery listed nothing. The pages are now read a few at a time, side by
 * side: each call is small, has its own deadline, and a call that fails
 * costs only its own pages. The whole read has one deadline too.
 */
export const WEB_DISCOVERY_READER_LIMITS = {
  /** Pages per reading call. */
  pagesPerCall: 3,
  /** Characters of each page a call is given. */
  pageChars: 2_500,
  attemptTimeoutMs: 15_000,
  /** The whole read, every call included. */
  deadlineMs: 20_000,
  maxOutputTokens: 1_200,
} as const;

export type WebDiscoveryReaderLimits = {
  readonly pagesPerCall: number;
  readonly pageChars: number;
  readonly attemptTimeoutMs: number;
  readonly deadlineMs: number;
  readonly maxOutputTokens: number;
};

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

/** Null only when every reading call failed. */
export type WebDiscoveryReader = (
  input: WebDiscoveryReaderInput,
) => Promise<readonly WebDiscoveryCompany[] | null>;

export function createWebDiscoveryReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  /** Tests only: smaller limits. */
  readonly limits?: WebDiscoveryReaderLimits | undefined;
}): WebDiscoveryReader {
  const registry = createDefaultPromptRegistry();
  const limits = dependencies.limits ?? WEB_DISCOVERY_READER_LIMITS;
  const readOne = async (
    input: WebDiscoveryReaderInput,
    sources: WebDiscoveryReaderInput["sources"],
    signal: AbortSignal,
  ): Promise<readonly WebDiscoveryCompany[] | null> => {
    const rendered = renderPrompt<WebDiscoveryReaderVariables>(registry, {
      task: "WEB_DISCOVERY_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied pages say.",
      variables: {
        looking: input.looking.slice(0, 600),
        sources: sources.map((source, index) => ({
          index,
          url: source.url.slice(0, 500),
          title: source.title === null ? null : source.title.slice(0, 300),
          publishedAt: source.publishedAt,
          excerpt: source.excerpt.slice(0, limits.pageChars),
        })),
      },
    });
    try {
      const result =
        await dependencies.gateway.execute<WebDiscoveryReaderResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            budget: {
              maxAttempts: 2,
              maxEstimatedCostUsd: 0.03,
              maxOutputTokens: limits.maxOutputTokens,
              attemptTimeoutMs: limits.attemptTimeoutMs,
            },
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
          { schema: WebDiscoveryReaderResultSchema, signal },
        );
      if (result.output.kind !== "STRUCTURED") return null;
      const value = WebDiscoveryReaderResultSchema.safeParse(
        result.output.value,
      );
      return value.success ? value.data.companies : null;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        {
          err: error,
          correlationId: input.attribution.correlationId,
          pages: sources.length,
        },
        "web discovery reader produced nothing",
      );
      return null;
    }
  };
  return async (input) => {
    if (input.sources.length === 0) return [];
    const deadline = AbortSignal.timeout(limits.deadlineMs);
    const signal =
      input.signal === undefined
        ? deadline
        : AbortSignal.any([deadline, input.signal]);
    const groups: WebDiscoveryReaderInput["sources"][] = [];
    const pages = input.sources.slice(0, WEB_DISCOVERY_READER_PAGES_MAX);
    for (let i = 0; i < pages.length; i += limits.pagesPerCall) {
      groups.push(pages.slice(i, i + limits.pagesPerCall));
    }
    const read = await Promise.all(
      groups.map((group) => readOne(input, group, signal)),
    );
    const done = read.filter(
      (companies): companies is readonly WebDiscoveryCompany[] =>
        companies !== null,
    );
    if (done.length < read.length) {
      dependencies.logger?.warn(
        {
          correlationId: input.attribution.correlationId,
          calls: read.length,
          failed: read.length - done.length,
        },
        "web discovery reader: some page groups were not read",
      );
    }
    return done.length === 0 ? null : done.flat();
  };
}
