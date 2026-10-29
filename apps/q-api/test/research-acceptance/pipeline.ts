import { createHash } from "node:crypto";

import type { QArtifactContent, QSituationDossier } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import type { AnalysisDocumentResult } from "@capital-q/q-core";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
  type ResearchTime,
} from "@capital-q/q-research";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  analysisContent,
  investigationGaps,
  investigationSections,
  mergeDossiers,
  recordsText,
  researchText,
  sourcesText,
  writeAnalysisWithReview,
  type AnalysisSource,
} from "../../src/composition/workforce/analysis.js";
import {
  createSpend,
  workforceDeepResearch,
  type ResearchDossier,
} from "../../src/composition/workforce/deep-research.js";
import type { ResearchFound } from "../../src/composition/workforce/jobs.js";
import { createWorkforceModels } from "../../src/composition/workforce/models.js";
import type { OwnResearchSubject } from "../../src/composition/workforce/own-subject.js";
import { situationText } from "../../src/composition/workforce/plan-job.js";

import type { AcceptanceCase } from "./case.js";

/**
 * One golden case, end to end, through the REAL code: the deep-research
 * step (planner prompt, egress composition, search, tiering, fact reading,
 * cross-check, rounds) and the real report assembly (the analyst's write
 * and review loop, then code's own sections and Sources). Only the edges
 * are swapped: the web provider and the Model Gateway, which the caller
 * passes as live, recording or replaying.
 *
 * The person's context reaches the step through `researchContext`: the
 * single place that maps a case's situation onto the step's dependencies,
 * as production does (main.ts): the assembled situation dossier, from
 * which the step writes its research brief; their earlier messages; and,
 * only when no brief can be written, a founder's own company.
 */

/** A stable UUID for a case: same case, same ids, same prompts. */
export function caseUuid(caseId: string, role: string): string {
  const hex = createHash("sha256").update(`${caseId}:${role}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function caseActor(one: AcceptanceCase): ActorContext {
  return ActorContextSchema.parse({
    tenantId: caseUuid(one.id, "tenant"),
    userId: caseUuid(one.id, "user"),
    organisationId: caseUuid(one.id, "organisation"),
    actorType: "HUMAN",
  });
}

/** The person's context as the deep-research step's dependencies take it. */
export function researchContext(one: AcceptanceCase): {
  readonly situation: () => Promise<QSituationDossier>;
  readonly earlierUserText: () => Promise<readonly string[]>;
  readonly ownSubject?: (
    actor: ActorContext,
  ) => Promise<OwnResearchSubject | null>;
  readonly capitalQRecords: () => Promise<
    AcceptanceCase["capitalQRecords"] | null
  >;
} {
  const company = one.public.company;
  return {
    situation: () => Promise.resolve(one.situation),
    earlierUserText: () => Promise.resolve(one.earlierTurns),
    ...(one.actor === "founder" && company !== undefined
      ? {
          ownSubject: () =>
            Promise.resolve({
              name: company.name,
              country: company.country,
              sectors: company.sectors,
              description: company.description,
            }),
        }
      : {}),
    capitalQRecords: () =>
      Promise.resolve(
        one.capitalQRecords.length === 0 ? null : one.capitalQRecords,
      ),
  };
}

/** The person's words as the step receives them: earlier turns first. */
export function caseRequest(one: AcceptanceCase): string {
  return [...one.earlierTurns, one.request].join("\n");
}

export type CaseRun = {
  readonly found: ResearchFound;
  readonly dossier: ResearchDossier | null;
  readonly sources: readonly AnalysisSource[];
  readonly draft: AnalysisDocumentResult | null;
  readonly content: QArtifactContent | null;
};

export async function runCase(input: {
  readonly case: AcceptanceCase;
  readonly provider: PublicWebResearchProvider;
  readonly gateway: ModelGateway;
  /**
   * The clock and deadlines of the whole run: the system's (recorded) when
   * live, the recording's when replayed, virtual in a scripted run.
   */
  readonly time: ResearchTime;
  /** Why a model call was not made, when a run needs explaining. */
  readonly logger?: Logger | undefined;
}): Promise<CaseRun> {
  const one = input.case;
  const actor = caseActor(one);
  const jobId = caseUuid(one.id, "job");
  const logging = input.logger === undefined ? {} : { logger: input.logger };
  const models = createWorkforceModels({ gateway: input.gateway, ...logging });
  const research = workforceDeepResearch({
    service: createPublicWebResearchService({
      provider: input.provider,
      time: input.time,
    }),
    models,
    time: input.time,
    ...logging,
    ...researchContext(one),
  });
  if (research === undefined) throw new Error("deep research not composed");
  const found = await research({
    actor,
    runId: caseUuid(one.id, "research-run"),
    jobId,
    request: caseRequest(one),
    query: one.stepGoal,
    budgetUsd: 0.6,
  });
  const dossier =
    found.status === "OK" && found.dossier !== undefined ? found.dossier : null;
  if (dossier === null)
    return { found, dossier, sources: [], draft: null, content: null };

  // The report, as the ANALYSIS step after it assembles one
  // (documents.ts): the person's own situation, Capital Q records kept
  // apart, the admitted facts, then the write-and-review loop and code's
  // own sections.
  const merged = mergeDossiers([dossier]);
  const records = recordsText(merged.records);
  const who = one.actor === "founder" ? "the founder" : "the investor";
  // As documents.ts: with a brief, the writer reads what the brief drew
  // from their situation (its selected facts and the sections they sit
  // in), not a second read of the whole situation; without one, their
  // own records.
  const context =
    merged.briefs.length > 0
      ? `WHAT THIS QUESTION NEEDS, as Q briefed it from everything it holds about ${who} (their own records, read as them; private):\n${merged.briefs.join("\n\n").slice(0, 16_000)}`
      : `WHO THIS IS FOR (${who}), from their own records:\n${situationText(one.situation)}`;
  const company = [context, records]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const today = new Date(input.time.now()).toISOString().slice(0, 10);
  const written = await writeAnalysisWithReview({
    models,
    who: { tenantId: actor.tenantId, userId: actor.userId },
    trace: { jobId, runId: caseUuid(one.id, "write-run") },
    spend: createSpend(1.2),
    canContinue: () => Promise.resolve(true),
    inputs: {
      principalName: who,
      request: caseRequest(one),
      purpose: `Write the evidence-backed report the person asked for. ${one.stepGoal}`,
      today,
      company,
      research: researchText(merged.facts),
      sources: sourcesText(merged.sources),
      sourceIndices: new Set(merged.sources.map((source) => source.index)),
      recordNames: merged.records.map((record) => record.name),
    },
  });
  if (written === null)
    return {
      found,
      dossier,
      sources: merged.sources,
      draft: null,
      content: null,
    };
  const content = analysisContent({
    draft: written.draft,
    review: written.review,
    sources: merged.sources,
    facts: merged.facts,
    seed: `${jobId}:write`,
    codeGaps: [...investigationGaps(merged.investigations)],
    codeSections: investigationSections({
      facts: merged.facts,
      investigations: merged.investigations,
    }),
  });
  return {
    found,
    dossier,
    sources: merged.sources,
    draft: written.draft,
    content,
  };
}
