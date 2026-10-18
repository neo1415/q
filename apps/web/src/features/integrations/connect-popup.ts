/**
 * Q room W4b: Google's connect flow in a small window beside the room.
 *
 * The room opens the window on the click (so a blocker allows it), sends it
 * to Google, and Google returns it to CONNECT_POPUP_PATH on this origin.
 * That page tells the room how it went (a same-origin channel; the opener
 * link may be cut by Google's opener policy, so a BroadcastChannel carries
 * it too) and closes. The message is only a hint: the room asks the server
 * for the connection's real state before it says anything is connected.
 */

export const CONNECT_POPUP_PATH = "/connected/google";
export const CONNECT_POPUP_CHANNEL = "cq-google-connect";
const MESSAGE_TYPE = "cq.google.connect";

export type ConnectOutcome = "connected" | "denied" | "failed";

export type ConnectMessage = {
  readonly type: typeof MESSAGE_TYPE;
  readonly outcome: ConnectOutcome;
};

export function connectOutcome(value: unknown): ConnectOutcome {
  return value === "connected" || value === "denied" ? value : "failed";
}

export function connectMessage(outcome: ConnectOutcome): ConnectMessage {
  return { type: MESSAGE_TYPE, outcome };
}

/** The outcome a message carries, or null when it is not ours. */
export function readConnectMessage(data: unknown): ConnectOutcome | null {
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record["type"] !== MESSAGE_TYPE) return null;
  return connectOutcome(record["outcome"]);
}

/** A small window, opened on the click itself; null when it was blocked. */
export function openConnectWindow(): Window | null {
  try {
    const opened = window.open(
      "",
      "cq-google-connect",
      "popup=yes,width=520,height=680",
    );
    return opened ?? null;
  } catch {
    return null;
  }
}

/** From the return page: tell the room, by every same-origin route. */
export function announceConnectOutcome(outcome: ConnectOutcome): void {
  const message = connectMessage(outcome);
  try {
    const opener = window.opener as Window | null;
    opener?.postMessage(message, window.location.origin);
  } catch {
    // The opener may be gone or cut off; the channel still carries it.
  }
  try {
    const channel = new BroadcastChannel(CONNECT_POPUP_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // No BroadcastChannel: the room re-checks when the window closes.
  }
}
