import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  WebSearchTool20250305,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { ModelProviderFailure } from "../errors.js";
import type {
  HostedWebSearchAdapter,
  HostedWebSearchAdapterResult,
  HostedWebSource,
} from "../web-search.js";
import {
  ANTHROPIC_PROVIDER_CODE,
  normalizeError,
  thinkingOffFor,
  toUsage,
} from "./anthropic.js";

/**
 * The Claude API's own web search tool behind the gateway's hosted-search
 * port (DECISIONS 103). One request, one hosted tool with a small use
 * bound, no tool of Capital Q's: the model can search and nothing else.
 *
 * The basic tool version is declared on purpose: the newer one filters
 * results by running code server-side, which spends tokens this path does
 * not need -- it wants the addresses and the passages cited, not an
 * answer. What comes back is reduced to that list here; the model's own
 * prose, the encrypted page content and the vendor's ids stop at this
 * file.
 */

/** The hosted tool version this adapter declares. */
export const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = "web_search_20250305";

/** Characters of cited text kept per source. */
const QUOTED_TEXT_MAX_CHARS = 600;

export type AnthropicWebSearchClient = {
  readonly messages: Pick<Anthropic["messages"], "create">;
};

export function createAnthropicHostedWebSearch(options: {
  readonly apiKey: string;
  /** For tests: a client already built. */
  readonly client?: AnthropicWebSearchClient | undefined;
}): HostedWebSearchAdapter {
  const client: AnthropicWebSearchClient =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      // One attempt: a failed search falls back to "unavailable", it is not retried.
      maxRetries: 0,
    });
  return {
    code: ANTHROPIC_PROVIDER_CODE,
    search: async (request, context) => {
      const thinking = thinkingOffFor(request.modelCode);
      if (thinking === undefined) {
        // A model whose request rules this adapter does not know.
        throw new ModelProviderFailure(
          "anthropic web search: model not permitted",
          {
            failureClass: "INVALID_REQUEST",
            providerCode: ANTHROPIC_PROVIDER_CODE,
          },
        );
      }
      const params = webSearchRequest(request, thinking);
      let message: Message;
      try {
        message = await client.messages.create(params, {
          signal: context.signal,
        });
      } catch (error: unknown) {
        throw normalizeError(error);
      }
      return webSearchResult(message);
    },
  };
}

/** The request body. Exported for the tests. */
export function webSearchRequest(
  request: Parameters<HostedWebSearchAdapter["search"]>[0],
  thinking: NonNullable<ReturnType<typeof thinkingOffFor>>,
): MessageCreateParamsNonStreaming {
  const tool: WebSearchTool20250305 = {
    type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: request.maxUses,
    ...(request.allowedDomains.length === 0
      ? {}
      : { allowed_domains: [...request.allowedDomains] }),
  };
  return {
    model: request.modelCode,
    max_tokens: request.maxOutputTokens,
    system: request.instruction,
    thinking,
    output_config: { effort: "low" },
    tools: [tool],
    messages: [{ role: "user", content: request.query }],
  };
}

/**
 * Sources from one response: every result the hosted search returned, in
 * order, one per address, with the passages the model cited from it. A
 * result the model did not cite is kept (it was found) with no quote.
 */
export function webSearchResult(
  message: Pick<Message, "content" | "usage" | "model" | "id">,
): HostedWebSearchAdapterResult {
  const quoted = new Map<string, string[]>();
  for (const block of message.content) {
    if (block.type !== "text" || block.citations === null) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location") continue;
      const text = citation.cited_text.trim();
      if (text.length === 0) continue;
      const list = quoted.get(citation.url) ?? [];
      if (!list.includes(text)) list.push(text);
      quoted.set(citation.url, list);
    }
  }
  const sources: HostedWebSource[] = [];
  const seen = new Set<string>();
  let searchErrorCode: string | null = null;
  let searchCalls = 0;
  for (const block of message.content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      searchCalls += 1;
      continue;
    }
    if (block.type !== "web_search_tool_result") continue;
    // A failed search answers 200 with an error object, not a list.
    if (!Array.isArray(block.content)) {
      searchErrorCode = block.content.error_code;
      continue;
    }
    for (const result of block.content) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      sources.push({
        url: result.url,
        title: result.title.trim().length > 0 ? result.title.trim() : null,
        quotedText: (quoted.get(result.url) ?? [])
          .join(" … ")
          .slice(0, QUOTED_TEXT_MAX_CHARS),
        pageAge: result.page_age ?? null,
      });
    }
  }
  // Cited first: what the model found matching ranks above what it skimmed.
  const ordered = [
    ...sources.filter((source) => source.quotedText.length > 0),
    ...sources.filter((source) => source.quotedText.length === 0),
  ];
  return {
    sources: ordered,
    searchRequests:
      message.usage.server_tool_use?.web_search_requests ?? searchCalls,
    usage: toUsage(message),
    modelCode: message.model,
    providerReference: message.id,
    searchErrorCode: ordered.length === 0 ? searchErrorCode : null,
  };
}
