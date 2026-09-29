import type { Metadata } from "next";

import { listQMemory } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { QMemoryList } from "@/features/settings/q-memory-list";

export const metadata: Metadata = { title: "What Q remembers" };
export const dynamic = "force-dynamic";

/**
 * What Q remembers about the person (ADR 0012; founder live 2026-09-29):
 * read under their own session, from the Q API, and theirs to correct.
 */
export default async function QMemoryPage() {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const read =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : await listQMemory({ baseUrl: qApiBaseUrl, accessToken }).catch(
          () => null,
        );
  return (
    <PageContainer width="reading" className="flex flex-col gap-6">
      <PageHeader
        title="What Q remembers"
        description="What you've told Q about yourself and how you like to work. Q uses it in every conversation, so you never have to repeat it. Forget anything that's wrong."
      />
      {read === null ? (
        <p className="cq-body text-(--cq-text-secondary)" data-state="unavailable">
          Q&apos;s memory couldn&apos;t be read just now. Reload in a moment.
        </p>
      ) : (
        <QMemoryList items={read.items} />
      )}
    </PageContainer>
  );
}
