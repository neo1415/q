import type {
  ModelCost,
  ModelMessage,
  ModelToolDefinition,
  ModelUsage,
} from "@capital-q/contracts";

import type { ModelPriceRecord } from "../catalog.js";

/**
 * Cost arithmetic over versioned price snapshots (doc 13 §56.3; packet
 * §40, §43). No price lives here: a snapshot row comes in, a figure with
 * its basis comes out. Free-tier billing is not modelled — the underlying
 * model price is what a route costs the architecture, whatever an account
 * is currently charged.
 */

/**
 * A deliberately conservative pre-call estimate: roughly four characters
 * per token for prose, rounded up. Used to reject routes that are
 * obviously outside a window or a budget, never as accounting.
 */
export function estimateInputTokens(
  messages: readonly ModelMessage[],
  tools: readonly ModelToolDefinition[] = [],
): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length + 8;
    if (message.role === "ASSISTANT" && message.toolCalls !== undefined) {
      chars += JSON.stringify(message.toolCalls).length;
    }
  }
  for (const tool of tools) {
    chars +=
      tool.name.length +
      tool.description.length +
      JSON.stringify(tool.inputJsonSchema).length +
      16;
  }
  return Math.ceil(chars / 4);
}

const USD_PRECISION = 1e8;

function roundUsd(amount: number): number {
  return Math.round(amount * USD_PRECISION) / USD_PRECISION;
}

export function priceUsage(
  usage: ModelUsage,
  price: ModelPriceRecord | null,
  basis: "PRICE_SNAPSHOT" | "ESTIMATED",
): ModelCost {
  if (price === null) {
    return { currency: "USD", amount: 0, basis: "UNPRICED" };
  }
  const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const outputTokens = usage.outputTokens + (usage.reasoningTokens ?? 0);
  const amount =
    (uncached * price.inputPerMillion +
      usage.cachedInputTokens * cachedRate +
      outputTokens * price.outputPerMillion) /
    1_000_000;
  return {
    currency: "USD",
    amount: roundUsd(amount),
    basis,
    priceSnapshotId: price.id,
  };
}

/** The upper bound a single attempt could cost: full output budget spent. */
export function estimateAttemptCost(
  inputTokens: number,
  maxOutputTokens: number,
  price: ModelPriceRecord | null,
): ModelCost {
  return priceUsage(
    { inputTokens, cachedInputTokens: 0, outputTokens: maxOutputTokens },
    price,
    "ESTIMATED",
  );
}
