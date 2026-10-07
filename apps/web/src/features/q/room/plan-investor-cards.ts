import type {
  DiscoveredInvestorProfileDto,
  InvestorGateFitDto,
  ReadinessBlueprintDto,
} from "@capital-q/contracts";

import {
  draftHref,
  gateRows,
  STANDING_WORDS,
  standingTally,
} from "@/features/investors/looks-for";

import type { RoomCardView } from "./room-card-view";

/**
 * Q room cards for the founder's 3/6/12-month plan (Q.04) and for what one
 * investor looks for, with the draft application (Q.05). Pure: the reads
 * happen in room-actions under the founder's own session; these only
 * shape what came back. Never model text.
 */

const ITEMS_MAX = 8;

export function blueprintCard(
  blueprint: ReadinessBlueprintDto,
  href: string,
): RoomCardView {
  const byId = new Map(blueprint.roadmap.map((step) => [step.id, step]));
  const items = blueprint.sequencing.flatMap((phase) =>
    phase.stepIds.flatMap((id) => {
      const step = byId.get(id);
      return step === undefined
        ? []
        : [
            {
              id: step.id,
              title: `${phase.label} · ${step.title}`,
              meta: step.why,
            },
          ];
    }),
  );
  return {
    heading: `Your ${String(blueprint.horizonMonths)}-month plan`,
    lead:
      items.length === 0
        ? "Nothing to sequence: your action plan has no open steps right now."
        : null,
    facts: blueprint.sequencing.map((phase) => ({
      label: phase.label,
      value: `${String(phase.stepIds.length)} step${phase.stepIds.length === 1 ? "" : "s"}`,
    })),
    items: items.slice(0, ITEMS_MAX),
    more: Math.max(0, items.length - ITEMS_MAX),
    href,
    open: "Open on Capital",
  };
}

/** Without the plan on their tier: say so, never a sample plan. */
export function blueprintNotOnPlanCard(href: string): RoomCardView {
  return {
    heading: "Your 3/6/12-month plan",
    lead: "The sequenced plan comes with Pro. Your action plan on Capital is free and ready now.",
    facts: [],
    items: [],
    more: 0,
    href,
    open: "Open Capital",
  };
}

export function looksForCard(
  investor: DiscoveredInvestorProfileDto,
  gate: InvestorGateFitDto | null,
  pageHref: string,
): RoomCardView {
  const rows = gateRows(gate);
  const draft = draftHref(gate);
  return {
    heading: `What ${investor.displayName} looks for`,
    lead:
      rows.length === 0
        ? `${investor.displayName} hasn't published criteria on Capital Q yet; their public profile is all they share.`
        : `${standingTally(rows)}. Their published bar, not their private thesis.`,
    facts: [],
    items: rows.slice(0, ITEMS_MAX).map((row, index) => ({
      id: `criterion-${String(index)}`,
      title: `${row.label}: ${STANDING_WORDS[row.standing]}`,
      meta: row.words,
    })),
    more: Math.max(0, rows.length - ITEMS_MAX),
    // The draft lives on their GateQ form, prefilled from the founder's
    // profile; only the founder's Send there submits anything.
    href: draft ?? pageHref,
    open: draft === null ? "Open their page" : "Review my draft application",
  };
}
