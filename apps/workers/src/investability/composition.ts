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
export function createInvestabilityDeckPort(
  sql: DatabaseExecutor,
): InvestabilityDeckPort {
  const room = createPostgresDataRoom();
  return async (companyId) => {
    const deck = await room.currentDeck(sql, companyId);
    if (deck === null) return null;
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
    const shown = new Set(
      reviewed.states
        .filter((s) => s.state === "CONFIRMED" || s.state === "CORRECTED")
        .map((s) => s.section),
    );
    if (shown.size === 0) return null;
    const sections: DeckSection[] = orderDeckSections(
      reviewed.sections.map((section) =>
        shown.has(section.section)
          ? deckSectionForReaders(section)
          : unknownDeckSection(section.section, "UNCLEAR"),
      ),
    );
    return { extractionId: reading.id, readAt: reading.createdAt, sections };
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
