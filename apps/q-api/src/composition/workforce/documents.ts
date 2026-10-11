import { createHash } from "node:crypto";

import {
  QRunIdSchema,
  type QArtifactSummary,
  type QSubjectRef,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type { ArtifactService } from "@capital-q/q-artifacts";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  prepareOrReviseArtifact,
  type ArtifactPreparation,
  type CompanyIntelligenceRequest,
  type CompanyIntelligenceResult,
  type QSpecialistExecutionContext,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import type {
  WorkforceDocumentInput,
  WorkforceDocumentResult,
} from "./jobs.js";

/** Approved own-company preparation through Q's existing evidence and artifact pipeline. */
export function createWorkforceDocuments(dependencies: {
  readonly freshActor: (actor: ActorContext) => Promise<ActorContext | null>;
  readonly ownCompany: (
    actor: ActorContext,
  ) => Promise<{ readonly companyId: string } | null>;
  readonly firewall: ContextFirewallPort;
  readonly investigate: (
    request: CompanyIntelligenceRequest,
    context: QSpecialistExecutionContext,
  ) => Promise<CompanyIntelligenceResult>;
  readonly artifacts: Pick<
    ArtifactService,
    "findWorkforceDocument" | "requestDocument"
  >;
  readonly preparation: ArtifactPreparation;
}) {
  return async (
    input: WorkforceDocumentInput & { readonly actor: ActorContext },
  ): Promise<WorkforceDocumentResult> => {
    const unavailable = (): WorkforceDocumentResult => ({
      status: "UNAVAILABLE",
      message: "This document cannot be prepared with the current authority.",
    });
    try {
      if (
        dependencies.preparation.pipeline?.mode !== "JOB" ||
        input.request.scope !== "OWN_COMPANY" ||
        input.request.operation !== "PREPARE" ||
        input.actor.organisationId !== input.organisationId ||
        !(await input.canContinue())
      )
        return unavailable();
      const actor = await dependencies.freshActor(input.actor);
      if (
        actor === null ||
        actor.userId !== input.actor.userId ||
        actor.tenantId !== input.actor.tenantId ||
        actor.organisationId !== input.organisationId
      )
        return unavailable();
      const own = await dependencies.ownCompany(actor);
      if (own === null) return unavailable();
      const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
        kind: "COMPANY",
        companyId: own.companyId,
      };
      const runId = QRunIdSchema.parse(input.qRunId);
      const correlationId = createCorrelationId();
      const decision = await dependencies.firewall.plan({
        actor,
        runId,
        correlationId,
        capability: "ANSWER",
        subjects: [subject],
      });
      if (decision.outcome !== "AUTHORISED") return unavailable();
      const workforce = {
        jobId: input.jobId,
        stepKey: input.stepKey,
        intentSha256: createHash("sha256")
          .update(
            JSON.stringify({
              request: input.request,
              goal: input.goal,
              qRunId: input.qRunId,
              tenantId: actor.tenantId,
              userId: actor.userId,
              organisationId: actor.organisationId,
              companyId: own.companyId,
              budgetUsd: input.budgetUsd,
            }),
          )
          .digest("hex"),
        execution: { runId: input.runId, budgetUsd: input.budgetUsd },
      };
      const authority = {
        actorContext: actor,
        permittedContextPlan: decision.plan,
        qRunId: runId,
        subject,
        artifactType: input.request.kind,
        workforce,
      };
      const outcomeOf = (
        artifact: QArtifactSummary,
      ): WorkforceDocumentResult =>
        artifact.status === "READY" && artifact.currentVersion > 0
          ? { status: "READY", artifactId: artifact.artifactId }
          : artifact.status === "PREPARING"
            ? { status: "PREPARING", artifactId: artifact.artifactId }
            : {
                status: "FAILED",
                message:
                  "The document pipeline could not finish this document.",
              };
      const prior =
        await dependencies.artifacts.findWorkforceDocument(authority);
      if (prior !== null) return outcomeOf(prior);
      if (!(await input.canContinue())) return unavailable();
      const result = await dependencies.investigate(
        {
          company: subject,
          question: input.goal,
          preparationMode: "EVIDENCE_ONLY",
          publicResearch: false,
        },
        {
          actor,
          runId,
          correlationId,
          capability: "ANSWER",
          plan: decision.plan,
        },
      );
      if (
        result.blocked !== null ||
        result.companyId !== own.companyId ||
        !(await input.canContinue())
      )
        return unavailable();
      // The approved structured request supplies the shape; evidence supplies
      // the content. No model receives authority to choose either scope or writes.
      const prepared = await prepareOrReviseArtifact({
        artifacts: {
          ...dependencies.preparation,
          pipeline: {
            mode: "JOB",
            port: {
              request: async (request) => {
                if (!(await input.canContinue()))
                  throw new Error("Document continuation stopped");
                const refreshed = await dependencies.freshActor(actor);
                if (
                  refreshed === null ||
                  refreshed.tenantId !== actor.tenantId ||
                  refreshed.userId !== actor.userId ||
                  refreshed.organisationId !== actor.organisationId
                )
                  throw new Error("Document authority unavailable");
                const fresh = await dependencies.firewall.plan({
                  actor: refreshed,
                  runId,
                  correlationId,
                  capability: "ANSWER",
                  subjects: [subject],
                });
                if (fresh.outcome !== "AUTHORISED")
                  throw new Error("Document authority unavailable");
                return (
                  await dependencies.artifacts.requestDocument({
                    ...request,
                    job: {
                      ...request.job,
                      grounding: [...request.job.grounding],
                      sectorCodes: [...request.job.sectorCodes],
                    },
                    actorContext: refreshed,
                    permittedContextPlan: fresh.plan,
                    workforce,
                  })
                ).artifact;
              },
              wait: () => Promise.resolve(null),
            },
          },
        },
        request: {
          runId,
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          capability: "ANSWER",
          subjects: [subject],
          actor,
          correlationId,
          retrieval: { kind: "NOT_CONFIGURED" },
          plan: decision.plan,
        },
        company: subject,
        companyName: result.companyName ?? "Your company",
        saidVerbatim: input.goal,
        result: {
          ...result,
          artifactRequest: {
            kind: "PREPARE",
            artifactType: input.request.kind,
            instruction: "",
            visualDirection: null,
            quote: input.goal.slice(0, 400),
          },
        },
        history: [],
      });
      return prepared.kind === "PREPARED"
        ? outcomeOf(prepared.summary)
        : {
            status: "FAILED",
            message:
              prepared.kind === "THIN_RECORD"
                ? "There is too little authorized information on record to prepare this document."
                : "The document could not be prepared.",
          };
    } catch {
      return unavailable();
    }
  };
}
