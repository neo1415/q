import type { QStreamTransportStatus } from "./q-stream.js";

/*
 * Q room W7: the transport's wording, apart from the stream itself, so a
 * page that shows it does not load the contracts' schemas to do so.
 */

/** Plain English for a transport state (§121-§123); never a run status. */
export function describeQStreamTransport(
  status: QStreamTransportStatus,
): string {
  switch (status) {
    case "CONNECTING":
      return "Connecting to Q…";
    case "CONNECTED":
      return "Connected to Q.";
    case "RECONNECTING":
      return "I lost the connection to Q. Reconnecting…";
    case "CLOSED":
      return "Disconnected from Q.";
  }
}
