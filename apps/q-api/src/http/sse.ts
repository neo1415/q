/**
 * Server-Sent Events framing (CQ-Q-009 §13; doc 22 §70, §75).
 *
 * One frame is a sequence of `field: value` lines ended by a blank line.
 * `data` is split on newlines into several `data:` lines, so a payload
 * containing a newline is reassembled exactly by any conforming parser.
 * A comment line starts with `:` and is never dispatched as an event —
 * that is what a heartbeat is.
 */

export type SseFrame = {
  readonly event: string;
  /** Present on durable events only; absent frames never move Last-Event-ID. */
  readonly id?: string | undefined;
  readonly data: string;
};

const LINE_BREAK = /\r\n|\r|\n/;

function assertFieldValue(field: string, value: string): void {
  // A line break inside a field would let a value forge a second field.
  if (LINE_BREAK.test(value)) {
    throw new Error(`SSE ${field} must not contain a line break`);
  }
}

export function formatSseFrame(frame: SseFrame): string {
  assertFieldValue("event", frame.event);
  let out = `event: ${frame.event}\n`;
  if (frame.id !== undefined) {
    assertFieldValue("id", frame.id);
    out += `id: ${frame.id}\n`;
  }
  for (const line of frame.data.split(LINE_BREAK)) {
    out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

export function formatSseComment(text: string): string {
  assertFieldValue("comment", text);
  return `: ${text}\n\n`;
}

export function formatSseRetry(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) {
    throw new Error("SSE retry must be a non-negative integer");
  }
  return `retry: ${milliseconds}\n\n`;
}
