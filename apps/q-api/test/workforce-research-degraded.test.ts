import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  boundPlan,
  registeredExecutors,
  runJob,
  type JobRecorder,
} from "@capital-q/q-orchestrator";

import {
  analysisContent,
  PUBLIC_UNAVAILABLE_GAP,
  researchText,
} from "../src/composition/workforce/analysis.js";
import {
  createWorkforceExecutors,
  type DocumentExecutionContext,
  type ResearchFound,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";

/**
 * Production 2026-10-25 (07a748ac8): with every public index resting, every
 * research-backed document job failed in ~5 s with no draft -- Research
 * FAILED "Public sources couldn't be checked just now", Documents SKIPPED
 * ("Waited on Research, which did not finish"), the lead HELD at "0 of 2
 * steps done". Public sources that cannot be reached are a gap, not a
 * failure: the work goes on from Capital Q's own records and says so.
 */

const owner = { tenantId: randomUUID(), userId: randomUUID() };

const proposed = [
  {
    key: "research",
    role: "RESEARCH",
    agentName: null,
    goal: "Research Silo Credit's market",
    tools: ["public_web.search"],
    dependsOn: [],
  },
  {
    key: "analysis",
    role: "DOCUMENTS",
    agentName: null,
    goal: "Write the market research",
    tools: ["documents.own.prepare"],
    dependsOn: ["research"],
    document: {
      operation: "PREPARE" as const,
      kind: "ONE_PAGER" as const,
      scope: "OWN_COMPANY" as const,
    },
  },
];

function world(research: () => Promise<ResearchFound>) {
  const unused = vi.fn(() =>
    Promise.reject(new Error("No outward action allowed")),
  );
  const prepare = vi.fn<NonNullable<WorkforcePorts["documents"]>>();
  prepare.mockResolvedValue({ status: "READY", artifactId: randomUUID() });
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Ada"),
    mandateMatches: unused,
    expressInterest: unused,
    openConversations: unused,
    writeReply: unused,
    send: unused,
    freeSlots: unused,
    book: unused,
    notify: unused,
    documents: prepare,
    research: () => research(),
  };
  const authority: DocumentExecutionContext = {
    qRunId: randomUUID(),
    organisationId: randomUUID(),
    canContinue: () => Promise.resolve(true),
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
    documentContext: authority,
  });
  const steps = boundPlan(proposed, {
    permitted: new Set(["public_web.search", "documents.own.prepare"]),
    budgetUsd: 5,
    executors: registeredExecutors({ research: true, documents: true }),
  }).steps;
  return { executors, steps, prepare };
}

function recorder() {
  const ended: { runId: string; status: string; summary: string }[] = [];
  const recording: JobRecorder = {
    startRun: () => Promise.resolve(randomUUID()),
    endRun: (runId, status, summary) => {
      ended.push({ runId, status, summary });
      return Promise.resolve();
    },
    handoff: () => Promise.resolve(),
  };
  return { recording, ended };
}

const unavailable = (): Promise<ResearchFound> =>
  Promise.resolve({
    status: "UNAVAILABLE",
    message: "Public sources couldn't be checked just now.",
    reason: "PUBLIC_UNAVAILABLE",
  });

describe("a research step that cannot reach public sources", () => {
  it("completes with the gap, and the document after it is written and says so", async () => {
    const w = world(unavailable);
    const r = recorder();
    const run = await runJob({
      jobId: randomUUID(),
      goal: "Market research on Silo Credit",
      steps: w.steps,
      executors: w.executors,
      recorder: r.recording,
    });
    expect(run.steps.map((step) => step.status)).toEqual(["DONE", "DONE"]);
    expect(run.steps[0]?.summary).toMatch(
      /Public sources couldn't be checked just now, so the work goes on from Capital Q's own records/u,
    );
    // The document step was given the gap, and its own line says it.
    expect(w.prepare.mock.calls[0]?.[1]).toMatchObject({
      publicSources: "UNAVAILABLE",
    });
    expect(run.steps[1]?.summary).toMatch(/Public sources were unavailable/u);
    // The lead's final line: the job finished.
    expect(r.ended.at(-1)).toMatchObject({
      status: "DONE",
      summary: "2 of 2 steps done.",
    });
  });

  it.each([
    ["the research port throws", () => Promise.reject(new Error("boom"))],
    [
      "the searches found nothing",
      (): Promise<ResearchFound> =>
        Promise.resolve({
          status: "UNAVAILABLE",
          message: "The searches found no public sources for this.",
          reason: "NO_SOURCES",
        }),
    ],
  ])("%s: still a gap, never a dead job", async (_case, research) => {
    const w = world(research);
    const executor = w.executors.RESEARCH;
    const step = w.steps[0];
    if (executor === undefined || step === undefined) throw new Error("setup");
    const result = await executor(step, {
      jobId: randomUUID(),
      runId: randomUUID(),
      results: new Map(),
    });
    expect(result.status).toBe("DONE");
    expect(result.outputs?.["publicSources"]).toMatch(
      /UNAVAILABLE|NONE_FOUND/u,
    );
  });

  it("a refusal (not theirs to research) still stops it", async () => {
    const w = world(() =>
      Promise.resolve({
        status: "UNAVAILABLE",
        message: "Not yours to research.",
        reason: "NOT_ALLOWED",
      }),
    );
    const executor = w.executors.RESEARCH;
    const step = w.steps[0];
    if (executor === undefined || step === undefined) throw new Error("setup");
    const result = await executor(step, {
      jobId: randomUUID(),
      runId: randomUUID(),
      results: new Map(),
    });
    expect(result).toEqual({
      status: "FAILED",
      summary: "Not yours to research.",
    });
  });
});

describe("the analysis states the gap: unknown stays unknown", () => {
  it("tells the writer, and code states the gap in the document", () => {
    expect(researchText([], "UNAVAILABLE")).toMatch(
      /PUBLIC SOURCES UNAVAILABLE.*never estimate or invent it/su,
    );
    const content = analysisContent({
      draft: {
        title: "Silo Credit: market",
        summary: "From Capital Q's own records.",
        sections: [
          { heading: "Market", body: "Not known from public sources." },
        ],
        gaps: ["Customer count is not known."],
      } as never,
      review: { open: [] } as never,
      sources: [],
      facts: [],
      seed: "job:analysis",
      publicSources: "UNAVAILABLE",
    });
    expect(JSON.stringify(content)).toContain(PUBLIC_UNAVAILABLE_GAP);
  });
});
