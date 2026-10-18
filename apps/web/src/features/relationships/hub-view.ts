import type {
  FounderResults,
  InvestorResults,
  QManifestRef,
} from "@capital-q/contracts";

/**
 * URL-owned Hub state. Three views: the Overview (the CRM's front page),
 * the Pipeline (the one record list) and Capital (owner 2026-10-16: "the
 * stuff in Capital would be like a tab in CRM"; `/capital` redirects
 * there). "relationships" was the same records as a list; it is the
 * Pipeline's List layout now, and its old links redirect there
 * (`pipelineListHref`). A bare `/relationships` opens the Overview (owner
 * 2026-10-16: the CRM landed on Pipeline). Reports are part of the
 * Overview; `/results` and `/crm?view=reports` redirect there.
 */
export type HubView =
  | "overview"
  | "pipeline"
  | "capital"
  // Owner 2026-10-17: GateQ and company requests (an investor's) and a
  // founder's applications are CRM tabs, not sidebar entries. They stay
  // their own pages at their own addresses, so Q's routes are unchanged.
  | "gateq"
  | "requests"
  | "applications";
export type HubSide = "INVESTOR" | "COMPANY" | "NONE";
export type PipelineLayout = "list" | "table" | "board";

export function hubViewOf(value: string | undefined): HubView {
  if (value === "pipeline" || value === "relationships") return "pipeline";
  return value === "capital" ? "capital" : "overview";
}

/** The Pipeline's layout: List unless the link names Table or Board. */
export function pipelineLayoutOf(value: string | undefined): PipelineLayout {
  return value === "table" || value === "board" ? value : "list";
}

/** Parameters an old `?view=relationships` link carries into the list. */
const LIST_KEPT = ["q", "state"] as const;

/**
 * Where an old `?view=relationships` link goes: the Pipeline's List
 * layout, with its search and state kept. Null: the link is not one.
 */
export function pipelineListHref(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  if (params["view"] !== "relationships") return null;
  const kept = new URLSearchParams({ view: "pipeline", layout: "list" });
  for (const key of LIST_KEPT) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200)
      kept.set(key, value);
  }
  return `/relationships?${kept.toString()}`;
}

/**
 * The CRM workspace's own tabs (owner directive 2026-10-15 §D: the sidebar's
 * Results became CRM). Each is a real, server-read view; the period
 * report lives in the Overview. Nothing here is a placeholder tab.
 */
export function hubTabs(side: HubSide = "NONE"): readonly {
  readonly view: HubView;
  readonly label: string;
  readonly href: string;
}[] {
  const extra: readonly {
    readonly view: HubView;
    readonly label: string;
    readonly href: string;
  }[] =
    side === "INVESTOR"
      ? [
          { view: "gateq", label: "GateQ", href: "/gateq" },
          { view: "requests", label: "Company requests", href: "/investors" },
        ]
      : side === "COMPANY"
        ? [
            // Opens on their applications; "GateQ" so it doesn't repeat
            // the GateQ page's own Applications tab.
            {
              view: "applications",
              label: "GateQ",
              href: "/gateq?tab=applications",
            },
          ]
        : [];
  return [
    {
      view: "overview",
      label: "Overview",
      href: "/relationships?view=overview",
    },
    {
      view: "pipeline",
      label: "Pipeline",
      href: "/relationships?view=pipeline",
    },
    {
      view: "capital",
      label: "Capital",
      href: CAPITAL_VIEW_HREF,
    },
    ...extra,
  ];
}

/** The CRM's Capital tab: what the Capital page was. */
export const CAPITAL_VIEW_HREF = "/relationships?view=capital";

/** The Capital page's own parameters, kept when `/capital` forwards. */
const CAPITAL_KEPT = ["tab", "round", "horizon"] as const;

/**
 * Where an old `/capital` link goes: the CRM's Capital tab, with its
 * sub-tab, round and plan horizon kept (Q's round cards, saved links).
 */
export function capitalTarget(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const kept = new URLSearchParams({ view: "capital" });
  for (const key of CAPITAL_KEPT) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 200)
      kept.set(key, value);
  }
  return `/relationships?${kept.toString()}`;
}

const CRM_VIEWS = new Set(["overview", "pipeline", "relationships", "capital"]);
const CRM_FORWARDED = [
  "q",
  "state",
  "sort",
  "cursor",
  "pageSize",
  "layout",
  "range",
  "stage",
];

/**
 * Where the `/crm` alias sends a link: the established route that owns the
 * view, with the view's own parameters kept. `/crm` alone opens the
 * overview, the CRM's front page; `view=reports` is the Overview's period.
 */
export function crmTarget(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const view = one("view");
  const kept = new URLSearchParams();
  for (const key of CRM_FORWARDED) {
    const value = one(key);
    if (value !== undefined && value.length > 0 && value.length <= 200)
      kept.set(key, value);
  }
  if (view === "reports") {
    const report = new URLSearchParams({ view: "overview" });
    for (const key of ["range", "stage", "from", "to"]) {
      const value = one(key);
      if (value !== undefined && value.length > 0 && value.length <= 40)
        report.set(key, value);
    }
    return `/relationships?${report.toString()}`;
  }
  const target = view !== undefined && CRM_VIEWS.has(view) ? view : "overview";
  if (target === "capital") return capitalTarget(params);
  if (target === "relationships") {
    kept.set("layout", "list");
    return `/relationships?${new URLSearchParams([["view", "pipeline"], ...kept]).toString()}`;
  }
  return `/relationships?${new URLSearchParams([["view", target], ...kept]).toString()}`;
}

export function hubTitle(side: HubSide): string {
  return side === "INVESTOR"
    ? "Investment Hub"
    : side === "COMPANY"
      ? "Fundraising Hub"
      : "Relationships";
}

/**
 * The one module a relationship's work continues in that the sidebar does
 * not already name for this place: GateQ, opened at the side's own tab.
 * Discover and Q Work are primary or workspace sidebar entries,
 * so repeating them here was a third route to the same page (redesign
 * 2026-10-15). A submission is not investor interest.
 */
export function hubDestinations(side: HubSide): readonly {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}[] {
  if (side === "NONE") return [];
  return side === "INVESTOR"
    ? [{ id: "gateq", label: "Investment inbox", href: "/gateq?tab=inbox" }]
    : [
        {
          id: "gateq",
          label: "My applications",
          href: "/gateq?tab=applications",
        },
      ];
}

/** Only counterpart IDs returned by the authorised overview read enter Q context. */
export function hubOverviewRefs(
  results: FounderResults | InvestorResults,
  stage: string | null,
): readonly QManifestRef[] {
  const states =
    results.side === "INVESTOR"
      ? (results.pipeline?.byState ??
        results.pipelineFit.map((row) => ({ state: row.state, count: 1 })))
      : results.pipeline.byState;
  // Match the existing pipeline's selection rule: an unknown/empty stage
  // shows the full pipeline rather than a fabricated empty result.
  const selected = states.some((row) => row.state === stage && row.count > 0)
    ? stage
    : null;
  if (results.side === "INVESTOR") {
    return results.pipelineFit
      .filter((row) => selected === null || row.state === selected)
      .flatMap((row): QManifestRef[] =>
        row.companyId === undefined
          ? []
          : [{ kind: "COMPANY", id: row.companyId }],
      )
      .slice(0, 12);
  }
  return results.pipeline.rows
    .filter((row) => selected === null || row.state === selected)
    .flatMap((row): QManifestRef[] =>
      row.investorOrganisationId === undefined
        ? []
        : [{ kind: "INVESTOR_ORGANISATION", id: row.investorOrganisationId }],
    )
    .slice(0, 12);
}

/**
 * Perf lane 2026-10-16: while a tapped CRM tab's view is read, what is
 * about to change dims (the tab itself carries the mark, LinkPending), so
 * the tap is answered at once. The header, with its tabs, stays as it is.
 */
export const HUB_PAGE_PENDING =
  "[&>*]:transition-opacity [&>*]:duration-(--cq-motion-fast) [&:has([data-link-pending])>:not(header)]:opacity-60";
