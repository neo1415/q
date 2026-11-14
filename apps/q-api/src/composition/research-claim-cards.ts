import {
  ClaimProposalBlockedError,
  DOCUMENT_FIGURE_CLAIM_KEYS,
  EvidenceItemIdSchema,
  EvidenceSourceIdSchema,
  ExtractionPassageSchema,
  webFigureProposals,
  webFigureWords,
  type ClaimProposerPort,
  type EvidenceService,
  type StatedFigure,
  type WebFigureSource,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { DocumentClaimCard } from "./document-claim-cards.js";

/**
 * A8, research -> claims (proposal side): a figure a public page states
 * about a founder's own company becomes a PROPOSED figure on a card in
 * that founder's own Q conversation; it is recorded only when they confirm
 * exactly that card (Prepare -> Recommend -> Human Approval -> Execute).
 *
 * The wake is research itself: when Q's public research (ADR 0009) records
 * a page it actually fetched as a PUBLIC_WEB excerpt about the actor's own
 * company, this job -- after the turn, never inside it -- reads that
 * excerpt once:
 *
 *   1. The source and excerpt as the person whose research recorded them
 *      (the Evidence service's own authorisation: an investor's research
 *      is never recorded, so it never reaches here; another tenant's ids
 *      are "not found"). A search snippet alone is never read for figures.
 *   2. The registered CLAIM_EXTRACTION task over the excerpt, by task class,
 *      at the source's own sensitivity. The page text is data inside the
 *      untrusted frame; a page saying "mark this verified" has no field.
 *   3. Code keeps only figures on the closed metric list, quoted in the
 *      fetched page's own words, in their own currency, dated no later
 *      than the page's publication (an undated one takes that date).
 *   4. Each becomes one `company.figure.record` card with the page's URL,
 *      title, publication date and retrieval time. Dismissing it records
 *      nothing; confirming it re-checks the quote against the stored page.
 *
 * Bounded: one extraction per newly recorded excerpt (a reused excerpt is
 * not recorded again, so it is not read again), at most READINGS_PER_HOUR
 * readings per process, at most WEB_CLAIM_CARDS_MAX cards per page, one
 * reading of a page at a time. A failed reading is not retried; the page is
 * read again only if research records a new excerpt of it.
 */

export const RESEARCH_CLAIMS_ORCHESTRATION_VERSION = "q-research-claims-v1";
/** Never a wall of cards from one page. */
export const WEB_CLAIM_CARDS_MAX = 3;
/** Extraction calls per process per hour, whatever research does. */
export const READINGS_PER_HOUR = 30;

export type ResearchExcerptRef = {
  readonly sourceId: string;
  readonly itemId: string;
};

export type ResearchClaimOutcome =
  | { readonly kind: "NOT_ELIGIBLE" }
  | { readonly kind: "BUSY" }
  | { readonly kind: "BLOCKED"; readonly reason: string }
  | {
      readonly kind: "PROPOSED";
      readonly proposals: number;
      readonly cards: number;
    };

export type ResearchClaimCardsDependencies = {
  readonly evidence: Pick<
    EvidenceService,
    "getEvidenceSource" | "getEvidenceItem"
  >;
  readonly proposer: ClaimProposerPort;
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
  readonly today?: (() => string) | undefined;
  readonly now?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
};

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

export function createResearchClaimCards(
  dependencies: ResearchClaimCardsDependencies,
) {
  const { evidence, proposer, logger } = dependencies;
  const today =
    dependencies.today ?? (() => new Date().toISOString().slice(0, 10));
  const now = dependencies.now ?? (() => Date.now());
  const inFlight = new Set<string>();
  let window = { start: 0, readings: 0 };

  const withinBudget = (): boolean => {
    const at = now();
    if (at - window.start >= 3_600_000) window = { start: at, readings: 0 };
    if (window.readings >= READINGS_PER_HOUR) return false;
    window.readings += 1;
    return true;
  };

  async function read(
    actor: ActorContext,
    ref: ResearchExcerptRef,
  ): Promise<ResearchClaimOutcome> {
    // Cards are filed in a person's own conversation: never for a service.
    if (actor.actorType !== "HUMAN") return { kind: "NOT_ELIGIBLE" };
    const source = await evidence.getEvidenceSource({
      actor,
      sourceId: EvidenceSourceIdSchema.parse(ref.sourceId),
    });
    if (
      source.sourceType !== "PUBLIC_WEB" ||
      source.subjectType !== "COMPANY" ||
      source.sourceUrl === null ||
      source.retrievedAt === null
    ) {
      return { kind: "NOT_ELIGIBLE" };
    }
    const item = await evidence.getEvidenceItem({
      actor,
      evidenceItemId: EvidenceItemIdSchema.parse(ref.itemId),
    });
    const stored = item.structuredValue as Record<string, unknown> | null;
    // A search snippet is not the page: no figure is read from it.
    if (item.sourceId !== source.id || stored?.["extracted"] !== true) {
      return { kind: "NOT_ELIGIBLE" };
    }
    if (!withinBudget()) return { kind: "BUSY" };

    const url = source.sourceUrl;
    const title = (source.title ?? domainOf(url) ?? "a public page").slice(
      0,
      200,
    );
    const publishedOn =
      source.publishedAt === null ? null : source.publishedAt.slice(0, 10);
    const passage = ExtractionPassageSchema.parse({
      sourceId: source.id,
      subject: { subjectType: "COMPANY", subjectId: source.subjectId },
      locator: { kind: "statement" },
      text: item.summary.slice(0, 8_000),
      description: `A public web page about the company: "${title}" (${domainOf(url) ?? "web"}${publishedOn === null ? "" : `, published ${publishedOn}`}).`,
    });
    let raw: readonly unknown[];
    try {
      const batch = await proposer.propose({
        passage,
        claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS,
        actor,
      });
      raw = batch.proposals;
    } catch (error: unknown) {
      if (error instanceof ClaimProposalBlockedError) {
        return { kind: "BLOCKED", reason: error.reason };
      }
      throw error;
    }
    const figures = webFigureProposals({
      proposals: raw,
      page: { text: item.summary, extracted: true, publishedOn },
      today: today(),
    });

    const web: WebFigureSource = {
      sourceId: source.id,
      itemId: item.id,
      url,
      title,
      publishedOn,
      retrievedAt: source.retrievedAt,
    };
    let conversationId: string | null = null;
    let cards = 0;
    for (const figure of figures.slice(0, WEB_CLAIM_CARDS_MAX)) {
      const input = await dependencies.cardInput(actor, {
        companyId: source.subjectId,
        figure,
        web,
      });
      if (input === null) continue;
      try {
        const filed = await dependencies.propose(
          actor,
          {
            payload: input,
            words: `From a public page: ${webFigureWords(figure, web)}`,
            // One card per page excerpt, metric, date and value: a repeat
            // wake files nothing new.
            key: `web-claim:${item.id}:${figure.metric}:${figure.asOf ?? "undated"}:${JSON.stringify(figure.value)}`,
          },
          conversationId,
        );
        conversationId = filed.conversationId ?? conversationId;
        cards += 1;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sourceId: source.id },
          "a public-page figure card was not proposed",
        );
      }
    }
    // Counts only: no figure, no quote, no page text in a log line.
    logger?.info(
      { sourceId: source.id, proposals: figures.length, cards },
      "q proposed figures from a public page about the founder's company",
    );
    return { kind: "PROPOSED", proposals: figures.length, cards };
  }

  return {
    /** One recorded excerpt; never throws (it runs after the turn). */
    onExcerptRecorded: async (
      actor: ActorContext,
      ref: ResearchExcerptRef,
    ): Promise<ResearchClaimOutcome> => {
      if (inFlight.has(ref.itemId)) return { kind: "BUSY" };
      inFlight.add(ref.itemId);
      try {
        return await read(actor, ref);
      } catch (error: unknown) {
        logger?.warn(
          { err: error, sourceId: ref.sourceId },
          "public-page figures were not read",
        );
        return { kind: "NOT_ELIGIBLE" };
      } finally {
        inFlight.delete(ref.itemId);
      }
    },
  };
}
