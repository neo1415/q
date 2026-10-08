import type { Metadata } from "next";

import {
  getCompanyDataRoom,
  getQBrandKit,
  getRequestInbox,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { getSessionAccessToken } from "@/auth/session";
import { DocumentsScreen } from "@/features/documents/documents-screen";
import { loadLibraryPageAction } from "@/features/documents/library-actions";
import { DataRoomTab } from "@/features/documents/requests/data-room-tab";
import { DocumentsTabBar } from "@/features/documents/requests/documents-tab-bar";
import { RequestsInbox } from "@/features/documents/requests/requests-inbox";
import { documentsTabOf } from "@/features/documents/requests/requests-model";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

/**
 * Documents (DOCS spec §3; P3): every document Q made for the person and
 * every document they uploaded, and the brand their documents are drawn in.
 *
 * Founders (2026-10-08; design docs/design/2026-10-08/founder-docs) get
 * three tabs, one URL each: My documents, Requested (everything investors
 * asked for: documents and questions, answered here), and Data room (the
 * curated folders, where a requested document says so, with the access
 * editor). A notification opens `?tab=requested&item=<id>`. Each tab reads
 * only its own data; the Requested count is read for the bar. Everything is
 * read under the person's own session; the API decides what they may see.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // A deep link Q opens (`?open=<artifact id>`); the screen opens it only
  // when it is one of the person's own listed documents.
  const open = params["open"];
  const item = params["item"];
  const { qApiBaseUrl, apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  const context = await resolveOwnContext().catch(() => null);
  const companyId = context?.kind === "FOUNDER" ? context.companyId : null;
  const api =
    apiBaseUrl === undefined || accessToken === null
      ? null
      : { baseUrl: apiBaseUrl, accessToken };
  const tab = companyId === null ? "mine" : documentsTabOf(params["tab"]);

  const [first, brand, inbox, room] = await Promise.all([
    tab === "mine" ? loadLibraryPageAction({}) : Promise.resolve(null),
    tab !== "mine" || qApiBaseUrl === undefined || accessToken === null
      ? Promise.resolve(null)
      : getQBrandKit({ baseUrl: qApiBaseUrl, accessToken }).catch(() => null),
    companyId === null || api === null
      ? Promise.resolve(null)
      : getRequestInbox(api, companyId).catch(() => null),
    companyId === null || api === null || tab === "mine"
      ? Promise.resolve(null)
      : getCompanyDataRoom(api, companyId).catch(() => null),
  ]);
  const owner = room?.viewer === "OWNER" ? room : null;

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader title="Documents" />
      {companyId === null ? null : (
        <DocumentsTabBar
          active={tab}
          counts={{
            ...(inbox === null || inbox.counts.open === 0
              ? {}
              : { requested: `${String(inbox.counts.open)} open` }),
          }}
        />
      )}
      <div
        id="documents-panel"
        role={companyId === null ? undefined : "tabpanel"}
        aria-labelledby={
          companyId === null ? undefined : `documents-tab-${tab}`
        }
        className="flex flex-col gap-8"
      >
        {tab === "mine" ? (
          <DocumentsScreen
            initial={first?.ok === true ? first.value : null}
            companyId={companyId}
            brand={brand}
            openOnArrival={typeof open === "string" ? open.slice(0, 64) : null}
          />
        ) : null}
        {tab === "requested" && companyId !== null ? (
          <RequestsInbox
            companyId={companyId}
            initial={inbox}
            documents={(owner?.documents ?? []).map((document) => ({
              documentId: document.documentId,
              title: document.title,
            }))}
            focusItem={typeof item === "string" ? item.slice(0, 64) : null}
          />
        ) : null}
        {tab === "data-room" && companyId !== null ? (
          <DataRoomTab
            companyId={companyId}
            view={owner}
            items={inbox?.items ?? []}
          />
        ) : null}
      </div>
    </PageContainer>
  );
}
