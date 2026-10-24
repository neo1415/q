import type {
  DiscoveryReasonDto,
  InvestorGateFitDto,
  PublicCardDto,
  PublicCardField,
  PublishedFitDto,
} from "@capital-q/contracts";

import { cardListItems, fieldsForAudience } from "../q-card/card-content";

import type { MatchState } from "./match-marks";

/**
 * What an investor publishes, read for a founder (ADR 0023; app prototypes
 * "investors" and "investor", 2026-10-20). Built ONLY from:
 *
 * - the investor's own Q Card, as a signed-in participant reads it: the
 *   mandate fields the investor chose to put on it (stages, sectors,
 *   geographies, models, customers, what they look for, typical cheque);
 * - their published GateQ criteria with the founder's own standing, as the
 *   API computed it; and Discover's public-profile reasons.
 *
 * The private mandate never reaches this code: there is no field here
 * that could carry it. Absent stays absent: an empty list is "not
 * published", never "none", and an unanswered criterion is "not known
 * yet", never a no.
 */

export type PublishedMandate = {
  readonly stages: readonly string[];
  readonly sectors: readonly string[];
  readonly geographies: readonly string[];
  readonly businessModels: readonly string[];
  readonly customerTypes: readonly string[];
  readonly lookFor: readonly string[];
  /** As the card states it, with its currency ("USD 250,000"). */
  readonly cheque: string | null;
  /** Their `/@handle`, when they have a live card. */
  readonly handle: string | null;
};

export const NOTHING_PUBLISHED: PublishedMandate = {
  stages: [],
  sectors: [],
  geographies: [],
  businessModels: [],
  customerTypes: [],
  lookFor: [],
  cheque: null,
  handle: null,
};

export function publishedMandate(card: PublicCardDto | null): PublishedMandate {
  if (card === null || card.subjectType !== "INVESTOR_ORGANISATION") {
    return NOTHING_PUBLISHED;
  }
  // The projection already decided the audience; this is the second layer.
  const fields = fieldsForAudience(card);
  const field = (key: PublicCardField["key"]) =>
    fields.find((candidate) => candidate.key === key);
  const list = (key: PublicCardField["key"]) => {
    const found = field(key);
    return found === undefined ? [] : cardListItems(found);
  };
  const cheque = field("mandateTypicalCheque")?.value.trim() ?? "";
  return {
    stages: list("mandateStages"),
    sectors: list("mandateSectors"),
    geographies: list("mandateGeographies"),
    businessModels: list("mandateBusinessModels"),
    customerTypes: list("mandateCustomerTypes"),
    lookFor: list("mandateLookFor"),
    cheque: cheque.length === 0 ? null : cheque,
    handle: card.handle,
  };
}

/** True when the investor has put any of their focus on their card. */
export function hasPublishedFocus(mandate: PublishedMandate): boolean {
  return (
    mandate.stages.length +
      mandate.sectors.length +
      mandate.geographies.length +
      mandate.businessModels.length +
      mandate.customerTypes.length +
      mandate.lookFor.length >
      0 || mandate.cheque !== null
  );
}

function joined(items: readonly string[]): string | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0] ?? null;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** "Seed and Series A. Security and Infrastructure." Null: none published. */
export function focusLine(mandate: PublishedMandate): string | null {
  const parts = [joined(mandate.stages), joined(mandate.sectors)].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : `${parts.join(". ")}.`;
}

/** "Seed, Security, United Kingdom." for the sheet; null when nothing. */
export function looksForSentence(mandate: PublishedMandate): string | null {
  const parts = [
    joined(mandate.stages),
    joined(mandate.sectors),
    joined(mandate.geographies),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `${parts.join(", ")}.`;
}

export type MatchDimension = "STAGE" | "SECTOR" | "GEOGRAPHY";
export const MATCH_DIMENSIONS: readonly MatchDimension[] = [
  "STAGE",
  "SECTOR",
  "GEOGRAPHY",
];
export const DIMENSION_WORDS: Readonly<Record<MatchDimension, string>> = {
  STAGE: "Stage",
  SECTOR: "Sector",
  GEOGRAPHY: "Geography",
};

type GateDimension = InvestorGateFitDto["criteria"][number]["dimension"];
const OF_GATE: Readonly<Partial<Record<GateDimension, MatchDimension>>> = {
  STAGE: "STAGE",
  TAXONOMY: "SECTOR",
  EXCLUDED_TAXONOMY: "SECTOR",
  GEOGRAPHY: "GEOGRAPHY",
};
const OF_REASON: Readonly<
  Partial<Record<DiscoveryReasonDto["kind"], MatchDimension>>
> = {
  STAGE_IN_RANGE: "STAGE",
  SECTOR_MATCH: "SECTOR",
  GEOGRAPHY_MATCH: "GEOGRAPHY",
};

const OF_PUBLISHED: Readonly<Record<MatchDimension, keyof PublishedFitDto>> = {
  STAGE: "stage",
  SECTOR: "sector",
  GEOGRAPHY: "geography",
};

/**
 * Stage, sector and geography in four words each. A dimension the gate
 * checks reads from the founder's standing on its criteria: all met is a
 * match, none met is not, some met is partly, and any criterion the
 * founder's profile cannot answer (with none failed) is not known yet. A
 * dimension the gate does not check reads from what their Q Card
 * publishes against the founder's own company, as the API compared it
 * (QO-42), else from Discover's public-profile reasons; anything else is
 * not known yet.
 */
export function dimensionMatches(
  gate: InvestorGateFitDto | null,
  reasons: readonly DiscoveryReasonDto[],
  published?: PublishedFitDto,
): Readonly<Record<MatchDimension, MatchState>> {
  const out: Record<MatchDimension, MatchState> = {
    STAGE: "unk",
    SECTOR: "unk",
    GEOGRAPHY: "unk",
  };
  for (const dimension of MATCH_DIMENSIONS) {
    const standings = (gate?.criteria ?? [])
      .filter((criterion) => OF_GATE[criterion.dimension] === dimension)
      .map((criterion) => criterion.standing);
    if (standings.length > 0) {
      const met = standings.filter((s) => s === "MET").length;
      const notMet = standings.filter((s) => s === "NOT_MET").length;
      out[dimension] =
        notMet === 0
          ? met === standings.length
            ? "ok"
            : "unk"
          : met === 0
            ? "no"
            : "part";
      continue;
    }
    const onCard = published?.[OF_PUBLISHED[dimension]] ?? "UNKNOWN";
    if (onCard !== "UNKNOWN") {
      out[dimension] = onCard === "MET" ? "ok" : "no";
      continue;
    }
    if (reasons.some((reason) => OF_REASON[reason.kind] === dimension)) {
      out[dimension] = "ok";
    }
  }
  return out;
}

/** How a founder can reach them, from their own choices only. */
export type Reach = "GATE" | "OPEN" | "QUALIFIED" | "CLOSED" | "NOT_STATED";

export function reachOf(
  inbound: "CLOSED" | "QUALIFIED" | "OPEN" | null | undefined,
  gate: InvestorGateFitDto | null,
): Reach {
  if (inbound === "CLOSED") return "CLOSED";
  if (gate !== null && gate.acceptingApplications) return "GATE";
  if (inbound === "OPEN") return "OPEN";
  if (inbound === "QUALIFIED") return "QUALIFIED";
  return "NOT_STATED";
}

export const REACH_WORDS: Readonly<Record<Reach, string>> = {
  GATE: "Apply via GateQ",
  OPEN: "Open to founders",
  QUALIFIED: "Only companies that fit their mandate",
  CLOSED: "Not taking requests",
  NOT_STATED: "Hasn’t said how to reach them",
};

/** Where the "Apply via GateQ" press goes: their gate's own form. */
export function gateHref(gate: InvestorGateFitDto | null): string | null {
  if (gate === null || !gate.acceptingApplications) return null;
  return `/g/${encodeURIComponent(gate.publicId)}`;
}
