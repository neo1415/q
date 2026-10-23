import type { QToolCallOutcome } from "@capital-q/q-runtime";
import type { ModelToolCall } from "@capital-q/contracts";

import { itemsOf, nameKey } from "./named-company-fact.js";

/**
 * Turn latency row 16 (the model-planned rounds, 3.8-4.5 s): the answer
 * prompt tells the model to look a named company up with
 * `search_companies`, then `get_company` with the returned id. The second
 * step needed a whole model round (~2 s) only to copy an id from one
 * result into the next call. When a search resolves to exactly one
 * company, code makes that read in the same round instead, so the next
 * round can answer.
 *
 * Code picks no company the model did not find: one exact name match, or
 * the only result. Anything else (none, several) is left to the model.
 * The read goes through the same tool port, authorize step and Context
 * Firewall as the model's own call; it decides nothing about the company.
 */
export const CHAINED_SEARCH_TOOL = "search_companies";
export const CHAINED_GET_TOOL = "get_company";
/**
 * The company's published figures, read beside its profile (owner
 * 2026-10-23: Q answered from the profile and never asked for figures).
 * Same tool port, authorize step and Context Firewall as the model's own
 * call; a figures read that is denied or fails is simply left out.
 */
export const CHAINED_FIGURES_TOOL = "read_company_figures";

/** What code reads for a company a search found, in parallel. */
export const CHAINED_READ_TOOLS: readonly string[] = [
  CHAINED_GET_TOOL,
  CHAINED_FIGURES_TOOL,
];

/** One chained read's key: the tool and the company. */
export function chainedKey(name: string, companyId: string): string {
  return `${name}|${companyId}`;
}

/** The company id a search resolved to; null when not exactly one. */
export function chainedCompanyOf(
  call: Pick<ModelToolCall, "name" | "arguments">,
  outcome: QToolCallOutcome,
): string | null {
  if (call.name !== CHAINED_SEARCH_TOOL) return null;
  const items = itemsOf(outcome);
  if (items === null || items.length === 0) return null;
  const ids = new Set(items.map((item) => item.companyId));
  if (ids.size === 1) return [...ids][0] ?? null;
  const query = (call.arguments as { readonly query?: unknown } | null)?.query;
  if (typeof query !== "string") return null;
  const wanted = nameKey(query);
  if (wanted.length === 0) return null;
  const exact = new Set(
    items
      .filter((item) => nameKey(item.canonicalName) === wanted)
      .map((item) => item.companyId),
  );
  return exact.size === 1 ? ([...exact][0] ?? null) : null;
}
