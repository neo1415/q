import type { Logger } from "@capital-q/observability";
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
import type { WorkforceModels } from "./models.js";

/** The marker a reviewer's revision carries, so a retry never revises twice. */
export const REVIEWER_REVISION_PREFIX = "Second-specialist review:";

const CRITIQUE_DOCUMENT_MAX = 24_000;
const CRITIQUE_EVIDENCE_MAX = 12_000;

/** The document as the critic reads it: headings, prose and stated gaps. */
export function critiqueText(content: {
  readonly sections: readonly {
    readonly heading: string;
    readonly body: string;
  }[];
  readonly gaps: readonly string[];
}): string {
  const body = content.sections
    .map((section) => `## ${section.heading}\n${section.body}`)
    .join("\n\n");
  const gaps =
    content.gaps.length === 0
      ? ""
      : `\n\n## Stated as not known\n${content.gaps.map((gap) => `- ${gap}`).join("\n")}`;
  return `${body}${gaps}`.slice(0, CRITIQUE_DOCUMENT_MAX);
}

/**
 * Approved document work through Q's existing evidence and artifact
 * pipeline: a document about the person's own company, a memo about the
 * one company the job named (bound by code at planning), or a second
 * specialist's critique and revision of a document an earlier step made.
 */
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
  /** The second specialist; absent: critique steps cannot run here. */
  readonly critic?: WorkforceModels["critique"] | undefined;
  /**
   * Live 2026-10-12: a named-company memo failed in 1.3 s with no trace,
   * because both failure paths here were silent. A failed step now says
   * which error stopped it (class and message only, never the content).
   */
  readonly logger?: Logger | undefined;
}) {
  /**
   * The second specialist. It reads the version the person may read now
   * (re-authorised), against the findings the document was built from,
   * and revises once only when its verdict is material. A technical
   * failure is FAILED with its reason, never a quiet "looks fine".
   */
  async function critiqueAndRevise(
    actor: ActorContext,
    input: WorkforceDocumentInput,
  ): Promise<WorkforceDocumentResult> {
    const failed = (message: string): WorkforceDocumentResult => ({
      status: "FAILED",
      message,
    });
    if (dependencies.critic === undefined)
      return failed("No reviewer is available to critique this document.");
    const source = input.source;
    if (source === undefined)
      return failed("The document to review was not prepared.");
    const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
      kind: "COMPANY",
      companyId: source.companyId,
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
    if (decision.outcome !== "AUTHORISED")
      return failed("This document can no longer be reviewed as you.");
    const current = await dependencies.preparation.port.currentVersion(
      actor,
      source.artifactId,
    );
    if (current === null)
      return failed("This document can no longer be read as you.");
    if (current.instruction?.startsWith(REVIEWER_REVISION_PREFIX) === true) {
      // A retry after the revision was filed: the review already happened.
      return {
        status: "READY",
        artifactId: source.artifactId,
        companyId: source.companyId,
        review: {
          material: true,
          issues: [],
          revisedToVersion: current.version,
        },
      };
    }
    const grounding = current.content.sections.flatMap((section) => [
      section.body,
      ...section.findings.map((finding) => finding.statement),
    ]);
    const evidence = current.content.sections
      .flatMap((section) =>
        section.findings.map((finding) => `- ${finding.statement}`),
      )
      .join("\n")
      .slice(0, CRITIQUE_EVIDENCE_MAX);
    if (!(await input.canContinue()))
      return failed("Review stopped before it started.");
    const verdict = await dependencies.critic(
      { tenantId: actor.tenantId, userId: actor.userId },
      { jobId: input.jobId, runId: input.runId },
      {
        documentKind: current.content.deck === undefined ? "memo" : "deck",
        principalName: input.principalName ?? "the person",
        companyName: current.title.slice(0, 120),
        purpose: input.goal.slice(0, 600),
        evidence: evidence.length > 0 ? evidence : "(no findings recorded)",
        document: critiqueText(current.content),
      },
    );
    if (verdict === null)
      return failed(
        "The reviewer could not finish its critique; nothing was changed.",
      );
    const issues = verdict.issues.map((issue) => ({
      kind: issue.kind,
      section: issue.section,
      problem: issue.problem,
    }));
    if (!verdict.material || verdict.issues.length === 0) {
      return {
        status: "READY",
        artifactId: source.artifactId,
        companyId: source.companyId,
        review: { material: false, issues, revisedToVersion: null },
      };
    }
    if (!(await input.canContinue()))
      return failed("Review stopped before the revision.");
    const instruction = `${REVIEWER_REVISION_PREFIX} ${verdict.issues
      .map((issue) => `${issue.section}: ${issue.problem} Fix: ${issue.fix}`)
      .join(" ")}`.slice(0, 1_900);
    const revised = await dependencies.preparation.reviser.revise({
      base: {
        title: current.title,
        summary: current.summary,
        content: current.content,
      },
      instruction,
      grounding,
      sensitivity: decision.plan.maxSensitivity,
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        qRunId: runId,
        correlationId,
      },
    });
    const filed = await dependencies.preparation.port.revise({
      actorContext: actor,
      permittedContextPlan: decision.plan,
      qRunId: runId,
      artifactId: source.artifactId,
      instruction,
      content: revised,
    });
    return {
      status: "READY",
      artifactId: filed.artifactId,
      companyId: source.companyId,
      review: {
        material: true,
        issues,
        revisedToVersion: filed.currentVersion,
      },
    };
  }

  return async (
    input: WorkforceDocumentInput & { readonly actor: ActorContext },
  ): Promise<WorkforceDocumentResult> => {
    const unavailable = (): WorkforceDocumentResult => ({
      status: "UNAVAILABLE",
      message: "This document cannot be prepared with the current authority.",
    });
    try {
      const request = input.request;
      if (
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
      if (request.operation === "CRITIQUE_AND_REVISE") {
        return await critiqueAndRevise(actor, input);
      }
      if (dependencies.preparation.pipeline?.mode !== "JOB")
        return unavailable();
      // The company: the person's own, or the one the approved plan bound
      // from what the goal named. Either way the firewall decides below.
      const companyId =
        request.scope === "OWN_COMPANY"
          ? ((await dependencies.ownCompany(actor))?.companyId ?? null)
          : request.companyId;
      if (companyId === null) return unavailable();
      const subject: Extract<QSubjectRef, { kind: "COMPANY" }> = {
        kind: "COMPANY",
        companyId,
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
              companyId,
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
        artifactType: request.kind,
        workforce,
      };
      const outcomeOf = (
        artifact: QArtifactSummary,
      ): WorkforceDocumentResult =>
        artifact.status === "READY" && artifact.currentVersion > 0
          ? { status: "READY", artifactId: artifact.artifactId, companyId }
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
        result.companyId !== companyId ||
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
        companyName:
          result.companyName ??
          (request.scope === "OWN_COMPANY" ? "Your company" : "The company"),
        saidVerbatim: input.goal,
        result: {
          ...result,
          artifactRequest: {
            kind: "PREPARE",
            artifactType: request.kind,
            instruction: "",
            visualDirection: null,
            quote: input.goal.slice(0, 400),
          },
        },
        history: [],
        logger: dependencies.logger,
      });
      if (prepared.kind !== "PREPARED") {
        dependencies.logger?.warn(
          {
            jobId: input.jobId,
            stepKey: input.stepKey,
            outcome: prepared.kind,
          },
          "workforce document was not prepared",
        );
      }
      return prepared.kind === "PREPARED"
        ? outcomeOf(prepared.summary)
        : {
            status: "FAILED",
            message:
              prepared.kind === "THIN_RECORD"
                ? "There is too little authorized information on record to prepare this document."
                : "The document could not be prepared.",
          };
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, jobId: input.jobId, stepKey: input.stepKey },
        "workforce document preparation threw",
      );
      return unavailable();
    }
  };
}
