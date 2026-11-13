import {
  intentToNavigateTarget,
  navigateTargetToIntent,
  Q_NAVIGATION_OFFER_LABEL_MAX,
  audienceOf,
  Q_SITE_MAP,
  QNavigateDestinationSchema,
  QNavigateTargetSchema,
  QRecordPageSchema,
  QRecordTabSchema,
  recordPageHasTab,
  type QRecordTab,
  type QResultBlock,
  qSiteMapDigest,
  qSiteMapLandingFor,
  type QNavigateTarget,
  type QSiteMap,
  type QSiteMapPage,
  type QWorkspaceScreen as QWorkspaceScreenContract,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  NavigationDecisionResultV3Schema,
  readsAsContext,
  readsAsGo,
  readsAsNoNavigation,
  renderPrompt,
  type NavigationDecisionResult,
  type TurnNavigationIntentV84,
  type TurnNavigationIntentV87,
  type NavigationDecisionVariables,
} from "@capital-q/q-core";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";
import { askerSideOf } from "./result-blocks.js";

/**
 * Q Workspace W4 (DECISIONS 71 amends N1: Q may move the page pane on its
 * own, model-led). Three steps, each with one job:
 *
 * 1. decide (W4.1): NAVIGATION_DECISION, a cheap cached model call beside
 *    retrieval, proposes MOVE / OFFER / STAY and names the place by page
 *    and record NAME, never an id.
 * 2. resolve (W4.3): code turns names into the ids of records the person
 *    may open (W2.3's resolution; here the records they were given). An
 *    unresolved or deleted record is a STAY.
 * 3. policy (W4.2): code applies the hard constraints the model never
 *    decides: never away from unsaved work or a busy pane (OFFER); never
 *    to a page they cannot open; a collapsed pane opens only when they
 *    asked for a page (otherwise the move is remembered); already there
 *    is a STAY; one move per turn; below the eval's gate, MOVE is OFFER
 *    by config.
 */

export type QNavigationSide = "INVESTOR" | "FOUNDER";

/** Where the page pane is and what it is doing. */
export type QNavigationPane = {
  /** Null: a page the site map cannot name (never "already there"). */
  readonly at: QNavigateTarget | null;
  readonly previous: QNavigateTarget | null;
  readonly pane: "OPEN" | "COLLAPSED";
  readonly dirty: boolean;
  /** ACTIVE: recent input of a kind the screen did not say (W1). */
  readonly busy: "TYPING" | "SCROLLING" | "ACTIVE" | null;
  /**
   * The person pinned the workspace (owner addendum, 13 Nov 2026): no
   * move changes the page; a move is offered (gateByReading's PINNED).
   */
  readonly pinned?: boolean | undefined;
};

/** The records a person may open, by name (W2.3 resolves these). */
export type QNavigationRecords = {
  readonly companies: readonly {
    readonly id: string;
    readonly name: string;
    readonly documents?:
      readonly { readonly title: string; readonly id: string }[] | undefined;
  }[];
  readonly investors: readonly { readonly id: string; readonly name: string }[];
  /** Other records (a document, a Daily, a rehearsal), each with the route it opens on when known. */
  readonly things: readonly {
    readonly id: string;
    readonly title: string;
    /** Null: known to have no page of its own (it lives on a list). */
    readonly route?: string | null | undefined;
  }[];
  readonly deleted: readonly { readonly id: string; readonly name: string }[];
  /** Their own company or firm ("my company", "us"), by name. */
  readonly own?:
    | {
        readonly kind: "COMPANY" | "INVESTOR";
        readonly name: string;
        /** Never shown to the model: it resolves "their own" pages. */
        readonly id?: string | undefined;
      }
    | undefined;
};

export type QNavigationInput = {
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly user: string;
    readonly q: string;
  }[];
  readonly side: QNavigationSide;
  readonly pane: QNavigationPane;
  readonly pageText: string | null;
  readonly records: QNavigationRecords;
  readonly siteMap: string;
  /**
   * Batch 7 replay: the one situation every reader and answer gets (W3's
   * FOCUS, situationHeader): who they are, their own organisation, the
   * record on their screen by name, and how me/my and their/it resolve.
   * Absent: not known.
   */
  readonly situation?: string | undefined;
};

/** The decision after resolution and policy: what the page pane does. */
export type QNavigationOutcome = {
  readonly decision: "MOVE" | "OFFER" | "STAY";
  readonly target: QNavigateTarget | null;
  /** MOVE with a collapsed pane: open it. */
  readonly openPane: boolean;
  /** STAY with a collapsed pane: the move kept for when it opens. */
  readonly remembered: QNavigateTarget | null;
  /** Why code changed the model's proposal, if it did. */
  readonly guard: QNavigationGuard | null;
  /**
   * OFFER while the workspace is pinned and they asked to go (GO): the
   * offer's one tap unpins, then opens it. Absent: an ordinary offer.
   */
  readonly unpin?: boolean | undefined;
};

export type QNavigationGuard =
  | "UNRESOLVED"
  | "DELETED"
  | "NO_ACCESS"
  | "ALREADY_THERE"
  | "UNSAVED_WORK"
  | "BUSY_PANE"
  | "COLLAPSED_PANE"
  | "BELOW_GATE"
  | "UNSURE"
  | "TWO_PLACES"
  | "NOTHING_BEFORE"
  /** Decision 78: the samples did not all name one place. */
  | "SPLIT_VOTE"
  /** The record was found only by part of the name said: a lookalike. */
  | "INEXACT_NAME"
  /** C10: the turn reader read no navigation asked (NONE, or negated). */
  | "NOT_ASKED"
  /** C10: the turn reader read OFFER_ONLY: the page is offered, never moved to. */
  | "OFFER_ONLY"
  /** C10 v84: CONTEXT, and the pane already shows that subject: kept. */
  | "SAME_SUBJECT"
  /** C10 v84: CONTEXT back to the page Q just moved away from: no ping-pong. */
  | "BACK_AND_FORTH"
  /** C10 v84: GO to a destination code itself moves to at once. */
  | "ANSWER_MOVES"
  /** The person pinned the workspace: the move is offered, never made. */
  | "PINNED";

// --- 0. The site map (W2) ---------------------------------------------

/**
 * W2.4's digest of the site map for the person's side, whole (DECISIONS 73:
 * never a trimmed digest that loses what Q needs to pick the exact place;
 * it sits in the cached prefix, which is where the cheapness comes from).
 */
export function navigationSiteMap(
  side: QNavigationSide,
  map: QSiteMap = Q_SITE_MAP,
): string {
  const other = side === "INVESTOR" ? "FOUNDER" : "INVESTOR";
  // What only the other side has, by title: so a request for one of them
  // is known to be no place of theirs (a STAY), never swapped for a
  // nearby page of theirs. Titles only; nothing here is theirs to open.
  const theirs: string[] = [];
  for (const page of map.pages) {
    if (page.redirectsTo !== undefined || page.audience === "ADMIN") continue;
    if (page.audience === other) {
      theirs.push(page.title);
      continue;
    }
    for (const tab of page.tabs)
      if (audienceOf(page, tab) === other)
        theirs.push(`${page.title}: ${tab.title}`);
  }
  // A title their own side also has (each side's own Messages, Calls) is
  // theirs too: only what they have no place of is listed.
  const own = new Set<string>();
  for (const page of map.pages) {
    if (page.redirectsTo !== undefined) continue;
    if (page.audience === side || page.audience === "ANY") {
      own.add(page.title);
      for (const tab of page.tabs)
        if (audienceOf(page, tab) !== other)
          own.add(`${page.title}: ${tab.title}`);
    }
  }
  const only = [...new Set(theirs)].filter((title) => !own.has(title));
  const digest = qSiteMapDigest(map, { side });
  return only.length === 0
    ? digest
    : `${digest}\nONLY THE OTHER SIDE HAS (never theirs to open): ${only.join("; ")}`;
}

/** A place in the site map's own words: a route, a tab, a section. */
export type QSitePlace = {
  readonly route: string;
  readonly tab: string | null;
  readonly sectionId: string | null;
  readonly slide: number | null;
  readonly position: "section" | "latest" | null;
};

const pageByRoute = (map: QSiteMap, route: string): QSiteMapPage | undefined =>
  map.pages.find((page) => page.route === route);

/**
 * W3.1's target said in the site map's words (where the pane is, for the
 * model; and the eval's scripted proposer). Null for a page the map does
 * not have.
 */
export function targetToSitePlace(
  target: QNavigateTarget,
  map: QSiteMap = Q_SITE_MAP,
): QSitePlace | null {
  const common = {
    sectionId: target.sectionId ?? null,
    slide: target.slide ?? null,
    position:
      target.position === "section" || target.position === "latest"
        ? target.position
        : null,
  };
  // W2's own landing: the page (and tab) a destination or record page opens.
  const landing = qSiteMapLandingFor(map, target.page);
  if (landing === null) return null;
  return {
    route: landing.page.route,
    tab: landing.tab?.id ?? target.tab ?? null,
    ...common,
  };
}

// --- The page pane's place, from the screen (W1/W3) -----------------------

const PATH_BASE = "http://route.local";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** A route template's segments against a path's: the params, or null. */
function matchRoute(template: string, pathname: string): string[] | null {
  const want = template.split("/").filter(Boolean);
  const got = pathname.split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params: string[] = [];
  for (const [i, segment] of want.entries()) {
    const actual = got[i] ?? "";
    if (segment.startsWith("[") && segment.endsWith("]")) {
      if (!UUID.test(actual)) return null;
      params.push(actual.toLowerCase());
    } else if (segment !== actual) return null;
  }
  return params;
}

/** How well a tab's href fits the URL: its query all present; null if not. */
function tabFit(href: string, url: URL): number | null {
  const tab = new URL(href, PATH_BASE);
  let fit = 0;
  for (const [key, value] of tab.searchParams) {
    if (url.searchParams.get(key) !== value) return null;
    fit += 1;
  }
  return fit;
}

const uuidParam = (url: URL, key: string): string | null => {
  const value = url.searchParams.get(key);
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
};

/**
 * The inverse of W3's deep link (`withNavigateTarget`): a page pane path
 * as the screen reports it (`/company/<id>?tab=deck&slide=4#section-team`)
 * read back through the site map as a QNavigateTarget. Null for a path
 * the map does not have; the policy then never thinks it is already there.
 */
export function navigateTargetFromPath(
  path: string,
  map: QSiteMap = Q_SITE_MAP,
): QNavigateTarget | null {
  let url: URL;
  try {
    url = new URL(path, PATH_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PATH_BASE) return null;
  const pathname = url.pathname.replace(/\/+$/u, "") || "/";
  // The page whose route is the path; else a tab whose href's path is.
  let best: {
    page: QSiteMapPage;
    tab: string | null;
    params: string[];
    fit: number;
  } | null = null;
  for (const page of map.pages) {
    const pageParams = matchRoute(page.route, pathname);
    for (const tab of page.tabs) {
      const tabPath = new URL(tab.href, PATH_BASE).pathname;
      const params = matchRoute(tabPath, pathname);
      if (params === null) continue;
      const fit = tabFit(tab.href, url);
      if (fit === null) continue;
      if (best === null || fit + 1 > best.fit)
        best = { page, tab: tab.id, params, fit: fit + 1 };
    }
    if (pageParams !== null && (best === null || best.fit < 1))
      best = { page, tab: null, params: pageParams, fit: 0.5 };
  }
  if (best === null) return null;
  const hash = url.hash.replace(/^#/u, "");
  const sectionId = hash.startsWith("section-")
    ? hash.slice("section-".length)
    : null;
  const slideText = url.searchParams.get("slide");
  const slide =
    slideText !== null && /^[1-9]\d{0,2}$/u.test(slideText)
      ? Number(slideText)
      : null;
  const [recordId = null] = best.params;
  const place = (withSection: boolean) =>
    sitePlaceToTarget(
      {
        route: best.page.route,
        tab: best.tab,
        sectionId: withSection ? sectionId : null,
        slide,
        position:
          withSection && sectionId !== null
            ? "section"
            : hash === "latest"
              ? "latest"
              : null,
      },
      {
        recordId,
        documentId: uuidParam(url, "doc"),
        itemId: uuidParam(url, "item"),
      },
      map,
    );
  // A section the map does not list still leaves the page known.
  const target = place(true) ?? place(false);
  if (target === null) return null;
  const messageId = uuidParam(url, "message");
  return messageId === null ? target : { ...target, messageId };
}

/** W3's screen.workspace (present: the workspace is on). */
export type QWorkspaceScreen = QWorkspaceScreenContract;

/** The policy's pane state from the screen (hints; nothing here grants). */
export function navigationPaneFromWorkspace(
  screen: QWorkspaceScreen,
  map: QSiteMap = Q_SITE_MAP,
): QNavigationPane {
  const read = (path: string | undefined) =>
    path === undefined ? null : navigateTargetFromPath(path, map);
  return {
    at: read(screen.at),
    previous: read(screen.previous),
    pane: screen.pagePane === "open" ? "OPEN" : "COLLAPSED",
    dirty: screen.dirty === true,
    busy: screen.busy === true ? "ACTIVE" : null,
    ...(screen.pinned === true ? { pinned: true } : {}),
  };
}

/** The ids resolution found for a place's record, document and item. */
export type QResolvedIds = {
  readonly recordId: string | null;
  readonly documentId: string | null;
  readonly itemId: string | null;
};

/**
 * A place in the site map's words, with its resolved ids, as W3.1's
 * QNavigateTarget. A tab that has its own destination is that destination
 * (Work's needs tab is WORK_NEEDS); a page that shows a record takes the
 * record's page (COMPANY, its tab kept); a relationship's messages tab is
 * its thread page. Null for anything the map does not have: a route, a
 * tab, a section, or a record on a page that shows none.
 */
export function sitePlaceToTarget(
  place: QSitePlace,
  ids: QResolvedIds,
  map: QSiteMap = Q_SITE_MAP,
): QNavigateTarget | null {
  // The digest writes a tab's section as "id@tab": the id is the section.
  if (place.sectionId?.includes("@") === true) {
    const [sectionId = "", tab = ""] = place.sectionId.split("@");
    place = {
      ...place,
      sectionId: sectionId.length === 0 ? null : sectionId,
      tab: place.tab ?? (tab.length === 0 ? null : tab),
    };
  }
  let page = pageByRoute(map, place.route);
  let tabId = place.tab;
  // A route that is already a tab's own path names that tab: the same
  // tab named again ("messages" on the messages route) adds nothing.
  if (
    page !== undefined &&
    tabId !== null &&
    !page.tabs.some((t) => t.id === tabId) &&
    tabOwningRoute(map, page.route)?.tab.id === tabId
  )
    tabId = null;
  // A route that is a tab's own path on another page (a relationship's
  // calls, diligence or deal) is that page at that tab.
  if (
    page === undefined ||
    (page.destinations.length === 0 && page.recordPages.length === 0)
  ) {
    const owner = tabOwningRoute(map, place.route);
    if (owner !== null) {
      page = owner.page;
      tabId = tabId ?? owner.tab.id;
    }
  }
  // A sub-route with no place of its own is its parent page's section of
  // the same id (/settings/team) or the same title (/settings/plan is
  // "Plan and billing", the parent's billing section), when it lists one.
  if (
    page !== undefined &&
    page.destinations.length === 0 &&
    page.recordPages.length === 0 &&
    page.tabs.length === 0 &&
    place.sectionId === null &&
    place.tab === null
  ) {
    const sub = page;
    const parentRoute = sub.route.slice(0, sub.route.lastIndexOf("/"));
    const last = sub.route.slice(sub.route.lastIndexOf("/") + 1);
    const parent = pageByRoute(map, parentRoute);
    const sameTitle = (a: string, b: string) =>
      a.trim().toLowerCase() === b.trim().toLowerCase();
    const section =
      parent === undefined || parent.destinations.length === 0
        ? undefined
        : (parent.sections.find((s) => s.tab === undefined && s.id === last) ??
          parent.sections.find(
            (s) => s.tab === undefined && sameTitle(s.title, sub.title),
          ));
    if (section !== undefined) {
      return sitePlaceToTarget(
        {
          ...place,
          route: parentRoute,
          sectionId: section.id,
          position: "section",
        },
        ids,
        map,
      );
    }
  }
  if (page === undefined) return null;
  let tab = tabId === null ? undefined : page.tabs.find((t) => t.id === tabId);
  if (tabId !== null && tab === undefined) return null;
  const section =
    place.sectionId === null
      ? undefined
      : page.sections.find((s) => s.id === place.sectionId);
  if (place.sectionId !== null && section === undefined) return null;
  if (section?.tab !== undefined && tab !== undefined && section.tab !== tab.id)
    return null;
  const recordId =
    ids.itemId !== null && page.route === "/board" ? null : ids.recordId;
  // A section on the page whatever the tab is the page's own place.
  if (
    section !== undefined &&
    section.tab === undefined &&
    tab !== undefined &&
    page.destinations.length > 0 &&
    recordId === null
  )
    tab = undefined;
  // A section only one tab shows names that tab.
  if (section?.tab !== undefined && tab === undefined)
    tab = page.tabs.find((t) => t.id === section.tab);
  // Nothing at page level: the tab the page opens on.
  if (tab === undefined && recordId === null && page.destinations.length === 0)
    tab = openingTab(page);
  // A record whose tabs are its own page's (a company): the tab it opens on.
  if (tab === undefined && recordId !== null) {
    const opening = openingTab(page);
    if (opening !== undefined && hrefPath(opening.href) === page.route)
      tab = opening;
  }
  // The leading section of what is shown is that place itself.
  const leading = section !== undefined && isLeadingSection(page, tab, section);
  const sectionId = section === undefined || leading ? null : section.id;
  const position =
    place.position === "section" && sectionId === null ? null : place.position;
  const detail = {
    ...(ids.documentId === null ? {} : { documentId: ids.documentId }),
    ...(place.slide === null ? {} : { slide: place.slide }),
    ...(sectionId === null ? {} : { sectionId }),
    ...(position === null ? {} : { position }),
  };
  let candidate: Record<string, unknown>;
  const [tabDestination] = tab?.destinations ?? [];
  if (
    tabDestination !== undefined &&
    recordId === null &&
    ids.itemId === null
  ) {
    candidate = { page: tabDestination, ...detail };
  } else if (ids.itemId !== null && page.route === "/board") {
    candidate = { page: "BOARD", itemId: ids.itemId, ...detail };
  } else if (recordId !== null) {
    const [recordPage] = page.recordPages;
    if (recordPage === undefined) return null;
    const thread =
      tab?.id === "messages" &&
      (recordPage === "RELATIONSHIP_COMPANY" ||
        recordPage === "RELATIONSHIP_INVESTOR");
    // A record page opens the record itself: a list page's tab, and a
    // section on it, are not the record's own.
    const recordTab =
      tab === undefined || thread ? null : QRecordTabSchema.safeParse(tab.id);
    const ownTab =
      recordTab?.success === true &&
      recordPageHasTab(recordPage, recordTab.data)
        ? recordTab.data
        : null;
    const listTab = tab !== undefined && !thread && ownTab === null;
    candidate = {
      page: thread ? `${recordPage}_MESSAGES` : recordPage,
      recordId,
      ...(ownTab === null ? {} : { tab: ownTab }),
      ...(listTab && section?.tab !== undefined
        ? {
            ...(ids.documentId === null ? {} : { documentId: ids.documentId }),
            ...(place.slide === null ? {} : { slide: place.slide }),
          }
        : detail),
    };
  } else {
    const [destination] = page.destinations;
    if (destination === undefined) return null;
    candidate = { page: destination, ...detail };
  }
  const parsed = QNavigateTargetSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const hrefPath = (href: string): string => href.split(/[?#]/u)[0] ?? href;

/** The tab a page opens on: its own path with no query, else the first on its path. */
function openingTab(
  page: QSiteMapPage,
): QSiteMapPage["tabs"][number] | undefined {
  return (
    page.tabs.find((t) => t.href === page.route) ??
    page.tabs.find((t) => hrefPath(t.href) === page.route)
  );
}

/** The page and tab whose tab lives at this route (its own path). */
function tabOwningRoute(
  map: QSiteMap,
  route: string,
): { page: QSiteMapPage; tab: QSiteMapPage["tabs"][number] } | null {
  for (const page of map.pages) {
    if (page.route === route) continue;
    const tab = page.tabs.find((t) => hrefPath(t.href) === route);
    if (tab !== undefined) return { page, tab };
  }
  return null;
}

/**
 * Whether a section is the place itself: the first section shown there
 * (the page's and this tab's, in the order the page lists them), or the
 * section that bears the tab's own id (the tab's body).
 */
function isLeadingSection(
  page: QSiteMapPage,
  tab: QSiteMapPage["tabs"][number] | undefined,
  section: QSiteMapPage["sections"][number],
): boolean {
  if (tab !== undefined && section.id === tab.id) return true;
  const shown = page.sections.filter(
    (s) => s.tab === undefined || s.tab === tab?.id,
  );
  return shown[0]?.id === section.id;
}

// --- 1. Decide -------------------------------------------------------------

export type QNavigationDecider = {
  readonly decide: (
    input: QNavigationInput,
    attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    },
  ) => Promise<NavigationDecisionResult | null>;
};

/**
 * DECISIONS 73 (owner, 6 Nov 2026): never trade Q's intelligence for cost
 * or speed. The decision runs on the answer's own class and model
 * (NORMAL_DIALOGUE), never a smaller one, with the whole site map; it is
 * kept cheap by the cached prefix, and fast by running beside retrieval.
 * Its reasoning level is keyed, so routing data can raise it.
 *
 * DECISIONS 78 (owner, 7 Nov 2026): reasoning MEDIUM, sampled three times
 * in parallel (NAVIGATION_VOTES). The output budget leaves room for
 * thinking (the Anthropic adapter turns thinking off below 4,096 output
 * tokens), and the cost ceiling covers that room; a decision itself is a
 * few hundred tokens.
 */
export const NAVIGATION_DECISION_TASK_CLASS = "NORMAL_DIALOGUE" as const;
export const NAVIGATION_DECISION_REASONING = "MEDIUM" as const;
const NAVIGATION_DECISION_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.12,
  maxOutputTokens: 4_096,
  attemptTimeoutMs: 9_000,
} as const;

/** The task's own variables (the renderer supplies the frame). */
export type QNavigationVariables = Omit<
  NavigationDecisionVariables,
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes"
>;

export function navigationVariables(
  input: QNavigationInput,
): QNavigationVariables {
  const records = {
    companies: input.records.companies.map((c) => ({
      name: c.name,
      ...(c.documents === undefined
        ? {}
        : { documents: c.documents.map((d) => d.title) }),
    })),
    investors: input.records.investors.map((i) => i.name),
    things: input.records.things.map((t) =>
      t.route === undefined ? t.title : { title: t.title, opensOn: t.route },
    ),
    deleted: input.records.deleted.map((d) => d.name),
    // Their own by name only: ids never reach the model.
    ...(input.records.own === undefined
      ? {}
      : {
          theirOwn: {
            kind: input.records.own.kind,
            name: input.records.own.name,
          },
        }),
  };
  return {
    utterance: input.utterance,
    recentTurns: JSON.stringify(input.recentTurns.slice(-6)).slice(0, 4_000),
    siteMap: input.siteMap.slice(0, 12_000),
    place: JSON.stringify({
      at: input.pane.at === null ? null : placeOf(input.pane.at, input.records),
      previous:
        input.pane.previous === null
          ? null
          : placeOf(input.pane.previous, input.records),
      pane: input.pane.pane,
      unsavedWork: input.pane.dirty,
      busy: input.pane.busy,
    }).slice(0, 1_500),
    pageText: (input.pageText ?? "").slice(0, 1_200),
    records: JSON.stringify(records).slice(0, 6_000),
    side: input.side,
    situation: (input.situation ?? "Nothing is known about them.").slice(
      0,
      1_600,
    ),
  };
}

/** A target said back in the site map's words and names, never ids. */
function placeOf(
  target: QNavigateTarget,
  records: QNavigationRecords,
): Record<string, unknown> {
  const name = (id: string | undefined): string | null => {
    if (id === undefined) return null;
    return (
      records.companies.find((c) => c.id === id)?.name ??
      records.investors.find((i) => i.id === id)?.name ??
      records.things.find((t) => t.id === id)?.title ??
      "a record"
    );
  };
  const place = targetToSitePlace(target);
  return {
    route: place?.route ?? null,
    ...(place?.tab == null ? {} : { tab: place.tab }),
    ...(target.recordId === undefined ? {} : { record: name(target.recordId) }),
    ...(target.itemId === undefined ? {} : { item: name(target.itemId) }),
    ...(target.sectionId === undefined ? {} : { sectionId: target.sectionId }),
    ...(target.slide === undefined ? {} : { slide: target.slide }),
  };
}

export function createQNavigationDecider(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger?: Logger | undefined;
  /**
   * Evals only: a registered NAVIGATION_DECISION version to render, for an
   * A/B on the same cases. Absent (production): the active version.
   */
  readonly promptVersion?: number | undefined;
}): QNavigationDecider {
  const registry = createDefaultPromptRegistry();
  return {
    decide: async (input, attribution) => {
      try {
        const rendered = renderPrompt<NavigationDecisionVariables>(registry, {
          task: "NAVIGATION_DECISION",
          ...(dependencies.promptVersion === undefined
            ? {}
            : { taskVersion: dependencies.promptVersion }),
          charter: "Q_SYSTEM",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You decide what the page pane does on this turn and nothing else; Capital Q resolves and checks it.",
          variables: navigationVariables(input),
        });
        const result = await dependencies.gateway.execute(
          {
            taskClass: NAVIGATION_DECISION_TASK_CLASS,
            reasoning: NAVIGATION_DECISION_REASONING,
            reasoningKey: "NAVIGATION_DECISION",
            sensitivity: "CONFIDENTIAL",
            budget: NAVIGATION_DECISION_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution,
          },
          { schema: NavigationDecisionResultV3Schema },
        );
        return result.output.kind === "STRUCTURED"
          ? NavigationDecisionResultV3Schema.parse(result.output.value)
          : null;
      } catch (error: unknown) {
        // A failed decision costs the move, never the answer: STAY.
        dependencies.logger?.warn(
          { err: error instanceof Error ? error.name : typeof error },
          "q navigation decision failed; the page pane stays",
        );
        return null;
      }
    },
  };
}

// --- 2. Resolve ----------------------------------------------------------

const norm = (text: string): string =>
  text.toLowerCase().replace(/[’']/gu, "'").replace(/\s+/gu, " ").trim();

const NAME_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "our",
  "my",
  "your",
  "of",
]);
const nameWords = (text: string): string[] =>
  norm(text)
    .replace(/'s\b/gu, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(" ")
    .filter((word) => word.length >= 3 && !NAME_STOP.has(word));

/**
 * One record by its name: exact; else the one name that contains what was
 * said; else the one whose every word was said (or that holds every word
 * said). Two that fit, or none, is no record: never a guess.
 */
function byName<T>(
  list: readonly T[],
  nameOf: (item: T) => string,
  said: string,
): T | null {
  return byNameMatch(list, nameOf, said)?.item ?? null;
}

/** byName, saying whether the name matched exactly or only in part. */
function byNameMatch<T>(
  list: readonly T[],
  nameOf: (item: T) => string,
  said: string,
): { readonly item: T; readonly exact: boolean } | null {
  const wanted = norm(said);
  const exact = list.filter((item) => norm(nameOf(item)) === wanted);
  if (exact.length === 1 && exact[0] !== undefined)
    return { item: exact[0], exact: true };
  if (exact.length > 1) return null;
  const inexact = (item: T | undefined) =>
    item === undefined ? null : { item, exact: false };
  const partial = list.filter((item) => norm(nameOf(item)).includes(wanted));
  if (partial.length === 1) return inexact(partial[0]);
  if (partial.length > 1) return null;
  const saidWords = new Set(nameWords(said));
  if (saidWords.size === 0) return null;
  const byWords = list.filter((item) => {
    const words = nameWords(nameOf(item));
    return (
      words.length > 0 &&
      (words.every((w) => saidWords.has(w)) ||
        [...saidWords].every((w) => words.includes(w)))
    );
  });
  return byWords.length === 1 ? inexact(byWords[0]) : null;
}

export type QNavigationResolution =
  | {
      readonly kind: "TARGET";
      readonly target: QNavigateTarget;
      /**
       * heldout4 follow-up: the record was found only by part of the name
       * said (a lookalike, never its exact name): offered, never moved to.
       */
      readonly inexact?: true;
    }
  | { readonly kind: "UNRESOLVED" | "DELETED" | "NOTHING_BEFORE" };

/** What the model named: a record (and maybe its document) on a page. */
export type QNavigationRecordAsk = {
  readonly kind: "COMPANY" | "INVESTOR" | "THING";
  readonly name: string;
  readonly document: string | null;
  readonly route: string;
  readonly tab: string | null;
};

/**
 * The ids behind a name, among only what the person may open. NONE never
 * says whether something exists out of reach; WHICH_ONE is two or more.
 */
export type QNavigationRecordFound =
  | {
      readonly status: "FOUND";
      readonly recordId: string;
      readonly documentId: string | null;
      /**
       * False: found only by part of the name said (or of the document's
       * title), a lookalike rather than the record named. Absent: the port
       * cannot tell (it is then treated as named).
       */
      readonly exact?: boolean;
    }
  | { readonly status: "NONE" | "WHICH_ONE" | "DELETED" }
  /** A record with no page of its own: the place named stands without it. */
  | { readonly status: "NO_PAGE" };

/**
 * W4.3's resolution port. In the answer path it is W2.3's
 * resolve_page_target (site.target.resolve), called from code as the
 * person, never offered to the model; the eval passes its records.
 */
export type QNavigationRecordResolver = (
  ask: QNavigationRecordAsk,
) => Promise<QNavigationRecordFound>;

/** Resolution over a list of records the person may open (eval, tests). */
export function findListedRecord(
  ask: QNavigationRecordAsk,
  records: QNavigationRecords,
): QNavigationRecordFound {
  if (byName(records.deleted, (d) => d.name, ask.name) !== null)
    return { status: "DELETED" };
  const companyMatch =
    ask.kind === "COMPANY"
      ? byNameMatch(records.companies, (c) => c.name, ask.name)
      : null;
  const company = companyMatch?.item ?? null;
  const match =
    companyMatch ??
    (ask.kind === "INVESTOR"
      ? byNameMatch(records.investors, (i) => i.name, ask.name)
      : ask.kind === "THING"
        ? byNameMatch(records.things, (t) => t.title, ask.name)
        : null);
  if (match === null) return { status: "NONE" };
  const found = match.item;
  // A company or investor has one name: part of it is a lookalike. Board
  // items and documents are named by what they are about, so a part of
  // their title is how people name them.
  const exact = ask.kind === "THING" || match.exact;
  if (ask.kind === "THING" && "route" in found && found.route === null)
    return { status: "NO_PAGE" };
  if (ask.document === null)
    return {
      status: "FOUND",
      recordId: found.id,
      documentId: null,
      exact,
    };
  const doc =
    company === null
      ? null
      : byNameMatch(company.documents ?? [], (d) => d.title, ask.document);
  return doc === null
    ? { status: "NONE" }
    : {
        status: "FOUND",
        recordId: found.id,
        documentId: doc.item.id,
        exact,
      };
}

export function listedRecordResolver(
  records: QNavigationRecords,
): QNavigationRecordResolver {
  return (ask) => Promise.resolve(findListedRecord(ask, records));
}

function siteProposal(place: NonNullable<NavigationDecisionResult["place"]>) {
  return {
    route: place.route,
    tab: place.tab,
    sectionId: place.sectionId,
    slide: place.slide,
    position:
      place.position === "section" || place.position === "latest"
        ? place.position
        : null,
  } as const;
}

/** The place once its names are ids (or it named none). */
function placeTarget(
  place: NonNullable<NavigationDecisionResult["place"]>,
  found: QNavigationRecordFound | null,
  map: QSiteMap,
): QNavigationResolution {
  if (found !== null && found.status === "DELETED") return { kind: "DELETED" };
  if (found?.status === "NO_PAGE")
    return placeTarget({ ...place, record: null, document: null }, null, map);
  if (found !== null && found.status !== "FOUND") return { kind: "UNRESOLVED" };
  // A document named without a record has nothing to belong to.
  if (found === null && place.document !== null) return { kind: "UNRESOLVED" };
  const onBoard = place.route === "/board" && place.record?.kind === "THING";
  const id = found?.recordId ?? null;
  const target = sitePlaceToTarget(
    siteProposal(place),
    {
      recordId: onBoard ? null : id,
      documentId: found?.documentId ?? null,
      itemId: onBoard ? id : null,
    },
    map,
  );
  if (target === null) return { kind: "UNRESOLVED" };
  return found?.status === "FOUND" && found.exact === false
    ? { kind: "TARGET", target, inexact: true }
    : { kind: "TARGET", target };
}

/**
 * A document named by its title on a page that shows one document as its
 * record (/documents) is that record: the title names it, as a record's
 * name does. Elsewhere a document belongs to the record named with it.
 */
function documentAsRecord(
  place: NonNullable<NavigationDecisionResult["place"]>,
  map: QSiteMap,
): NonNullable<NavigationDecisionResult["place"]> {
  if (place.record !== null || place.document === null) return place;
  const page = pageByRoute(map, place.route);
  if (
    !(page?.recordPages as readonly string[] | undefined)?.includes("DOCUMENT")
  )
    return place;
  return {
    ...place,
    record: { kind: "THING", name: place.document },
    document: null,
  };
}

function askOf(
  place: NonNullable<NavigationDecisionResult["place"]>,
): QNavigationRecordAsk | null {
  return place.record === null
    ? null
    : {
        kind: place.record.kind,
        name: place.record.name,
        document: place.document,
        route: place.route,
        tab: place.tab,
      };
}

/**
 * The model's place, with every name turned into the id of a record the
 * person may open, mapped through the site map to W3.1's target. Never a
 * guess: two records that fit, or none, is UNRESOLVED; so is a route,
 * tab or section the site map does not have.
 */
/**
 * A founder's own data room and deck (/company/data-room) are their own
 * company's tabs: the page sends them there. With their company known,
 * the place is that record, so "already there" and Back compare true.
 */
function asOwnRecord(
  resolution: QNavigationResolution,
  records: QNavigationRecords,
): QNavigationResolution {
  return resolution.kind === "TARGET"
    ? { ...resolution, target: ownPlace(resolution.target, records) }
    : resolution;
}

/** A founder's own data room or deck as their company's tab (else as is). */
export function ownPlace(
  target: QNavigateTarget,
  records: QNavigationRecords,
): QNavigateTarget {
  const own = records.own;
  if (own?.kind !== "COMPANY" || own.id === undefined) return target;
  const { page, ...rest } = target;
  const tab =
    page === "OWN_DATA_ROOM" ? "dataroom" : page === "OWN_DECK" ? "deck" : null;
  if (tab === null) return target;
  const parsed = QNavigateTargetSchema.safeParse({
    ...rest,
    page: "COMPANY",
    recordId: own.id,
    tab,
  });
  return parsed.success ? parsed.data : target;
}

export function resolveNavigationPlace(
  proposal: NavigationDecisionResult,
  input: QNavigationInput,
  map: QSiteMap = Q_SITE_MAP,
): QNavigationResolution {
  if (proposal.back) return backTo(input);
  const place =
    proposal.place === null ? null : documentAsRecord(proposal.place, map);
  if (place === null) return { kind: "UNRESOLVED" };
  const ask = askOf(place);
  return asOwnRecord(
    placeTarget(
      place,
      ask === null ? null : findListedRecord(ask, input.records),
      map,
    ),
    input.records,
  );
}

/** The same, through a resolver port (resolve_page_target in the answer path). */
export async function resolveNavigationPlaceWith(
  proposal: NavigationDecisionResult,
  input: QNavigationInput,
  resolver: QNavigationRecordResolver,
  map: QSiteMap = Q_SITE_MAP,
): Promise<QNavigationResolution> {
  if (proposal.back) return backTo(input);
  const place =
    proposal.place === null ? null : documentAsRecord(proposal.place, map);
  if (place === null) return { kind: "UNRESOLVED" };
  const ask = askOf(place);
  let found: QNavigationRecordFound | null = null;
  if (ask !== null) {
    try {
      found = await resolver(ask);
    } catch {
      // A failed lookup costs the move, never the answer.
      return { kind: "UNRESOLVED" };
    }
  }
  return asOwnRecord(placeTarget(place, found, map), input.records);
}

function backTo(input: QNavigationInput): QNavigationResolution {
  return input.pane.previous === null
    ? { kind: "NOTHING_BEFORE" }
    : { kind: "TARGET", target: ownPlace(input.pane.previous, input.records) };
}

// --- 3. Policy -------------------------------------------------------------

const PLACE_FIELDS = [
  "page",
  "recordId",
  "companyId",
  "tab",
  "documentId",
  "slide",
  "threadId",
  "messageId",
  "sectionId",
  "itemId",
] as const;

/** The same place (the top of a page needs no position). */
export function samePlace(a: QNavigateTarget, b: QNavigateTarget): boolean {
  const position = (t: QNavigateTarget) =>
    t.position === "top" ? undefined : t.position;
  return (
    PLACE_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null)) &&
    (position(a) ?? null) === (position(b) ?? null)
  );
}

export type QNavigationPolicyConfig = {
  /**
   * Whether autonomous moves are allowed (the q-nav eval's gate holds).
   * False: every MOVE is an OFFER -- a config value, not a code change.
   */
  readonly movesAllowed: boolean;
};

const STAY = (
  guard: QNavigationGuard | null,
  remembered: QNavigateTarget | null = null,
): QNavigationOutcome => ({
  decision: "STAY",
  target: null,
  openPane: false,
  remembered,
  guard,
});

/**
 * The hard constraints (plan W4.2), in code, after resolution. The model
 * proposes; this decides what may happen. One outcome per turn.
 */
export function applyNavigationPolicy(input: {
  readonly proposal: NavigationDecisionResult | null;
  readonly resolution: QNavigationResolution | null;
  readonly pane: QNavigationPane;
  readonly canOpen: (page: string) => boolean;
  readonly config: QNavigationPolicyConfig;
  /** Their records: where the pane is, read as their own record's place. */
  readonly records?: QNavigationRecords | undefined;
  /** The model's second place, resolved (v5): a different one is an OFFER. */
  readonly alternative?: QNavigationResolution | null | undefined;
}): QNavigationOutcome {
  const { proposal, resolution } = input;
  const records = input.records;
  const pane =
    records === undefined || input.pane.at === null
      ? input.pane
      : { ...input.pane, at: ownPlace(input.pane.at, records) };
  if (proposal === null || proposal.decision === "STAY") return STAY(null);
  if (resolution === null || resolution.kind !== "TARGET") {
    return STAY(resolution?.kind ?? "UNRESOLVED");
  }
  const target = sharedPlace(resolution.target, input.alternative);
  if (!input.canOpen(target.page)) return STAY("NO_ACCESS");
  if (pane.at !== null && samePlace(target, pane.at))
    return STAY("ALREADY_THERE");
  const lookalike = resolution.inexact === true;
  if (pane.pane === "COLLAPSED") {
    // Open the pane only for a page they asked to see; otherwise keep it.
    return proposal.decision === "MOVE" &&
      proposal.askedForPage &&
      proposal.sure !== false &&
      !lookalike &&
      !secondPlace(target, input.alternative, input.canOpen, records)
      ? {
          decision: "MOVE",
          target,
          openPane: true,
          remembered: null,
          guard: null,
        }
      : STAY("COLLAPSED_PANE", target);
  }
  const offer = (guard: QNavigationGuard | null): QNavigationOutcome => ({
    decision: "OFFER",
    target,
    openPane: false,
    remembered: null,
    guard,
  });
  if (pane.dirty) return offer("UNSAVED_WORK");
  if (pane.busy !== null) return offer("BUSY_PANE");
  // Two places serve what they mean: offer it, never move to a guess.
  if (proposal.sure === false) return offer("UNSURE");
  if (secondPlace(target, input.alternative, input.canOpen, records))
    return offer("TWO_PLACES");
  // A record found only by part of the name said: never moved to a guess.
  if (lookalike) return offer("INEXACT_NAME");
  if (proposal.decision === "OFFER") return offer(null);
  if (!input.config.movesAllowed) return offer("BELOW_GATE");
  return {
    decision: "MOVE",
    target,
    openPane: false,
    remembered: null,
    guard: null,
  };
}

/**
 * C10 (owner directive and correction, 13 Nov 2026: semantic intent, not
 * keyword routing; keep contextual workspace navigation). The decision ran
 * on every turn and moved or offered pages nobody needed (live on
 * 5af6c8ad3: a chart question opened the company's Overview; "What stage
 * is Ledgerline at?" stored "Relationship is ready to open."), yet the
 * owner values Q bringing the page the conversation is now about into the
 * adjacent pane. The turn reader's navigation intent (TURN_READER v84),
 * read in the same single reading, decides WHETHER the pane may change;
 * the decision decides WHERE, and its policy (applied before this) whether
 * it may: no access, unresolved or inexact names, two places, unsure, a
 * dirty or busy pane, a collapsed pane, already there.
 *
 *   NONE or negated  nothing moves, nothing is offered, nothing remembered
 *   OFFER_ONLY       a MOVE becomes an OFFER of the same place
 *   CONTEXT          the decision stands under its policy -- deep links
 *                    included (a record's tab, section, document, thread) --
 *                    with two holds: the pane already shows that subject
 *                    (sameSubject) -- SAME_SUBJECT; or it is the page Q just
 *                    moved away from -- BACK_AND_FORTH
 *   GO               the decision stands; when code itself moves to the
 *                    reader's destination at once (fast GO), the decision
 *                    adds nothing -- ANSWER_MOVES
 *   null             no reading (a code lane, a failed or older reading):
 *                    the decision stands as before -- the documented fallback
 */
export function gateByReading(
  outcome: QNavigationOutcome,
  navigation: TurnNavigationIntentV84 | null,
  context: {
    readonly pane?: QNavigationPane | undefined;
    readonly codeMoves?: boolean | undefined;
  } = {},
): QNavigationOutcome {
  const gated = gateByReadingAlone(outcome, navigation, context);
  return context.pane?.pinned === true ? holdForPin(gated, navigation) : gated;
}

/**
 * Pinned workspace (owner addendum, 13 Nov 2026), the last hold: the
 * reading's own holds (NONE, OFFER_ONLY, SAME_SUBJECT, BACK_AND_FORTH,
 * ANSWER_MOVES) and the policy's guards (no access, unsaved work, busy,
 * collapsed, ambiguity) have already applied, so it only ever turns a
 * move that would have happened into an offer of the same place:
 *
 *   MOVE              an OFFER, guard PINNED (the page never changes)
 *   MOVE, read GO     an OFFER whose one tap unpins and opens (`unpin`):
 *                     an exact request is never silently dropped
 *   OFFER, read GO    the same offer, with `unpin`
 *   STAY              unchanged (nothing offered that was not proposed;
 *                     a collapsed pane's remembered move stays remembered)
 *
 * A place they may not open never reaches here as a target (the policy's
 * NO_ACCESS is a STAY), so pinning never produces such an offer.
 */
function holdForPin(
  outcome: QNavigationOutcome,
  navigation: TurnNavigationIntentV84 | null,
): QNavigationOutcome {
  if (outcome.decision === "STAY" || outcome.target === null) return outcome;
  const go = readsAsGo(navigation);
  if (outcome.decision === "OFFER")
    return go ? { ...outcome, unpin: true } : outcome;
  return {
    decision: "OFFER",
    target: outcome.target,
    openPane: false,
    remembered: null,
    guard: "PINNED",
    ...(go ? { unpin: true } : {}),
  };
}

function gateByReadingAlone(
  outcome: QNavigationOutcome,
  navigation: TurnNavigationIntentV84 | null,
  context: {
    readonly pane?: QNavigationPane | undefined;
    readonly codeMoves?: boolean | undefined;
  },
): QNavigationOutcome {
  if (navigation === null) return outcome;
  if (readsAsNoNavigation(navigation)) {
    return outcome.decision === "STAY" && outcome.remembered === null
      ? outcome
      : STAY("NOT_ASKED");
  }
  if (navigation.mode === "OFFER_ONLY" && outcome.decision === "MOVE") {
    return {
      decision: "OFFER",
      target: outcome.target,
      openPane: false,
      remembered: null,
      guard: "OFFER_ONLY",
    };
  }
  if (navigation.mode === "GO" && context.codeMoves === true) {
    return outcome.decision === "STAY" && outcome.remembered === null
      ? outcome
      : STAY("ANSWER_MOVES");
  }
  if (readsAsContext(navigation)) {
    const place = outcome.target ?? outcome.remembered;
    const pane = context.pane;
    if (place !== null && pane !== undefined) {
      if (pane.at !== null && sameSubject(place, pane.at))
        return STAY("SAME_SUBJECT");
      if (pane.previous !== null && sameSubject(place, pane.previous))
        return STAY("BACK_AND_FORTH");
    }
  }
  return outcome;
}

/**
 * The same subject on screen: the same page, record, tab, document, thread
 * and item -- whatever its section, slide, message or scroll position. A
 * follow-up about what the pane already shows keeps it; a deep link to
 * another tab of the same record ("can I see their data room?" while the
 * company's Overview is open) is a new subject and moves.
 */
const SUBJECT_FIELDS = [
  "page",
  "recordId",
  "companyId",
  "tab",
  "documentId",
  "threadId",
  "itemId",
] as const satisfies readonly (keyof QNavigateTarget)[];
export function sameSubject(a: QNavigateTarget, b: QNavigateTarget): boolean {
  return SUBJECT_FIELDS.every(
    (field) => (a[field] ?? null) === (b[field] ?? null),
  );
}

/**
 * C10 v85 (live 13 Nov 2026 on 12baf142c): "Who should I follow up with
 * this week?" was read CONTEXT but the decision voted STAY (no guard), so
 * the pipeline never came up. When the reading is CONTEXT and names one of
 * the person's own screens (`navigation.destination`), and the decision
 * stayed with no guard and nothing remembered, that destination is placed
 * through the same policy (applyNavigationPolicy: may they open it, already
 * there, unsaved work or a busy pane is an offer, a collapsed pane only
 * remembers it, the moves gate). gateByReading's holds apply after it.
 * Null: nothing to place this way; the decision's outcome stands.
 *
 * Why this and not the reading in the decision's prompt: the decision runs
 * beside the reading, not after it; feeding it the reading would make every
 * workspace turn wait for both in series. Here code adds no model call and
 * no wait, and only ever acts where the decision itself proposed nothing.
 */
export function readingPlacesContext(input: {
  readonly proposed: QNavigationOutcome;
  readonly navigation: QReadNavigation | null;
  readonly pane: QNavigationPane;
  readonly canOpen: (page: string) => boolean;
  readonly config: QNavigationPolicyConfig;
  readonly records?: QNavigationRecords | undefined;
}): QNavigationOutcome | null {
  const { navigation, proposed } = input;
  const destination = navigation?.destination ?? null;
  if (destination === null) return null;
  // Pinned workspace: a GO to one of their own screens is code's fast GO
  // when unpinned (answer.ts fastGoOf moves at once); pinned, code does not
  // move, so the destination is placed here and gateByReading's PINNED
  // hold makes it an "unpin and open" offer -- an exact request is never
  // silently dropped, whatever the decision voted. Placed through the same
  // policy, so a place they may not open is never offered.
  const pinnedGo = input.pane.pinned === true && readsAsGo(navigation);
  if (!pinnedGo && !readsAsContext(navigation)) return null;
  if (
    proposed.decision !== "STAY" ||
    (proposed.guard !== null && !pinnedGo) ||
    proposed.remembered !== null
  ) {
    return null;
  }
  return applyNavigationPolicy({
    proposal: {
      decision: "MOVE",
      place: null,
      back: false,
      // A page the conversation turned to, not one they asked to see: a
      // collapsed pane only remembers it.
      askedForPage: false,
      reason: "",
    },
    resolution: { kind: "TARGET", target: { page: destination } },
    pane: input.pane,
    canOpen: input.canOpen,
    config: input.config,
    records: input.records,
  });
}

/**
 * A record's place on another of its tabs: the same page and record, the
 * tab selected (a relationship's messages are its thread page); nothing
 * else of the old place (a section, document or slide belongs to its own
 * tab). The place itself when it already shows that tab (a company
 * profile with no tab is its Overview); null when the page has no such tab.
 */
function onRecordTab(
  place: QNavigateTarget,
  tab: QRecordTab,
): QNavigateTarget | null {
  const page = QRecordPageSchema.safeParse(place.page);
  if (!page.success || place.recordId === undefined) return null;
  const thread =
    page.data === "RELATIONSHIP_COMPANY_MESSAGES" ||
    page.data === "RELATIONSHIP_INVESTOR_MESSAGES";
  const record =
    page.data === "RELATIONSHIP_COMPANY_MESSAGES"
      ? "RELATIONSHIP_COMPANY"
      : page.data === "RELATIONSHIP_INVESTOR_MESSAGES"
        ? "RELATIONSHIP_INVESTOR"
        : page.data;
  if (!recordPageHasTab(record, tab)) return null;
  const showing = thread
    ? "messages"
    : (place.tab ??
      (recordPageHasTab(record, "overview") ? "overview" : undefined));
  if (showing === tab) return place;
  const parsed = QNavigateTargetSchema.safeParse(
    tab === "messages" &&
      (record === "RELATIONSHIP_COMPANY" || record === "RELATIONSHIP_INVESTOR")
      ? { page: `${record}_MESSAGES`, recordId: place.recordId }
      : { page: record, recordId: place.recordId, tab },
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Record tabs (owner clarification, 13 Nov 2026; TURN_READER v87): the
 * reading names the part of a record the turn is about (`navigation.tab`,
 * by meaning, any language); the decision, which runs beside the reading,
 * never sees it. "Can I see their data room?" with Clinicrest's Overview
 * in the pane was a SAME_SUBJECT stay. Applied before gateByReading:
 *
 *   the decision's place (or the remembered one) is a record page with
 *   that tab      the same record on that tab (already there is a STAY)
 *   the decision stayed with nothing proposed (no guard, "already there"
 *   or a split vote) and the turn's record is known
 *                 that record on that tab, through the same policy
 *                 (access, unsaved work, busy, collapsed, the moves gate)
 *
 * The turn's record (live 13 Nov 2026 on d96c63ee1: "Tell me about
 * Ledgerline." then "And what's their team like?" stayed on Clinicrest's
 * messages): `subject`, the one record the conversation is about, resolved
 * as the person (subjectPlace); with none told (undefined), the record in
 * the pane. A subject told as unresolved (null: two candidates, or none
 * they may open) places nothing -- never the pane's record in its stead,
 * never a guess. A subject the reading named (`named`) with no tab is
 * placed as its own page (CONTEXT turned to it).
 *
 * A tab the page lacks adds nothing and invents no move; NONE adds nothing.
 * gateByReading's holds (NONE, OFFER_ONLY, SAME_SUBJECT, pinned) apply
 * after it, so a pinned pane gets an offer that carries the tab. No model
 * call and no words: only the reading and the screen. Null: unchanged.
 */
export function readingTabPlace(input: {
  readonly proposed: QNavigationOutcome;
  readonly navigation: QReadNavigation | null;
  readonly pane: QNavigationPane;
  readonly canOpen: (page: string) => boolean;
  readonly config: QNavigationPolicyConfig;
  readonly records?: QNavigationRecords | undefined;
  /**
   * The turn's one record, resolved (subjectPlace): a place; null when
   * told but unresolved; undefined when not told (the pane's record).
   */
  readonly subject?: QPlacedSubject | null | undefined;
}): QNavigationOutcome | null {
  const { navigation, proposed, pane, subject } = input;
  const tab = navigation?.tab ?? null;
  if (navigation === null || readsAsNoNavigation(navigation)) return null;
  const place = proposed.target ?? proposed.remembered;
  if (place !== null) {
    if (tab === null) return null;
    const tabbed = onRecordTab(place, tab);
    if (tabbed === null || tabbed === place) return null;
    if (proposed.target === null) return { ...proposed, remembered: tabbed };
    if (pane.at !== null && samePlace(tabbed, pane.at))
      return STAY("ALREADY_THERE");
    return { ...proposed, target: tabbed };
  }
  if (
    proposed.decision !== "STAY" ||
    (proposed.guard !== null &&
      proposed.guard !== "ALREADY_THERE" &&
      proposed.guard !== "SPLIT_VOTE")
  )
    return null;
  const tabbed = subjectOnTab(pane.at, subject, tab, navigation);
  if (tabbed === null) return null;
  return applyNavigationPolicy({
    proposal: {
      decision: "MOVE",
      place: null,
      back: false,
      // GO asked for that page; CONTEXT is a page the conversation turned
      // to (a collapsed pane only remembers it).
      askedForPage: readsAsGo(navigation),
      reason: "",
    },
    resolution: { kind: "TARGET", target: tabbed },
    pane,
    canOpen: input.canOpen,
    config: input.config,
    records: input.records,
  });
}

/** The turn's record as placed: its record page, and whether the reading named it. */
export type QPlacedSubject = {
  readonly place: QNavigateTarget;
  readonly named: boolean;
};

/**
 * Where the reading's tab lands when the decision proposed nothing: the
 * turn's record on that tab (the pane's own page of it first, when the
 * pane shows that record), else the record in the pane when no subject
 * was told. Null: nothing to place (unresolved subject, no tab where none
 * was named, a page lacking the tab, or the pane already there).
 */
function subjectOnTab(
  at: QNavigateTarget | null,
  subject: QPlacedSubject | null | undefined,
  tab: QRecordTab | null,
  navigation: QReadNavigation,
): QNavigateTarget | null {
  if (subject === null) return null;
  const sameRecord =
    subject !== undefined &&
    at !== null &&
    at.recordId !== undefined &&
    at.recordId === subject.place.recordId;
  if (subject === undefined || sameRecord) {
    if (at === null || tab === null) return null;
    const onPane = onRecordTab(at, tab);
    if (onPane !== null) return onPane === at ? null : onPane;
    // The pane already shows that record (its thread, say): its Overview
    // is no new subject; another of its tabs is on its own page.
    if (subject === undefined || tab === "overview") return null;
  }
  if (tab === null) {
    // No tab: only a record the reading named, as its own page (CONTEXT
    // turned to it); already on that record, nothing.
    return subject.named && readsAsContext(navigation) && !sameRecord
      ? subject.place
      : null;
  }
  const onSubject = onRecordTab(subject.place, tab);
  if (onSubject === null) return null;
  return at !== null && samePlace(onSubject, at) ? null : onSubject;
}

/**
 * The record the turn is about (QPageMoveReading.subject), resolved as the
 * person (W2.3's resolver, or their listed records): exactly one record
 * they may open, by its name; a known id that the name does not resolve
 * to, two records, a lookalike or none: null. Undefined: not told.
 */
export async function subjectPlace(
  subject: QPageMoveSubject | null | undefined,
  resolver: QNavigationRecordResolver,
  records: QNavigationRecords,
  map: QSiteMap = Q_SITE_MAP,
): Promise<QPlacedSubject | null | undefined> {
  if (subject === undefined) return undefined;
  if (subject === null) return null;
  const page = subject.kind;
  const route = qSiteMapLandingFor(map, page)?.page.route;
  let recordId: string | null = null;
  if (subject.name !== null && route !== undefined) {
    const found = await resolver({
      kind: subject.kind,
      name: subject.name,
      document: null,
      route,
      tab: null,
    }).catch(() => null);
    if (found?.status !== "FOUND" || found.exact === false) return null;
    recordId = found.recordId;
    if (subject.id !== null && subject.id !== recordId) return null;
  } else if (subject.id !== null) {
    // No name: only a record among those they may open, by its id.
    const listed =
      subject.kind === "COMPANY" ? records.companies : records.investors;
    recordId = listed.some((one) => one.id === subject.id) ? subject.id : null;
  }
  if (recordId === null) return null;
  const parsed = QNavigateTargetSchema.safeParse({ page, recordId });
  return parsed.success ? { place: parsed.data, named: subject.named } : null;
}

/**
 * A pitch to watch (the reading's companyMedia.pitch) lives on the
 * profile's Elevator pitch tab, never the deck (live 13 Nov 2026 on
 * d96c63ee1: "Play me their pitch." was read tab null and the decision's
 * own place was the company's deck). The decided or overlaid place on
 * tab deck becomes that record's elevator tab; already there: a STAY.
 */
export function pitchOnElevator(
  outcome: QNavigationOutcome,
  pitch: boolean,
  pane: QNavigationPane,
): QNavigationOutcome {
  if (!pitch) return outcome;
  const elevator = (place: QNavigateTarget | null): QNavigateTarget | null =>
    place !== null && place.page === "COMPANY" && place.tab === "deck"
      ? (onRecordTab(place, "elevator") ?? place)
      : place;
  const target = elevator(outcome.target);
  const remembered = elevator(outcome.remembered);
  if (target === outcome.target && remembered === outcome.remembered)
    return outcome;
  if (
    target !== null &&
    outcome.decision !== "STAY" &&
    pane.at !== null &&
    samePlace(target, pane.at)
  )
    return STAY("ALREADY_THERE");
  return { ...outcome, target, remembered };
}

/** A real second place: resolved, theirs to open, and not the same place. */
function secondPlace(
  target: QNavigateTarget,
  alternative: QNavigationResolution | null | undefined,
  canOpen: (page: string) => boolean,
  records: QNavigationRecords | undefined,
): boolean {
  if (alternative?.kind !== "TARGET") return false;
  const other =
    records === undefined
      ? alternative.target
      : ownPlace(alternative.target, records);
  const mine = records === undefined ? target : ownPlace(target, records);
  // On the same tab of the same page and record, both are on screen once
  // it opens: no wrong page is possible, so it is not a second place.
  // Sibling tabs are separate places (a wrong tab is a wrong page).
  if (onSamePage(other, mine)) return false;
  return canOpen(other.page) && !samePlace(other, mine);
}

function onSamePage(a: QNavigateTarget, b: QNavigateTarget): boolean {
  const pa = targetToSitePlace(a);
  const pb = targetToSitePlace(b);
  return (
    pa !== null &&
    pb !== null &&
    pa.route === pb.route &&
    pa.tab === pb.tab &&
    (a.recordId ?? null) === (b.recordId ?? null)
  );
}

/**
 * Two sections of one tab that serve what they mean about as well: the
 * tab they share is the place (never a guess between its sections).
 */
function sharedPlace(
  target: QNavigateTarget,
  alternative: QNavigationResolution | null | undefined,
): QNavigateTarget {
  if (alternative?.kind !== "TARGET") return target;
  const other = alternative.target;
  if (
    other.page !== target.page ||
    (other.recordId ?? null) !== (target.recordId ?? null) ||
    (other.tab ?? null) !== (target.tab ?? null) ||
    (other.sectionId ?? null) === (target.sectionId ?? null) ||
    target.sectionId === undefined
  )
    return target;
  const { sectionId: _section, position, ...rest } = target;
  const shared = QNavigateTargetSchema.safeParse({
    ...rest,
    ...(position === "latest" ? { position } : {}),
  });
  return shared.success ? shared.data : target;
}

/** The model's alternative, resolved the same way as its place. */
export async function resolveAlternative(
  proposal: NavigationDecisionResult | null,
  input: QNavigationInput,
  resolver: QNavigationRecordResolver,
  map: QSiteMap = Q_SITE_MAP,
): Promise<QNavigationResolution | null> {
  const alternative = proposal?.alternative ?? null;
  if (proposal === null || alternative === null || proposal.decision === "STAY")
    return null;
  return resolveNavigationPlaceWith(
    { ...proposal, place: alternative, back: false, alternative: null },
    input,
    resolver,
    map,
  );
}

/**
 * DECISIONS 78: self-consistency. The decision is sampled this many times
 * at once (thinking on, so the samples can differ), each through the same
 * resolution and policy; the page pane moves only when every sample lands
 * on one place. It turns the model's own uncertainty into an OFFER without
 * any rule about words.
 */
export const NAVIGATION_VOTES = 3;

/**
 * The decision's deadline from the turn's start: production's 2-4.5 s
 * (batch-8 replay) with room. A stored answer never waits past it.
 */
export const NAVIGATION_DECISION_DEADLINE_MS = 6_000;
/** The most a stored answer waits for the decision before it goes alone. */
export const NAVIGATION_SETTLE_GRACE_MS = 1_500;
/** A late decision still moves the pane up to this long into the turn. */
export const NAVIGATION_LATE_LIMIT_MS = 20_000;

/** How much a decision does on its own: the most careful one wins a tie. */
const AUTHORITY: Readonly<Record<QNavigationOutcome["decision"], number>> = {
  STAY: 0,
  OFFER: 1,
  MOVE: 2,
};

/** Where an outcome would take them: its target, or the one remembered. */
const votedPlace = (outcome: QNavigationOutcome): QNavigateTarget | null =>
  outcome.target ?? outcome.remembered;

/**
 * The place a vote is about: everything but the section (and its scroll
 * position). Batch-10 replay: three samples on Analytics, one naming the
 * who-viewed section, split a unanimous move into an OFFER.
 */
const withoutSection = (target: QNavigateTarget): QNavigateTarget => {
  const { sectionId: _section, position, ...rest } = target;
  const parsed = QNavigateTargetSchema.safeParse({
    ...rest,
    ...(position === "section" || position === undefined ? {} : { position }),
  });
  return parsed.success ? parsed.data : target;
};
const samePlaceAnySection = (a: QNavigateTarget, b: QNavigateTarget) =>
  samePlace(withoutSection(a), withoutSection(b));

/**
 * The group's section: the one a strict majority of it names, else none
 * (the place itself, never a guess between its parts).
 */
function sectionVoted(
  group: readonly QNavigationOutcome[],
  chosen: QNavigationOutcome,
): QNavigationOutcome {
  const counts = new Map<string, number>();
  for (const one of group) {
    const section = votedPlace(one)?.sectionId ?? "";
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const winner =
    top !== undefined && top[1] * 2 > group.length && top[0] !== ""
      ? top[0]
      : null;
  const place = (target: QNavigateTarget | null): QNavigateTarget | null => {
    if (target === null) return null;
    if (winner === null) return withoutSection(target);
    const parsed = QNavigateTargetSchema.safeParse({
      ...withoutSection(target),
      sectionId: winner,
      position: "section",
    });
    return parsed.success ? parsed.data : target;
  };
  return {
    ...chosen,
    target: place(chosen.target),
    remembered: place(chosen.remembered),
  };
}

const leastAuthority = (
  outcomes: readonly QNavigationOutcome[],
): QNavigationOutcome =>
  outcomes.reduce((careful, o) =>
    AUTHORITY[o.decision] < AUTHORITY[careful.decision] ? o : careful,
  );

/**
 * The samples' outcomes, voted (decision 78; batch 13, owner: "the whole
 * point was for Q to open pages by itself"):
 * - all name one place: the most careful of them (a MOVE only if all move);
 * - a strict majority (2 of 3) names one place: the most careful of that
 *   majority -- a MOVE when they all move there. A safety guard on any of
 *   them (an inexact name, unsaved work, ...) still makes it an offer.
 *   A sample whose place did not resolve votes for no place;
 * - no place has a majority, and only one place was named at all (one
 *   MOVE beside STAYs): an OFFER of it, or, with the pane collapsed, it
 *   is remembered for when it opens;
 * - otherwise (two places, one vote each): STAY (SPLIT_VOTE).
 */
export function voteNavigation(
  outcomes: readonly QNavigationOutcome[],
): QNavigationOutcome {
  const [first] = outcomes;
  if (first === undefined) return STAY("SPLIT_VOTE");
  if (outcomes.length === 1) return first;
  const groups: QNavigationOutcome[][] = [];
  const placeless: QNavigationOutcome[] = [];
  for (const outcome of outcomes) {
    const at = votedPlace(outcome);
    if (at === null) {
      placeless.push(outcome);
      continue;
    }
    const group = groups.find((g) => {
      const there = g[0] === undefined ? null : votedPlace(g[0]);
      return there !== null && samePlaceAnySection(there, at);
    });
    if (group === undefined) groups.push([outcome]);
    else group.push(outcome);
  }
  const majority = (n: number) => n * 2 > outcomes.length;
  const [largest] = [...groups].sort((a, b) => b.length - a.length);
  if (largest !== undefined && largest.length === outcomes.length)
    return sectionVoted(largest, leastAuthority(largest));
  if (largest !== undefined && majority(largest.length)) {
    const careful = sectionVoted(largest, leastAuthority(largest));
    return careful.decision === "MOVE"
      ? careful
      : { ...careful, guard: careful.guard ?? "SPLIT_VOTE" };
  }
  const [only] = groups;
  if (groups.length === 1 && only !== undefined) {
    const careful = sectionVoted(only, leastAuthority(only));
    if (careful.decision === "STAY") return { ...careful, guard: "SPLIT_VOTE" };
    const at = votedPlace(careful);
    return careful.openPane
      ? STAY("SPLIT_VOTE", at)
      : {
          decision: "OFFER",
          target: at,
          openPane: false,
          remembered: null,
          guard: "SPLIT_VOTE",
        };
  }
  if (majority(placeless.length)) return placeless[0] ?? STAY("SPLIT_VOTE");
  return STAY("SPLIT_VOTE");
}

/** One sample of the decision: what the model proposed, and what code made of it. */
export type QNavigationSample = {
  readonly proposal: NavigationDecisionResult | null;
  readonly resolution: QNavigationResolution | null;
  readonly outcome: QNavigationOutcome;
};

/**
 * A sample as a log line may carry it (batch-8 replay: production must say
 * what the decision did): decisions, place shapes and guards only -- never
 * a record's name, the person's words, or an id.
 */
export function sampleForLog(one: QNavigationSample): Record<string, unknown> {
  const place = one.proposal?.place ?? null;
  return {
    proposed: one.proposal?.decision ?? "FAILED",
    route: place?.route ?? null,
    tab: place?.tab ?? null,
    sectionId: place?.sectionId ?? null,
    askedForPage: one.proposal?.askedForPage ?? null,
    record: place?.record != null,
    alternative: one.proposal?.alternative != null,
    resolved: one.resolution?.kind ?? null,
    outcome: one.outcome.decision,
    guard: one.outcome.guard,
  };
}

/**
 * The three steps together -- decide, resolve, apply the policy -- for each
 * of NAVIGATION_VOTES samples at once, then the vote.
 */
export async function decideNavigation(
  dependencies: {
    readonly decider: QNavigationDecider;
    readonly canOpen: (page: string) => boolean;
    readonly config: QNavigationPolicyConfig;
    /** W2.3's resolve_page_target in the answer path; else `input.records`. */
    readonly resolver?: QNavigationRecordResolver | undefined;
    /** Samples to vote over (decision 78); 1 is the plain pipeline. */
    readonly votes?: number | undefined;
    /** Observability: each sample's proposal, resolution and outcome. */
    readonly onSamples?:
      ((samples: readonly QNavigationSample[]) => void) | undefined;
  },
  input: QNavigationInput,
  attribution: Parameters<QNavigationDecider["decide"]>[1],
): Promise<QNavigationOutcome> {
  const resolver = dependencies.resolver ?? listedRecordResolver(input.records);
  const sample = async (): Promise<QNavigationSample> => {
    const proposal = await dependencies.decider.decide(input, attribution);
    const [resolution, alternative] =
      proposal === null || proposal.decision === "STAY"
        ? [null, null]
        : await Promise.all([
            resolveNavigationPlaceWith(proposal, input, resolver),
            resolveAlternative(proposal, input, resolver),
          ]);
    const outcome = applyNavigationPolicy({
      proposal,
      resolution,
      pane: input.pane,
      canOpen: dependencies.canOpen,
      config: dependencies.config,
      records: input.records,
      alternative,
    });
    return { proposal, resolution, outcome };
  };
  const votes = Math.max(1, dependencies.votes ?? NAVIGATION_VOTES);
  // In parallel: the vote costs no serial latency over one decision.
  const samples = await Promise.all(Array.from({ length: votes }, sample));
  dependencies.onSamples?.(samples);
  return voteNavigation(samples.map((one) => one.outcome));
}

// --- 4. The answer path: one move per turn, beside the answer ------------

/**
 * A navigation reading as code takes it: v84's intent, with v85's
 * destination and v87's record tab when the reading names them (absent:
 * none named).
 */
export type QReadNavigation = TurnNavigationIntentV84 &
  Partial<Pick<TurnNavigationIntentV87, "destination" | "tab">>;

/**
 * The one record the turn is about, as the answer path resolved it from
 * the reading and the conversation (never from the pane alone): a name
 * and/or the id the conversation holds for it. `named`: the reading named
 * it (namedOther), so a CONTEXT turn with no tab turns to its page.
 */
export type QPageMoveSubject = {
  readonly kind: "COMPANY" | "INVESTOR";
  readonly name: string | null;
  readonly id: string | null;
  readonly named: boolean;
};

/** What the turn reader read about navigation, as the port is told it (C10). */
export type QPageMoveReading = {
  readonly navigation: QReadNavigation | null;
  /** Fast GO: code moves to the reader's destination itself, at once. */
  readonly codeMoves?: boolean | undefined;
  /** A8: they asked to watch the company's pitch (companyMedia.pitch). */
  readonly pitch?: boolean | undefined;
  /**
   * The turn's record (readingTabPlace): one record; null when the
   * conversation leaves it open (two, or none resolvable) -- then nothing
   * is placed on the pane's record in its stead; undefined: not told.
   */
  readonly subject?: QPageMoveSubject | null | undefined;
};

/** The turn as the decision reads it (the answer path's own reads). */
export type QPageMoveTurn = {
  readonly utterance: string;
  readonly recentTurns: QNavigationInput["recentTurns"];
  readonly pageText: string | null;
  /**
   * C10: the answer path will say what the turn reader read about
   * navigation (`heard`), or that the turn was answered unread (settle,
   * awaitPublished or late). The decision then waits for it, bounded by
   * its own deadline. Absent: no reading follows; the decision stands.
   */
  readonly readingFollows?: boolean | undefined;
  /**
   * Batch-12 latency: stores the decision's move as its own Q message the
   * moment the decision lands, while the answer may still be writing, so
   * the page pane moves within the decision's own time (the browser
   * follows a stored message at once). Absent: the move joins the answer
   * (settle) or follows it (late).
   */
  readonly publish?:
    | ((move: {
        readonly content: string;
        readonly blocks: readonly QResultBlock[];
      }) => Promise<{ readonly messageId: string } | undefined>)
    | undefined;
};

/**
 * W4 in the answer path. `start` runs the decision beside the answer's own
 * reads when the screen carries the Q Workspace (`screen.workspace`
 * present); `settle` is awaited just before the answer's message is
 * stored -- never inside its transaction -- and adds the page pane's move
 * to its blocks. Absent workspace: nothing starts and nothing changes
 * (N1 and the legacy intents stand).
 */
export type QPageMovePort = {
  readonly start: (request: QAnswerRequest, turn: QPageMoveTurn) => void;
  /**
   * C10 (TURN_READER v84): the turn reader's navigation intent for this
   * run, as soon as its reading has started, and whether code itself moves
   * to the reader's GO destination at once. The decision waits for it
   * (bounded by its own deadline) and is gated by it (`gateByReading`). A
   * run that never reads (a code lane) is heard as null when its answer is
   * stored: the decision stands, as before.
   */
  readonly heard?:
    | ((
        request: QAnswerRequest,
        reading: Promise<QPageMoveReading | null>,
      ) => void)
    | undefined;
  readonly settle: (
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
    options?: {
      /**
       * The answer's own moves are code's exact commands (a page by its
       * name, "yes, open it" to Q's offer): they stand over the decision.
       * Absent: the answer model's own acts, which the decision outranks.
       */
      readonly keepAnswerMoves?: boolean | undefined;
    },
  ) => Promise<readonly QResultBlock[] | undefined>;
  /**
   * Batch-8 replay: a decision still running when the answer was stored
   * (and the answer moved nothing itself) follows it: its move and a short
   * line, for the answer path to store before the run completes. Null when
   * there is none.
   */
  /**
   * The message the decision's move was published as, waiting for the
   * decision until its deadline; null when it moves nothing. For a code
   * answer that would otherwise say a record could not be opened while the
   * pane moved there (batch 7 #3): the move's message is the answer.
   */
  readonly awaitPublished?:
    ((request: QAnswerRequest) => Promise<string | null>) | undefined;
  readonly late?:
    | ((request: QAnswerRequest) => Promise<{
        readonly content: string;
        readonly blocks: readonly QResultBlock[];
      } | null>)
    | undefined;
};

const NO_RECORDS: QNavigationRecords = {
  companies: [],
  investors: [],
  things: [],
  deleted: [],
};

/** A move the answer already makes: code's own move wins (one per turn). */
/** UI acts that change where the page pane is (a tab, an item, history). */
const PLACE_ACTS: ReadonlySet<string> = new Set([
  "SELECT_TAB",
  "SELECT_ITEM",
  "BACK",
  "FORWARD",
]);

/** A block that moves the page pane to another place (not a page action). */
function changesPlace(block: QResultBlock): boolean {
  return (
    movesAlready([block]) ||
    (block.kind === "UI_INTENT" &&
      block.intent.kind === "UI_ACT" &&
      PLACE_ACTS.has(block.intent.act))
  );
}

/** A place an intent names: everything but its section and scroll position. */
const intentPlace = (intent: object): string => {
  const {
    sectionId: _section,
    position: _position,
    ...rest
  } = intent as Record<string, unknown>;
  return JSON.stringify(
    Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)),
  );
};

/**
 * Batch 14 (owner live 8 Nov: "I've opened Clinicrest." then "Want me to
 * open Clinicrest's profile…?"): an offer of a place a published move has
 * already taken the pane to.
 */
function offersPlaceMoved(
  block: QResultBlock,
  moved: readonly QResultBlock[],
): boolean {
  if (block.kind !== "NAVIGATION_OFFER") return false;
  const offered = intentPlace(block.intent);
  return moved.some(
    (one) => one.kind === "UI_INTENT" && intentPlace(one.intent) === offered,
  );
}

/** Record pages that open a document in its viewer, not a page of the pane. */
const VIEWER_PAGES: ReadonlySet<string> = new Set([
  "DOCUMENT",
  "DATA_ROOM_DOCUMENT",
]);

/**
 * A block that itself takes the page pane to another place: a page, a
 * settings part, a record's page, a tab or history act. Not an offer (the
 * person has not moved), and not a document opened in its viewer.
 */
function movesPaneItself(block: QResultBlock): boolean {
  if (block.kind !== "UI_INTENT") return false;
  const intent = block.intent;
  if (intent.kind === "OPEN_RECORD_PAGE") return !VIEWER_PAGES.has(intent.page);
  return changesPlace(block);
}

const blockKind = (block: QResultBlock): string =>
  block.kind === "UI_INTENT"
    ? block.intent.kind === "UI_ACT"
      ? `UI_ACT:${block.intent.act}`
      : `UI_INTENT:${block.intent.kind}`
    : block.kind;

function movesAlready(blocks: readonly QResultBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === "NAVIGATION_OFFER" ||
      (block.kind === "UI_INTENT" &&
        (block.intent.kind === "NAVIGATE" ||
          block.intent.kind === "OPEN_RECORD_PAGE" ||
          block.intent.kind === "OPEN_SETTINGS")),
  );
}

// --- Fast contextual placement: only complete screens -------------------

/**
 * Own destinations that stand for a record page (their company's or
 * firm's profile, pitch, data room, deck): placing them early would land
 * on the record without the tab the decision names.
 */
const RECORD_STANDINS: ReadonlySet<string> = new Set([
  "PROFILE",
  "PITCH",
  "OWN_DATA_ROOM",
  "OWN_DECK",
]);

/** A screen of their own that is already the exact place (no tab to add). */
export function completeScreen(destination: string): boolean {
  return !RECORD_STANDINS.has(destination);
}

/** Whether the words name one of the records they may open (by its name). */
export function namesARecord(
  utterance: string,
  records: QNavigationRecords,
): boolean {
  const words = utterance.toLocaleLowerCase();
  const names = [
    ...records.companies.map((one) => one.name),
    ...records.investors.map((one) => one.name),
    ...records.things.map((one) => one.title),
  ];
  return names.some((name) => {
    const named = name.trim().toLocaleLowerCase();
    return named.length >= 3 && words.includes(named);
  });
}

const REFINING_FIELDS = [
  "tab",
  "sectionId",
  "documentId",
  "threadId",
  "itemId",
] as const satisfies readonly (keyof QNavigateTarget)[];

/**
 * The decision's verdict is the early move's own page and record, more
 * exactly: every field the early move set is the same, and it adds at
 * least one of tab, section, document, thread or item. Never another
 * page or record (never a refinement across records).
 */
export function refinesPlace(
  early: QNavigationOutcome,
  later: QNavigationOutcome,
): boolean {
  if (early.decision !== "MOVE" || later.decision !== "MOVE") return false;
  const a = early.target;
  const b = later.target;
  if (a === null || b === null) return false;
  if (
    a.page !== b.page ||
    (a.recordId ?? null) !== (b.recordId ?? null) ||
    (a.companyId ?? null) !== (b.companyId ?? null)
  )
    return false;
  let adds = false;
  for (const field of REFINING_FIELDS) {
    const was = a[field] ?? null;
    const now = b[field] ?? null;
    if (was !== null && was !== now) return false;
    if (was === null && now !== null) adds = true;
  }
  return adds;
}

// --- Pinned workspace (owner addendum, 13 Nov 2026) ----------------------

/** Whether this turn's workspace is pinned (screen.workspace.pinned). */
export function pinnedOf(request: QAnswerRequest): boolean {
  return request.plan.screen?.workspace?.pinned === true;
}

/** What Q says when a pinned workspace kept the page where it is. */
export function pinnedLine(title: string): string {
  return `Your workspace is pinned, so the page stays as it is. ${title} is ready when you want it.`;
}

/**
 * Pinned: an answer's blocks with every block that would move the page
 * pane (movesPaneItself: a page, a record's page, Settings, a tab or
 * history act) held back. A page, record page or Settings move becomes an
 * offer of the same place -- `unpin` when the request was explicit (code's
 * exact command, a GO reading), so one tap unpins and opens it; never an
 * offer of a page they may not open. A tab or history act has no offer
 * shape and is held. A document opened in its viewer, layout changes,
 * conversation, analysis and every other block pass unchanged.
 */
export function pinnedBlocks(
  blocks: readonly QResultBlock[],
  options: {
    readonly explicit: boolean;
    readonly canOpen: (page: string) => boolean;
    readonly title: (target: QNavigateTarget) => string;
    /** Offers this run already made elsewhere (its published move). */
    readonly alreadyOffered?: readonly QResultBlock[] | undefined;
    readonly logger?: Logger | undefined;
    readonly runId?: string | undefined;
  },
): QResultBlock[] {
  const offered = new Set(
    [...blocks, ...(options.alreadyOffered ?? [])].flatMap((block) =>
      block.kind === "NAVIGATION_OFFER" ? [intentPlace(block.intent)] : [],
    ),
  );
  const kept: QResultBlock[] = [];
  const held: string[] = [];
  for (const block of blocks) {
    if (!movesPaneItself(block) || block.kind !== "UI_INTENT") {
      kept.push(block);
      continue;
    }
    held.push(blockKind(block));
    const offer = pinnedOffer(block.intent, options);
    if (offer === null) continue;
    const place = intentPlace(offer.intent);
    if (offered.has(place)) continue;
    offered.add(place);
    kept.push(offer);
  }
  if (held.length > 0)
    options.logger?.info(
      { qRunId: options.runId, held, explicit: options.explicit },
      "q page move: the workspace is pinned; the answer's move is offered",
    );
  return kept;
}

function pinnedOffer(
  intent: Extract<QResultBlock, { kind: "UI_INTENT" }>["intent"],
  options: {
    readonly explicit: boolean;
    readonly canOpen: (page: string) => boolean;
    readonly title: (target: QNavigateTarget) => string;
  },
): Extract<QResultBlock, { kind: "NAVIGATION_OFFER" }> | null {
  const unpin = options.explicit ? { unpin: true as const } : {};
  if (intent.kind === "OPEN_SETTINGS") {
    return {
      kind: "NAVIGATION_OFFER",
      intent,
      place: "Settings",
      openLabel: "Open Settings",
      ...unpin,
    };
  }
  if (intent.kind !== "NAVIGATE" && intent.kind !== "OPEN_RECORD_PAGE")
    return null;
  const target = intentToNavigateTarget(intent);
  if (!options.canOpen(target.page)) return null;
  const title = options.title(target);
  return {
    kind: "NAVIGATION_OFFER",
    intent,
    place: title,
    openLabel: `Open ${title}`,
    ...unpin,
  };
}

export function sideOfRequest(request: QAnswerRequest): QNavigationSide {
  return askerSideOf(request);
}

/**
 * Whether this person may open the page: the site map's audience for the
 * side and, for a named destination, the run's own capability manifest
 * (the server's list of what this run may open) when it carries one.
 */
export function canOpenFor(
  request: QAnswerRequest,
  map: QSiteMap = Q_SITE_MAP,
): (page: string) => boolean {
  const side = sideOfRequest(request);
  const navigable = request.capabilities?.navigate;
  return (page) => {
    const landing = qSiteMapLandingFor(map, page);
    if (landing === null || landing.page.redirectsTo !== undefined)
      return false;
    // The tab's own audience, else the page's (W2).
    const audience = audienceOf(landing.page, landing.tab ?? undefined);
    if (audience !== "ANY" && audience !== side) return false;
    const destination = QNavigateDestinationSchema.safeParse(page);
    return (
      !destination.success ||
      navigable === undefined ||
      navigable.includes(destination.data)
    );
  };
}

export function createQPageMoves(dependencies: {
  readonly decider: QNavigationDecider;
  readonly config: QNavigationPolicyConfig;
  /** The names this person may open, for the prompt (their own reads). */
  readonly records?:
    ((request: QAnswerRequest) => Promise<QNavigationRecords>) | undefined;
  /** W2.3's resolution as this person; absent: the listed records. */
  readonly resolver?:
    ((request: QAnswerRequest) => QNavigationRecordResolver) | undefined;
  readonly map?: QSiteMap | undefined;
  readonly logger?: Logger | undefined;
  /**
   * The run's situation (situationHeader, W3's FOCUS), read as the person
   * beside their records; absent or failed: the decision is told nothing.
   */
  readonly situation?:
    ((request: QAnswerRequest) => Promise<string | null>) | undefined;
  /**
   * Tests: a fixed wait after the answer. Absent (production): until the
   * decision's deadline from the turn's start (NAVIGATION_DECISION_DEADLINE_MS).
   */
  readonly settleWithinMs?: number | undefined;
}): QPageMovePort {
  const map = dependencies.map ?? Q_SITE_MAP;
  const pending = new Map<string, Promise<QNavigationOutcome | null>>();
  const startedAt = new Map<string, number>();
  /**
   * How long a stored answer waits for the decision. Batch-8 replay: a fixed
   * 2.5 s after the answer dropped every move for a fast (code) answer,
   * since the decision takes 2-4.5 s in production. It now waits until the
   * decision's own deadline, counted from the turn's start: a long answer
   * never waits, a fast one waits only as long as the decision needs.
   */
  // Batch-12 latency: runs whose move is published the moment it lands
  // (the stored message's id, or null when nothing was published).
  const publications = new Map<string, Promise<string | null>>();
  // The blocks each run's published move carried (batch 14: an offer of
  // the same place in the answer is stale once the pane is there).
  const published = new Map<string, readonly QResultBlock[]>();
  const consumed = new Set<string>();
  // C10: each run's navigation reading (v83). `hear` resolves it once:
  // with the reading, or null when the run's answer is stored unread.
  const readings = new Map<
    string,
    {
      readonly hear: (reading: Promise<QPageMoveReading | null> | null) => void;
      readonly heard: Promise<QPageMoveReading | null>;
    }
  >();
  // The reading once it has landed, for settle's synchronous check.
  const heardNow = new Map<string, QPageMoveReading | null>();
  // Fast GO: the decision's move, held while code moves itself; used only
  // if the stored answer turns out to move nothing (never neither).
  const heldForCode = new Map<string, QNavigationOutcome>();
  const hearNothing = (runId: string): void => {
    readings.get(runId)?.hear(null);
  };
  const lineFor = (outcome: QNavigationOutcome, title: string): string =>
    outcome.guard === "PINNED" || outcome.unpin === true
      ? pinnedLine(title)
      : outcome.decision === "OFFER"
        ? `${title} is ready to open.`
        : `I've opened ${title}.`;
  const lateRuns = new Map<
    string,
    {
      readonly decided: Promise<QNavigationOutcome | null>;
      readonly began: number;
    }
  >();
  /** The place's own name, as the site map titles it (its tab, else its page). */
  const placeTitle = (target: QNavigateTarget): string => {
    const landing = qSiteMapLandingFor(map, target.page);
    const tabId = target.tab ?? landing?.tab?.id;
    const tab = landing?.page.tabs.find((t) => t.id === tabId);
    return (tab?.title ?? landing?.page.title ?? "the page").slice(
      0,
      Q_NAVIGATION_OFFER_LABEL_MAX - 5,
    );
  };
  /** The page pane's blocks for an outcome with a place; null for none. */
  const blocksOf = (outcome: QNavigationOutcome): QResultBlock[] | null => {
    if (outcome.target === null || outcome.decision === "STAY") return null;
    let intent: ReturnType<typeof navigateTargetToIntent>;
    try {
      intent = navigateTargetToIntent(outcome.target);
    } catch {
      return null;
    }
    if (outcome.decision === "OFFER") {
      const title = (
        qSiteMapLandingFor(map, outcome.target.page)?.page.title ?? "the page"
      ).slice(0, Q_NAVIGATION_OFFER_LABEL_MAX - 5);
      return [
        {
          kind: "NAVIGATION_OFFER",
          intent,
          place: title,
          openLabel: `Open ${title}`,
          ...(outcome.unpin === true ? { unpin: true as const } : {}),
        },
      ];
    }
    return [
      ...(outcome.openPane
        ? [
            {
              kind: "UI_INTENT" as const,
              intent: {
                kind: "LAYOUT_SET" as const,
                pagePane: "open" as const,
              },
            },
          ]
        : []),
      { kind: "UI_INTENT", intent },
    ];
  };
  const waitFor = (runId: string): number => {
    if (dependencies.settleWithinMs !== undefined)
      return dependencies.settleWithinMs;
    const since = Date.now() - (startedAt.get(runId) ?? Date.now());
    // Never more than a short grace: a decision later than that follows
    // the answer (late), so a fast answer stays fast.
    return Math.min(
      NAVIGATION_SETTLE_GRACE_MS,
      Math.max(0, NAVIGATION_DECISION_DEADLINE_MS - since),
    );
  };
  return {
    start: (request, turn) => {
      const workspace = request.plan.screen?.workspace;
      if (workspace === undefined || pending.has(request.runId)) return;
      const side = sideOfRequest(request);
      let sampled: readonly QNavigationSample[] = [];
      const began = Date.now();
      let hear: (
        reading: Promise<QPageMoveReading | null> | null,
      ) => void = () => undefined;
      const heard =
        turn.readingFollows === true
          ? new Promise<QPageMoveReading | null>((resolve) => {
              hear = resolve;
            }).catch(() => null)
          : Promise.resolve(null);
      void heard.then((navigation) => {
        heardNow.set(request.runId, navigation);
      });
      readings.set(request.runId, { hear, heard });
      // Read once, for both the reading's early placement and the decision.
      const read = Promise.all([
        dependencies.records?.(request).catch(() => null),
        dependencies.situation?.(request).catch(() => null),
      ]);
      const deciding = (async () => {
        const [listed, situation] = await read;
        const records = listed ?? NO_RECORDS;
        const input: QNavigationInput = {
          utterance: turn.utterance,
          recentTurns: turn.recentTurns,
          side,
          pane: navigationPaneFromWorkspace(workspace, map),
          pageText: turn.pageText,
          records,
          siteMap: navigationSiteMap(side, map),
          ...(situation == null ? {} : { situation }),
        };
        return decideNavigation(
          {
            decider: dependencies.decider,
            canOpen: canOpenFor(request, map),
            config: dependencies.config,
            resolver:
              dependencies.resolver?.(request) ?? listedRecordResolver(records),
            onSamples: (samples) => {
              sampled = samples;
            },
          },
          input,
          {
            tenantId: request.tenantId,
            userId: request.actorUserId,
            correlationId: request.correlationId,
          },
        ).then(async (proposed) => {
          // C10: whether to move at all is the reading's (v84), never the
          // words'; waited for no longer than the decision's own deadline.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const reading = await Promise.race([
            heard,
            new Promise<null>((resolve) => {
              timer = setTimeout(
                () => resolve(null),
                Math.max(
                  0,
                  began + NAVIGATION_DECISION_DEADLINE_MS - Date.now(),
                ),
              );
            }),
          ]).finally(() => clearTimeout(timer));
          const navigation = reading?.navigation ?? null;
          // v85: CONTEXT naming one of their own screens, where the
          // decision proposed nothing, is placed by code (same policy).
          const placedByReading = readingPlacesContext({
            proposed,
            navigation,
            pane: input.pane,
            canOpen: canOpenFor(request, map),
            config: dependencies.config,
            records,
          });
          const paneHere = {
            ...input.pane,
            at:
              input.pane.at === null ? null : ownPlace(input.pane.at, records),
          };
          // v87: the record's tab the reading names, on the decision's
          // place or the turn's record (readingTabPlace): the one record
          // the conversation is about, resolved as the person.
          const subject = await subjectPlace(
            reading?.subject,
            dependencies.resolver?.(request) ?? listedRecordResolver(records),
            records,
            map,
          );
          const onTab = readingTabPlace({
            proposed,
            navigation,
            pane: paneHere,
            canOpen: canOpenFor(request, map),
            config: dependencies.config,
            records,
            subject,
          });
          // A pitch to watch: the deck the decision chose is its elevator.
          const outcome = gateByReading(
            pitchOnElevator(
              onTab ?? placedByReading ?? proposed,
              reading?.pitch === true,
              paneHere,
            ),
            navigation,
            { pane: paneHere, codeMoves: reading?.codeMoves },
          );
          // Fast GO: held, in case the answer stored moves nothing after all.
          if (outcome.guard === "ANSWER_MOVES" && proposed.target !== null)
            heldForCode.set(request.runId, proposed);
          if (outcome !== proposed)
            dependencies.logger?.info(
              {
                qRunId: request.runId,
                proposed: proposed.decision,
                decision: outcome.decision,
                navigation: navigation?.mode ?? null,
                negated: navigation?.negated ?? null,
                placedByReading: placedByReading?.decision ?? null,
                onTab: onTab?.decision ?? null,
                subject:
                  subject === undefined
                    ? null
                    : subject === null
                      ? "OPEN"
                      : "ONE",
                guard: outcome.guard,
              },
              "q page move gated by the turn's navigation reading",
            );
          // Batch-8 replay: what the decision did, every run (no names,
          // no words, no ids).
          const target =
            outcome.target === null ? null : targetToSitePlace(outcome.target);
          dependencies.logger?.info(
            {
              qRunId: request.runId,
              decision: outcome.decision,
              page: outcome.target?.page ?? null,
              tab: outcome.target?.tab ?? null,
              route: target?.route ?? null,
              openPane: outcome.openPane,
              remembered: outcome.remembered?.page ?? null,
              guard: outcome.guard,
              // C10: the reading the verdict was gated by (live checks);
              // the hold that applied is the guard above (NOT_ASKED,
              // OFFER_ONLY, SAME_SUBJECT, BACK_AND_FORTH, ANSWER_MOVES).
              proposed: proposed.decision,
              proposedGuard: proposed.guard,
              navigation: navigation?.mode ?? null,
              negated: navigation?.negated ?? null,
              navigationDestination: navigation?.destination ?? null,
              navigationTab: navigation?.tab ?? null,
              codeMoves: reading?.codeMoves ?? null,
              placedByReading: placedByReading?.decision ?? null,
              samples: sampled.map(sampleForLog),
              ms: Date.now() - began,
            },
            "q page move decided",
          );
          return outcome;
        });
      })().catch((error: unknown) => {
        dependencies.logger?.warn(
          { err: error instanceof Error ? error.name : typeof error },
          "q page move not decided; the page pane stays",
        );
        return null;
      });
      // Contextual moves "very fast" (owner, 13 Nov 2026; v85 live 7/7 but
      // CONTEXT took 4-7 s): a CONTEXT reading that names one of their own
      // screens is placed the moment the reading lands, through the same
      // policy and holds (access, already there, unsaved work, busy,
      // collapsed, same subject, back and forth, pinned) -- all screen
      // state, none of them the decider's verdict. Whichever lands first
      // places the page; the other never moves it a second time.
      const early = (async (): Promise<QNavigationOutcome | null> => {
        // Without publish the move joins the answer (settle waits for the
        // decision anyway): nothing to gain, so the decision alone places it.
        if (turn.publish === undefined) return null;
        const reading = await heard;
        const navigation = reading?.navigation ?? null;
        if (!readsAsContext(navigation) || navigation?.destination == null)
          return null;
        // Deep-link regression (live, b1bfae8e7: "Can I see Clinicrest's
        // data room?" lost ?tab=dataroom): only a complete screen of their
        // own is placed early. A screen that stands for a record (their
        // profile, pitch, data room, deck), or words that name one of their
        // records, wait for the decision: it is the one that knows the tab.
        if (!completeScreen(navigation.destination)) return null;
        const [listed] = await read;
        const records = listed ?? NO_RECORDS;
        if (namesARecord(turn.utterance, records)) return null;
        const paneNow = navigationPaneFromWorkspace(workspace, map);
        const placed = readingPlacesContext({
          proposed: STAY(null),
          navigation,
          pane: paneNow,
          canOpen: canOpenFor(request, map),
          config: dependencies.config,
          records,
        });
        if (placed === null) return null;
        const outcome = gateByReading(placed, navigation, {
          pane: {
            ...paneNow,
            at: paneNow.at === null ? null : ownPlace(paneNow.at, records),
          },
          codeMoves: reading?.codeMoves,
        });
        if (outcome.decision === "STAY") return null;
        dependencies.logger?.info(
          {
            qRunId: request.runId,
            decision: outcome.decision,
            page: outcome.target?.page ?? null,
            guard: outcome.guard,
            navigation: "CONTEXT",
            placedByReading: "EARLY",
            ms: Date.now() - began,
          },
          "q page move placed by the reading as it landed",
        );
        return outcome;
      })().catch(() => null);
      let placedEarly: QNavigationOutcome | null = null;
      const decided = new Promise<QNavigationOutcome | null>((resolve) => {
        let placed = false;
        void early.then((outcome) => {
          if (outcome === null || placed) return;
          placed = true;
          placedEarly = outcome;
          resolve(outcome);
        });
        void deciding.then(async (outcome) => {
          // The reading's own placement, if it has already landed, goes
          // first; never waited for (a reading that never comes must not
          // hold the decision's own verdict).
          const notYet = Symbol("not yet");
          const first = await Promise.race([early, Promise.resolve(notYet)]);
          if (placed) {
            // The same page or record, more exactly (a tab, section,
            // document, thread or item the early move lacks): refined in
            // place -- the same move, never a second one away.
            if (
              placedEarly !== null &&
              outcome !== null &&
              refinesPlace(placedEarly, outcome)
            ) {
              refine(outcome);
              return;
            }
            if (outcome !== null && outcome.decision !== "STAY")
              dependencies.logger?.info(
                {
                  qRunId: request.runId,
                  decision: outcome.decision,
                  page: outcome.target?.page ?? null,
                },
                "q page move: the decision landed after the reading placed the page; no second move",
              );
            return;
          }
          if (first !== null && first !== notYet) return;
          placed = true;
          resolve(outcome);
        });
      });
      pending.set(request.runId, decided);
      startedAt.set(request.runId, Date.now());
      const publish = turn.publish;
      // After the early move's own message: the decision's exact place on
      // the same page or record, published as the same move refined.
      function refine(outcome: QNavigationOutcome): void {
        const runId = request.runId;
        const moved = blocksOf(outcome);
        if (publish === undefined || moved === null || outcome.target === null)
          return;
        const target = outcome.target;
        const after = publications.get(runId) ?? Promise.resolve(null);
        publications.set(
          runId,
          after.then(async (first) => {
            published.set(runId, [...(published.get(runId) ?? []), ...moved]);
            dependencies.logger?.info(
              {
                qRunId: runId,
                page: target.page,
                tab: target.tab ?? null,
                ms: Date.now() - began,
              },
              "q page move refined to the decision's exact place",
            );
            const stored = await publish({
              content: lineFor(outcome, placeTitle(target)),
              blocks: moved,
            }).catch(() => undefined);
            return first ?? stored?.messageId ?? null;
          }),
        );
      }
      if (publish !== undefined) {
        const runId = request.runId;
        publications.set(
          runId,
          decided
            .then(async (outcome): Promise<string | null> => {
              if (outcome === null || consumed.has(runId)) return null;
              const moved = blocksOf(outcome);
              if (moved === null || outcome.target === null) return null;
              consumed.add(runId);
              published.set(runId, moved);
              const stored = await publish({
                content: lineFor(outcome, placeTitle(outcome.target)),
                blocks: moved,
              });
              dependencies.logger?.info(
                {
                  qRunId: runId,
                  decision: outcome.decision,
                  page: outcome.target.page,
                  ms: Date.now() - began,
                },
                "q page move published as it landed",
              );
              return stored?.messageId ?? null;
            })
            .catch((error: unknown) => {
              dependencies.logger?.warn(
                {
                  qRunId: runId,
                  err: error instanceof Error ? error.name : typeof error,
                },
                "q page move not published",
              );
              return null;
            }),
        );
      }
      // A run that never settles (a failed answer) does not keep it.
      setTimeout(() => {
        pending.delete(request.runId);
        startedAt.delete(request.runId);
        lateRuns.delete(request.runId);
        publications.delete(request.runId);
        published.delete(request.runId);
        consumed.delete(request.runId);
        readings.delete(request.runId);
        heardNow.delete(request.runId);
        heldForCode.delete(request.runId);
      }, 120_000).unref?.();
    },
    heard: (request, reading) => {
      readings.get(request.runId)?.hear(reading.catch(() => null));
    },
    settle: async (request, blocks, options) => {
      const settled = await settleUnpinned(request, blocks, options);
      if (settled === undefined || !pinnedOf(request)) return settled;
      // Pinned workspace: whatever still moves the page here (code's exact
      // commands, the answer model's own moves) is offered instead. Code's
      // commands and a GO reading are explicit: their offer unpins.
      const explicit =
        options?.keepAnswerMoves === true ||
        readsAsGo(heardNow.get(request.runId)?.navigation);
      return pinnedBlocks(settled, {
        explicit,
        // The decision's own offer, published as its own message: once.
        alreadyOffered: published.get(request.runId) ?? [],
        canOpen: canOpenFor(request, map),
        title: placeTitle,
        logger: dependencies.logger,
        runId: request.runId,
      });
    },
    awaitPublished: async (request) => {
      hearNothing(request.runId);
      return awaitPublishedMove(request);
    },
    late: async (request) => {
      hearNothing(request.runId);
      return lateMove(request);
    },
  };
  async function settleUnpinned(
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
    options?: { readonly keepAnswerMoves?: boolean | undefined },
  ): Promise<readonly QResultBlock[] | undefined> {
    {
      // An answer stored with no reading heard is a code lane: unread.
      hearNothing(request.runId);
      const settled = await settleMoves(request, blocks, options);
      // Fast GO held the decision's move for code's own; if the answer
      // stored moves nothing after all, the decision's move joins it, so a
      // GO is never left with neither.
      const held = heldForCode.get(request.runId);
      heldForCode.delete(request.runId);
      if (held !== undefined && !(settled ?? []).some(movesPaneItself)) {
        const moved = blocksOf(held);
        if (moved !== null) {
          dependencies.logger?.info(
            { qRunId: request.runId, decision: held.decision },
            "q page move: code did not move after a GO; the decision's move joins the answer",
          );
          return [...(settled ?? []), ...moved];
        }
      }
      // C10: the answer model's own place moves stand only where the
      // reading asked for navigation; code's exact commands always stand.
      if (
        settled === undefined ||
        options?.keepAnswerMoves === true ||
        !readsAsNoNavigation(heardNow.get(request.runId)?.navigation)
      ) {
        return settled;
      }
      const kept = settled.filter((block) => !movesPaneItself(block));
      if (kept.length !== settled.length)
        dependencies.logger?.info(
          {
            qRunId: request.runId,
            answerMoves: settled.filter(movesPaneItself).map(blockKind),
          },
          "q page move: the reading asked for no move; the answer's own move dropped",
        );
      return kept;
    }
  }
  async function settleMoves(
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
    options?: { readonly keepAnswerMoves?: boolean | undefined },
  ): Promise<readonly QResultBlock[] | undefined> {
    const decided = pending.get(request.runId);
    if (decided === undefined) return blocks;
    if (publications.has(request.runId)) {
      // Batch-12 latency: the decision is its own message; the answer
      // never waits for it and never carries it.
      pending.delete(request.runId);
      const current = blocks ?? [];
      const movedTo = published.get(request.runId);
      if (movedTo !== undefined) {
        // One authority: the answer model's own place moves would be a
        // second, contrary move after the pane already moved.
        if (options?.keepAnswerMoves === true) {
          // Code's exact commands stand; an offer of the place the pane
          // is already showing never does (batch 14).
          const fresh = current.filter(
            (block) => !offersPlaceMoved(block, movedTo),
          );
          if (fresh.length === current.length) return blocks;
          dependencies.logger?.info(
            { qRunId: request.runId },
            "q page move dropped the answer's offer of the same place",
          );
          return fresh;
        }
        const stripped = current.filter((block) => !changesPlace(block));
        if (stripped.length !== current.length)
          dependencies.logger?.info(
            {
              qRunId: request.runId,
              answerMoves: current.filter(changesPlace).map(blockKind),
            },
            "q page move replaced the answer's own move",
          );
        return stripped;
      }
      if (options?.keepAnswerMoves === true && current.some(movesPaneItself)) {
        // Code's exact command moved the pane: the decision adds nothing.
        consumed.add(request.runId);
        dependencies.logger?.info(
          {
            qRunId: request.runId,
            answerMoves: current.filter(movesPaneItself).map(blockKind),
          },
          "q page move skipped: the answer already moves the pane",
        );
      }
      return blocks;
    }
    const began = startedAt.get(request.runId) ?? Date.now();
    const waitMs = waitFor(request.runId);
    pending.delete(request.runId);
    startedAt.delete(request.runId);
    const current = blocks ?? [];
    const answerMoves = current.filter(changesPlace);
    // Code's exact commands stand. Batch-10 replay: an offer, or a
    // document opened in its viewer, is not one -- it never moved the
    // pane, and it used to discard a unanimous decision for the
    // company's own Deck tab.
    const commanded = current.filter(movesPaneItself);
    if (options?.keepAnswerMoves === true && commanded.length > 0) {
      dependencies.logger?.info(
        { qRunId: request.runId, answerMoves: commanded.map(blockKind) },
        "q page move skipped: the answer already moves the pane",
      );
      return blocks;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notYet = Symbol("not yet");
    const settled = await Promise.race([
      decided,
      new Promise<typeof notYet>((resolve) => {
        timer = setTimeout(() => resolve(notYet), waitMs);
      }),
    ]).finally(() => clearTimeout(timer));
    if (settled === notYet) {
      // Batch-11 replay: only an answer that itself moved the pane keeps
      // the late move away; an offer or a document opened in its viewer
      // never moved it, and used to drop a 3/3 decision for a Deck tab.
      const movedItself = current.filter(movesPaneItself);
      if (movedItself.length > 0) {
        dependencies.logger?.info(
          { qRunId: request.runId, answerMoves: movedItself.map(blockKind) },
          "q page move skipped: the answer already moves the pane",
        );
        return blocks;
      }
      // Batch-8 replay: never dropped. The answer goes now; the move
      // follows it (late), before the run completes.
      lateRuns.set(request.runId, { decided, began });
      dependencies.logger?.info(
        { qRunId: request.runId, waitedMs: waitMs },
        "q page move not ready when the answer was stored; it follows the answer",
      );
      return blocks;
    }
    const moved = settled === null ? null : blocksOf(settled);
    if (moved === null) return blocks;
    // One authority in the Q Workspace: the decision's place replaces the
    // answer's own place moves; the page's own actions stay.
    if (answerMoves.length > 0)
      dependencies.logger?.info(
        { qRunId: request.runId, answerMoves: answerMoves.map(blockKind) },
        "q page move replaced the answer's own move",
      );
    return [...current.filter((block) => !changesPlace(block)), ...moved];
  }
  async function awaitPublishedMove(
    request: QAnswerRequest,
  ): Promise<string | null> {
    const publication = publications.get(request.runId);
    if (publication === undefined) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const began = startedAt.get(request.runId) ?? Date.now();
    return Promise.race([
      publication,
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          Math.max(0, began + NAVIGATION_DECISION_DEADLINE_MS - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }
  async function lateMove(request: QAnswerRequest): Promise<{
    readonly content: string;
    readonly blocks: readonly QResultBlock[];
  } | null> {
    const publication = publications.get(request.runId);
    if (publication !== undefined) {
      // The run must not end before the move is stored: wait for it
      // (bounded), then nothing is left to add.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const began = startedAt.get(request.runId) ?? Date.now();
      await Promise.race([
        publication,
        new Promise<void>((resolve) => {
          timer = setTimeout(
            resolve,
            Math.max(0, began + NAVIGATION_LATE_LIMIT_MS - Date.now()),
          );
        }),
      ]).finally(() => clearTimeout(timer));
      publications.delete(request.runId);
      published.delete(request.runId);
      consumed.delete(request.runId);
      startedAt.delete(request.runId);
      return null;
    }
    const waiting = lateRuns.get(request.runId);
    if (waiting === undefined) return null;
    lateRuns.delete(request.runId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tooLate = Symbol("too late");
    const settled = await Promise.race([
      waiting.decided,
      new Promise<typeof tooLate>((resolve) => {
        timer = setTimeout(
          () => resolve(tooLate),
          Math.max(0, waiting.began + NAVIGATION_LATE_LIMIT_MS - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (settled === tooLate || settled === null) return null;
    const moved = blocksOf(settled);
    if (moved === null || settled.target === null) return null;
    const title = placeTitle(settled.target);
    dependencies.logger?.info(
      {
        qRunId: request.runId,
        decision: settled.decision,
        page: settled.target.page,
        ms: Date.now() - waiting.began,
      },
      "q page move applied after the answer",
    );
    return { content: lineFor(settled, title), blocks: moved };
  }
}
