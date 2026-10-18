import type { QSentenceGesture } from "@capital-q/contracts";

import { wireNow } from "../q/wire";

/**
 * "Q's answer asks its particles for these": one browser event every Q
 * presence on the page listens to (PRESENCE spec §5). Raised by the text
 * thread when an answer lands, by voice when a spoken turn's gestures
 * arrive, and by onboarding with each reply. The gestures are the
 * model's closed-set choices from the answer contract; nothing here reads
 * the words to pick one.
 *
 * Each answer is announced once: a surface re-rendering, or the voice
 * board being read again, does not replay it.
 */
export const Q_GESTURES_EVENT = "cq:q-gestures";

export type QGesturesDetail = {
  readonly answerId: string;
  readonly gestures: readonly QSentenceGesture[];
  readonly spoken: boolean;
  readonly text?: string | undefined;
};

const announced = new Set<string>();

export function announceQGestures(detail: QGesturesDetail): void {
  if (typeof window === "undefined" || detail.gestures.length === 0) return;
  if (announced.has(detail.answerId)) return;
  announced.add(detail.answerId);
  if (announced.size > 200) {
    const oldest = announced.values().next().value;
    if (oldest !== undefined) announced.delete(oldest);
  }
  window.dispatchEvent(
    new CustomEvent<QGesturesDetail>(Q_GESTURES_EVENT, { detail }),
  );
}

/** The gestures an event carries, validated, or null for anything else. */
export function gesturesDetail(event: Event): QGesturesDetail | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const record = detail as Record<string, unknown>;
  // W7: checked against the wire's contracts; before they are in (a
  // moment after the first paint) the particles simply keep their shape.
  const schema = wireNow()?.QSentenceGesturesSchema;
  if (schema === undefined) return null;
  const gestures = schema.safeParse(record["gestures"]);
  if (!gestures.success || typeof record["answerId"] !== "string") return null;
  return {
    answerId: record["answerId"],
    gestures: gestures.data,
    spoken: record["spoken"] === true,
    text: typeof record["text"] === "string" ? record["text"] : undefined,
  };
}
