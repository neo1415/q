import type { QOfferedTool } from "@capital-q/q-runtime";

/**
 * K Part 7: the tools the conversational analyst is sent, in one stable
 * order. Which tools are offered is the registry's choice (R33: the most
 * specific first, so the right ones survive the model's tool bound); the
 * order they are SENT in only has to be the same whenever the set is, so
 * a provider that caches the prompt prefix -- OpenAI counts the tool list
 * in it -- reuses it across turns instead of missing on a reshuffle.
 * Name order, by code point, so it never depends on a locale.
 */
export function stableToolOrder(
  offered: readonly QOfferedTool[],
): QOfferedTool["definition"][] {
  return offered
    .map((tool) => tool.definition)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
