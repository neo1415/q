import {
  Q_SITE_MAP,
  type QRecordPage,
  type QSiteMap,
} from "@capital-q/contracts";
import {
  sideOfRequest,
  type QNavigationRecordAsk,
  type QNavigationRecordFound,
  type QNavigationRecordResolver,
  type QNavigationRecords,
} from "@capital-q/model-gateway/q";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { QOpenRecordPort } from "./references.js";

/**
 * Q Workspace W4.3 in the answer path: the record a NAVIGATION_DECISION
 * names, found as this person through the open_page tool's own authorise
 * step (the records they may already see: their relationships, Saves, the
 * network). A name that matches nothing they may see, or several, is
 * NONE: the pane stays and nothing is said about what exists.
 *
 * Not yet resolved here (STAY until W2.3's resolve_page_target is
 * callable from code): a data-room document by its title, and a Board
 * item. Ids never come from the model.
 */

const RECORD_PAGES_OPEN_PAGE_NAMES: ReadonlySet<QRecordPage> = new Set([
  "COMPANY",
  "INVESTOR",
  "RELATIONSHIP_COMPANY",
  "RELATIONSHIP_INVESTOR",
  "RELATIONSHIP_COMPANY_MESSAGES",
  "RELATIONSHIP_INVESTOR_MESSAGES",
  "DOCUMENT",
  "INVESTOR_REHEARSAL",
  "COMPANY_REHEARSAL",
]);

/** The record page a route (and tab) shows, in the site map's words. */
export function recordPageForRoute(
  route: string,
  tab: string | null,
  map: QSiteMap = Q_SITE_MAP,
): QRecordPage | null {
  const page = map.pages.find((p) => p.route === route);
  const [recordPage] = page?.recordPages ?? [];
  if (recordPage === undefined) return null;
  if (
    tab === "messages" &&
    (recordPage === "RELATIONSHIP_COMPANY" ||
      recordPage === "RELATIONSHIP_INVESTOR")
  )
    return `${recordPage}_MESSAGES`;
  return recordPage;
}

export function createOpenRecordNavigationResolver(
  openRecord: QOpenRecordPort,
  map: QSiteMap = Q_SITE_MAP,
): (request: QAnswerRequest) => QNavigationRecordResolver {
  return (request) =>
    async (ask: QNavigationRecordAsk): Promise<QNavigationRecordFound> => {
      if (ask.document !== null) return { status: "NONE" };
      const page = recordPageForRoute(ask.route, ask.tab, map);
      if (page === null || !RECORD_PAGES_OPEN_PAGE_NAMES.has(page))
        return { status: "NONE" };
      const opened = await openRecord.open(request, { page, name: ask.name });
      return opened === null
        ? { status: "NONE" }
        : { status: "FOUND", recordId: opened.id, documentId: null };
    };
}

/**
 * The names the prompt lists as theirs to open: the counterparts in their
 * own relationships (companies for an investor, investors for a founder).
 * Names only reach the model; resolution is the resolver's, as them.
 */
export function counterpartNavigationRecords(
  counterpartNames: (request: QAnswerRequest) => Promise<readonly string[]>,
): (request: QAnswerRequest) => Promise<QNavigationRecords> {
  return async (request) => {
    const names = (await counterpartNames(request)).slice(0, 60);
    // No id: the prompt reads names, and the resolver finds the record.
    const listed = names.map((name) => ({ id: "", name }));
    return sideOfRequest(request) === "INVESTOR"
      ? { companies: listed, investors: [], things: [], deleted: [] }
      : { companies: [], investors: listed, things: [], deleted: [] };
  };
}
