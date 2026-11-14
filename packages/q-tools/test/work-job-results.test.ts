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
  return (
    actor: ActorContext,
    plan: PermittedContextPlan,
    args: Record<string, unknown> = {},
  ) =>
    executor.execute(
      { callId: "c-1", name: "list_q_work", arguments: args },
      contextFor(actor, plan),
    );
}

describe("list_q_work v4: every finding and question is reachable (decision 97)", () => {
  const many: QWorkJobResult = {
    ...JOB,
    review:
      JOB.review === null
        ? null
        : {
            ...JOB.review,
            findings: Array.from({ length: 11 }, (_, i) => ({
              kind: "UNSUPPORTED",
              section: `Section ${String(i + 1)}`,
              problem: `Problem ${String(i + 1)}`,
            })),
          },
    diligence: {
      questions: Array.from(
        { length: 7 },
        (_, i) => `Question ${String(i + 1)}?`,
      ),
      filedForApproval: true,
    },
  };

  it("says how many there are and pages through them by jobId and from", async () => {
    const read = world(() => Promise.resolve([many]));
    const plan = ownPlan(actorA, actorA.userId);
    const first = await read(actorA, plan);
    expect(first.result).toMatchObject({
      ok: true,
      data: {
        jobsTotal: 1,
        jobs: [
          {
            truncated: true,
            nextFrom: 5,
            review: { findingsTotal: 11 },
            diligence: { questionsTotal: 7 },
          },
        ],
      },
    });
    const seenFindings = new Set<string>();
    const seenQuestions = new Set<string>();
    let from: number | null = 0;
    for (let page = 0; from !== null && page < 10; page += 1) {
      const outcome = await read(actorA, plan, { jobId: many.jobId, from });
      const data = (
        outcome.result as {
          data: {
            jobs: {
              nextFrom: number | null;
              review: { findings: { section: string }[] };
              diligence: { questions: string[] };
            }[];
          };
        }
      ).data;
      const job = data.jobs[0];
      for (const f of job?.review.findings ?? []) seenFindings.add(f.section);
      for (const q of job?.diligence.questions ?? []) seenQuestions.add(q);
      from = job?.nextFrom ?? null;
    }
    // v3 showed 8 findings and 5 questions with no sign of the rest.
    expect(seenFindings.size).toBe(11);
    expect(seenQuestions.size).toBe(7);
  });
});

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

  it("says where a job's plan stands (live5 g: ready, not 'still running')", async () => {
    const plan = {
      state: "READY_FOR_THEIR_DECISION",
      goal: "Complete a first-pass diligence review of Ledgerline",
      done: 0,
      total: 5,
    };
    const outcome = await world(() =>
      Promise.resolve([{ ...JOB, state: plan.state, plan }]),
    )(actorA, ownPlan(actorA, actorA.userId));
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { jobs: [{ state: "READY_FOR_THEIR_DECISION", plan }] },
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
