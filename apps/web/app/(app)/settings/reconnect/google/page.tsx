import { redirect } from "next/navigation";

import { GOOGLE_RECONNECT_TARGET } from "@capital-q/contracts";

/**
 * meetfix-57: the reconnect link Q's answers and notices carry. A plain
 * path (notification links allow no query or fragment) that lands on
 * Settings → Connections with the reconnect requested; the Google row
 * there starts it when Google is not connected.
 */
export default function ReconnectGooglePage(): never {
  redirect(GOOGLE_RECONNECT_TARGET);
}
