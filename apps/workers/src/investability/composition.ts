import {
  deckSectionForReaders,
  orderDeckSections,
  unknownDeckSection,
  type DeckSection,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { createPostgresDataRoom } from "@capital-q/evidence";
import { reviewedDeckSections } from "@capital-q/permissions";
import {
  createInvestabilityService,
  createPostgresUnicornPotentialStore,
  createUnicornPotentialService,
  assessUnicornPotential,
  UNICORN_POTENTIAL_METHOD_VERSION,
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

export function composeInvestability(
  sql: DatabaseExecutor,
  transactions?: TransactionManager,
): {
  readonly service: InvestabilityService;
} {
  const investability = createInvestabilityService({
    store: createPostgresInvestabilityStore({ sql }),
    deck: createInvestabilityDeckPort(sql),
  });
  if (transactions === undefined) return { service: investability };
  const unicorn = createUnicornPotentialService({
    store: createPostgresUnicornPotentialStore({ sql, transactions }),
    deck: createInvestabilityDeckPort(sql),
    assess: assessUnicornPotential,
    methodVersion: UNICORN_POTENTIAL_METHOD_VERSION,
  });
  // Share the existing event routing and paced repair tick, never the feed read.
  // AllSettled lets either independent assessment progress if the other fails.
  return {
    service: {
      recompute: async (companyId) => {
        const [original, extra] = await Promise.allSettled([
          investability.recompute(companyId),
          unicorn.recompute(companyId),
        ]);
        if (original.status === "rejected") throw original.reason;
        if (extra.status === "rejected") throw extra.reason;
        return original.value;
      },
      sweep: async (options) => {
        const original = await investability.sweep(options);
        const extra = await unicorn.sweep({
          limit: Math.min(options?.limit ?? 100, 100),
          pauseMs: options?.pauseMs ?? 250,
        });
        return {
          recorded: original.recorded + extra.recorded,
          unchanged: original.unchanged + extra.unchanged,
          failed: original.failed + extra.failed,
        };
      },
    },
  };
}
