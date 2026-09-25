/**
 * A question asked on this tab whose run the browser has not yet heard
 * back about (CQ-QX-007 H1).
 *
 * Asking is a server action, and Next.js runs a page's server actions one
 * at a time: behind a slow one, the question can take many seconds to be
 * accepted — and the conversation's id, which is what puts `?c=` in the
 * URL, only exists once it is. A person who reloads in that window used to
 * land on a blank Home while the run completed somewhere they could not
 * see.
 *
 * So the question is remembered for this tab with the idempotency key it
 * was sent under. A reload finds it and asks again with the SAME key: the
 * Q API answers a repeated key with the run it already created (or creates
 * it, if the first request never arrived), so the page reopens the one
 * conversation rather than starting a second. Session storage only — it
 * holds the person's own words, on their own tab, briefly — and every read
 * and write tolerates storage being unavailable.
 */
const KEY = "cq.q.pending-ask";

/** Older than this, the question is not recovered: it is not "just now". */
export const PENDING_ASK_MAX_AGE_MS = 120_000;

export type PendingAsk = {
  readonly idempotencyKey: string;
  readonly text: string;
  readonly at: string;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly relationshipId?: string | undefined;
};

export function rememberPendingAsk(ask: PendingAsk): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(ask));
  } catch {
    // No storage: a reload in the window is simply not recovered.
  }
}

export function forgetPendingAsk(idempotencyKey?: string): void {
  try {
    if (idempotencyKey !== undefined) {
      const current = readPendingAsk();
      if (current !== null && current.idempotencyKey !== idempotencyKey) {
        return;
      }
    }
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The remembered question, when there is one and it is recent. */
export function readPendingAsk(now = Date.now()): PendingAsk | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const ask = value as Record<string, unknown>;
    if (
      typeof ask["idempotencyKey"] !== "string" ||
      typeof ask["text"] !== "string" ||
      typeof ask["at"] !== "string"
    ) {
      return null;
    }
    const age = now - Date.parse(ask["at"]);
    if (!Number.isFinite(age) || age < 0 || age > PENDING_ASK_MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return {
      idempotencyKey: ask["idempotencyKey"],
      text: ask["text"],
      at: ask["at"],
      ...(typeof ask["companyId"] === "string"
        ? { companyId: ask["companyId"] }
        : {}),
      ...(typeof ask["investorOrganisationId"] === "string"
        ? { investorOrganisationId: ask["investorOrganisationId"] }
        : {}),
      ...(typeof ask["relationshipId"] === "string"
        ? { relationshipId: ask["relationshipId"] }
        : {}),
    };
  } catch {
    return null;
  }
}
