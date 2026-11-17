import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ModelDataPosture,
  ModelGatewayRequestInput,
  ModelSensitivity,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";

import { isModelGatewayError } from "../errors.js";
import type { ModelGateway } from "../gateway.js";
import type { ModelUsageEntry, ModelUsageRepository } from "../ports.js";
import {
  TURN_READER_REASONING,
  TURN_READER_REASONING_KEY,
} from "./turn-reader.js";

/**
 * The reader warm-up (DECISIONS 101, owner 2026-11-16).
 *
 * Live 16 Nov (ai_ops.model_usage, five days): the first reader calls after
 * 30+ minutes without one timed out about half the time (31 of 61) against
 * 5.7% otherwise, so the first question after an idle spell waited for the
 * reader's cut-offs. When someone opens Q and this process has not used the
 * reader's route for READER_WARMUP_IDLE_MS, one tiny call goes down that
 * route first, so the person's own first turn finds it warm.
 *
 * Context Firewall: the call carries a fixed sentence and nothing else --
 * no words, ids, names or records of the person. The ledger row names the
 * tenant (a foreign key; routing reads its tenant policy exactly as for the
 * reader) but no user and no run, and its purpose is WARMUP, so it is never
 * a Q turn and never in a person's usage.
 */

/** How long the reader's route may sit unused before an arrival warms it. */
export const READER_WARMUP_IDLE_MS = 15 * 60_000;

/** The task class the turn reader routes by; its first attempt is what we warm. */
const READER_TASK_CLASS = "FAST_CLASSIFICATION" as const;

/**
 * Fixed text, never assembled from anything. A one-field answer keeps the
 * output to a few tokens.
 */
const WARMUP_SYSTEM =
  'This is a connection check. Answer with the JSON object {"ok": true}.';
const WARMUP_USER = "Ready?";

/**
 * The gateway refuses a STRUCTURED request that brings no validation
 * schema, before any attempt (INVALID_REQUEST): live on cdb2dd74e the
 * warm-up failed that way in 4 ms on every arrival and never warmed the
 * route. Lenient: any answer at all has warmed it.
 */
const WarmupAnswerSchema = z.object({ ok: z.boolean() }).passthrough();

/**
 * Exactly one attempt, no hedge and no fallback: the point is the reader's
 * first route, and a fallback would warm a different one at a higher price.
 * Ten seconds lets a cold route finish its start rather than being cut where
 * the reader cuts (4 s), which is the whole cost we want to pay here.
 */
const WARMUP_BUDGET = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.002,
  maxOutputTokens: 32,
  attemptTimeoutMs: 10_000,
} as const;

/**
 * When the reader's route was last used in this process. Fed from the
 * usage ledger, so every attempt on that task class counts (the reader, its
 * hedge, the quick skims, and the warm-up itself), whoever made it.
 */
export type ReaderRouteActivity = {
  /** The same ledger, with each reader-route attempt marking the route used. */
  readonly observe: (usage: ModelUsageRepository) => ModelUsageRepository;
  readonly lastUsedAt: () => number | null;
};

export function createReaderRouteActivity(
  now: () => number = Date.now,
): ReaderRouteActivity {
  let last: number | null = null;
  const note = (entry: ModelUsageEntry): void => {
    if (entry.taskClass === READER_TASK_CLASS) last = now();
  };
  return {
    observe: (usage) => ({
      record: (entry) => {
        note(entry);
        return usage.record(entry);
      },
    }),
    lastUsedAt: () => last,
  };
}

export type ReaderWarmup = {
  /**
   * Someone opened Q. Returns at once, whatever happens: the call (if any)
   * runs after this returns, its result is discarded and a failure is a log
   * line. Only the tenant id is taken, for the ledger and tenant policy.
   */
  readonly onArrival: (who: { readonly tenantId: string }) => void;
};

export function createReaderWarmup(dependencies: {
  readonly gateway: ModelGateway;
  readonly activity: ReaderRouteActivity;
  readonly logger?: Logger | undefined;
  /** The reader's own declarations, so routing picks the reader's route. */
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly idleMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}): ReaderWarmup {
  const now = dependencies.now ?? Date.now;
  const idleMs = dependencies.idleMs ?? READER_WARMUP_IDLE_MS;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  let lastWarmupAt: number | null = null;

  const idleSince = (at: number, since: number | null): boolean =>
    since === null || at - since >= idleMs;

  const warm = (who: { readonly tenantId: string }): void => {
    const at = now();
    // Warm already, or warmed (or being warmed) within the window: once
    // per process per idle window, however many people arrive.
    if (!idleSince(at, dependencies.activity.lastUsedAt())) return;
    if (!idleSince(at, lastWarmupAt)) return;
    lastWarmupAt = at;

    const request: ModelGatewayRequestInput = {
      taskClass: READER_TASK_CLASS,
      reasoning: TURN_READER_REASONING,
      reasoningKey: TURN_READER_REASONING_KEY,
      sensitivity,
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
      budget: WARMUP_BUDGET,
      messages: [
        { role: "SYSTEM", content: WARMUP_SYSTEM },
        { role: "USER", content: WARMUP_USER },
      ],
      output: {
        kind: "STRUCTURED",
        schemaName: "q_route_warmup",
        jsonSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
      attribution: {
        tenantId: who.tenantId,
        correlationId: `cor_warmup_${randomUUID()}`,
        purpose: "WARMUP",
      },
    };
    const started = now();
    // Deferred past this call so nothing in the gateway, even a
    // synchronous throw, can hold up the page that triggered it.
    void Promise.resolve()
      .then(() =>
        dependencies.gateway.execute(request, { schema: WarmupAnswerSchema }),
      )
      .then(
        () => {
          dependencies.logger?.info(
            { ms: now() - started },
            "q reader route warmed",
          );
        },
        (error: unknown) => {
          dependencies.logger?.info(
            {
              ms: now() - started,
              failure: isModelGatewayError(error)
                ? error.failureClass
                : "UNKNOWN_FAILURE",
            },
            "q reader route warm-up did not answer",
          );
        },
      );
  };

  return {
    onArrival: (who) => {
      try {
        warm(who);
      } catch {
        // A warm-up is an optimisation: it never fails the arrival.
      }
    },
  };
}
