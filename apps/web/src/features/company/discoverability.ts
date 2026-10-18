import type { MarketplaceReadinessAssessment } from "@capital-q/contracts";

/**
 * What keeps investors' declared rules from placing a company, said in
 * general terms (live 2026-10-02: Nixo, ready, with no sector). About the
 * company's own declared facts only: never any investor, never a mandate.
 * Unknown never excludes a company from a feed (ADR 0020); it means fewer
 * investors' rules can match it, so it is shown less often.
 */
export type DiscoverabilityNote = {
  readonly fact: "SECTOR" | "STAGE" | "COUNTRY";
  readonly text: string;
  readonly href: string;
};

export function discoverabilityNotes(
  discoverability: MarketplaceReadinessAssessment["discoverability"],
): readonly DiscoverabilityNote[] {
  if (discoverability === undefined) return [];
  const notes: DiscoverabilityNote[] = [];
  if (!discoverability.sectorDeclared) {
    notes.push({
      fact: "SECTOR",
      text: "Investors who look for particular sectors can't place you until you add your sector, so you reach fewer of them.",
      href: "/profile",
    });
  }
  if (!discoverability.stageDeclared) {
    notes.push({
      fact: "STAGE",
      text: "Investors who look for a stage can't place you until you add yours.",
      href: "/profile",
    });
  }
  if (!discoverability.countryDeclared) {
    notes.push({
      fact: "COUNTRY",
      text: "Investors who look for a place can't place you until you add where you're based.",
      href: "/profile",
    });
  }
  return notes;
}
