import {
  navigateTargetToIntent,
  Q_NAVIGATION_OFFER_LABEL_MAX,
  audienceOf,
  Q_SITE_MAP,
  QNavigateDestinationSchema,
  QNavigateTargetSchema,
  QRecordTabSchema,
  recordPageHasTab,
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
  renderPrompt,
  type NavigationDecisionResult,
  type NavigationDecisionVariables,
} from "@capital-q/q-core";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ModelGateway } from "../gateway.js";
import { ownInvestorOrganisationIn } from "./result-blocks.js";

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
  | "SPLIT_VOTE";

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
}): QNavigationDecider {
  const registry = createDefaultPromptRegistry();
  return {
    decide: async (input, attribution) => {
      try {
        const rendered = renderPrompt<NavigationDecisionVariables>(registry, {
          task: "NAVIGATION_DECISION",
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
  const wanted = norm(said);
  const exact = list.filter((item) => norm(nameOf(item)) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const partial = list.filter((item) => norm(nameOf(item)).includes(wanted));
  if (partial.length === 1) return partial[0] ?? null;
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
  return byWords.length === 1 ? (byWords[0] ?? null) : null;
}

export type QNavigationResolution =
  | { readonly kind: "TARGET"; readonly target: QNavigateTarget }
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
  const company =
    ask.kind === "COMPANY"
      ? byName(records.companies, (c) => c.name, ask.name)
      : null;
  const found =
    company ??
    (ask.kind === "INVESTOR"
      ? byName(records.investors, (i) => i.name, ask.name)
      : ask.kind === "THING"
        ? byName(records.things, (t) => t.title, ask.name)
        : null);
  if (found === null) return { status: "NONE" };
  if (ask.kind === "THING" && "route" in found && found.route === null)
    return { status: "NO_PAGE" };
  if (ask.document === null)
    return { status: "FOUND", recordId: found.id, documentId: null };
  const doc =
    company === null
      ? null
      : byName(company.documents ?? [], (d) => d.title, ask.document);
  return doc === null
    ? { status: "NONE" }
    : { status: "FOUND", recordId: found.id, documentId: doc.id };
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
  return target === null ? { kind: "UNRESOLVED" } : { kind: "TARGET", target };
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
    ? { kind: "TARGET", target: ownPlace(resolution.target, records) }
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
  if (pane.pane === "COLLAPSED") {
    // Open the pane only for a page they asked to see; otherwise keep it.
    return proposal.decision === "MOVE" &&
      proposal.askedForPage &&
      proposal.sure !== false &&
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

/** How much a decision does on its own: the most careful one wins a tie. */
const AUTHORITY: Readonly<Record<QNavigationOutcome["decision"], number>> = {
  STAY: 0,
  OFFER: 1,
  MOVE: 2,
};

/** Where an outcome would take them: its target, or the one remembered. */
const votedPlace = (outcome: QNavigationOutcome): QNavigateTarget | null =>
  outcome.target ?? outcome.remembered;

const leastAuthority = (
  outcomes: readonly QNavigationOutcome[],
): QNavigationOutcome =>
  outcomes.reduce((careful, o) =>
    AUTHORITY[o.decision] < AUTHORITY[careful.decision] ? o : careful,
  );

/**
 * The samples' outcomes, voted (decision 78):
 * - all name one place: the most careful of them (a MOVE only if all move);
 * - a strict majority names one place: never a move -- an OFFER of it, or,
 *   with the pane collapsed, it is remembered for when it opens;
 * - a strict majority names no place: their STAY;
 * - otherwise: STAY (SPLIT_VOTE).
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
      return there !== null && samePlace(there, at);
    });
    if (group === undefined) groups.push([outcome]);
    else group.push(outcome);
  }
  const majority = (n: number) => n * 2 > outcomes.length;
  const [largest] = [...groups].sort((a, b) => b.length - a.length);
  if (largest !== undefined && largest.length === outcomes.length)
    return leastAuthority(largest);
  if (largest !== undefined && majority(largest.length)) {
    const careful = leastAuthority(largest);
    if (careful.decision !== "MOVE") return { ...careful, guard: "SPLIT_VOTE" };
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
  },
  input: QNavigationInput,
  attribution: Parameters<QNavigationDecider["decide"]>[1],
): Promise<QNavigationOutcome> {
  const resolver = dependencies.resolver ?? listedRecordResolver(input.records);
  const sample = async (): Promise<QNavigationOutcome> => {
    const proposal = await dependencies.decider.decide(input, attribution);
    const [resolution, alternative] =
      proposal === null || proposal.decision === "STAY"
        ? [null, null]
        : await Promise.all([
            resolveNavigationPlaceWith(proposal, input, resolver),
            resolveAlternative(proposal, input, resolver),
          ]);
    return applyNavigationPolicy({
      proposal,
      resolution,
      pane: input.pane,
      canOpen: dependencies.canOpen,
      config: dependencies.config,
      records: input.records,
      alternative,
    });
  };
  const votes = Math.max(1, dependencies.votes ?? NAVIGATION_VOTES);
  // In parallel: the vote costs no serial latency over one decision.
  const outcomes = await Promise.all(Array.from({ length: votes }, sample));
  return voteNavigation(outcomes);
}

// --- 4. The answer path: one move per turn, beside the answer ------------

/** The turn as the decision reads it (the answer path's own reads). */
export type QPageMoveTurn = {
  readonly utterance: string;
  readonly recentTurns: QNavigationInput["recentTurns"];
  readonly pageText: string | null;
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
  readonly settle: (
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
  ) => Promise<readonly QResultBlock[] | undefined>;
};

const NO_RECORDS: QNavigationRecords = {
  companies: [],
  investors: [],
  things: [],
  deleted: [],
};

/** A move the answer already makes: code's own move wins (one per turn). */
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

export function sideOfRequest(request: QAnswerRequest): QNavigationSide {
  return ownInvestorOrganisationIn(request.plan) === null
    ? "FOUNDER"
    : "INVESTOR";
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
  /** How long a settled answer waits for a decision still running. */
  readonly settleWithinMs?: number | undefined;
}): QPageMovePort {
  const map = dependencies.map ?? Q_SITE_MAP;
  const waitMs = dependencies.settleWithinMs ?? 2_500;
  const pending = new Map<string, Promise<QNavigationOutcome | null>>();
  return {
    start: (request, turn) => {
      const workspace = request.plan.screen?.workspace;
      if (workspace === undefined || pending.has(request.runId)) return;
      const side = sideOfRequest(request);
      const decided = (async () => {
        const records =
          (await dependencies.records?.(request).catch(() => null)) ??
          NO_RECORDS;
        const input: QNavigationInput = {
          utterance: turn.utterance,
          recentTurns: turn.recentTurns,
          side,
          pane: navigationPaneFromWorkspace(workspace, map),
          pageText: turn.pageText,
          records,
          siteMap: navigationSiteMap(side, map),
        };
        return decideNavigation(
          {
            decider: dependencies.decider,
            canOpen: canOpenFor(request, map),
            config: dependencies.config,
            resolver:
              dependencies.resolver?.(request) ?? listedRecordResolver(records),
          },
          input,
          {
            tenantId: request.tenantId,
            userId: request.actorUserId,
            correlationId: request.correlationId,
          },
        );
      })().catch((error: unknown) => {
        dependencies.logger?.warn(
          { err: error instanceof Error ? error.name : typeof error },
          "q page move not decided; the page pane stays",
        );
        return null;
      });
      pending.set(request.runId, decided);
      // A run that never settles (a failed answer) does not keep it.
      setTimeout(() => pending.delete(request.runId), 120_000).unref?.();
    },
    settle: async (request, blocks) => {
      const decided = pending.get(request.runId);
      if (decided === undefined) return blocks;
      pending.delete(request.runId);
      const current = blocks ?? [];
      if (movesAlready(current)) return blocks;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        decided,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), waitMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (outcome === null || outcome.target === null) return blocks;
      if (outcome.decision === "STAY") return blocks;
      let intent: ReturnType<typeof navigateTargetToIntent>;
      try {
        intent = navigateTargetToIntent(outcome.target);
      } catch {
        return blocks;
      }
      if (outcome.decision === "OFFER") {
        const title = (
          qSiteMapLandingFor(map, outcome.target.page)?.page.title ?? "the page"
        ).slice(0, Q_NAVIGATION_OFFER_LABEL_MAX - 5);
        return [
          ...current,
          {
            kind: "NAVIGATION_OFFER",
            intent,
            place: title,
            openLabel: `Open ${title}`,
          },
        ];
      }
      return [
        ...current,
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
    },
  };
}
