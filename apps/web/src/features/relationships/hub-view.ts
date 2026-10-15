import type {
  FounderResults,
  InvestorResults,
  QManifestRef,
} from "@capital-q/contracts";

/**
 * URL-owned Hub state. Two views (research 2026-10-15 §3.2): the Overview
 * and the Pipeline, the one record list. "relationships" was the same
 * records as a list; it is the Pipeline's List layout now, and its old
 * links redirect there (`pipelineListHref`). A bare `/relationships`
 * still opens that list, as it always has. Reports are part of the
 * Overview; `/results` and `/crm?view=reports` redirect there.
 */
export type HubView = "overview" | "pipeline";
export type HubSide = "INVESTOR" | "COMPANY" | "NONE";
export type PipelineLayout = "list" | "table" | "board";

export function hubViewOf(value: string | undefined): HubView {
  return value === "overview" ? "overview" : "pipeline";
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
export function hubTabs(): readonly {
  readonly view: HubView;
  readonly label: string;
  readonly href: string;
}[] {
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
  ];
}

const CRM_VIEWS = new Set(["overview", "pipeline", "relationships"]);
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
 * Discover, Capital and Q Work are primary or workspace sidebar entries,
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
