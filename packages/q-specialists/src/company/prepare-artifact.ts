import type {
  QArtifactSummary,
  QResultBlock,
  QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest } from "@capital-q/q-runtime";

import type { ArtifactPreparationPort } from "./artifact-port.js";
import type { BriefReviser } from "./brief-reviser.js";
import type { CompanyIntelligenceResult } from "./contracts.js";
import { composeInvestmentBrief } from "./investment-brief.js";

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
};

type HistoryLike = readonly {
  readonly blocks?: readonly QResultBlock[] | undefined;
}[];

/** The most recent artifact Q put in front of this person, if any. */
export function latestArtifactIn(history: HistoryLike): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const blocks = history[index]?.blocks ?? [];
    for (let at = blocks.length - 1; at >= 0; at -= 1) {
      const block = blocks[at];
      if (block !== undefined && block.kind === "ARTIFACT_REFERENCE") {
        return block.artifactId;
      }
    }
  }
  return null;
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

export async function prepareOrReviseArtifact(input: {
  readonly artifacts: ArtifactPreparation;
  readonly request: QAnswerRequest;
  readonly company: QSubjectRef;
  readonly companyName: string;
  readonly result: CompanyIntelligenceResult;
  readonly history: HistoryLike;
  readonly logger?: Logger | undefined;
}): Promise<QArtifactSummary | null> {
  const { artifacts, request, company, result, history, logger } = input;
  const ask = result.artifactRequest;
  if (ask === null) {
    return null;
  }
  const companyName = companyNameFrom(result, input.companyName);
  const base = composeInvestmentBrief({ companyName, result });
  if (base === null) {
    // Nothing on record but gaps. A document saying only "unknown" is
    // worse than being told the record is too thin to write one from.
    logger?.debug(
      { qRunId: request.runId },
      "artifact not prepared: nothing on record to compose from",
    );
    return null;
  }
  const grounding = result.findings.map((finding) => finding.statement);

  try {
    if (ask.kind === "REVISE") {
      const target = latestArtifactIn(history);
      if (target !== null) {
        const current = await artifacts.port.currentVersion(
          request.actor,
          target,
        );
        if (current !== null) {
          const revised = await artifacts.reviser.revise({
            base: {
              title: current.title,
              summary: current.summary,
              content: current.content,
            },
            instruction: ask.instruction,
            grounding,
            sensitivity: request.plan.maxSensitivity,
            attribution: {
              tenantId: request.actor.tenantId,
              userId: request.actor.userId,
              qRunId: request.runId,
              correlationId: request.correlationId,
            },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          });
          return await artifacts.port.revise({
            actorContext: request.actor,
            permittedContextPlan: request.plan,
            qRunId: request.runId,
            artifactId: target,
            instruction: ask.instruction,
            content: revised,
          });
        }
      }
      // Asked to change something that is not in this conversation, or is
      // no longer theirs to read. Preparing a fresh one is the useful
      // answer and is no less authorised than any other preparation.
    }
    return await artifacts.port.prepare({
      actorContext: request.actor,
      permittedContextPlan: request.plan,
      qRunId: request.runId,
      subject: company,
      artifactType: ask.artifactType,
      content: base,
    });
  } catch (error: unknown) {
    logger?.warn(
      { err: error, qRunId: request.runId },
      "artifact preparation did not complete",
    );
    return null;
  }
}
