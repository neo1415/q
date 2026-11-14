import { z } from "zod";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EvidenceService } from "../application/service.js";
import {
  EvidenceItemIdSchema,
  EvidenceSourceIdSchema,
} from "../contracts/index.js";
import { EvidenceSourceNotFoundError } from "../domain/errors.js";
import { documentFigureProposals } from "./document-figure.js";
import { excerptIsPresent } from "./policy.js";
import {
  RESEARCH_READING_EVIDENCE_TYPE,
  ResearchReadingSchema,
} from "./research-reading.js";
import {
  STATED_FIGURE_METRICS,
  statedFigureClashes,
  statedFigureStructuredValue,
  statedFigureWords,
  StatedFigureSchema,
  type StatedFigure,
  type StatedFigureEvidence,
  type StatedFigureOutcome,
} from "./stated-figure.js";

/**
 * A8: a figure a public web page states about a founder's own company,
 * proposed to that founder, and recorded only once they confirm it.
 *
 *   research (ADR 0009) -> PUBLIC_WEB source + excerpt item (persisted) ->
 *   claim extraction over the excerpt (a job, never the chat turn) ->
 *   PROPOSED figures (nothing persisted) -> the founder's card ->
 *   approved -> USER_CLAIM / SELF_REPORTED claim, organisation_private,
 *   its evidence the page's own words, the page's URL and dates.
 *
 * Why these axes (ADR-001, ADR 0009 §6 and §8, decision 87): no claim is
 * minted from a page, and a page can never raise Capital Q's confidence.
 * A retrieved article is not independent verification, so it is never
 * EXTERNALLY_VERIFIED; and ADR-001 has no "source supported" status for a
 * third party's account. What makes this a claim at all is the founder
 * confirming the figure as their company's own: their claim, self-
 * reported, with the article kept as its provenance. Whether a dated
 * public source should raise that status, or be recorded without the
 * founder, is the owner's decision, not this code's.
 *
 * The extractor's proposals are untrusted: the quote must be in the text
 * Capital Q actually fetched from the page (never a search snippet alone),
 * the metric on the closed list, money in its own currency, and the date
 * neither after today nor after the page's own publication date. An
 * undated figure takes the page's publication date; a page with neither
 * stays undated. A page saying "mark this verified" has no field to say it.
 */

/** Where on the public web the figure was read. Server-assembled, never a model's. */
export const WebFigureSourceSchema = z
  .object({
    /** The PUBLIC_WEB evidence source research registered for this page. */
    sourceId: z.string().uuid(),
    /** The excerpt item that holds the fetched page text the quote is in. */
    itemId: z.string().uuid(),
    url: z.string().url().max(2_048),
    /** The page's own title (or its domain), for the card. */
    title: z.string().trim().min(1).max(200),
    /** YYYY-MM-DD: when the page says it was published; null when it does not. */
    publishedOn: z.iso.date().nullable(),
    /** When Capital Q fetched it. */
    retrievedAt: z.iso.datetime({ offset: true }),
    /**
     * The kept research reading (public_web.reading item) this figure was
     * proposed from, when there is one: linked to the founder's claim, so
     * the third party's report stays its provenance.
     */
    readingItemId: z.string().uuid().optional(),
  })
  .strict();
export type WebFigureSource = z.infer<typeof WebFigureSourceSchema>;

/** The fetched text of one public page, as research persisted it. */
export type WebFigurePage = {
  readonly text: string;
  /** False when only a search snippet was kept: no figure is read from it. */
  readonly extracted: boolean;
  /** YYYY-MM-DD from the source, or null. */
  readonly publishedOn: string | null;
};

/**
 * The proposals worth a founder's card, from an extractor's raw output
 * over one public page. Pure; everything that does not pass is dropped.
 */
export function webFigureProposals(input: {
  readonly proposals: readonly unknown[];
  readonly page: WebFigurePage;
  /** YYYY-MM-DD. */
  readonly today: string;
}): StatedFigure[] {
  if (!input.page.extracted) return [];
  const published = input.page.publishedOn;
  // Nothing is dated after the page was written: that is the page's
  // forecast, not a figure the company reached.
  const ceiling =
    published !== null && published < input.today ? published : input.today;
  const out: StatedFigure[] = [];
  const seen = new Set<string>();
  for (const { figure } of documentFigureProposals({
    proposals: input.proposals,
    passages: [{ text: input.page.text, page: null }],
    today: ceiling,
  })) {
    const dated =
      figure.asOf === null && published !== null && published <= input.today
        ? StatedFigureSchema.safeParse({ ...figure, asOf: published })
        : { success: true as const, data: figure };
    if (!dated.success) continue;
    const key = JSON.stringify([
      dated.data.metric,
      dated.data.asOf,
      dated.data.value,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dated.data);
  }
  return out;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

/** "MRR of $42k at 31 Oct 2026, reported by "Title" (example.com, 2 Nov 2026)". */
export function webFigureWords(
  figure: StatedFigure,
  web: Pick<WebFigureSource, "title" | "url" | "publishedOn">,
): string {
  const when = web.publishedOn === null ? "" : `, ${web.publishedOn}`;
  return `${statedFigureWords(figure)}, reported by "${web.title}" (${domainOf(web.url)}${when})`;
}

export type WebFigureEvidence = StatedFigureEvidence &
  Pick<EvidenceService, "getEvidenceSource" | "getEvidenceItem">;

const iso = (value: string | null): string | null =>
  value === null ? null : value.slice(0, 10);

/**
 * Records one figure the founder confirmed from a public page. Called only
 * with the approved payload, and trusts none of its provenance: the source
 * must be this company's PUBLIC_WEB source at exactly that URL, the item
 * that source's excerpt, and the quote must still be in that excerpt.
 * Anything else is "not found", whatever the payload names. The dates and
 * URL recorded are the source row's, never the card's.
 */
export async function recordWebFigure(
  evidence: WebFigureEvidence,
  command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly figure: StatedFigure;
    readonly web: WebFigureSource;
    readonly correlationId: CorrelationId;
  },
): Promise<StatedFigureOutcome> {
  const { actor, companyId, correlationId } = command;
  const figure = StatedFigureSchema.parse(command.figure);
  const web = WebFigureSourceSchema.parse(command.web);
  const source = await evidence.getEvidenceSource({
    actor,
    sourceId: EvidenceSourceIdSchema.parse(web.sourceId),
  });
  if (
    source.sourceType !== "PUBLIC_WEB" ||
    source.subjectType !== "COMPANY" ||
    source.subjectId !== companyId ||
    source.sourceUrl !== web.url
  ) {
    throw new EvidenceSourceNotFoundError();
  }
  const excerpt = await evidence.getEvidenceItem({
    actor,
    evidenceItemId: EvidenceItemIdSchema.parse(web.itemId),
  });
  const stored = excerpt.structuredValue as Record<string, unknown> | null;
  if (
    excerpt.sourceId !== source.id ||
    stored?.["extracted"] !== true ||
    !excerptIsPresent(figure.said, excerpt.summary)
  ) {
    throw new EvidenceSourceNotFoundError();
  }
  // The kept reading it came from, checked like the excerpt: this source's
  // reading of this metric and value, or nothing is recorded.
  let readingItemId: string | null = null;
  if (web.readingItemId !== undefined) {
    const reading = await evidence.getEvidenceItem({
      actor,
      evidenceItemId: EvidenceItemIdSchema.parse(web.readingItemId),
    });
    const kept = ResearchReadingSchema.safeParse(
      reading.structuredValue?.["reading"],
    );
    if (
      reading.sourceId !== source.id ||
      reading.evidenceType !== RESEARCH_READING_EVIDENCE_TYPE ||
      !kept.success ||
      kept.data.metric !== figure.metric ||
      !excerptIsPresent(kept.data.quote, figure.said)
    ) {
      throw new EvidenceSourceNotFoundError();
    }
    readingItemId = reading.id;
  }
  const reportedBy =
    source.metadata?.["subjectWebsite"] === true
      ? "COMPANY_OWN_SITE"
      : "THIRD_PARTY";
  const metric = STATED_FIGURE_METRICS[figure.metric];
  const { same, clashes } = await statedFigureClashes(
    evidence,
    actor,
    companyId,
    figure,
  );
  if (same !== null) {
    return {
      outcome: "ALREADY_RECORDED",
      claimId: same.id,
      conflicts: clashes.length,
    };
  }
  const structuredValue = statedFigureStructuredValue(figure);
  const validFrom =
    figure.asOf === null ? null : `${figure.asOf}T00:00:00.000Z`;
  const title = source.title ?? domainOf(web.url);
  const published = iso(source.publishedAt);
  const claim = await evidence.createClaim({
    actor,
    correlationId,
    input: {
      subject: { subjectType: "COMPANY", subjectId: companyId },
      claimType: metric.claimType,
      claimKey: metric.claimKey,
      statement: `The company's ${statedFigureWords(figure)}: first reported by the public source "${title}" (${domainOf(web.url)}${published === null ? "" : `, ${published}`}), then confirmed by the founder.`,
      structuredValue,
      // The founder's confirmation makes it their claim. The page neither
      // verifies it nor raises its standing (ADR 0009 §6, §8).
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CURRENT",
      validFrom,
      sourceId: source.id,
      // Private to their company; publishing is a separate founder route.
      visibilityScope: "organisation_private",
    },
  });
  const item = await evidence.createEvidenceItem({
    actor,
    correlationId,
    input: {
      sourceId: source.id,
      evidenceType: `${metric.claimType}.public_web`,
      summary: figure.said,
      structuredValue: {
        ...structuredValue,
        url: web.url,
        retrievedAt: source.retrievedAt ?? web.retrievedAt,
        ...(published === null ? {} : { publishedOn: published }),
        excerptItemId: excerpt.id,
        ...(readingItemId === null ? {} : { readingItemId }),
        // Both provenances (decision 93): who first reported it, and that
        // the founder then confirmed it. The page's words are never
        // presented as the founder's original statement.
        reportedBy,
        confirmedBy: "FOUNDER",
        confirmedByUserId: actor.userId,
      },
      locator: { kind: "statement" },
      validFrom,
      evidenceStatus: "SELF_REPORTED",
      reliabilityClass: "SECONDARY_EXTERNAL",
    },
  });
  await evidence.linkClaimEvidence({
    actor,
    correlationId,
    input: {
      claimId: claim.id,
      evidenceItemId: item.id,
      relationship: "SUPPORTS",
    },
  });
  if (readingItemId !== null) {
    await evidence.linkClaimEvidence({
      actor,
      correlationId,
      input: {
        claimId: claim.id,
        evidenceItemId: EvidenceItemIdSchema.parse(readingItemId),
        relationship: "SUPPORTS",
      },
    });
  }
  // Both readings stay CURRENT; neither is chosen.
  for (const clash of clashes) {
    await evidence.linkClaimEvidence({
      actor,
      correlationId,
      input: {
        claimId: clash.id,
        evidenceItemId: item.id,
        relationship: "CONTRADICTS",
      },
    });
  }
  return { outcome: "RECORDED", claimId: claim.id, conflicts: clashes.length };
}
