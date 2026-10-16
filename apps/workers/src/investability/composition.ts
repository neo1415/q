import {
  deckSectionForReaders,
  orderDeckSections,
  unknownDeckSection,
  type DeckSection,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { createPostgresDataRoom } from "@capital-q/evidence";
import { reviewedDeckSections } from "@capital-q/permissions";
import {
  createInvestabilityService,
  createPostgresInvestabilityStore,
  type InvestabilityDeckPort,
  type InvestabilityService,
} from "@capital-q/readiness";

/**
 * Investability, composed for the worker (owner 2026-10-16).
 *
 * The deck port is the Context Firewall for the deck: only a deck offered
 * to ALL investors (data room PUBLIC, or download open to investors) is
 * read, and of Q's reading only the sections the founder confirmed or
 * corrected, exactly as an investor is shown them
 * (`@capital-q/permissions` company-deck). A deck shared only with one
 * relationship never reaches a score every investor sees. No model call.
 */
export type InvestabilityDeckRoom = Pick<
  ReturnType<typeof createPostgresDataRoom>,
  "currentDeck" | "extractionFor"
>;

export function createInvestabilityDeckPort(
  sql: DatabaseExecutor,
  room: InvestabilityDeckRoom = createPostgresDataRoom(),
): InvestabilityDeckPort {
  return async (companyId) => {
    const deck = await room.currentDeck(sql, companyId);
    if (deck === null) return null;
    // Only a deck offered to ALL investors; a relationship grant never
    // reaches a score every investor sees.
    const offeredToAll =
      deck.level === "PUBLIC" || deck.downloadAudience === "INVESTORS";
    if (!offeredToAll) return null;
    const reading = await room.extractionFor(sql, deck.versionId);
    if (reading === null) return null;
    const reviewed = reviewedDeckSections(
      reading.sections,
      reading.reviews ?? [],
      reading.confirmed,
    );
    const stateOf = new Map(reviewed.states.map((s) => [s.section, s.state]));
    const shown = (state: string | undefined) =>
      state === "CONFIRMED" || state === "CORRECTED";
    const sections: DeckSection[] = orderDeckSections(
      reviewed.sections.map((section) =>
        shown(stateOf.get(section.section))
          ? deckSectionForReaders(section)
          : unknownDeckSection(section.section, "UNCLEAR"),
      ),
    );
    // ADR 0075: sections not reviewed yet, as Q read them. A section the
    // founder marked as wrong (DISMISSED) is never among them.
    const unconfirmed: DeckSection[] = reviewed.sections
      .filter((section) => stateOf.get(section.section) === "PENDING")
      .map((section) => deckSectionForReaders(section));
    if (
      !sections.some((s) => s.status !== "UNCLEAR") &&
      unconfirmed.length === 0
    ) {
      return null;
    }
    return {
      extractionId: reading.id,
      readAt: reading.createdAt,
      sections,
      unconfirmed,
    };
  };
}

export function composeInvestability(sql: DatabaseExecutor): {
  readonly service: InvestabilityService;
} {
  return {
    service: createInvestabilityService({
      store: createPostgresInvestabilityStore({ sql }),
      deck: createInvestabilityDeckPort(sql),
    }),
  };
}
