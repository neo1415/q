import type { Metadata } from "next";

import { getQBrandKit, listQArtifacts } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { DocumentsScreen } from "@/features/documents/documents-screen";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

/**
 * Documents (DOCS spec §3): every document Q made for the person, to open
 * or download, and the brand their documents are drawn in. Read under the
 * person's own session from the Q API; the Q API lists only their own
 * organisation's documents and brand.
 */
export default async function DocumentsPage() {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const session =
    qApiBaseUrl === undefined || accessToken === null
      ? null
      : { baseUrl: qApiBaseUrl, accessToken };
  const [documents, brand] =
    session === null
      ? [null, null]
      : await Promise.all([
          listQArtifacts(session, { limit: 50 }).catch(() => null),
          getQBrandKit(session).catch(() => null),
        ]);
  return (
    <PageContainer width="reading" className="flex flex-col gap-8">
      <PageHeader
        title="Documents"
        description="Decks, briefs and reports Q made for you, and the brand they're drawn in."
      />
      <DocumentsScreen documents={documents?.items ?? null} brand={brand} />
    </PageContainer>
  );
}
