import type {
  FounderResults,
  InvestorResults,
  QManifestRef,
} from "@capital-q/contracts";

/** URL-owned Hub state: old relationship links still open the existing board. */
export type HubView = "overview" | "relationships" | "pipeline";
export type HubSide = "INVESTOR" | "COMPANY" | "NONE";

export function hubViewOf(value: string | undefined): HubView {
  return value === "overview" || value === "pipeline" ? value : "relationships";
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
    { id: "results", label: "Reports", href: "/results" },
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
