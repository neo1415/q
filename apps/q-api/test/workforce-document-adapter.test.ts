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
import {
  createWorkforceDocuments,
  REVIEWER_REVISION_PREFIX,
} from "../src/composition/workforce/documents.js";
import type { WorkforceModels } from "../src/composition/workforce/models.js";

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  membershipId: randomUUID(),
  actorType: "HUMAN",
});
const companyId = randomUUID();
const qRunId = QRunIdSchema.parse(randomUUID());
function world(critic?: WorkforceModels["critique"]) {
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
  // The revision path's own ports, each refusing until a test arms it.
  const currentVersion = vi.fn<ArtifactPreparation["port"]["currentVersion"]>(
    () => Promise.reject(new Error("unexpected revision read")),
  );
  const revise = vi.fn<ArtifactPreparation["port"]["revise"]>(() =>
    Promise.reject(new Error("unexpected revision")),
  );
  const reviser = vi.fn<ArtifactPreparation["reviser"]["revise"]>(() =>
    Promise.reject(new Error("unexpected rewrite")),
  );
  const preparation: ArtifactPreparation = {
    port: { prepare: unused, revise, currentVersion },
    reviser: { revise: reviser },
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
    critic,
  });
  return {
    currentVersion,
    revise,
    reviser,
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
      companyId,
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

describe("investor work: a memo about the named company, and a second specialist's critique", () => {
  const prospect = randomUUID();
  it("prepares a memo about the company the plan bound, never the person's own", async () => {
    const w = world();
    w.investigate.mockResolvedValue({ ...w.result, companyId: prospect });
    const request = {
      operation: "PREPARE" as const,
      kind: "MEMO" as const,
      scope: "NAMED_COMPANY" as const,
      companyId: prospect,
    };
    expect((await w.prepare({ ...w.input, request })).status).toBe("PREPARING");
    // The firewall decides for exactly that company, as the person, and
    // the document is filed about it.
    expect(w.firewall.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        subjects: [{ kind: "COMPANY", companyId: prospect }],
      }),
    );
    expect(w.artifacts.requestDocument.mock.calls[0]?.[0]).toMatchObject({
      subject: { kind: "COMPANY", companyId: prospect },
      artifactType: "MEMO",
    });
  });

  it("refuses a memo when the specialist's record is about another company", async () => {
    const w = world();
    const result = await w.prepare({
      ...w.input,
      request: {
        operation: "PREPARE",
        kind: "MEMO",
        scope: "NAMED_COMPANY",
        companyId: prospect,
      },
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(w.artifacts.requestDocument).not.toHaveBeenCalled();
  });

  function version(instruction?: string) {
    return {
      artifactId: randomUUID(),
      version: 1,
      title: "Northstar — investment memo",
      summary: "A memo.",
      content: {
        sections: [
          {
            heading: "Traction",
            body: "Northstar has 400 customers and is growing fast.",
            findings: [
              {
                findingId: randomUUID(),
                statement: "The founder says Northstar has 400 customers.",
              },
            ],
          },
        ],
        gaps: ["Monthly burn"],
      },
      ...(instruction === undefined ? {} : { instruction }),
    };
  }
  function critiqueInput(w: ReturnType<typeof world>, artifactId: string) {
    return {
      ...w.input,
      request: {
        operation: "CRITIQUE_AND_REVISE" as const,
        sourceStep: "memo",
      },
      source: { artifactId, companyId: prospect },
      principalName: "Amara",
    };
  }

  it("revises once when the critique is material, with the critic's fixes as the instruction", async () => {
    const critic = vi.fn<WorkforceModels["critique"]>(() =>
      Promise.resolve({
        material: true,
        issues: [
          {
            kind: "UNSUPPORTED",
            section: "Traction",
            problem: "States 400 customers as fact; it is the founder's claim.",
            fix: "Say the founder reports 400 customers.",
          },
        ],
        strengths: [],
      }),
    );
    const w = world(critic);
    const current = version();
    const revised = {
      title: current.title,
      summary: current.summary,
      content: current.content,
    };
    w.currentVersion.mockResolvedValue(current as never);
    w.reviser.mockResolvedValue(revised as never);
    w.revise.mockResolvedValue(
      QArtifactSummarySchema.parse({
        ...w.summary,
        artifactId: current.artifactId,
        status: "READY",
        currentVersion: 2,
      }),
    );
    const result = await w.prepare(critiqueInput(w, current.artifactId));
    expect(result).toMatchObject({
      status: "READY",
      artifactId: current.artifactId,
      review: { material: true, revisedToVersion: 2 },
    });
    const read = critic.mock.calls[0]?.[2];
    expect(read?.evidence).toContain(
      "The founder says Northstar has 400 customers.",
    );
    expect(read?.document).toContain("## Traction");
    const instruction = w.revise.mock.calls[0]?.[0].instruction ?? "";
    expect(instruction.startsWith(REVIEWER_REVISION_PREFIX)).toBe(true);
    expect(instruction).toContain("Say the founder reports 400 customers.");
  });

  it("leaves the document as written when nothing material is found", async () => {
    const critic = vi.fn<WorkforceModels["critique"]>(() =>
      Promise.resolve({
        material: false,
        issues: [],
        strengths: ["Separates claims from evidence."],
      }),
    );
    const w = world(critic);
    const current = version();
    w.currentVersion.mockResolvedValue(current as never);
    const result = await w.prepare(critiqueInput(w, current.artifactId));
    expect(result).toMatchObject({
      status: "READY",
      review: { material: false, revisedToVersion: null },
    });
    expect(w.unused).not.toHaveBeenCalled();
  });

  it("fails honestly when the critic cannot finish, and never revises twice on a retry", async () => {
    const failing = world(
      vi.fn<WorkforceModels["critique"]>(() => Promise.resolve(null)),
    );
    const current = version();
    failing.currentVersion.mockResolvedValue(current as never);
    const failed = await failing.prepare(
      critiqueInput(failing, current.artifactId),
    );
    expect(failed.status).toBe("FAILED");

    const critic = vi.fn<WorkforceModels["critique"]>();
    const retried = world(critic);
    const already = {
      ...version(`${REVIEWER_REVISION_PREFIX} Traction: fixed.`),
      version: 2,
    };
    retried.currentVersion.mockResolvedValue(already as never);
    const again = await retried.prepare(
      critiqueInput(retried, already.artifactId),
    );
    expect(again).toMatchObject({
      status: "READY",
      review: { revisedToVersion: 2 },
    });
    expect(critic).not.toHaveBeenCalled();
    expect(retried.unused).not.toHaveBeenCalled();
  });

  it("refuses to critique when the person can no longer read the document", async () => {
    const critic = vi.fn<WorkforceModels["critique"]>();
    const w = world(critic);
    w.currentVersion.mockResolvedValue(null);
    const result = await w.prepare(critiqueInput(w, randomUUID()));
    expect(result.status).toBe("FAILED");
    expect(critic).not.toHaveBeenCalled();
  });
});
