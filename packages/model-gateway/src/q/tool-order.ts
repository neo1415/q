import type { ModelToolCall } from "@capital-q/contracts";
import type { QOfferedTool, QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * A call to a catalogue tool this turn does not offer: refused, never run,
 * said to the model plainly so it answers with what it has. The tool's
 * own name is not resolved: nothing about it executes.
 */
export function notOfferedThisTurn(call: ModelToolCall): QToolCallOutcome {
  const safeMessage =
    "That tool is not available on this turn. Answer from what you have read, or use one of this turn's tools.";
  return {
    callId: call.callId,
    toolName: null,
    toolVersion: null,
    classification: null,
    status: "DENIED",
    failureCode: "TOOL_NOT_ELIGIBLE",
    sensitivity: null,
    result: { ok: false, error: { code: "TOOL_NOT_ELIGIBLE", safeMessage } },
    latencyMs: 0,
  };
}

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

/** The tool list a round sends, and what this turn may call of it. */
export type ToolBlock = {
  readonly tools: QOfferedTool["definition"][];
  /** Absent: every tool sent may be called. */
  readonly allowedTools?: string[];
};

/**
 * Model spend, 18 Nov 2026 (ai_ops.model_usage: 73% of first answer calls
 * read nothing from the prompt cache). The analyst is sent its plan class's
 * whole catalogue, in name order, the same bytes from turn to turn, so the
 * provider's cache holds it right after the shared instructions; this
 * turn's offer is what may be called (`allowedTools`). A tool offered but
 * not in the catalogue (one the turn named, or loaded on demand) follows
 * it, so the catalogue's cached prefix still holds. Over the request's
 * bound, catalogue tools this turn does not allow give way first.
 *
 * Only when the offer already holds at least half the catalogue: measured
 * 11-18 Nov, first answer calls were either ~110-tool offers (~52k input)
 * or focused ones of a few dozen tools (~20k). A cached catalogue token
 * costs a tenth of an uncached one, but a miss pays for all of it, and a
 * shared prefix was warm for only ~57% of first calls (68% had an answer
 * call in the 5 minutes before; a warm identical prefix hit 85%). At that
 * rate the whole catalogue pays only when it replaces at least ~45% of
 * itself: a large offer saves ~22-40% of its input cost, while padding a
 * focused offer to the catalogue would cost ~28% more. A focused turn sends
 * its offer, after the same shared instructions, as before.
 *
 * Without a catalogue, or on a turn that offers nothing, the offer alone is
 * sent, as before.
 */
export function toolBlockFor(
  catalogue: readonly QOfferedTool[] | null,
  offered: readonly QOfferedTool[],
  max: number,
): ToolBlock {
  if (
    catalogue === null ||
    catalogue.length === 0 ||
    offered.length === 0 ||
    offered.length * 2 < catalogue.length
  ) {
    return { tools: stableToolOrder(offered) };
  }
  const allowed = new Set(offered.map((tool) => tool.definition.name));
  const listed = new Set(catalogue.map((tool) => tool.definition.name));
  const head = stableToolOrder(catalogue);
  const extras = stableToolOrder(
    offered.filter((tool) => !listed.has(tool.definition.name)),
  );
  let spare = head.length + extras.length - max;
  const kept =
    spare <= 0
      ? head
      : [...head]
          .reverse()
          .filter((tool) => {
            if (spare > 0 && !allowed.has(tool.name)) {
              spare -= 1;
              return false;
            }
            return true;
          })
          .reverse();
  const tools = [...kept, ...extras];
  return tools.every((tool) => allowed.has(tool.name))
    ? { tools }
    : { tools, allowedTools: [...allowed].sort() };
}
