import type { QUiActIntent, QUiActReceipt } from "@capital-q/contracts";

/**
 * RECOVERY-2026-10 seam (lead): universal application control. Pages
 * register their controls by semantic id; an act on an id nobody has
 * registered is reported TARGET_MISSING, never as done. Workstream C
 * (docs/recovery/specs/C-app-control.md) owns this module from here.
 */
export type UiActHandler = (
  intent: QUiActIntent,
) => Promise<QUiActReceipt["status"]> | QUiActReceipt["status"];

const handlers = new Map<string, UiActHandler>();
const listeners = new Set<(receipt: QUiActReceipt) => void>();

/** A page registers a control; the returned function unregisters it. */
export function registerUiControl(
  id: string,
  handler: UiActHandler,
): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/** Receipts reach whoever reports them to the server (the Q wire). */
export function onUiActReceipt(
  listener: (receipt: QUiActReceipt) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function performUiAct(
  intent: QUiActIntent,
): Promise<QUiActReceipt> {
  const handler =
    intent.target === undefined
      ? handlers.get("page")
      : handlers.get(intent.target);
  let status: QUiActReceipt["status"] = "TARGET_MISSING";
  if (handler !== undefined) {
    try {
      status = await handler(intent);
    } catch {
      status = "FAILED";
    }
  }
  const receipt: QUiActReceipt = { actId: intent.actId, status };
  for (const listener of listeners) listener(receipt);
  return receipt;
}
