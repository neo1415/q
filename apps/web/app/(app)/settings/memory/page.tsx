import type { Metadata } from "next";

import { getQPreferenceLearning, listQMemory } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";
import { MemoryView } from "@/features/settings/memory-view";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "What Q remembers" };
export const dynamic = "force-dynamic";

/**
 * What Q remembers about the person (ADR 0012; founder live 2026-09-29;
 * chosen design "Grouped, forget in place", 2026-10-21): read under their
 * own session, from the Q API, and theirs to correct or forget.
 */
export default async function QMemoryPage() {
  const t = await serverT();
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const session =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : { baseUrl: qApiBaseUrl, accessToken };
  const [read, learning] =
    session === null
      ? [null, null]
      : await Promise.all([
          listQMemory(session).catch(() => null),
          getQPreferenceLearning(session).catch(() => null),
        ]);
  return <MemoryView t={t} items={read?.items ?? null} learning={learning} />;
}
