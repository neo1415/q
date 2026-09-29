/**
 * "Q is saying this now": one browser event every Q surface listens to.
 *
 * Voice raises it as each of Q's lines arrives, the text thread as each
 * answer lands. The swarm forms what the sentence is about and the page
 * pointer flies to whatever on the page the sentence names. A sound and a
 * picture, never a record: nothing listening to it stores the text.
 */
export const Q_SAID_EVENT = "cq:q-said";

export type QSaidDetail = { readonly text: string };

/** The sentence an event carries, or null for anything else. */
export function saidText(event: Event): string | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  return typeof detail === "object" &&
    detail !== null &&
    "text" in detail &&
    typeof detail.text === "string"
    ? detail.text
    : null;
}

export function announceQSaid(text: string): void {
  if (typeof window === "undefined" || text.trim().length === 0) return;
  window.dispatchEvent(
    new CustomEvent<QSaidDetail>(Q_SAID_EVENT, { detail: { text } }),
  );
}
