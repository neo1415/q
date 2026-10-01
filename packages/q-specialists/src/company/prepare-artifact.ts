import type {
  QArtifactSummary,
  QResultBlock,
  QVisibleStage,
  QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ArtifactPreparationPort } from "./artifact-port.js";
import type { BriefReviser } from "./brief-reviser.js";
import type { CompanyIntelligenceResult } from "./contracts.js";
import { composeInvestmentBrief } from "./investment-brief.js";
import type { StockPhotoPort } from "./deck-photos.js";
import {
  auditDocument,
  brandDeck,
  runDocumentStudio,
  type DeckPolisher,
  type StudioBrand,
} from "./document-studio.js";
import type { IllustrationPort } from "./deck-illustrations.js";
import { composePitchDeck } from "./pitch-deck.js";

/**
 * Preparing the document somebody asked for (QX-003D/F; ADR 0013).
 *
 * The composing has already happened by the time anything here runs: the
 * specialist produced findings under the run's authorised plan, and the
 * brief is assembled from those findings. This decides whether to write a
 * new artifact or a new version of one, and asks the artifact application
 * service to do it. Nothing in this file writes, and nothing in it is
 * reachable by a model.
 *
 * Which artifact a revision targets is resolved from the conversation's
 * own recent messages — the most recent card Q put in front of this
 * person — and never from anything the model said. A model that could
 * name an artifact could name somebody else's; a card in their own thread
 * is something they were already shown, and the service re-authorises it
 * before a word of it is read.
 *
 * Every failure returns null. A document that could not be prepared must
 * not take the answer down with it: the findings still stand, and the
 * person is told the document did not come through.
 */

export type ArtifactPreparation = {
  readonly port: ArtifactPreparationPort;
  readonly reviser: BriefReviser;
  /** Stock photographs for decks; absent means decks go without. */
  readonly photos?: StockPhotoPort | undefined;
  /**
   * DOCS: the document studio's inputs. The confirmed brand kit and the
   * company's taxonomy codes are read as the actor, never from anything a
   * model said; the polisher is the words step. Absent: decks are filed
   * as composed (with photos), as before.
   */
  readonly studio?:
    | {
        readonly brandOf: (
          actor: QAnswerRequest["actor"],
        ) => Promise<StudioBrand | null>;
        /** The actor's own company and its taxonomy industry codes. */
        readonly ownCompanyOf: (actor: QAnswerRequest["actor"]) => Promise<{
          readonly companyId: string;
          readonly sectorCodes: readonly string[];
        } | null>;
        readonly polisher?: DeckPolisher | undefined;
        /** Generated pictures, for this run (budgets are the port's). */
        readonly illustrationsFor?:
          | ((request: QAnswerRequest) => IllustrationPort | undefined)
          | undefined;
      }
    | undefined;
};

type HistoryLike = readonly {
  readonly blocks?: readonly QResultBlock[] | undefined;
}[];

/**
 * The most recent document Q put in front of this person, if any.
 *
 * Returned as the card rather than the id because the title is what the
 * prompt needs: a model asked to read "make the executive summary
 * shorter" cannot tell that it is a request to change a document unless
 * it knows a document is open. That fact is the server's, taken from
 * their own conversation, and it is supplied rather than guessed.
 */
export function latestArtifactCardIn(history: HistoryLike): {
  readonly artifactId: string;
  readonly title: string;
} | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const blocks = history[index]?.blocks ?? [];
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at];
      if (block !== undefined && block.kind === "ARTIFACT_REFERENCE") {
        return { artifactId: block.artifactId, title: block.title };
      }
    }
  }
  return null;
}

/** Just the identifier, for a caller that only needs to know which one. */
export function latestArtifactIn(history: HistoryLike): string | null {
  return latestArtifactCardIn(history)?.artifactId ?? null;
}

/**
 * What to call the company in the document's title.
 *
 * Taken from the subject description the specialist already resolved,
 * which is the canonical name the run was authorised against — never a
 * name a model wrote in prose.
 */
function companyNameFrom(
  result: CompanyIntelligenceResult,
  fallback: string,
): string {
  const named = result.findings.find(
    (finding) =>
      finding.dimension === "DESCRIPTION" &&
      /\bnamed\b/i.test(finding.statement),
  );
  const match =
    named === undefined
      ? null
      : /\bnamed\s+(.+?)\.?\s*$/i.exec(named.statement);
  const candidate = match?.[1]?.trim();
  return candidate === undefined || candidate.length === 0
    ? fallback
    : candidate.slice(0, 120);
}

/**
 * How a requested document ended. THIN_RECORD is not a failure and must
 * never be told as one: there is too little on record to write from, and
 * "try again in a moment" would send the person round the same loop.
 */
export type ArtifactPreparationOutcome =
  | { readonly kind: "NOT_ASKED" }
  | { readonly kind: "PREPARED"; readonly summary: QArtifactSummary }
  | {
      readonly kind: "THIN_RECORD";
      readonly artifactType: NonNullable<
        CompanyIntelligenceResult["artifactRequest"]
      >["artifactType"];
    }
  | { readonly kind: "FAILED" };

export async function prepareOrReviseArtifact(input: {
  readonly artifacts: ArtifactPreparation;
  readonly request: QAnswerRequest;
  /** The run's company record, or undefined for a company known only publicly. */
  readonly company: QSubjectRef | undefined;
  readonly companyName: string;
  /** The person's own message, as the instruction of last resort. */
  readonly saidVerbatim: string;
  readonly result: CompanyIntelligenceResult;
  readonly history: HistoryLike;
  readonly logger?: Logger | undefined;
  /** Tells the person Q is writing or editing, while it does. */
  readonly showStage?: ((stage: QVisibleStage) => Promise<void>) | undefined;
}): Promise<ArtifactPreparationOutcome> {
  const { artifacts, request, company, result, history, logger } = input;
  const ask = result.artifactRequest;
  if (ask === null) {
    return { kind: "NOT_ASKED" };
  }
  // Their own words when the model put the change in the quote and left
  // the field empty. Acting on an empty instruction is not something to
  // attempt, and a revision with no instruction is not a revision.
  const instruction =
    ask.instruction.length > 0 ? ask.instruction : input.saidVerbatim;
  const findingStatements = result.findings.map((finding) => finding.statement);

  /**
   * A change to a document that already exists is a revision of THAT
   * document, and it is decided before anything is composed (CQ-QACT-001,
   * F5). Live, "make the traction slide shorter" was answered with "there
   * isn't enough on record to build a deck": the fresh composition a
   * revision never uses ran first, came back empty on a thin record, and
   * the thin-record answer won. A revision rewrites what the document
   * already says, so how much the record holds today does not decide it.
   */
  if (ask.kind === "REVISE") {
    const target = latestArtifactIn(history);
    if (target !== null) {
      try {
        const current = await artifacts.port.currentVersion(
          request.actor,
          target,
        );
        if (current !== null) {
          await input.showStage?.("REVISING_DOCUMENT");
          const revised = await artifacts.reviser.revise({
            base: {
              title: current.title,
              summary: current.summary,
              content: current.content,
            },
            instruction,
            // What the document already carries may be restated; the
            // record's findings may be drawn on. Nothing else.
            grounding: [
              ...current.content.sections.flatMap((section) => [
                section.body,
                ...section.findings.map((finding) => finding.statement),
              ]),
              ...findingStatements,
            ],
            sensitivity: request.plan.maxSensitivity,
            attribution: {
              tenantId: request.actor.tenantId,
              userId: request.actor.userId,
              qRunId: request.runId,
              correlationId: request.correlationId,
            },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          });
          // DOCS: the audit describes this version, not the last one.
          const audited =
            revised.content.deck === undefined
              ? revised
              : {
                  ...revised,
                  content: {
                    ...revised.content,
                    audit: auditDocument(revised.content, [
                      ...current.content.sections.flatMap((section) => [
                        section.body,
                        ...section.findings.map((finding) => finding.statement),
                      ]),
                      ...findingStatements,
                    ]),
                  },
                };
          return {
            kind: "PREPARED",
            summary: await artifacts.port.revise({
              actorContext: request.actor,
              permittedContextPlan: request.plan,
              qRunId: request.runId,
              artifactId: target,
              instruction,
              content: audited,
            }),
          };
        }
      } catch (error: unknown) {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "artifact revision did not complete",
        );
        return { kind: "FAILED" };
      }
    }
    // Asked to change something that is not in this conversation, or is no
    // longer theirs to read. Preparing a fresh one is the useful answer and
    // is no less authorised than any other preparation.
  }

  const companyName =
    result.companyName !== undefined &&
    result.companyName !== null &&
    result.companyName.trim().length > 0
      ? result.companyName.trim().slice(0, 120)
      : companyNameFrom(result, input.companyName);
  /**
   * Which composer, chosen by what they asked for.
   *
   * Both read the same findings the specialist produced under the run's
   * authorised plan; what differs is the shape. A deck that cannot be
   * composed falls back to nothing rather than to a brief: somebody who
   * asked for slides and received an essay has not been helped, and has
   * not been told why.
   */
  const base =
    ask.artifactType === "PITCH_DECK"
      ? composePitchDeck({
          companyName,
          result,
          // No record behind it: everything came from the public web.
          provenance: company === undefined ? "PUBLIC_SOURCES" : "RECORD",
          ...(ask.visualDirection === null
            ? {}
            : { direction: ask.visualDirection }),
        })
      : composeInvestmentBrief({ companyName, result });
  if (base === null) {
    // Nothing on record but gaps. A document saying only "unknown" is
    // worse than being told the record is too thin to write one from.
    logger?.debug(
      { qRunId: request.runId },
      "artifact not prepared: nothing on record to compose from",
    );
    return { kind: "THIN_RECORD", artifactType: ask.artifactType };
  }
  await input.showStage?.("PREPARING_DOCUMENT");
  try {
    const studio = artifacts.studio;
    // DOCS: the studio's steps. The brand and the sector's design apply
    // only to a document about the actor's own company; a deck about
    // somebody else's company is never dressed in the reader's brand.
    const own =
      studio === undefined || company?.kind !== "COMPANY"
        ? null
        : await studio.ownCompanyOf(request.actor).catch(() => null);
    const isOwn =
      own !== null &&
      company?.kind === "COMPANY" &&
      own.companyId === company.companyId;
    const brand =
      studio === undefined || !isOwn
        ? null
        : await studio.brandOf(request.actor).catch(() => null);
    const sectorCodes = isOwn ? own.sectorCodes : [];
    const content =
      ask.artifactType === "PITCH_DECK"
        ? await runDocumentStudio(base.content, {
            grounding: findingStatements,
            sectorCodes,
            directionChosen: ask.visualDirection !== null,
            brand,
            photos: artifacts.photos,
            illustrations: studio?.illustrationsFor?.(request),
            polisher: studio?.polisher,
            sensitivity: request.plan.maxSensitivity,
            attribution: {
              tenantId: request.actor.tenantId,
              userId: request.actor.userId,
              qRunId: request.runId,
              correlationId: request.correlationId,
            },
            signal: request.signal,
          })
        : brandDeck(base.content, brand);
    return {
      kind: "PREPARED",
      summary: await artifacts.port.prepare({
        actorContext: request.actor,
        permittedContextPlan: request.plan,
        qRunId: request.runId,
        ...(company === undefined ? {} : { subject: company }),
        artifactType: ask.artifactType,
        content: { ...base, content },
      }),
    };
  } catch (error: unknown) {
    logger?.warn(
      { err: error, qRunId: request.runId },
      "artifact preparation did not complete",
    );
    return { kind: "FAILED" };
  }
}
