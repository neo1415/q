import type { Metadata } from "next";

import { getQBrandKit } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { DocumentsScreen } from "@/features/documents/documents-screen";
import { loadLibraryPageAction } from "@/features/documents/library-actions";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

/**
 * Documents (DOCS spec §3; P3): every document Q made for the person and
 * every document they uploaded, one page at a time, and the brand their
 * documents are drawn in. Read under the person's own session; the APIs
 * list only their own organisation's documents and brand.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A deep link Q opens (`?open=<artifact id>`); the screen opens it only
  // when it is one of the person's own listed documents.
  const open = (await searchParams)["open"];
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const [first, brand, context] = await Promise.all([
    loadLibraryPageAction({}),
    qApiBaseUrl === undefined || accessToken === null
      ? Promise.resolve(null)
      : getQBrandKit({ baseUrl: qApiBaseUrl, accessToken }).catch(() => null),
    resolveOwnContext().catch(() => null),
  ]);
  return (
    <PageContainer className="flex flex-col gap-8">
      <PageHeader title="Documents" />
      <DocumentsScreen
        initial={first.ok ? first.value : null}
        companyId={context?.kind === "FOUNDER" ? context.companyId : null}
        brand={brand}
        openOnArrival={typeof open === "string" ? open.slice(0, 64) : null}
      />
    </PageContainer>
  );
}
