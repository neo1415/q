import type { QPageManifest } from "@capital-q/contracts";

import { onUiActReport, type UiActReport } from "../ui-act-controller";

/**
 * RECOVERY-2026-10 (C2): every UI act's receipt goes to the Q API, so the
 * next turn -- typed or spoken -- knows what the screen did and Q never
 * claims an act it has no receipt for.
 *
 * Through a route handler, not a server action: server actions run one at
 * a time per tab (audit C-08), and a receipt must not wait behind a voice
 * relay or a run. Receipts that land together go in one request.
 */
export const Q_UI_ACTS_ROUTE = "/api/q-ui-acts";
const BATCH_MS = 250;
const BATCH_MAX = 16;

export type ReceiptTransport = (body: {
  readonly reports: readonly UiActReport[];
  readonly manifest?: QPageManifest | undefined;
}) => Promise<void>;

export const fetchTransport: ReceiptTransport = async (body) => {
  await fetch(Q_UI_ACTS_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // A receipt for the act that left the page still arrives.
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
};

/**
 * Starts reporting; the returned function stops. `manifest` reads the page
 * as it is after the acts (ids and kinds only).
 */
export function startReceiptReporter(
  manifest: () => QPageManifest | undefined,
  transport: ReceiptTransport = fetchTransport,
): () => void {
  let pending: UiActReport[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending.length === 0) return;
    const reports = pending.slice(0, BATCH_MAX);
    pending = pending.slice(BATCH_MAX);
    const now = manifest();
    void transport({
      reports,
      ...(now === undefined ? {} : { manifest: now }),
    });
    if (pending.length > 0) timer = setTimeout(flush, 0);
  };
  const stop = onUiActReport((report) => {
    pending.push(report);
    timer ??= setTimeout(flush, BATCH_MS);
  });
  return () => {
    stop();
    if (timer !== null) clearTimeout(timer);
    flush();
  };
}
