import { createHash } from "node:crypto";

import { z } from "zod";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EvidenceService } from "../application/service.js";
import { EvidenceSourceIdSchema } from "../contracts/index.js";
import { EvidenceSourceNotFoundError } from "../domain/errors.js";
import {
  ClaimProposalSchema,
  type ClaimProposal,
  type ProposedValue,
} from "./contracts.js";
import { excerptIsPresent } from "./policy.js";
import {
  STATED_FIGURE_METRICS,
  statedFigureClashes,
  statedFigureStructuredValue,
  statedFigureWords,
  StatedFigureSchema,
  type StatedFigure,
  type StatedFigureEvidence,
  type StatedFigureMetric,
  type StatedFigureOutcome,
  type StatedFigureValue,
} from "./stated-figure.js";

/**
 * A8: a figure read from a founder's own document (their pitch deck),
 * proposed to them, and recorded as their claim only once they confirm it.
 *
 *   document text -> claim extraction (a job, never a chat turn) ->
 *   PROPOSED figures (here: nothing persisted) -> the founder's card ->
 *   approved -> USER_CLAIM / DOCUMENT_SUPPORTED claim, organisation_private,
 *   its evidence the document's own words at their page.
 *
 * The extractor's proposals are untrusted: each must quote words that are
 * in the document's text, name a metric on the closed list the figure
 * readers already use, carry money in its own currency and be a figure
 * the document states (not an estimate, a target or Q's inference). The
 * page comes from the passage the quote was found in, never from the
 * proposal. A document saying "mark this verified" or "make this public"
 * has no field to say it in.
 *
 * Dismissing the card records nothing. Dates work as in conversation: a
 * different value for the same metric and date stays beside the earlier
 * one (CONTRADICTS, both CURRENT); another month is history.
 */

/** Claim keys a document figure may carry: the figure readers' own list. */
const METRIC_BY_CLAIM_KEY: ReadonlyMap<string, StatedFigureMetric> = new Map(
  (
    Object.entries(STATED_FIGURE_METRICS) as [
      StatedFigureMetric,
      (typeof STATED_FIGURE_METRICS)[StatedFigureMetric],
    ][]
  ).map(([metric, definition]) => [definition.claimKey, metric]),
);
export const DOCUMENT_FIGURE_CLAIM_KEYS: readonly string[] = [
  ...METRIC_BY_CLAIM_KEY.keys(),
];

/** Where in which document the figure was read. Server-assembled, never a model's. */
export const DocumentFigureSourceSchema = z
  .object({
    /** The DOCUMENT evidence source registered for this document version. */
    sourceId: z.string().uuid(),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    /** Slide or page the quoted words are on; null when the text has none. */
    page: z.number().int().min(1).max(10_000).nullable(),
    /** The document's own title, for the card. */
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export type DocumentFigureSource = z.infer<typeof DocumentFigureSourceSchema>;

/** One passage of the document, with the page its text is on. */
export type DocumentFigurePassage = {
  readonly text: string;
  readonly page: number | null;
};

export type DocumentFigureProposal = {
  readonly figure: StatedFigure;
  readonly page: number | null;
};

const MONEY_DECIMAL = /^\d{1,15}(?:\.\d{1,4})?$/u;

function figureValue(
  value: ProposedValue | null,
  kind: "MONEY" | "COUNT" | "PERCENT",
): StatedFigureValue | null {
  if (value === null) return null;
  if (kind === "MONEY") {
    if (value.kind !== "MONEY" || value.amount < 0) return null;
    // A decimal string, never a float: at most four decimal places.
    const amount = Number(value.amount.toFixed(4)).toString();
    return MONEY_DECIMAL.test(amount)
      ? { kind: "MONEY", amount, currency: value.currency }
      : null;
  }
  if (kind === "COUNT") {
    return value.kind === "COUNT" ? { kind: "COUNT", value: value.value } : null;
  }
  return value.kind === "PERCENTAGE" &&
    value.value >= -1000 &&
    value.value <= 1000
    ? { kind: "PERCENT", value: value.value }
    : null;
}

/**
 * The proposals worth a founder's card, from an extractor's raw output.
 * Pure: no database, no clock beyond `today`, no model. Everything that
 * does not pass is dropped, never repaired.
 */
export function documentFigureProposals(input: {
  readonly proposals: readonly unknown[];
  readonly passages: readonly DocumentFigurePassage[];
  /** YYYY-MM-DD: a figure dated after today is a forecast, not a figure reached. */
  readonly today: string;
}): DocumentFigureProposal[] {
  const out: DocumentFigureProposal[] = [];
  const seen = new Set<string>();
  for (const raw of input.proposals) {
    const parsed = ClaimProposalSchema.safeParse(raw);
    if (!parsed.success) continue;
    const proposal: ClaimProposal = parsed.data;
    // Only what the document states: an estimate, a target or a reading
    // the extractor concluded is not the company's figure.
    if (proposal.assertionKind !== "SOURCE_ASSERTION") continue;
    const metric = METRIC_BY_CLAIM_KEY.get(proposal.claimKey);
    if (metric === undefined) continue;
    // The quote must be the document's own words, and the page is the
    // passage's where they were found: never the proposal's say-so.
    const passage = input.passages.find((candidate) =>
      excerptIsPresent(proposal.excerpt, candidate.text),
    );
    if (passage === undefined) continue;
    if (proposal.asOf !== null && proposal.asOf > input.today) continue;
    const value = figureValue(
      proposal.value,
      STATED_FIGURE_METRICS[metric].kind,
    );
    if (value === null) continue;
    const figure = StatedFigureSchema.safeParse({
      metric,
      value,
      asOf: proposal.asOf,
      said: proposal.excerpt,
    });
    if (!figure.success) continue;
    const key = JSON.stringify([metric, proposal.asOf, value]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ figure: figure.data, page: passage.page });
  }
  return out;
}

/** "your pitch deck", by its own title: what the card names. */
export function documentFigureWords(
  figure: StatedFigure,
  document: Pick<DocumentFigureSource, "title" | "page">,
): string {
  const where =
    document.page === null ? "" : ` (page ${String(document.page)})`;
  return `${statedFigureWords(figure)}, from "${document.title}"${where}`;
}

export type DocumentFigureEvidence = StatedFigureEvidence &
  Pick<EvidenceService, "getEvidenceSource">;

/**
 * Records one figure the founder confirmed from their document. Called
 * only with the approved payload. The source must be this company's own
 * DOCUMENT source for exactly that document version: anything else is
 * "not found", whatever the payload names.
 */
export async function recordDocumentFigure(
  evidence: DocumentFigureEvidence,
  command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly figure: StatedFigure;
    readonly document: DocumentFigureSource;
    readonly correlationId: CorrelationId;
  },
): Promise<StatedFigureOutcome> {
  const { actor, companyId, correlationId } = command;
  const figure = StatedFigureSchema.parse(command.figure);
  const document = DocumentFigureSourceSchema.parse(command.document);
  const source = await evidence.getEvidenceSource({
    actor,
    sourceId: EvidenceSourceIdSchema.parse(document.sourceId),
  });
  if (
    source.sourceType !== "DOCUMENT" ||
    source.subjectType !== "COMPANY" ||
    source.subjectId !== companyId ||
    source.metadata["documentVersionId"] !== document.documentVersionId
  ) {
    throw new EvidenceSourceNotFoundError();
  }
  const metric = STATED_FIGURE_METRICS[figure.metric];
  const subject = { subjectType: "COMPANY" as const, subjectId: companyId };
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
  const claim = await evidence.createClaim({
    actor,
    correlationId,
    input: {
      subject,
      claimType: metric.claimType,
      claimKey: metric.claimKey,
      statement: `The company's ${statedFigureWords(figure)}, as stated in its own document "${document.title}" and confirmed by the founder.`,
      structuredValue,
      // The company speaking about itself in a document: its claim, which
      // the document supports. Never verified by being written down.
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
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
      evidenceType: `${metric.claimType}.document`,
      summary: figure.said,
      structuredValue,
      locator: {
        kind: "document",
        documentVersionId: document.documentVersionId,
        ...(document.page === null ? {} : { page: document.page }),
        excerptHash: createHash("sha256").update(figure.said).digest("hex"),
      },
      validFrom,
      evidenceStatus: "DOCUMENT_SUPPORTED",
      reliabilityClass: "PRIMARY_UNVERIFIED",
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
