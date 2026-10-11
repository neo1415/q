import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PermittedContextPlanSchema,
  QArtifactSummarySchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QRunIdSchema,
  QFindingIdSchema,
} from "@capital-q/contracts";
import type { ArtifactService } from "@capital-q/q-artifacts";
import { ActorContextSchema } from "@capital-q/security";
import type {
  ArtifactPreparation,
  CompanyIntelligenceResult,
} from "@capital-q/q-specialists";
import { createWorkforceDocuments } from "../src/composition/workforce/documents.js";

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  membershipId: randomUUID(),
  actorType: "HUMAN",
});
const companyId = randomUUID();
const qRunId = QRunIdSchema.parse(randomUUID());
function world() {
  let active = true;
  const input = {
    actor,
    request: {
      scope: "OWN_COMPANY" as const,
      operation: "PREPARE" as const,
      kind: "ONE_PAGER" as const,
    },
    goal: "Prepare our one-pager",
    jobId: randomUUID(),
    stepKey: "prepare",
    runId: randomUUID(),
    qRunId,
    organisationId: actor.organisationId ?? "",
    budgetUsd: 0.1,
    canContinue: () => Promise.resolve(active),
  };
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: qRunId,
    tenantId: actor.tenantId,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId }],
    scopes: [],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60000).toISOString(),
    revalidateOnResume: true,
  });
  const summary = QArtifactSummarySchema.parse({
    artifactId: randomUUID(),
    type: "ONE_PAGER",
    status: "PREPARING",
    title: "Northstar — one-pager",
    currentVersion: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const result: CompanyIntelligenceResult = {
    companyId,
    companyName: "Northstar",
    canonicalDescription: "Moves freight",
    specialistVersion: "company-intelligence/v1",
    asOf: new Date().toISOString(),
    blocked: null,
    findings: [
      {
        findingId: QFindingIdSchema.parse(randomUUID()),
        runId: qRunId,
        sensitivity: "CONFIDENTIAL",
        visibilityScope: "organisation_private",
        subjects: [{ kind: "COMPANY", companyId }],
        type: "OBSERVATION",
        dimension: "DESCRIPTION",
        statement: "Northstar moves freight between Lagos and Abuja.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        confidence: "LOW",
        evidenceRefs: [],
        derivation: "DETERMINISTIC",
      },
    ],
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "LOW",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {
      specialistId: "company-intelligence",
      specialistVersion: "v1",
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      routingPolicyCode: null,
      modelCalls: 0,
      retrievalCalls: 0,
      knowledgeReads: 2,
      toolCalls: 1,
      factCount: 1,
      promptCharacters: 0,
      latencyMs: 0,
      costUsd: 0,
      findingCountsByType: {},
      evidenceRefCount: 0,
      contradictionCount: 0,
      gapCount: 0,
      uncertaintyCount: 0,
      staleFactCount: 0,
      rejectedFindingCount: 0,
      rejectedCitationCount: 0,
      researchCalls: 0,
      publicSourceCount: 0,
      statementsRecorded: 0,
    },
  };
  const unused = vi.fn(() =>
    Promise.reject(new Error("unexpected alternate artifact path")),
  );
  const preparation: ArtifactPreparation = {
    port: { prepare: unused, revise: unused, currentVersion: unused },
    reviser: { revise: unused },
    pipeline: { mode: "JOB", port: { request: unused, wait: unused } },
  };
  const freshActor = vi.fn(() => Promise.resolve<typeof actor | null>(actor));
  const firewall = {
    plan: vi.fn(() =>
      Promise.resolve({ outcome: "AUTHORISED" as const, plan }),
    ),
  };
  const investigate = vi.fn(() => Promise.resolve(result));
  const artifacts = {
    findWorkforceDocument: vi.fn<ArtifactService["findWorkforceDocument"]>(() =>
      Promise.resolve<typeof summary | null>(null),
    ),
    requestDocument: vi.fn<ArtifactService["requestDocument"]>(() =>
      Promise.resolve({ artifact: summary, history: [] }),
    ),
  };
  const prepare = createWorkforceDocuments({
    freshActor,
    ownCompany: () => Promise.resolve({ companyId }),
    firewall,
    investigate,
    artifacts,
    preparation,
  });
  return {
    prepare,
    input,
    freshActor,
    firewall,
    investigate,
    artifacts,
    summary,
    result,
    stop: () => {
      active = false;
    },
    unused,
  };
}

describe("workforce reuses authorized document preparation", () => {
  it("queues canonical content once and resumes the same artifact without further investigation", async () => {
    const w = world();
    expect(await w.prepare(w.input)).toEqual({
      status: "PREPARING",
      artifactId: w.summary.artifactId,
    });
    expect(w.investigate).toHaveBeenCalledWith(
      expect.objectContaining({
        preparationMode: "EVIDENCE_ONLY",
        publicResearch: false,
      }),
      expect.objectContaining({ runId: qRunId }),
    );
    const queued = w.artifacts.requestDocument.mock.calls[0]?.[0];
    expect(queued).toMatchObject({
      qRunId,
      subject: { kind: "COMPANY", companyId },
      workforce: {
        jobId: w.input.jobId,
        stepKey: w.input.stepKey,
        execution: { runId: w.input.runId, budgetUsd: 0.1 },
      },
    });
    w.artifacts.findWorkforceDocument.mockResolvedValue({
      ...w.summary,
      status: "READY",
      currentVersion: 1,
    });
    expect(await w.prepare({ ...w.input, runId: randomUUID() })).toEqual({
      status: "READY",
      artifactId: w.summary.artifactId,
    });
    expect(w.investigate).toHaveBeenCalledTimes(1);
    expect(w.artifacts.requestDocument).toHaveBeenCalledTimes(1);
    expect(
      w.artifacts.findWorkforceDocument.mock.calls[0]?.[0].workforce
        .intentSha256,
    ).toBe(
      w.artifacts.findWorkforceDocument.mock.calls[1]?.[0].workforce
        .intentSha256,
    );
    expect(w.unused).not.toHaveBeenCalled();
  });
  it("denies revoked membership and cancellation before any persistence", async () => {
    const w = world();
    w.freshActor.mockResolvedValue(null);
    expect((await w.prepare(w.input)).status).toBe("UNAVAILABLE");
    expect(w.investigate).not.toHaveBeenCalled();
    expect(w.artifacts.requestDocument).not.toHaveBeenCalled();
    const stopped = world();
    stopped.investigate.mockImplementation(() => {
      stopped.stop();
      return Promise.resolve(stopped.result);
    });
    expect((await stopped.prepare(stopped.input)).status).toBe("UNAVAILABLE");
    expect(stopped.artifacts.requestDocument).not.toHaveBeenCalled();
  });
  it("requires a real ready version and preserves actual pipeline failure", async () => {
    const w = world();
    w.artifacts.findWorkforceDocument.mockResolvedValue({
      ...w.summary,
      status: "READY",
      currentVersion: 0,
    });
    expect((await w.prepare(w.input)).status).toBe("FAILED");
    w.artifacts.findWorkforceDocument.mockResolvedValue({
      ...w.summary,
      status: "FAILED",
    });
    expect((await w.prepare(w.input)).status).toBe("FAILED");
    expect(w.investigate).not.toHaveBeenCalled();
  });
});
