import {
  RESEARCH_BOUNDS,
  type PublicWebSearchResult,
  type ResearchProviderFailureClass,
} from "../contracts.js";
import { judgePublicUrl } from "../domain/url-safety.js";
import {
  isResearchProviderFailure,
  ResearchProviderFailure,
  type PublicWebResearchProvider,
  type ResearchExecutionContext,
} from "../ports.js";
import { webText } from "./web-text.js";

/**
 * The model-hosted web search (DECISIONS 103) behind the research port,
 * and the last-resort chain that puts it after every configured index.
 *
 * Nothing here calls a model. The search itself is a port the composition
 * fills with the Model Gateway's hosted search, so the request goes
 * through the gateway's eligibility, ledger and daily cap like every other
 * model call. This side owns what the research port owns: what may leave
 * (the composed query, the domains a caller pinned, nothing else), the
 * per-turn bound, and turning what came back into ordinary search hits --
 * public material of unknown reliability, labelled with this provider's
 * code wherever it is recorded, read and cited exactly as another index's
 * results are.
 */

export const MODEL_HOSTED_SEARCH_CODE = "model_hosted_web_search" as const;

/** Model-hosted searches one research turn may make. */
export const MODEL_HOSTED_SEARCHES_PER_TURN = 1;

/** One source the hosted search found. */
export type ModelHostedSource = {
  readonly url: string;
  readonly title: string | null;
  readonly quotedText: string;
  readonly pageAge: string | null;
};

/** What crosses into the gateway: the composed query and identifiers only. */
export type ModelHostedSearchCall = {
  readonly query: string;
  readonly includeDomains: readonly string[];
  readonly attribution: {
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly runId?: string | undefined;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type ModelHostedSearchPort = (call: ModelHostedSearchCall) => Promise<
  | {
      readonly ok: true;
      readonly sources: readonly ModelHostedSource[];
      readonly latencyMs: number;
    }
  | { readonly ok: false; readonly failureClass: ResearchProviderFailureClass }
>;

/** Turns remembered for the per-turn bound; the oldest is forgotten first. */
const TURNS_REMEMBERED = 1_024;

export function createModelHostedSearchProvider(input: {
  readonly search: ModelHostedSearchPort;
  readonly perTurn?: number | undefined;
}): PublicWebResearchProvider {
  const perTurn = input.perTurn ?? MODEL_HOSTED_SEARCHES_PER_TURN;
  const used = new Map<string, number>();
  const failure = (failureClass: ResearchProviderFailureClass) =>
    new ResearchProviderFailure({
      providerCode: MODEL_HOSTED_SEARCH_CODE,
      failureClass,
    });

  return {
    code: MODEL_HOSTED_SEARCH_CODE,
    // It searches; it reads no page (the readers the chain already has do).
    canReadPages: false,
    search: async (request, context) => {
      const who = context.attribution;
      // No turn to bill and bound: no hosted search.
      if (who === undefined) throw failure("UNAVAILABLE");
      const turn = `${who.tenantId}:${who.runId ?? who.correlationId}`;
      const count = used.get(turn) ?? 0;
      if (count >= perTurn) throw failure("UNAVAILABLE");
      // Reserved before the await, so two searches of one turn started
      // side by side cannot both pass.
      used.delete(turn);
      used.set(turn, count + 1);
      if (used.size > TURNS_REMEMBERED) {
        const oldest = used.keys().next().value;
        if (oldest !== undefined) used.delete(oldest);
      }

      const started = Date.now();
      const answer = await input.search({
        // Only the composed public query and the pinned domains leave.
        query: request.query,
        includeDomains: request.includeDomains,
        attribution: {
          tenantId: who.tenantId,
          ...(who.userId === undefined ? {} : { userId: who.userId }),
          ...(who.runId === undefined ? {} : { runId: who.runId }),
          correlationId: who.correlationId,
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (!answer.ok) throw failure(answer.failureClass);
      return {
        hits: hostedHits(answer.sources, request.maxResults),
        latencyMs: Math.max(0, Date.now() - started),
      };
    },
    extract: () => Promise.reject(failure("VALIDATION")),
  };
}

/** The hosted search's sources as ordinary, bounded, safe search hits. */
export function hostedHits(
  sources: readonly ModelHostedSource[],
  maxResults: number,
): PublicWebSearchResult["hits"] {
  const hits: PublicWebSearchResult["hits"] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const verdict = judgePublicUrl(source.url);
    if (!verdict.ok || seen.has(verdict.url)) continue;
    seen.add(verdict.url);
    const title =
      source.title === null ? "" : webText(source.title).slice(0, 300);
    const age = source.pageAge?.trim() ?? "";
    hits.push({
      url: verdict.url,
      title: title.length > 0 ? title : null,
      snippet: webText(source.quotedText).slice(
        0,
        RESEARCH_BOUNDS.maxSnippetChars,
      ),
      // Only a date the platform can read; "3 days ago" is not one.
      publishedAt:
        age.length > 0 && !Number.isNaN(Date.parse(age))
          ? age.slice(0, 40)
          : null,
      relevance: Math.max(0, 1 - hits.length * 0.05),
    });
    if (hits.length >= Math.min(maxResults, RESEARCH_BOUNDS.maxSearchResults)) {
      break;
    }
  }
  return hits;
}

/**
 * The configured indexes first; the last resort only when they all failed.
 *
 * A search the indexes answered -- even with nothing found -- is their
 * answer: an empty result is not a reason to pay for another search. Only
 * a failure of every index (a spent or refused key, a rate limit, an
 * outage, a timeout) reaches the last resort; a request the indexes
 * refused as invalid does not. If the last resort fails too, the indexes'
 * own failure is reported, exactly as before it existed. Pages are read
 * by the indexes' readers only. The provider code is the one that
 * answered the last search, so evidence names it.
 */
export function createLastResortSearchProvider(input: {
  readonly primary: PublicWebResearchProvider;
  readonly lastResort: PublicWebResearchProvider;
  readonly onFallback?:
    | ((event: {
        readonly provider: string;
        readonly outcome: "FOUND" | "EMPTY" | "FAILED";
        readonly primaryFailure: ResearchProviderFailureClass;
        readonly failureClass: ResearchProviderFailureClass | null;
      }) => void)
    | undefined;
}): PublicWebResearchProvider {
  const { primary, lastResort } = input;
  let answeredBy: PublicWebResearchProvider = primary;
  const search = async (
    request: Parameters<PublicWebResearchProvider["search"]>[0],
    context: ResearchExecutionContext,
  ): Promise<PublicWebSearchResult> => {
    try {
      const result = await primary.search(request, context);
      answeredBy = primary;
      return result;
    } catch (error: unknown) {
      if (
        !isResearchProviderFailure(error) ||
        error.failureClass === "VALIDATION" ||
        context.signal?.aborted === true
      ) {
        throw error;
      }
      try {
        const result = await lastResort.search(request, context);
        answeredBy = lastResort;
        input.onFallback?.({
          provider: lastResort.code,
          outcome: result.hits.length > 0 ? "FOUND" : "EMPTY",
          primaryFailure: error.failureClass,
          failureClass: null,
        });
        return result;
      } catch (last: unknown) {
        if (!isResearchProviderFailure(last)) throw last;
        input.onFallback?.({
          provider: lastResort.code,
          outcome: "FAILED",
          primaryFailure: error.failureClass,
          failureClass: last.failureClass,
        });
        throw error;
      }
    }
  };
  return {
    get code() {
      return answeredBy.code;
    },
    search,
    extract: (request, context) => primary.extract(request, context),
    ...(primary.canSearch === false && lastResort.canSearch === false
      ? { canSearch: false as const }
      : {}),
    ...(primary.canReadPages === false ? { canReadPages: false as const } : {}),
  };
}
