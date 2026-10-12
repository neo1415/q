import { describe, expect, it, vi } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createQToolExecutor,
  createQToolRegistry,
  createQWorkTools,
  type QWorkIntelligencePort,
  type QWorkJobResult,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * Conversation continuity after a job of Q's team finishes: list_q_work
 * reports what the reviewer changed and the diligence questions exactly as
 * the job's steps persisted them, to the job's owner only.
 */

const QUESTIONS = [
  "What share of 2025 revenue came from your three largest customers?",
  "Which of the pilot contracts converted to paid, and at what price?",
  "How many months of runway do you have at the current burn?",
  "Who owns the heat-exchanger patent: the company or a founder?",
  "What did the last churned customer say when they left?",
] as const;

const JOB: QWorkJobResult = {
  jobId: "0b000000-0000-4000-8000-000000000001",
  goal: "Research Kestrel Heat, write me a memo and have it reviewed",
  state: "COMPLETED",
  finishedAt: "2026-10-12T09:00:00.000Z",
  inThisConversation: true,
  review: {
    outcome: "REVISED",
    documentTitle: "Kestrel Heat memo",
    findings: [
      {
        kind: "UNSUPPORTED",
        section: "Traction",
        problem: "States 40% growth with no source.",
      },
      {
        kind: "MISSING_RISK",
        section: "Risks",
        problem: "Customer concentration is not mentioned.",
      },
    ],
    fromVersion: 1,
    toVersion: 2,
    revisionNote:
      "Traction: States 40% growth with no source. Fix: mark it as a claim.",
    sectionsChanged: ["Traction", "Risks"],
  },
  diligence: { questions: [...QUESTIONS], filedForApproval: true },
};

function ownPlan(actor: ActorContext, userId: string): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

function world(jobResults: QWorkIntelligencePort["jobResults"]) {
  const unused = () => Promise.reject(new Error("not this tool"));
  const port: QWorkIntelligencePort = {
    isInvestor: () => Promise.resolve(true),
    hasCompany: () => Promise.resolve(false),
    list: () => Promise.resolve([]),
    stop: unused,
    answer: unused,
    setAway: unused,
    prepareForApproval: () => "PREPARED",
    jobResults,
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createQWorkTools(port)),
  });
  return (actor: ActorContext, plan: PermittedContextPlan) =>
    executor.execute(
      { callId: "c-1", name: "list_q_work", arguments: {} },
      contextFor(actor, plan),
    );
}

describe("list_q_work: a finished job's reviewer changes and diligence questions", () => {
  it("reports the reviewer's findings, revision and the exact persisted questions", async () => {
    const jobResults = vi.fn(() => Promise.resolve([JOB]));
    const outcome = await world(jobResults)(
      actorA,
      ownPlan(actorA, actorA.userId),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        jobs: [
          {
            jobId: JOB.jobId,
            inThisConversation: true,
            review: {
              outcome: "REVISED",
              fromVersion: 1,
              toVersion: 2,
              findings: JOB.review?.findings,
              revisionNote: JOB.review?.revisionNote,
              sectionsChanged: ["Traction", "Risks"],
            },
            diligence: { questions: [...QUESTIONS], filedForApproval: true },
          },
        ],
      },
    });
    // Read as the person asking, in this run (the original conversation).
    expect(jobResults).toHaveBeenCalledExactlyOnceWith(actorA, {
      runId: contextFor(actorA, ownPlan(actorA, actorA.userId)).runId,
    });
  });

  it("keeps an unrecorded review or questions null (unknown), never filled in", async () => {
    const outcome = await world(() =>
      Promise.resolve([{ ...JOB, review: null, diligence: null }]),
    )(actorA, ownPlan(actorA, actorA.userId));
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { jobs: [{ review: null, diligence: null }] },
    });
  });

  it("refuses another person's conversation and never reads their jobs", async () => {
    const jobResults = vi.fn(() => Promise.resolve([JOB]));
    const outcome = await world(jobResults)(
      actorB,
      ownPlan(actorB, actorA.userId),
    );
    expect(outcome.result.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).not.toContain(QUESTIONS[0]);
    expect(jobResults).not.toHaveBeenCalled();
  });

  it("a job read that fails leaves the rest of the report standing", async () => {
    const outcome = await world(() => Promise.reject(new Error("down")))(
      actorA,
      ownPlan(actorA, actorA.userId),
    );
    expect(outcome.result).toMatchObject({ ok: true, data: { items: [] } });
    expect(JSON.stringify(outcome.result)).not.toContain('"jobs"');
  });
});
