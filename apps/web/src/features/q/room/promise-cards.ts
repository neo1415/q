import {
  FIT_BAND_LABELS,
  fitScoreOutOf10,
  type AssumptionBoardDto,
  type DiscoveredInvestorDto,
  type FitComparisonDto,
  type InvestorGateFitDto,
  type ThesisReadingDto,
} from "@capital-q/contracts";

import {
  assumptionLabels,
  claimLine,
  standingWord,
} from "@/features/assumptions/words";
import { gateLine } from "@/features/discover/gate-words";

import type { RoomCardView } from "./room-card-view";

/**
 * The Q room cards for the investor promises (2026-10-07), built from the
 * pages' own reads (never model text). Pure, so the words are tested.
 */

const ITEMS_MAX = 8;

export function assumptionsCard(
  board: AssumptionBoardDto,
  object: "ASSUMPTIONS" | "EVIDENCE_BOARD",
  href: string,
): RoomCardView {
  const counts = [
    { label: "Evidenced", value: String(board.counts.evidenced) },
    { label: "Claimed", value: String(board.counts.claimed) },
    { label: "Not known yet", value: String(board.counts.unknown) },
  ];
  const ordered =
    object === "EVIDENCE_BOARD"
      ? (["EVIDENCED", "CLAIMED", "UNKNOWN"] as const).flatMap((standing) =>
          board.assumptions.filter((a) => a.standing === standing),
        )
      : board.assumptions;
  return {
    heading:
      object === "EVIDENCE_BOARD" ? "Evidence board" : "Assumptions to test",
    lead:
      board.basis === "NOTHING_SHARED"
        ? "They haven't shared a confirmed deck reading with you, so every key claim is not known yet."
        : "From their confirmed deck reading: what they claim, what has a document behind it, and what is not known yet.",
    facts: counts,
    items: ordered.slice(0, ITEMS_MAX).map((a) => ({
      id: a.id,
      title: claimLine(a),
      meta:
        object === "EVIDENCE_BOARD"
          ? [standingWord(a), ...assumptionLabels(a)].join(" · ")
          : `${[standingWord(a), ...assumptionLabels(a)].join(" · ")}. Ask: ${a.question}`,
    })),
    more: Math.max(0, ordered.length - ITEMS_MAX),
    href,
    open: "Open the profile",
  };
}

export function thesisCard(
  reading: ThesisReadingDto,
  href: string,
): RoomCardView {
  return {
    heading: "How Q reads your thesis",
    lead:
      reading.inferred[0] === undefined
        ? reading.mandateId === null
          ? "You have no active mandate yet, so there is nothing declared to read against."
          : null
        : `Q's reading, not a rule: ${reading.inferred[0]}`,
    facts: [
      ...reading.declared.map((rule) => ({
        label: rule.label,
        value: rule.value,
      })),
      { label: "Saved", value: String(reading.observed.saved) },
      { label: "Passed", value: String(reading.observed.passed) },
    ],
    items: reading.suggestions.map((suggestion) => ({
      id: suggestion.id,
      title: suggestion.title,
      meta: `${suggestion.because} Applies only if you approve.`,
    })),
    more: 0,
    href,
    open: "Open your thesis",
  };
}

export function comparisonCard(
  comparison: FitComparisonDto,
  href: string,
): RoomCardView {
  return {
    heading: "Your saved companies, side by side",
    lead:
      comparison.entries.length === 0
        ? "None of these is one you can compare on fit right now."
        : "Ordered by fit with your mandate; unknown never counts against a company.",
    facts: [],
    items: comparison.entries.map((entry) => {
      const score = fitScoreOutOf10(entry.profile);
      return {
        id: entry.companyId,
        title: `${String(entry.position)}. ${entry.name}`,
        meta: `${score === null ? "" : `${score}/10 · `}${FIT_BAND_LABELS[entry.profile.band]}${entry.bestOn.length > 0 ? " · best of these on some rows" : ""}`,
      };
    }),
    more: 0,
    href,
    open: "Compare on Saved",
  };
}

export function investorFitCard(
  investors: readonly DiscoveredInvestorDto[],
  gates: readonly InvestorGateFitDto[],
  href: string,
): RoomCardView {
  const byInvestor = new Map(
    gates.map((gate) => [gate.investorOrganisationId, gate]),
  );
  return {
    heading: "Investors by what they publish",
    lead: "Based on what investors publish: their gate and public profile. Their private mandates never shape this.",
    facts: [
      { label: "Investors", value: String(investors.length) },
      { label: "With a gate", value: String(gates.length) },
    ],
    items: investors.map((investor) => {
      const gate = byInvestor.get(investor.investorOrganisationId);
      return {
        id: investor.investorOrganisationId,
        title: investor.displayName,
        meta:
          gate === undefined
            ? "No gate published"
            : `Has a gate: ${gateLine(gate)}`,
      };
    }),
    more: 0,
    href,
    open: "Open Discover",
  };
}
