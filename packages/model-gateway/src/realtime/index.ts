import {
  sensitivityWithin,
  type ModelSensitivity,
  type ModelToolDefinition,
} from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import type { SyntheticDemoRoutingAllowance } from "../policy/synthetic-demo.js";
import type { ModelUsageRepository } from "../ports.js";

/**
 * Full-duplex voice through the Q Model Gateway (DUPLEX; flag
 * CQ_VOICE_REALTIME, off by default).
 *
 * The same boundary as text and images: feature code never calls a
 * speech-to-speech provider. It asks this gateway for a REALTIME_VOICE
 * session, which (1) refuses unless the session's context plan is within
 * the provider's data-use ceiling or the deployment holds the
 * synthetic-demo attestation, exactly as text routing does, (2) asks the
 * adapter for a short-lived client secret bound to the instructions and
 * tools the caller computed from the Context Firewall plan, and (3) prices
 * and records every response's usage in ai_ops.model_usage under purpose
 * VOICE_REALTIME. The browser holds only the client secret; the API key
 * never leaves the adapter.
 *
 * What this gateway does not own: who may open a line (the broker, after
 * the actor and the firewall plan), which tools are offered (the Tool
 * Registry, for that plan), and the spend caps (the broker, from this
 * ledger). Like images, it enforces what it can see: a kill switch and
 * eligibility.
 */

export const REALTIME_VOICE_TASK_CLASS = "REALTIME_VOICE" as const;
export const VOICE_REALTIME_PURPOSE = "VOICE_REALTIME" as const;

/** USD per million tokens, by modality. Audio is the cost that matters. */
export type RealtimePrices = {
  readonly textInput: number;
  readonly cachedTextInput: number;
  readonly textOutput: number;
  readonly audioInput: number;
  readonly cachedAudioInput: number;
  readonly audioOutput: number;
};

/**
 * One response's usage, by modality. Input counts include their cached
 * part (the provider's convention); cached counts are billed at the
 * cached rate and the rest at the full rate.
 */
export type RealtimeUsage = {
  readonly inputTextTokens: number;
  readonly inputAudioTokens: number;
  readonly cachedTextTokens: number;
  readonly cachedAudioTokens: number;
  readonly outputTextTokens: number;
  readonly outputAudioTokens: number;
};

export type RealtimeVoice = "FEMALE" | "MALE";

export type RealtimeSessionRequest = {
  readonly modelCode: string;
  /** Stable prefix first: the provider caches a repeated prefix. */
  readonly instructions: string;
  readonly tools: readonly ModelToolDefinition[];
  readonly voice: RealtimeVoice;
  /** Per response: bounds what one answer can cost. */
  readonly maxOutputTokens: number;
  /** How long the client secret may be used to open the line. */
  readonly secretTtlSeconds: number;
};

export type RealtimeSessionGrant = {
  readonly clientSecret: string;
  readonly expiresAt: Date;
  /** Where the browser posts its session offer with the secret. */
  readonly callsUrl: string;
};

/** One vendor's speech-to-speech session endpoint, behind the adapter pattern. */
export type RealtimeSessionProvider = {
  readonly code: string;
  readonly modelCode: string;
  /** Catalog ids for the usage row (ai_ops.providers / ai_ops.models). */
  readonly providerId: string;
  readonly modelId: string;
  readonly prices: RealtimePrices;
  /** Rejects with ModelProviderFailure; never with a vendor exception. */
  readonly mint: (
    request: RealtimeSessionRequest,
    context: { readonly signal: AbortSignal },
  ) => Promise<RealtimeSessionGrant>;
};

export type RealtimeAttribution = {
  readonly tenantId: string;
  readonly userId: string;
  readonly correlationId: string;
};

export type RealtimeMintRequest = {
  readonly instructions: string;
  readonly tools: readonly ModelToolDefinition[];
  readonly voice: RealtimeVoice;
  readonly maxOutputTokens: number;
  readonly secretTtlSeconds: number;
  /** The plan's ceiling: the most sensitive thing the line may carry. */
  readonly sensitivity: ModelSensitivity;
  readonly attribution: RealtimeAttribution;
  readonly signal?: AbortSignal | undefined;
};

export type RealtimeMintResult =
  | { readonly status: "MINTED"; readonly grant: RealtimeSessionGrant }
  | {
      /** Off, unconfigured, ineligible for this plan, or the provider failed. */
      readonly status: "UNAVAILABLE" | "INELIGIBLE" | "FAILED";
    };

export type RealtimeVoiceGateway = {
  readonly enabled: boolean;
  readonly mint: (request: RealtimeMintRequest) => Promise<RealtimeMintResult>;
  /** Estimated USD for one response's usage at the provider's prices. */
  readonly price: (usage: RealtimeUsage) => number;
  /** Prices one response and writes its ledger row; returns the cost. */
  readonly record: (input: {
    readonly usage: RealtimeUsage;
    readonly attribution: RealtimeAttribution;
  }) => Promise<number>;
};

const PER_MILLION = 1_000_000;

/** Never negative, never NaN: a malformed count costs nothing extra. */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function realtimeCostUsd(
  usage: RealtimeUsage,
  prices: RealtimePrices,
): number {
  const text = count(usage.inputTextTokens);
  const audio = count(usage.inputAudioTokens);
  const cachedText = Math.min(count(usage.cachedTextTokens), text);
  const cachedAudio = Math.min(count(usage.cachedAudioTokens), audio);
  const usd =
    ((text - cachedText) * prices.textInput +
      cachedText * prices.cachedTextInput +
      (audio - cachedAudio) * prices.audioInput +
      cachedAudio * prices.cachedAudioInput +
      count(usage.outputTextTokens) * prices.textOutput +
      count(usage.outputAudioTokens) * prices.audioOutput) /
    PER_MILLION;
  return Math.round(usd * 1e8) / 1e8;
}

function failureClassOf(error: unknown) {
  if (error instanceof ModelProviderFailure) return error.failureClass;
  if (error instanceof Error && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof Error && error.name === "AbortError") return "CANCELLED";
  return "TRANSIENT";
}

export function createRealtimeVoiceGateway(options: {
  readonly provider: RealtimeSessionProvider | undefined;
  readonly enabled: boolean;
  readonly usage?: ModelUsageRepository | undefined;
  /**
   * The provider's justified data-use ceiling. PUBLIC for a provider whose
   * terms were not reviewed (ai_ops.providers privacy class UNREVIEWED).
   */
  readonly providerCeiling: ModelSensitivity;
  /** The composition root's attestation; its presence is the proof. */
  readonly syntheticDemo?: SyntheticDemoRoutingAllowance | null | undefined;
  readonly mintTimeoutMs?: number | undefined;
  readonly onFailure?:
    ((failure: { readonly failureClass: string }) => void) | undefined;
}): RealtimeVoiceGateway {
  const provider = options.provider;
  const enabled = options.enabled && provider !== undefined;
  const timeoutMs = options.mintTimeoutMs ?? 8_000;
  const price = (usage: RealtimeUsage) =>
    provider === undefined ? 0 : realtimeCostUsd(usage, provider.prices);
  return {
    enabled,
    price,
    mint: async (request) => {
      if (!enabled) return { status: "UNAVAILABLE" };
      // Context Firewall decision ≠ provider data-use eligibility: the plan
      // says what this line may carry, and the provider must be cleared for
      // it. A synthetic deployment lifts the provider's ceiling only.
      if (
        !sensitivityWithin(request.sensitivity, options.providerCeiling) &&
        options.syntheticDemo?.permitted !== true
      ) {
        return { status: "INELIGIBLE" };
      }
      const signal =
        request.signal === undefined
          ? AbortSignal.timeout(timeoutMs)
          : AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const grant = await provider.mint(
          {
            modelCode: provider.modelCode,
            instructions: request.instructions,
            tools: request.tools,
            voice: request.voice,
            maxOutputTokens: request.maxOutputTokens,
            secretTtlSeconds: request.secretTtlSeconds,
          },
          { signal },
        );
        return { status: "MINTED", grant };
      } catch (error) {
        options.onFailure?.({ failureClass: failureClassOf(error) });
        return { status: "FAILED" };
      }
    },
    record: async ({ usage, attribution }) => {
      const costUsd = price(usage);
      if (provider === undefined) return costUsd;
      await options.usage?.record({
        tenantId: attribution.tenantId,
        userId: attribution.userId,
        qRunId: undefined,
        taskClass: REALTIME_VOICE_TASK_CLASS,
        providerId: provider.providerId,
        modelId: provider.modelId,
        routingPolicyId: undefined,
        attempt: 1,
        inputTokens:
          count(usage.inputTextTokens) + count(usage.inputAudioTokens),
        cachedInputTokens:
          count(usage.cachedTextTokens) + count(usage.cachedAudioTokens),
        outputTokens:
          count(usage.outputTextTokens) + count(usage.outputAudioTokens),
        // Streamed over the person's own line; there is no request latency.
        latencyMs: 0,
        costUsd,
        costBasis: "ESTIMATED",
        success: true,
        errorCode: undefined,
        correlationId: attribution.correlationId,
        purpose: VOICE_REALTIME_PURPOSE,
      });
      return costUsd;
    },
  };
}
