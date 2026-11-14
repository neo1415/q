import {
  adoptableMetric,
  StatedFigureSchema,
  webFigureWords,
  type ResearchReading,
  type StatedFigure,
  type WebFigureSource,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { DocumentClaimCard } from "./document-claim-cards.js";

/**
 * A8, research -> claims (adoption side, decision 93): a figure a public
 * page reports about a founder's own company is kept first as cited
 * research evidence (a `public_web.reading`, research-readings.ts), with
 * no approval needed. Only adopting it into the company's own controlled
 * claims needs the founder: a `company.figure.record` card in their own Q
 * conversation (Prepare -> Recommend -> Human Approval -> Execute). On
 * approval recordWebFigure keeps BOTH provenances: the page that first
 * reported it (and the kept reading) and the founder's confirmation.
 *
 * This file calls no model: the reading was made once, selectively, by the
 * readings job (decision 96), and a card is built from what was kept.
 * Fundraising readings have no figure card yet; they stay research.
 */

export const RESEARCH_CLAIMS_ORCHESTRATION_VERSION = "q-research-claims-v1";
/** Never a wall of cards from one page. */
export const WEB_CLAIM_CARDS_MAX = 3;

export type KeptReading = {
  /** The `public_web.reading` evidence item. */
  readonly itemId: string;
  readonly reading: ResearchReading;
};

export type ResearchClaimCardsDependencies = {
  /** The declared action's card input (null: it does not fit). */
  readonly cardInput: (
    actor: ActorContext,
    proposal: {
      readonly companyId: string;
      readonly figure: StatedFigure;
      readonly web: WebFigureSource;
    },
  ) => Promise<Record<string, unknown> | null>;
  readonly propose: (
    actor: ActorContext,
    card: DocumentClaimCard,
    conversationId: string | null,
  ) => Promise<{ readonly conversationId: string | null }>;
  readonly logger?: Logger | undefined;
};

/** The figure a kept reading may be adopted as, or null. Pure. */
export function adoptionOf(
  kept: KeptReading,
): { readonly figure: StatedFigure; readonly web: WebFigureSource } | null {
  const { reading } = kept;
  const metric = adoptableMetric(reading);
  const { evidenceSourceId, excerptItemId } = reading.source;
  // Only a page recorded as the company's own evidence can be adopted.
  if (metric === null || evidenceSourceId === null || excerptItemId === null) {
    return null;
  }
  // A bounded figure ("over 10,000") is not a figure to adopt as stated.
  if (reading.uncertainty.bound !== null) return null;
  const figure = StatedFigureSchema.safeParse({
    metric,
    value: reading.value,
    // Undated: the page's publication date, as before; else unknown.
    asOf: reading.asOf ?? reading.source.publishedOn,
    said: reading.quote,
  });
  if (!figure.success) return null;
  return {
    figure: figure.data,
    web: {
      sourceId: evidenceSourceId,
      itemId: excerptItemId,
      url: reading.source.url,
      title: (reading.source.title ?? reading.source.domain).slice(0, 200),
      publishedOn: reading.source.publishedOn,
      retrievedAt: reading.source.retrievedAt,
      readingItemId: kept.itemId,
    },
  };
}

export function createResearchClaimCards(
  dependencies: ResearchClaimCardsDependencies,
) {
  const { logger } = dependencies;
  return {
    /** Cards for newly kept readings of their own company. Never throws. */
    fromReadings: async (
      actor: ActorContext,
      companyId: string,
      kept: readonly KeptReading[],
    ): Promise<{ readonly cards: number }> => {
      // Cards are filed in a person's own conversation: never for a service.
      if (actor.actorType !== "HUMAN") return { cards: 0 };
      let conversationId: string | null = null;
      let cards = 0;
      const perPage = new Map<string, number>();
      for (const entry of kept) {
        const adoption = adoptionOf(entry);
        if (adoption === null) continue;
        const page = adoption.web.itemId;
        const count = perPage.get(page) ?? 0;
        if (count >= WEB_CLAIM_CARDS_MAX) continue;
        try {
          const input = await dependencies.cardInput(actor, {
            companyId,
            ...adoption,
          });
          if (input === null) continue;
          const filed = await dependencies.propose(
            actor,
            {
              payload: input,
              words: `From a public page: ${webFigureWords(adoption.figure, adoption.web)}`,
              // One card per kept reading: a repeat files nothing new.
              key: `web-claim:${entry.itemId}`,
            },
            conversationId,
          );
          conversationId = filed.conversationId ?? conversationId;
          perPage.set(page, count + 1);
          cards += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, readingItemId: entry.itemId },
            "a public-page figure card was not proposed",
          );
        }
      }
      return { cards };
    },
  };
}
