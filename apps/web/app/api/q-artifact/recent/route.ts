import { NextResponse } from "next/server";

import { listQArtifacts } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The person's newest documents, for the document-ready toasts on every
 * page (DOCS spec §3 F2). A GET the toast owner polls while the tab is
 * visible: server actions run one at a time per client, and a poll must
 * never queue behind somebody's Save. The session cookie is the only
 * authority; the Q API lists the actor's own organisation's documents.
 */
export const dynamic = "force-dynamic";

const plain = (status: number) =>
  NextResponse.json(
    { items: [] },
    { status, headers: { "cache-control": "no-store" } },
  );

export async function GET(): Promise<NextResponse> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return plain(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return plain(401);
  try {
    const page = await listQArtifacts(
      { baseUrl: qApiBaseUrl, accessToken },
      { limit: 6 },
    );
    return NextResponse.json(
      {
        items: page.items.map((item) => ({
          artifactId: item.artifactId,
          type: item.type,
          status: item.status,
          title: item.title,
          currentVersion: item.currentVersion,
          updatedAt: item.updatedAt,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return plain(502);
  }
}
