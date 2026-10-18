import { NextResponse } from "next/server";

import { readQRoom } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { QRoomReadQuerySchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * voice-cards: the person's Q room feed, for the Q page and every page's
 * dock while a voice line is open. A route, not a server action: server
 * actions run one at a time per client, and this long poll runs beside
 * everything else the page does. The session cookie is the only
 * authority; the Q API answers with the session's own person's room.
 */
export const dynamic = "force-dynamic";

const empty = (status: number) =>
  NextResponse.json(
    { entries: [], unavailable: true },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = QRoomReadQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!query.success) return empty(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return empty(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return empty(401);
  try {
    const read = await readQRoom(
      { baseUrl: qApiBaseUrl, accessToken },
      {
        after: query.data.after,
        epoch: query.data.epoch,
        wait: query.data.wait === 1,
      },
    );
    return NextResponse.json(read, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return empty(502);
  }
}
