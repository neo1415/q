import {
  HostedWebSearchUnavailable,
  type HostedWebSearch,
} from "@capital-q/model-gateway";
import type { ResearchProviderFailureClass } from "@capital-q/q-research";
import type { ModelHostedSearchPort } from "@capital-q/q-research/providers/model-hosted-search";

/**
 * DECISIONS 103: the research port's model-hosted search, filled with the
 * Model Gateway's hosted search. The gateway's refusals become research
 * failure classes; nothing of the vendor's reaches the research side.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function modelHostedSearchPort(
  hosted: HostedWebSearch,
): ModelHostedSearchPort {
  return async (call) => {
    try {
      const result = await hosted.search({
        query: call.query,
        includeDomains: call.includeDomains,
        attribution: {
          tenantId: call.attribution.tenantId,
          ...(call.attribution.userId === undefined
            ? {}
            : { userId: call.attribution.userId }),
          // The ledger's run column holds a Q run's id, nothing else.
          ...(call.attribution.runId !== undefined &&
          UUID.test(call.attribution.runId)
            ? { qRunId: call.attribution.runId }
            : {}),
          correlationId: call.attribution.correlationId.slice(0, 128),
        },
        ...(call.signal === undefined ? {} : { signal: call.signal }),
      });
      return {
        ok: true,
        sources: result.sources,
        latencyMs: result.latencyMs,
      };
    } catch (error: unknown) {
      if (!(error instanceof HostedWebSearchUnavailable)) throw error;
      return { ok: false, failureClass: failureClassOf(error) };
    }
  };
}

function failureClassOf(
  error: HostedWebSearchUnavailable,
): ResearchProviderFailureClass {
  switch (error.refusal) {
    case "CAP_REACHED":
      return "RATE_LIMIT";
    case "INVALID_REQUEST":
      return "VALIDATION";
    case "INELIGIBLE":
    case "SEARCH_FAILED":
      return "UNAVAILABLE";
    case "PROVIDER_FAILED":
      return error.failureClass === "AUTHENTICATION" ||
        error.failureClass === "RATE_LIMIT" ||
        error.failureClass === "TIMEOUT"
        ? error.failureClass
        : "UNAVAILABLE";
  }
}
