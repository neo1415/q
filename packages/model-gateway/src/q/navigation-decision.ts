import {
  Q_SITE_MAP,
  QNavigateTargetSchema,
  qSiteMapDigest,
  qSiteMapLandingFor,
  type QNavigateTarget,
  type QSiteMap,
  type QSiteMapPage,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  NavigationDecisionResultSchema,
  renderPrompt,
  type NavigationDecisionResult,
  type NavigationDecisionVariables,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

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
  readonly at: QNavigateTarget;
  readonly previous: QNavigateTarget | null;
  readonly pane: "OPEN" | "COLLAPSED";
  readonly dirty: boolean;
  readonly busy: "TYPING" | "SCROLLING" | null;
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
  readonly things: readonly { readonly id: string; readonly title: string }[];
  readonly deleted: readonly { readonly id: string; readonly name: string }[];
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
  | "NOTHING_BEFORE";

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
  return qSiteMapDigest(map, { side });
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
  const page = pageByRoute(map, place.route);
  if (page === undefined) return null;
  const tab =
    place.tab === null ? undefined : page.tabs.find((t) => t.id === place.tab);
  if (place.tab !== null && tab === undefined) return null;
  if (place.sectionId !== null) {
    const section = page.sections.find((s) => s.id === place.sectionId);
    if (section === undefined) return null;
    if (
      section.tab !== undefined &&
      tab !== undefined &&
      section.tab !== tab.id
    )
      return null;
  }
  const detail = {
    ...(ids.documentId === null ? {} : { documentId: ids.documentId }),
    ...(place.slide === null ? {} : { slide: place.slide }),
    ...(place.sectionId === null ? {} : { sectionId: place.sectionId }),
    ...(place.position === null ? {} : { position: place.position }),
  };
  let candidate: Record<string, unknown>;
  const [tabDestination] = tab?.destinations ?? [];
  if (tabDestination !== undefined && ids.recordId === null) {
    candidate = { page: tabDestination, ...detail };
  } else if (ids.itemId !== null && page.route === "/board") {
    candidate = { page: "BOARD", itemId: ids.itemId, ...detail };
  } else if (ids.recordId !== null) {
    const [recordPage] = page.recordPages;
    if (recordPage === undefined) return null;
    const thread =
      tab?.id === "messages" &&
      (recordPage === "RELATIONSHIP_COMPANY" ||
        recordPage === "RELATIONSHIP_INVESTOR");
    candidate = {
      page: thread ? `${recordPage}_MESSAGES` : recordPage,
      recordId: ids.recordId,
      ...(tab === undefined || thread ? {} : { tab: tab.id }),
      ...detail,
    };
  } else {
    const [destination] = page.destinations;
    if (destination === undefined) return null;
    candidate = { page: destination, ...detail };
  }
  const parsed = QNavigateTargetSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
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
 */
export const NAVIGATION_DECISION_TASK_CLASS = "NORMAL_DIALOGUE" as const;
export const NAVIGATION_DECISION_REASONING = "LOW" as const;
const NAVIGATION_DECISION_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_200,
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
    things: input.records.things.map((t) => t.title),
    deleted: input.records.deleted.map((d) => d.name),
  };
  return {
    utterance: input.utterance,
    recentTurns: JSON.stringify(input.recentTurns.slice(-6)).slice(0, 4_000),
    siteMap: input.siteMap.slice(0, 12_000),
    place: JSON.stringify({
      at: placeOf(input.pane.at, input.records),
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
          { schema: NavigationDecisionResultSchema },
        );
        return result.output.kind === "STRUCTURED"
          ? NavigationDecisionResultSchema.parse(result.output.value)
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

/** One record by its name: exact, else the one name that contains it. */
function byName<T>(
  list: readonly T[],
  nameOf: (item: T) => string,
  said: string,
): T | null {
  const wanted = norm(said);
  const exact = list.filter((item) => norm(nameOf(item)) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  const partial = list.filter((item) => norm(nameOf(item)).includes(wanted));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

export type QNavigationResolution =
  | { readonly kind: "TARGET"; readonly target: QNavigateTarget }
  | { readonly kind: "UNRESOLVED" | "DELETED" | "NOTHING_BEFORE" };

/**
 * The model's place, with every name turned into the id of a record the
 * person may open, mapped through the site map to W3.1's target. Never a
 * guess: two records that fit, or none, is UNRESOLVED; so is a route,
 * tab or section the site map does not have.
 */
export function resolveNavigationPlace(
  proposal: NavigationDecisionResult,
  input: QNavigationInput,
  map: QSiteMap = Q_SITE_MAP,
): QNavigationResolution {
  if (proposal.back) {
    return input.pane.previous === null
      ? { kind: "NOTHING_BEFORE" }
      : { kind: "TARGET", target: input.pane.previous };
  }
  const place = proposal.place;
  if (place === null) return { kind: "UNRESOLVED" };
  const record = place.record;
  if (
    record !== null &&
    byName(input.records.deleted, (d) => d.name, record.name) !== null
  ) {
    return { kind: "DELETED" };
  }
  const company =
    record?.kind === "COMPANY"
      ? byName(input.records.companies, (c) => c.name, record.name)
      : null;
  const investor =
    record?.kind === "INVESTOR"
      ? byName(input.records.investors, (i) => i.name, record.name)
      : null;
  const thing =
    record?.kind === "THING"
      ? byName(input.records.things, (t) => t.title, record.name)
      : null;
  if (
    record !== null &&
    company === null &&
    investor === null &&
    thing === null
  )
    return { kind: "UNRESOLVED" };
  let documentId: string | null = null;
  if (place.document !== null) {
    const doc =
      company === null
        ? null
        : byName(company.documents ?? [], (d) => d.title, place.document);
    if (doc === null) return { kind: "UNRESOLVED" };
    documentId = doc.id;
  }
  const onBoard = place.route === "/board" && thing !== null;
  const target = sitePlaceToTarget(
    {
      route: place.route,
      tab: place.tab,
      sectionId: place.sectionId,
      slide: place.slide,
      position:
        place.position === "section" || place.position === "latest"
          ? place.position
          : null,
    },
    {
      recordId: onBoard
        ? null
        : (company?.id ?? investor?.id ?? thing?.id ?? null),
      documentId,
      itemId: onBoard ? thing.id : null,
    },
    map,
  );
  return target === null ? { kind: "UNRESOLVED" } : { kind: "TARGET", target };
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
}): QNavigationOutcome {
  const { proposal, resolution, pane } = input;
  if (proposal === null || proposal.decision === "STAY") return STAY(null);
  if (resolution === null || resolution.kind !== "TARGET") {
    return STAY(resolution?.kind ?? "UNRESOLVED");
  }
  const target = resolution.target;
  if (!input.canOpen(target.page)) return STAY("NO_ACCESS");
  if (samePlace(target, pane.at)) return STAY("ALREADY_THERE");
  if (pane.pane === "COLLAPSED") {
    // Open the pane only for a page they asked to see; otherwise keep it.
    return proposal.decision === "MOVE" && proposal.askedForPage
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

/** The three steps together: decide, resolve, apply the policy. */
export async function decideNavigation(
  dependencies: {
    readonly decider: QNavigationDecider;
    readonly canOpen: (page: string) => boolean;
    readonly config: QNavigationPolicyConfig;
  },
  input: QNavigationInput,
  attribution: Parameters<QNavigationDecider["decide"]>[1],
): Promise<QNavigationOutcome> {
  const proposal = await dependencies.decider.decide(input, attribution);
  const resolution =
    proposal === null || proposal.decision === "STAY"
      ? null
      : resolveNavigationPlace(proposal, input);
  return applyNavigationPolicy({
    proposal,
    resolution,
    pane: input.pane,
    canOpen: dependencies.canOpen,
    config: dependencies.config,
  });
}
