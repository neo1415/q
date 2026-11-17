import {
  ModelAttributionSchema,
  sensitivityAtMost,
  type ModelEligibilityReason,
  type ModelFailureClass,
  type ModelProviderCode,
  type ModelSensitivity,
  type ModelUsage,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";

import {
  effectivePrice,
  indexCatalog,
  isModelEffective,
  type ModelCatalog,
  type ModelPriceRecord,
  type ModelRecord,
  type ProviderRecord,
} from "./catalog.js";
import { ModelProviderFailure } from "./errors.js";
import { priceUsage } from "./policy/cost.js";
import { providerJustifiedCeiling } from "./policy/eligibility.js";
import type { ModelSpendCap } from "./policy/spend-cap.js";
import type {
  ModelCatalogPort,
  ModelUsageRepository,
  TenantModelPolicyPort,
} from "./ports.js";

/**
 * Model-hosted public web search (DECISIONS 103, owner 2026-11-17): the
 * last fallback of Q's public research, used only when every configured
 * search index is spent or unavailable.
 *
 * It is a gateway call, held to what every model call is held to: the
 * model and its provider come from the catalogue, the request is judged
 * for eligibility before anything leaves (it is PUBLIC by construction --
 * only the research query builder's public terms are ever passed in), each
 * attempt is one row in the usage ledger with its cost, and a daily cap
 * bounds what it may spend. What it returns is a list of public sources
 * (address, title, the words the model quoted from them), never an answer:
 * the research service reads, ranks and labels them as it does any other
 * index's results.
 *
 * Kept apart from `ModelGateway.execute` on purpose: that path routes a
 * task class over versioned policies and never declares a vendor-hosted
 * tool. This one names one catalogued model by configuration and declares
 * exactly one hosted tool with a small use bound.
 */

/** Searches the model may run in one request. */
export const HOSTED_WEB_SEARCH_MAX_USES = 3;
/**
 * The vendor's search fee, USD per search (USD 10 per 1,000 searches, the
 * published rate on 2026-11-17), billed on top of the tokens.
 */
export const HOSTED_WEB_SEARCH_FEE_USD = 0.01;
/** Output the model may write: a short list of sources, nothing more. */
export const HOSTED_WEB_SEARCH_MAX_OUTPUT_TOKENS = 1_024;
/** Wall clock for the one attempt. */
export const HOSTED_WEB_SEARCH_TIMEOUT_MS = 30_000;
/** Sources kept from one request. */
export const HOSTED_WEB_SEARCH_MAX_SOURCES = 8;

/** The only sensitivity this path ever carries. */
const SENSITIVITY: ModelSensitivity = "PUBLIC";

/**
 * The instruction the model is given. It asks for the sources found and
 * nothing of the model's own: whatever it writes besides its citations is
 * discarded by the adapter.
 */
export const HOSTED_WEB_SEARCH_INSTRUCTION =
  "Search the public web for the query. Return the sources found: for each, cite the passage that matches the query. Do not answer the query yourself and do not add anything the sources do not say.";

/** A public source the hosted search found; unverified material. */
export type HostedWebSource = {
  readonly url: string;
  readonly title: string | null;
  /** The words the model cited from the page; empty when it cited none. */
  readonly quotedText: string;
  /** The page's age as the vendor states it (free text), or null. */
  readonly pageAge: string | null;
};

/** What one adapter call returns. No raw payload, no model prose. */
export type HostedWebSearchAdapterResult = {
  readonly sources: readonly HostedWebSource[];
  /** Searches the vendor billed for this request. */
  readonly searchRequests: number;
  readonly usage: ModelUsage | undefined;
  readonly modelCode: string;
  readonly providerReference: string | undefined;
  /** The vendor's search error token when the search itself failed. */
  readonly searchErrorCode: string | null;
  /**
   * The vendor answered but its content could not be read: the usage is
   * still priced and recorded; no source is returned.
   */
  readonly unreadable: boolean;
};

export type HostedWebSearchAdapterRequest = {
  readonly modelCode: string;
  readonly query: string;
  /** Domains to keep the search to; empty: the whole web. */
  readonly allowedDomains: readonly string[];
  readonly maxUses: number;
  readonly maxOutputTokens: number;
  readonly instruction: string;
};

/** One vendor's hosted web search, behind the providers/* subpaths. */
export type HostedWebSearchAdapter = {
  readonly code: ModelProviderCode;
  /** Rejects with ModelProviderFailure; never with a vendor exception. */
  readonly search: (
    request: HostedWebSearchAdapterRequest,
    context: { readonly signal: AbortSignal },
  ) => Promise<HostedWebSearchAdapterResult>;
};

export type HostedWebSearchRequest = {
  /** A query already composed from public research terms; nothing else. */
  readonly query: string;
  readonly includeDomains: readonly string[];
  readonly attribution: {
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly qRunId?: string | undefined;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type HostedWebSearchResult = {
  readonly sources: readonly HostedWebSource[];
  readonly searchRequests: number;
  readonly costUsd: number;
  readonly providerCode: ModelProviderCode;
  readonly modelCode: string;
  readonly latencyMs: number;
};

export type HostedWebSearchRefusal =
  | "CAP_REACHED"
  | "INELIGIBLE"
  | "INVALID_REQUEST"
  | "PROVIDER_FAILED"
  | "SEARCH_FAILED";

/** Why no hosted search ran or answered. Carries no vendor text. */
export class HostedWebSearchUnavailable extends Error {
  readonly refusal: HostedWebSearchRefusal;
  readonly failureClass: ModelFailureClass | undefined;
  readonly eligibility: ModelEligibilityReason | undefined;

  constructor(input: {
    readonly refusal: HostedWebSearchRefusal;
    readonly failureClass?: ModelFailureClass | undefined;
    readonly eligibility?: ModelEligibilityReason | undefined;
    readonly cause?: unknown;
  }) {
    super(`model-hosted web search unavailable (${input.refusal})`, {
      cause: input.cause,
    });
    this.name = "HostedWebSearchUnavailable";
    this.refusal = input.refusal;
    this.failureClass = input.failureClass;
    this.eligibility = input.eligibility;
  }
}

export type HostedWebSearch = {
  readonly search: (
    request: HostedWebSearchRequest,
  ) => Promise<HostedWebSearchResult>;
};

export type HostedWebSearchDependencies = {
  readonly catalog: ModelCatalogPort;
  readonly adapter: HostedWebSearchAdapter;
  readonly usage: ModelUsageRepository;
  /** The catalogued model to run, by code (configuration, never business code). */
  readonly modelCode: string;
  /**
   * Every ceiling a request must pass before it starts: this path's own
   * daily cap first, then the aggregate one when there is one.
   */
  readonly caps: readonly ModelSpendCap[];
  readonly tenantPolicies?: TenantModelPolicyPort | undefined;
  readonly maxUses?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

type Route = {
  readonly provider: ProviderRecord;
  readonly model: ModelRecord;
  readonly price: ModelPriceRecord;
};

/**
 * Whether the configured model may take a PUBLIC hosted search now: the
 * same checks, in the same order, as a routed candidate -- provider
 * status, model status and period, the model's own ceiling, the ceiling
 * the provider's reviewed terms justify, tenant policy, and a known price
 * (an unpriced search is a search whose cost the cap cannot count).
 */
export function judgeHostedSearchRoute(input: {
  readonly catalog: ModelCatalog;
  readonly providerCode: ModelProviderCode;
  readonly modelCode: string;
  readonly allowedProviders?:
    | {
        readonly allowed?: readonly string[];
        readonly denied: readonly string[];
      }
    | undefined;
  readonly now: Date;
}):
  | ({ readonly ok: true } & Route)
  | { readonly ok: false; readonly reason: ModelEligibilityReason } {
  const provider = input.catalog.providerByCode.get(input.providerCode);
  if (provider === undefined || provider.status !== "ACTIVE") {
    return { ok: false, reason: "PROVIDER_DISABLED" };
  }
  const model = [...input.catalog.modelById.values()].find(
    (candidate) =>
      candidate.providerId === provider.id &&
      candidate.modelCode === input.modelCode,
  );
  if (model === undefined || model.status !== "ACTIVE") {
    return { ok: false, reason: "MODEL_DISABLED" };
  }
  if (!isModelEffective(model, input.now)) {
    return { ok: false, reason: "MODEL_NOT_EFFECTIVE" };
  }
  if (!sensitivityAtMost(SENSITIVITY, model.sensitivityCeiling)) {
    return { ok: false, reason: "SENSITIVITY_EXCEEDS_CEILING" };
  }
  if (!sensitivityAtMost(SENSITIVITY, providerJustifiedCeiling(provider))) {
    return { ok: false, reason: "PROVIDER_POLICY_INSUFFICIENT" };
  }
  const tenant = input.allowedProviders;
  if (
    tenant !== undefined &&
    (tenant.denied.includes(provider.code) ||
      (tenant.allowed !== undefined && !tenant.allowed.includes(provider.code)))
  ) {
    return { ok: false, reason: "TENANT_POLICY_DENIES_PROVIDER" };
  }
  const price = effectivePrice(input.catalog, model.id, input.now);
  if (price === null) return { ok: false, reason: "PRICE_UNKNOWN" };
  return { ok: true, provider, model, price };
}

/** An error's class name and system code, when they are plain tokens. */
function tokenOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value)
    ? value
    : undefined;
}

/** An error's class: its `name`, or its constructor's when that is generic. */
function nameOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return tokenOf(error.name === "Error" ? error.constructor.name : error.name);
}

/**
 * The structured fields of one failed hosted search: the class it was
 * recorded under, the vendor's HTTP status, error type and request id,
 * and the names of the errors underneath (a connection failure's
 * system code, for instance). Never a message, the query or a key.
 */
export function hostedSearchFailureFields(
  providerCode: ModelProviderCode,
  failureClass: ModelFailureClass,
  error: unknown,
  startedAtMs: number,
): Record<string, string | number | boolean | undefined> {
  const failure = error instanceof ModelProviderFailure ? error : undefined;
  const cause: unknown = failure === undefined ? error : failure.cause;
  const nested: unknown = cause instanceof Error ? cause.cause : undefined;
  // A connection failure's system code sits a level or two further down
  // (SDK error -> fetch TypeError -> socket error).
  let causeCode: string | undefined;
  let link: unknown = nested;
  for (let depth = 0; depth < 3 && link instanceof Error; depth += 1) {
    causeCode = tokenOf((link as { code?: unknown }).code) ?? causeCode;
    link = link.cause;
  }
  return {
    provider: providerCode,
    failureClass,
    httpStatus: failure?.providerStatus,
    errorType: failure?.vendorErrorCode,
    providerRequestId: failure?.providerRequestId,
    accountExhausted: failure?.accountExhausted,
    errorName: nameOf(cause),
    causeName: nameOf(nested),
    causeCode,
    latencyMs: Math.max(0, Date.now() - startedAtMs),
  };
}

/** Token cost from the price snapshot plus the per-search fee, in USD. */
export function hostedSearchCostUsd(
  usage: ModelUsage | undefined,
  searchRequests: number,
  price: ModelPriceRecord,
): number {
  const tokens =
    usage === undefined ? 0 : priceUsage(usage, price, "PRICE_SNAPSHOT").amount;
  const fee = Math.max(0, searchRequests) * HOSTED_WEB_SEARCH_FEE_USD;
  return Math.round((tokens + fee) * 1e8) / 1e8;
}

export function createHostedWebSearch(
  dependencies: HostedWebSearchDependencies,
): HostedWebSearch {
  const now = dependencies.now ?? (() => new Date());
  const maxUses = Math.max(
    1,
    Math.min(
      HOSTED_WEB_SEARCH_MAX_USES,
      dependencies.maxUses ?? HOSTED_WEB_SEARCH_MAX_USES,
    ),
  );
  const timeoutMs = dependencies.timeoutMs ?? HOSTED_WEB_SEARCH_TIMEOUT_MS;
  const adapter = dependencies.adapter;

  return {
    search: async (request) => {
      const attribution = ModelAttributionSchema.safeParse({
        ...request.attribution,
        purpose: "PUBLIC_WEB_SEARCH",
      });
      const query = request.query.trim();
      if (!attribution.success || query.length === 0 || query.length > 400) {
        throw new HostedWebSearchUnavailable({ refusal: "INVALID_REQUEST" });
      }
      const who = attribution.data;

      for (const cap of dependencies.caps) {
        const verdict = await cap.check();
        if (!verdict.allowed) {
          dependencies.logger?.warn(
            { capUsd: verdict.capUsd, spentUsd: verdict.spentUsd },
            "model-hosted web search: daily cap reached",
          );
          throw new HostedWebSearchUnavailable({
            refusal: "CAP_REACHED",
            failureClass: "BUDGET_EXCEEDED",
          });
        }
      }

      const at = now();
      const catalog = indexCatalog(await dependencies.catalog.load());
      const tenantPolicy = await dependencies.tenantPolicies?.policyFor(
        who.tenantId,
      );
      const route = judgeHostedSearchRoute({
        catalog,
        providerCode: adapter.code,
        modelCode: dependencies.modelCode,
        allowedProviders:
          tenantPolicy === undefined
            ? undefined
            : {
                ...(tenantPolicy.allowedProviderCodes === undefined
                  ? {}
                  : { allowed: tenantPolicy.allowedProviderCodes }),
                denied: tenantPolicy.deniedProviderCodes,
              },
        now: at,
      });
      if (!route.ok) {
        dependencies.logger?.warn(
          { eligibility: route.reason },
          "model-hosted web search: no eligible route",
        );
        throw new HostedWebSearchUnavailable({
          refusal: "INELIGIBLE",
          failureClass: "POLICY_INELIGIBLE",
          eligibility: route.reason,
        });
      }

      const started = Date.now();
      const signal =
        request.signal === undefined
          ? AbortSignal.timeout(timeoutMs)
          : AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      const record = async (outcome: {
        readonly usage: ModelUsage | undefined;
        readonly costUsd: number | undefined;
        readonly errorCode: ModelFailureClass | undefined;
      }): Promise<void> => {
        if (outcome.costUsd !== undefined) {
          for (const cap of dependencies.caps) cap.note(outcome.costUsd);
        }
        try {
          await dependencies.usage.record({
            tenantId: who.tenantId,
            userId: who.userId,
            qRunId: who.qRunId,
            // The model reads search results and reports their sources:
            // evidence gathering, told apart in the ledger by its purpose.
            taskClass: "EVIDENCE_SYNTHESIS",
            providerId: route.provider.id,
            modelId: route.model.id,
            routingPolicyId: undefined,
            attempt: 1,
            inputTokens: outcome.usage?.inputTokens ?? 0,
            cachedInputTokens: outcome.usage?.cachedInputTokens ?? 0,
            outputTokens: outcome.usage?.outputTokens ?? 0,
            latencyMs: Math.max(0, Date.now() - started),
            costUsd: outcome.costUsd,
            costBasis:
              outcome.costUsd === undefined ? "UNPRICED" : "PRICE_SNAPSHOT",
            success: outcome.errorCode === undefined,
            errorCode: outcome.errorCode,
            correlationId: who.correlationId,
            purpose: "PUBLIC_WEB_SEARCH",
          });
        } catch (error: unknown) {
          // The ledger never takes the answer down; the in-process cap
          // tally above already counted the spend.
          dependencies.logger?.warn(
            { err: error },
            "model-hosted web search: usage row not recorded",
          );
        }
      };

      let answer: HostedWebSearchAdapterResult;
      try {
        answer = await adapter.search(
          {
            modelCode: route.model.modelCode,
            query,
            allowedDomains: request.includeDomains,
            maxUses,
            maxOutputTokens: Math.min(
              HOSTED_WEB_SEARCH_MAX_OUTPUT_TOKENS,
              route.model.maxOutputTokens,
            ),
            instruction: HOSTED_WEB_SEARCH_INSTRUCTION,
          },
          { signal },
        );
      } catch (error: unknown) {
        // The adapter rejects only with ModelProviderFailure; anything else
        // is a fault of ours that asking again will not cure.
        const failureClass =
          error instanceof ModelProviderFailure
            ? error.failureClass
            : "PERMANENT";
        dependencies.logger?.warn(
          hostedSearchFailureFields(adapter.code, failureClass, error, started),
          "model-hosted web search failed",
        );
        await record({
          usage: undefined,
          costUsd: undefined,
          errorCode: failureClass,
        });
        throw new HostedWebSearchUnavailable({
          refusal: "PROVIDER_FAILED",
          failureClass,
          cause: error,
        });
      }

      const costUsd = hostedSearchCostUsd(
        answer.usage,
        answer.searchRequests,
        route.price,
      );
      const searchFailed =
        answer.unreadable ||
        (answer.sources.length === 0 && answer.searchErrorCode !== null);
      await record({
        usage: answer.usage,
        costUsd,
        errorCode: answer.unreadable
          ? "INVALID_MODEL_OUTPUT"
          : searchFailed
            ? "PROVIDER_OUTAGE"
            : undefined,
      });
      dependencies.logger?.info(
        {
          provider: adapter.code,
          model: answer.modelCode,
          searches: answer.searchRequests,
          sources: answer.sources.length,
          costUsd,
          searchError: answer.searchErrorCode,
          unreadable: answer.unreadable,
          messageId: answer.providerReference,
        },
        "model-hosted web search",
      );
      if (searchFailed) {
        throw new HostedWebSearchUnavailable({
          refusal: "SEARCH_FAILED",
          failureClass: "PROVIDER_OUTAGE",
        });
      }
      return {
        sources: answer.sources.slice(0, HOSTED_WEB_SEARCH_MAX_SOURCES),
        searchRequests: answer.searchRequests,
        costUsd,
        providerCode: adapter.code,
        modelCode: answer.modelCode,
        latencyMs: Math.max(0, Date.now() - started),
      };
    },
  };
}

/**
 * `Q_MODEL_SEARCH_DAILY_USD_CAP`: this path's own daily ceiling, USD 2
 * unless set; 0 turns the fallback off. A plain non-negative number up to
 * 50, or startup fails: a typo must never lift the owner's cap.
 */
export function parseModelSearchDailyCapUsd(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env["Q_MODEL_SEARCH_DAILY_USD_CAP"]?.trim();
  if (raw === undefined || raw === "") return 2;
  if (!/^\d+(\.\d+)?$/u.test(raw) || Number(raw) > 50) {
    throw new Error(
      "Q_MODEL_SEARCH_DAILY_USD_CAP must be a number of US dollars between 0 and 50",
    );
  }
  return Number(raw);
}
