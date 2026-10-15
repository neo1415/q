import type {
  FounderResults,
  InvestorResults,
  QManifestRef,
} from "@capital-q/contracts";

/**
 * URL-owned Hub state: old relationship links still open the existing board.
 * "reports" is the Results page (`/results`), which stays at its own URL so
 * every report and download link keeps working; it sits in the CRM's tabs.
 */
export type HubView = "overview" | "relationships" | "pipeline" | "reports";
export type HubSide = "INVESTOR" | "COMPANY" | "NONE";

export function hubViewOf(value: string | undefined): HubView {
  return value === "overview" || value === "pipeline" ? value : "relationships";
}

/**
 * The CRM workspace's own tabs (owner directive 2026-10-15 §D: the sidebar's
 * Results became CRM). Each is a real, server-read view; Reports is the
 * existing Results page. Nothing here is a placeholder tab.
 */
export function hubTabs(side: HubSide): readonly {
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
    {
      view: "relationships",
      label: "Relationships",
      href: "/relationships?view=relationships",
    },
    // Results reads only a founder's or an investor's own side.
    ...(side === "NONE"
      ? []
      : [{ view: "reports" as const, label: "Reports", href: "/results" }]),
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
 * overview, the CRM's front page; `view=reports` is the Results page.
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
    const report = new URLSearchParams();
    for (const key of ["range", "stage", "from", "to"]) {
      const value = one(key);
      if (value !== undefined && value.length > 0 && value.length <= 40)
        report.set(key, value);
    }
    const query = report.toString();
    return query === "" ? "/results" : `/results?${query}`;
  }
  const target = view !== undefined && CRM_VIEWS.has(view) ? view : "overview";
  return `/relationships?${new URLSearchParams([["view", target], ...kept]).toString()}`;
}

export function hubTitle(side: HubSide): string {
  return side === "INVESTOR"
    ? "Investment Hub"
    : side === "COMPANY"
      ? "Fundraising Hub"
      : "Relationships";
}

/** Only working, role-appropriate routes. A submission is not investor interest. */
export function hubDestinations(side: HubSide): readonly {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}[] {
  if (side === "NONE") return [];
  return [
    { id: "discover", label: "Discover", href: "/discover" },
    ...(side === "INVESTOR"
      ? [{ id: "gateq", label: "Investment inbox", href: "/gateq?tab=inbox" }]
      : [
          { id: "capital", label: "Capital", href: "/capital" },
          {
            id: "gateq",
            label: "My applications",
            href: "/gateq?tab=applications",
          },
        ]),
    { id: "work", label: "Q Work", href: "/work" },
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
