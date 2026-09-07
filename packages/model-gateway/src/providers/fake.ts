import type {
  ModelFailureClass,
  ModelFinishStatus,
  ModelProviderCode,
  ModelToolCall,
  ModelUsage,
} from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import type {
  ModelExecutionContext,
  ModelProvider,
  ModelProviderCapabilities,
  ModelProviderRequest,
  ModelProviderResult,
} from "../ports.js";

/**
 * The deterministic test provider (doc 23 §185; packet §54). Software
 * tests prove the gateway against the ModelProvider port with scripted
 * behaviour — success, structured output, rate limit, timeout, outage,
 * invalid JSON, schema mismatch, raw vendor exception, usage fixtures —
 * and never by mocking an SDK.
 */

export type FakeBehaviour =
  | {
      readonly kind: "TEXT";
      readonly text: string;
      readonly usage?: ModelUsage | undefined;
      readonly finish?: ModelFinishStatus | undefined;
      readonly delayMs?: number | undefined;
      readonly providerReference?: string | undefined;
    }
  | {
      /** Serialised as JSON; combine with a schema to test acceptance. */
      readonly kind: "JSON";
      readonly value: unknown;
      readonly usage?: ModelUsage | undefined;
      readonly delayMs?: number | undefined;
    }
  | {
      /** Proposes tool calls, as a tool-capable model would when tools are offered. */
      readonly kind: "TOOL_CALLS";
      readonly calls: readonly ModelToolCall[];
      readonly text?: string | undefined;
      readonly usage?: ModelUsage | undefined;
    }
  | {
      readonly kind: "FAIL";
      readonly failureClass: ModelFailureClass;
      readonly retryAfterMs?: number | undefined;
      /** The adapter's own safe wording; the vendor payload goes on `cause`. */
      readonly message?: string | undefined;
      readonly cause?: unknown;
    }
  | {
      /** Waits for the attempt signal, then fails as an SDK honouring abort would. */
      readonly kind: "HANG";
    }
  | {
      /** A raw, unclassified exception — what a buggy adapter would leak. */
      readonly kind: "THROW_RAW";
      readonly message: string;
    };

export type FakeCall = {
  readonly request: ModelProviderRequest;
  readonly attempt: number;
};

export type FakeModelProvider = ModelProvider & {
  readonly calls: readonly FakeCall[];
};

export type FakeModelProviderOptions = {
  readonly code: ModelProviderCode;
  /** Consumed in order; the last behaviour repeats. */
  readonly script: readonly FakeBehaviour[];
  readonly capabilities?: Partial<ModelProviderCapabilities> | undefined;
};

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true },
    );
  });
}

export function createFakeModelProvider(
  options: FakeModelProviderOptions,
): FakeModelProvider {
  const calls: FakeCall[] = [];
  let index = 0;
  const next = (): FakeBehaviour => {
    const behaviour =
      options.script[Math.min(index, options.script.length - 1)];
    index += 1;
    if (behaviour === undefined) {
      throw new Error("fake provider needs at least one scripted behaviour");
    }
    return behaviour;
  };

  return {
    code: options.code,
    calls,
    capabilities: () => ({
      structuredOutput: true,
      toolCalling: true,
      streaming: false,
      cancellation: true,
      ...options.capabilities,
    }),
    generate: async (
      request: ModelProviderRequest,
      context: ModelExecutionContext,
    ): Promise<ModelProviderResult> => {
      calls.push({ request, attempt: context.attempt });
      const behaviour = next();
      try {
        switch (behaviour.kind) {
          case "TEXT":
            if (behaviour.delayMs !== undefined) {
              await delay(behaviour.delayMs, context.signal);
            }
            return {
              text: behaviour.text,
              toolCalls: undefined,
              usage: behaviour.usage,
              finish: behaviour.finish ?? "COMPLETE",
              modelCode: request.modelCode,
              providerReference: behaviour.providerReference,
            };
          case "JSON":
            if (behaviour.delayMs !== undefined) {
              await delay(behaviour.delayMs, context.signal);
            }
            return {
              text: JSON.stringify(behaviour.value),
              toolCalls: undefined,
              usage: behaviour.usage,
              finish: "COMPLETE",
              modelCode: request.modelCode,
              providerReference: undefined,
            };
          case "TOOL_CALLS":
            return {
              text: behaviour.text ?? "",
              toolCalls: behaviour.calls,
              usage: behaviour.usage,
              finish: "TOOL_CALLS",
              modelCode: request.modelCode,
              providerReference: undefined,
            };
          case "FAIL":
            throw new ModelProviderFailure(
              behaviour.message ??
                `fake provider failure: ${behaviour.failureClass}`,
              {
                failureClass: behaviour.failureClass,
                providerCode: options.code,
                retryAfterMs: behaviour.retryAfterMs,
                cause: behaviour.cause,
              },
            );
          case "HANG":
            return await waitForAbort(context.signal);
          case "THROW_RAW":
            throw new Error(behaviour.message);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new ModelProviderFailure("fake provider request aborted", {
            failureClass: "CANCELLED",
            providerCode: options.code,
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
