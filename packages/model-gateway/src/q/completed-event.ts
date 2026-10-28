import type { QResponseMessage } from "@capital-q/contracts";

/**
 * q_runtime.run_events bounds each event's payload (20260906120000:
 * `length(payload::text) <= 16384`). The completed-message event carries
 * the whole stored message, blocks included, and a pipeline answer laid
 * out as ten fit cards overran it: the insert failed, the transaction
 * rolled the message back with it, and the person saw "Q couldn't finish
 * that" (production 2026-10-28, run 33a9f3c7, investor Savanna Seed).
 *
 * The stored message keeps everything; the EVENT is bounded here so the
 * turn always lands. Over the bound, the event carries the message
 * without its blocks (a reopened conversation reads them from the
 * record), and a message whose text alone overruns is cut to fit.
 */

/** The database's bound on the event payload's text. */
export const RUN_EVENT_PAYLOAD_MAX = 16_384;

/**
 * Postgres prints jsonb with a space after every ':' and ','. Counting
 * every such character in the compact text (those inside strings too)
 * over-estimates, never under: the bound is kept whatever the text.
 */
export function jsonbTextLength(value: unknown): number {
  const compact = JSON.stringify(value);
  let separators = 0;
  for (const character of compact) {
    if (character === ":" || character === ",") separators += 1;
  }
  return compact.length + separators;
}

export function fitsRunEvent(data: unknown): boolean {
  return jsonbTextLength(data) <= RUN_EVENT_PAYLOAD_MAX;
}

export type BoundedCompletedMessage = {
  readonly message: QResponseMessage;
  /** What the event had to leave to the record, if anything. */
  readonly trimmed: "NONE" | "BLOCKS" | "BLOCKS_AND_TEXT";
};

/** The completed-message event's data, within the run-event bound. */
export function boundedCompletedMessage(
  message: QResponseMessage,
): BoundedCompletedMessage {
  if (fitsRunEvent({ message })) return { message, trimmed: "NONE" };
  const { blocks: _blocks, ...withoutBlocks } = message;
  if (fitsRunEvent({ message: withoutBlocks })) {
    return { message: withoutBlocks, trimmed: "BLOCKS" };
  }
  // Text alone over the bound: cut to what fits, by halving until it does
  // (every other field is small and fixed).
  let text = withoutBlocks.text ?? "";
  for (let step = 0; step < 24; step += 1) {
    text = text.slice(0, Math.floor(text.length / 2));
    if (fitsRunEvent({ message: { ...withoutBlocks, text } })) break;
  }
  return {
    message: { ...withoutBlocks, text },
    trimmed: "BLOCKS_AND_TEXT",
  };
}
