import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WorkforceJobStartPayloadSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";
import {
  createWorkforcePorts,
  type WorkforcePortServices,
} from "../src/composition/workforce/ports.js";
import { JobPlanResultV3Schema } from "@capital-q/q-core";
import {
  boundPlan,
  registeredExecutors,
  type AgentExecutor,
} from "@capital-q/q-orchestrator";
import {
  createWorkforceExecutors,
  executableJobTools,
  type DocumentExecutionContext,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import { plannedFrom } from "../src/composition/workforce/job-actions.js";

const owner = { tenantId: randomUUID(), userId: randomUUID() };
const document = {
  operation: "PREPARE" as const,
  kind: "ONE_PAGER" as const,
  scope: "OWN_COMPANY" as const,
};
const proposed = {
  key: "prepare",
  role: "DOCUMENTS",
  agentName: null,
  goal: "Prepare our one-pager",
  tools: ["documents.own.prepare"],
  dependsOn: [],
  document,
};
const steps = () =>
  boundPlan([proposed], {
    permitted: new Set(proposed.tools),
    budgetUsd: 0.5,
    executors: registeredExecutors({ research: false, documents: true }),
  }).steps;
const context = {
  jobId: randomUUID(),
  runId: randomUUID(),
  results: new Map(),
};
function world(
  options: {
    readonly active?: () => Promise<boolean>;
    readonly composed?: boolean;
    readonly authority?: boolean;
  } = {},
) {
  let now = 0;
  const unused = vi.fn(() =>
    Promise.reject(new Error("No outward action allowed")),
  );
  const prepare = vi.fn<NonNullable<WorkforcePorts["documents"]>>();
  const ports: WorkforcePorts = {
    principalName: unused,
    mandateMatches: unused,
    expressInterest: unused,
    openConversations: unused,
    writeReply: unused,
    send: unused,
    freeSlots: unused,
    book: unused,
    notify: unused,
    ...(options.composed === false ? {} : { documents: prepare }),
  };
  const authority: DocumentExecutionContext = {
    qRunId: randomUUID(),
    organisationId: randomUUID(),
    canContinue: options.active ?? (() => Promise.resolve(true)),
  };
  const executors = createWorkforceExecutors({
    owner,
    ports,
    models: { readReply: unused },
    review: {
      prepare: unused,
      review: unused,
      abandon: unused,
      settle: unused,
    },
    scheduling: false,
    ...(options.authority === false ? {} : { documentContext: authority }),
    documentPolling: {
      now: () => now,
      wait: () => {
        now += 1_000;
        return Promise.resolve();
      },
      deadlineMs: 3_000,
    },
  });
  const run = () => {
    const executor: AgentExecutor | undefined = executors.DOCUMENTS;
    const step = steps()[0];
    if (executor === undefined || step === undefined)
      throw new Error("Missing executor");
    return executor(step, context);
  };
  return { run, prepare, unused, authority, executors };
}

describe("existing document pipeline workforce bridge", () => {
  it("registers preparation only where composed", () => {
    expect(registeredExecutors({ research: false }).DOCUMENTS).toBeUndefined();
    expect(world({ composed: false }).executors.DOCUMENTS).toBeUndefined();
    expect(executableJobTools(false)).not.toContain("documents.own.prepare");
    expect(executableJobTools(false, true)).toContain("documents.own.prepare");
    expect(
      registeredExecutors({ research: false, documents: true }).DOCUMENTS,
    ).toMatchObject({ tools: ["documents.own.prepare"], outward: false });
  });
  it("preserves the exact structured request through model, bounds, approval and resume", () => {
    const model = JobPlanResultV3Schema.parse({
      summary: "Prepare our one-pager",
      steps: [
        {
          key: proposed.key,
          role: proposed.role,
          goal: proposed.goal,
          tools: proposed.tools,
          dependsOn: [],
          document,
        },
      ],
      cannot: [],
    });
    expect(model.steps[0]?.document).toEqual(document);
    const payload = WorkforceJobStartPayloadSchema.parse({
      ownerUserId: owner.userId,
      goal: proposed.goal,
      summary: proposed.goal,
      steps: steps().map((step) => ({
        key: step.key,
        role: step.role,
        agentName: step.agentName,
        goal: step.goal,
        tools: step.tools,
        dependsOn: step.dependsOn,
        spawned: false,
        document: step.document,
        budgetUsd: "0.10",
      })),
      permitted: proposed.tools,
      budgetUsd: "0.50",
      cannot: [],
    });
    expect(plannedFrom(payload).steps[0]?.document).toEqual(document);
    expect(
      boundPlan([{ ...proposed, document: undefined }], {
        permitted: new Set(proposed.tools),
        budgetUsd: 0.5,
        executors: registeredExecutors({ research: false, documents: true }),
      }).refused,
    ).toEqual([{ key: "prepare", reason: "INVALID_DOCUMENT_REQUEST" }]);
  });
  it("waits through PREPARING and completes only for READY, without outward action", async () => {
    const w = world();
    const artifactId = randomUUID();
    w.prepare
      .mockResolvedValueOnce({ status: "PREPARING", artifactId })
      .mockResolvedValueOnce({ status: "READY", artifactId });
    expect(await w.run()).toMatchObject({
      status: "DONE",
      outputs: { artifactId },
    });
    expect(w.prepare).toHaveBeenCalledTimes(2);
    expect(w.prepare.mock.calls[0]?.[1]).toMatchObject({
      jobId: context.jobId,
      stepKey: "prepare",
      runId: context.runId,
      qRunId: w.authority.qRunId,
      budgetUsd: 0.1,
      request: document,
    });
    expect(w.unused).not.toHaveBeenCalled();
  });
  it("stops pending work when cancelled or its lease is lost", async () => {
    const active = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const w = world({ active });
    w.prepare.mockResolvedValue({
      status: "PREPARING",
      artifactId: randomUUID(),
    });
    const stopped = await w.run();
    expect(stopped.status).toBe("FAILED");
    expect(stopped.summary).toContain("stopped");
    expect(w.prepare).toHaveBeenCalledTimes(1);
  });
  it("withholds READY completion when cancelled during the adapter call", async () => {
    const active = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const w = world({ active });
    w.prepare.mockResolvedValue({ status: "READY", artifactId: randomUUID() });
    const stopped = await w.run();
    expect(stopped.status).toBe("FAILED");
    expect(stopped.summary).toContain("stopped");
  });
  it("rejects revision, sharing and foreign ownership before the document service", async () => {
    expect(
      WorkforceJobStartPayloadSchema.shape.steps.element.shape.document
        .unwrap()
        .safeParse({ ...document, operation: "SHARE" }).success,
    ).toBe(false);
    const unused = () => Promise.reject(new Error("Unused service"));
    const documents = vi.fn<NonNullable<WorkforcePortServices["documents"]>>();
    const actor = ActorContextSchema.parse({
      ...owner,
      organisationId: randomUUID(),
      actorType: "HUMAN",
    });
    const services: WorkforcePortServices = {
      feed: unused,
      expressInterest: unused,
      relationships: unused,
      readChat: unused,
      sendChat: unused,
      writeReply: unused,
      findSlots: unused,
      book: unused,
      nameOf: unused,
      documents,
    };
    const port = createWorkforcePorts(services, unused)(actor);
    const input = {
      canContinue: () => Promise.resolve(true),
      request: document,
      goal: proposed.goal,
      qRunId: randomUUID(),
      jobId: context.jobId,
      stepKey: "prepare",
      runId: context.runId,
      organisationId: actor.organisationId ?? "",
      budgetUsd: 0.1,
    };
    expect(
      await port.documents?.({ ...owner, tenantId: randomUUID() }, input),
    ).toMatchObject({ status: "UNAVAILABLE" });
    expect(
      await port.documents?.({ ...owner, userId: randomUUID() }, input),
    ).toMatchObject({ status: "UNAVAILABLE" });
    expect(documents).not.toHaveBeenCalled();
  });
  it("requires the original Q run and durable continuation authority", async () => {
    const w = world({ authority: false });
    expect(await w.run()).toMatchObject({ status: "FAILED" });
    expect(w.prepare).not.toHaveBeenCalled();
  });
  it("reports actual pipeline failure and a bounded pending deadline as FAILED", async () => {
    const failed = world();
    failed.prepare.mockResolvedValue({
      status: "FAILED",
      message: "Document pipeline failed.",
    });
    expect(await failed.run()).toEqual({
      status: "FAILED",
      summary: "Document pipeline failed.",
    });
    const pending = world();
    pending.prepare.mockResolvedValue({
      status: "PREPARING",
      artifactId: randomUUID(),
    });
    const waiting = await pending.run();
    expect(waiting.status).toBe("FAILED");
    expect(waiting.summary).toContain("deadline");
    expect(pending.prepare).toHaveBeenCalledTimes(3);
  });
});
