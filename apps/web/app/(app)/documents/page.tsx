import type { Metadata } from "next";

import {
  getQBrandKit,
  listDocuments,
  listQArtifacts,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { DeckSharing, type DeckRow } from "@/features/documents/deck-sharing";
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
  const { qApiBaseUrl, apiBaseUrl } = loadWebServerConfig();
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
  // The organisation's uploaded pitch decks and who may download each
  // (ADR 0041), from the application API under the same session. Failing
  // leaves the section out, nothing more.
  const decks: DeckRow[] =
    apiBaseUrl === undefined || accessToken === null
      ? []
      : await listDocuments({ baseUrl: apiBaseUrl, accessToken })
          .then((list) =>
            list.documents
              .filter(
                (document) =>
                  document.documentType === "PITCH_DECK" &&
                  document.status === "ACTIVE" &&
                  document.companyId !== null,
              )
              .map((document) => ({
                documentId: document.id,
                title: document.title,
                downloadAudience: document.downloadAudience,
                version: document.version,
              })),
          )
          .catch(() => []);
  return (
    <PageContainer width="reading" className="flex flex-col gap-8">
      <PageHeader
        title="Documents"
        description="Decks, briefs and reports Q made for you, and the brand they're drawn in."
      />
      <DeckSharing decks={decks} />
      <DocumentsScreen documents={documents?.items ?? null} brand={brand} />
    </PageContainer>
  );
}
