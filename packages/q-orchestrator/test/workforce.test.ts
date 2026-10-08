import { describe, expect, it } from "vitest";

import type { DraftReviewResult } from "@capital-q/q-core";

import { QAgentExecutorSchema } from "@capital-q/contracts";

import {
  ALL_EXECUTORS,
  UNREGISTERED_ROLE_REASONS,
  boundPlan,
  executorRosterText,
  planIsValid,
  registeredExecutors,
  gradeOf,
  runJob,
  writeWithReview,
  type JobRecorder,
} from "../src/index.js";

function review(
  score: number,
  options: { readonly failRule?: string; readonly feedback?: string } = {},
): DraftReviewResult {
  return {
    criteria: (
      [
        "WARM_OPENING",
        "ASK_TIMING",
        "ANSWERS_THEM",
        "CONCISE_AND_CALM",
        "READS_SIGNALS",
        "PERSONAL_STYLE",
      ] as const
    ).map((criterion) => ({ criterion, score, note: "" })),
    integrity: (
      [
        "GROUNDED",
        "NO_COMMITMENTS",
        "NOTHING_PRIVATE",
        "HONEST_IDENTITY",
      ] as const
    ).map((rule) => ({ rule, ok: rule !== options.failRule, note: "" })),
    feedback: options.feedback ?? "",
  };
}

describe("the executor registry (recovery D1)", () => {
  it("declares every executor against the lead contract, and no writer or reviewer role", () => {
    for (const executor of ALL_EXECUTORS) {
      expect(QAgentExecutorSchema.safeParse(executor).success).toBe(true);
    }
    const roles = Object.keys(registeredExecutors({ research: true }));
    expect(roles).toEqual([
      "CONVERSATION",
      "OUTREACH",
      "SCHEDULING",
      "DISCOVERY",
      "RESEARCH",
    ]);
    // Documents and diligence have no executor, and say why.
    expect(UNREGISTERED_ROLE_REASONS.DOCUMENTS).toMatch(/document/u);
    expect(UNREGISTERED_ROLE_REASONS.DILIGENCE).toBeDefined();
  });

  it("registers research only where a research provider is composed", () => {
    expect(registeredExecutors({ research: false }).RESEARCH).toBeUndefined();
    const roster = executorRosterText(
      registeredExecutors({ research: false }),
      new Set(["chat.message.send"]),
    );
    expect(roster).not.toMatch(/WRITER|REVIEWER|AD_HOC|RESEARCH|DOCUMENTS/u);
    expect(roster).toMatch(/CONVERSATION/u);
  });
});

describe("boundPlan", () => {
  const permitted = new Set([
    "search_companies",
    "list_my_relationships",
    "relationship.interest.express",
    "chat.message.send",
  ]);

  it("keeps only tools the executor has and the person allowed", () => {
    const bound = boundPlan(
      [
        {
          key: "watch",
          role: "DISCOVERY",
          agentName: null,
          goal: "find matches",
          tools: [
            "search_companies",
            "relationship.interest.express",
            "chat.message.send",
          ],
          dependsOn: [],
        },
        {
          key: "book",
          role: "SCHEDULING",
          agentName: null,
          goal: "book calls",
          tools: ["schedule.meeting.book"],
          dependsOn: ["watch"],
        },
      ],
      { permitted, budgetUsd: 1 },
    );
    expect(bound.steps.map((step) => step.key)).toEqual(["watch"]);
    expect(bound.steps[0]).toMatchObject({
      role: "MANDATE_WATCHER",
      executor: "DISCOVERY",
      tools: ["search_companies"],
      outward: false,
    });
    expect(bound.refused).toEqual([
      { key: "book", reason: "NO_PERMITTED_TOOL" },
    ]);
    expect(planIsValid(bound)).toBe(false);
  });

  it("refuses WRITER and REVIEWER steps (the audit's repro), so the plan is never offered", () => {
    // capital-q-audit/evidence/agents/repro-writer-step.md: this plan was
    // approved, the WRITER step HELD and the reply SKIPPED.
    const bound = boundPlan(
      [
        {
          key: "draft",
          role: "WRITER",
          agentName: null,
          goal: "Draft the reply",
          tools: [],
          dependsOn: [],
        },
        {
          key: "grade",
          role: "REVIEWER",
          agentName: null,
          goal: "Grade it",
          tools: [],
          dependsOn: ["draft"],
        },
        {
          key: "reply",
          role: "CONVERSATION",
          agentName: null,
          goal: "Send the reply",
          tools: ["list_messages", "chat.message.send"],
          dependsOn: ["grade"],
        },
      ],
      {
        permitted: new Set(["list_messages", "chat.message.send"]),
        budgetUsd: 0.4,
      },
    );
    expect(bound.refused).toEqual([
      { key: "draft", reason: "NO_EXECUTOR" },
      { key: "grade", reason: "NO_EXECUTOR" },
      { key: "reply", reason: "WAITS_ON_MISSING_STEP" },
    ]);
    expect(planIsValid(bound)).toBe(false);
  });

  it("accepts the same job planned the honest way: one conversation step", () => {
    const bound = boundPlan(
      [
        {
          key: "reply",
          role: "CONVERSATION",
          agentName: null,
          goal: "Reply to Zino",
          tools: ["list_messages", "chat.message.send"],
          dependsOn: [],
        },
      ],
      {
        permitted: new Set(["list_messages", "chat.message.send"]),
        budgetUsd: 0.4,
      },
    );
    expect(planIsValid(bound)).toBe(true);
    expect(bound.steps[0]).toMatchObject({
      executor: "CONVERSATION",
      outward: true,
      spawned: false,
    });
  });

  it("refuses ad-hoc agents, roles without an executor here, the lead, unknown roles and steps past the budget", () => {
    const bound = boundPlan(
      [
        {
          key: "a",
          role: "DISCOVERY",
          agentName: null,
          goal: "g",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "b",
          role: "DISCOVERY",
          agentName: null,
          goal: "g",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "c",
          role: "LEAD",
          agentName: null,
          goal: "g",
          tools: [],
          dependsOn: [],
        },
        {
          key: "d",
          role: "HACKER",
          agentName: null,
          goal: "g",
          tools: [],
          dependsOn: [],
        },
        {
          key: "e",
          role: "AD_HOC",
          agentName: "Thanker",
          goal: "g",
          tools: ["chat.message.send"],
          dependsOn: [],
        },
        {
          key: "f",
          role: "DOCUMENTS",
          agentName: null,
          goal: "g",
          tools: [],
          dependsOn: [],
        },
        {
          key: "g",
          role: "RESEARCH",
          agentName: null,
          goal: "g",
          tools: ["public_web.search"],
          dependsOn: [],
        },
      ],
      {
        permitted: new Set([...permitted, "public_web.search"]),
        budgetUsd: 0.05,
      },
    );
    expect(bound.steps.map((step) => step.key)).toEqual(["a"]);
    expect(bound.refused.map((one) => one.reason)).toEqual([
      "OVER_BUDGET",
      "LEAD_IS_NOT_A_STEP",
      "UNKNOWN_ROLE",
      "NO_EXECUTOR",
      "NO_EXECUTOR",
      // No research provider composed in the default registry.
      "NO_EXECUTOR",
    ]);
  });

  it("plans research when the deployment registers it", () => {
    const bound = boundPlan(
      [
        {
          key: "look",
          role: "RESEARCH",
          agentName: null,
          goal: "five investors",
          tools: ["public_web.search"],
          dependsOn: [],
        },
      ],
      {
        permitted: new Set(["public_web.search"]),
        budgetUsd: 1,
        executors: registeredExecutors({ research: true }),
      },
    );
    expect(planIsValid(bound)).toBe(true);
    expect(bound.steps[0]).toMatchObject({
      role: "RESEARCH",
      executor: "RESEARCH",
      outward: false,
    });
  });
});

describe("gradeOf", () => {
  it("weights the rubric to 100 and never averages away an integrity failure", () => {
    expect(gradeOf(review(5), 75)).toMatchObject({ score: 100, passed: true });
    expect(gradeOf(review(3), 75)).toMatchObject({ score: 60, passed: false });
    const failed = gradeOf(review(5, { failRule: "GROUNDED" }), 75);
    expect(failed).toMatchObject({ score: 100, passed: false });
    expect(failed.failedIntegrity).toEqual(["GROUNDED"]);
  });

  it("counts an ungraded criterion as nothing and an unchecked rule as failed", () => {
    const grade = gradeOf({ criteria: [], integrity: [], feedback: "" }, 75);
    expect(grade.score).toBe(0);
    expect(grade.failedIntegrity).toHaveLength(4);
  });
});

describe("writeWithReview", () => {
  it("passes a good first draft without a redraft", async () => {
    const outcome = await writeWithReview("Hello Ada", {
      review: () => Promise.resolve(review(5)),
      redraft: () => Promise.reject(new Error("not called")),
    });
    expect(outcome).toMatchObject({
      verdict: "PASSED",
      body: "Hello Ada",
      attempts: 1,
    });
  });

  it("sends a low draft back to the writer with the feedback and passes the redraft", async () => {
    const feedbacks: string[] = [];
    const handoffs: string[] = [];
    const outcome = await writeWithReview(
      "Book a call now.",
      {
        review: (body) =>
          Promise.resolve(
            body.startsWith("Hi")
              ? review(5)
              : review(2, { feedback: "Open warmly; no meeting ask yet." }),
          ),
        redraft: (_body, feedback) => {
          feedbacks.push(feedback);
          return Promise.resolve("Hi Ada, I enjoyed reading about Tallyloom.");
        },
        onHandoff: (handoff) => {
          handoffs.push(`${handoff.from}->${handoff.to}`);
          return Promise.resolve();
        },
      },
      { threshold: 75, maxRedrafts: 2 },
    );
    expect(outcome.verdict).toBe("PASSED");
    expect(outcome.body).toBe("Hi Ada, I enjoyed reading about Tallyloom.");
    expect(outcome.attempts).toBe(2);
    // The writer gets the reviewer's words as a numbered fix list.
    expect(feedbacks).toEqual(["1. Open warmly; no meeting ask yet."]);
    expect(handoffs).toEqual(["REVIEWER->WRITER", "WRITER->REVIEWER"]);
  });

  it("holds the draft after the most redrafts, and on integrity", async () => {
    const low = await writeWithReview(
      "x",
      {
        review: () => Promise.resolve(review(2)),
        redraft: () => Promise.resolve("y"),
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(low).toMatchObject({
      verdict: "HELD",
      reason: "BELOW_BAR",
      attempts: 2,
    });
    const integrity = await writeWithReview(
      "x",
      {
        review: () =>
          Promise.resolve(review(5, { failRule: "NO_COMMITMENTS" })),
        redraft: () => Promise.resolve("y"),
      },
      { threshold: 75, maxRedrafts: 0 },
    );
    expect(integrity).toMatchObject({ verdict: "HELD", reason: "INTEGRITY" });
  });

  it("holds when the reviewer cannot be reached, and when code's own check fails a redraft", async () => {
    const unavailable = await writeWithReview("x", {
      review: () => Promise.resolve(null),
      redraft: () => Promise.resolve("y"),
    });
    expect(unavailable).toMatchObject({
      verdict: "HELD",
      reason: "REVIEW_UNAVAILABLE",
    });
    const checked = await writeWithReview("x", {
      review: () => Promise.resolve(review(1)),
      redraft: () => Promise.resolve("Let's meet Tuesday?"),
      recheck: () => "MEETING_BEFORE_RAPPORT",
    });
    expect(checked).toMatchObject({ verdict: "HELD", reason: "CODE_CHECK" });
  });
});

describe("runJob", () => {
  function recorder() {
    const runs: {
      id: string;
      role: string;
      spawnedBy: string | null;
      status?: string;
    }[] = [];
    const handoffs: string[] = [];
    const port: JobRecorder = {
      startRun: (input) => {
        const id = `run-${String(runs.length + 1)}`;
        runs.push({ id, role: input.role, spawnedBy: input.spawnedByRunId });
        return Promise.resolve(id);
      },
      endRun: (runId, status) => {
        const run = runs.find((one) => one.id === runId);
        if (run !== undefined) run.status = status;
        return Promise.resolve();
      },
      handoff: (input) => {
        handoffs.push(`${input.fromRunId}->${input.toRunId}`);
        return Promise.resolve();
      },
    };
    return { runs, handoffs, port };
  }

  it("runs steps in order, records hand-offs and skips a step whose dependency did not finish", async () => {
    const { runs, handoffs, port } = recorder();
    const bound = boundPlan(
      [
        {
          key: "watch",
          role: "DISCOVERY",
          agentName: null,
          goal: "g",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "reply",
          role: "CONVERSATION",
          agentName: null,
          goal: "g",
          tools: ["chat.message.send"],
          dependsOn: ["watch"],
        },
        {
          key: "thank",
          role: "CONVERSATION",
          agentName: null,
          goal: "g",
          tools: ["chat.message.send"],
          dependsOn: [],
        },
      ],
      {
        permitted: new Set(["search_companies", "chat.message.send"]),
        budgetUsd: 1,
      },
    );
    const conversation: string[] = [];
    const result = await runJob({
      jobId: "job-1",
      goal: "the job",
      steps: bound.steps,
      recorder: port,
      executors: {
        DISCOVERY: () =>
          Promise.resolve({ status: "HELD", summary: "nothing new" }),
        CONVERSATION: (step) => {
          conversation.push(step.key);
          return Promise.resolve({ status: "DONE", summary: "replied" });
        },
      },
    });
    expect(result.steps.map((step) => step.status)).toEqual([
      "HELD",
      "SKIPPED",
      "DONE",
    ]);
    expect(conversation).toEqual(["thank"]);
    expect(runs[0]).toMatchObject({ role: "LEAD", spawnedBy: null });
    expect(runs.slice(1).every((run) => run.spawnedBy === "run-1")).toBe(true);
    expect(handoffs).toContain("run-2->run-3");
  });

  it("resumes after a restart: a finished step is never redone, an interrupted one runs again (D3)", async () => {
    const { runs, port } = recorder();
    const bound = boundPlan(
      [
        {
          key: "watch",
          role: "DISCOVERY",
          agentName: null,
          goal: "g",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "reply",
          role: "CONVERSATION",
          agentName: null,
          goal: "g",
          tools: ["chat.message.send"],
          dependsOn: ["watch"],
        },
      ],
      {
        permitted: new Set(["search_companies", "chat.message.send"]),
        budgetUsd: 1,
      },
    );
    const ran: string[] = [];
    const result = await runJob({
      jobId: "job-1",
      goal: "the job",
      steps: bound.steps,
      recorder: {
        ...port,
        // "watch" finished before the restart; "reply" was interrupted.
        prior: (_job, key) =>
          Promise.resolve(
            key === "watch"
              ? {
                  runId: "old-watch",
                  status: "DONE" as const,
                  summary: "3 found",
                }
              : null,
          ),
      },
      executors: {
        DISCOVERY: () => {
          ran.push("watch");
          return Promise.resolve({ status: "DONE", summary: "again" });
        },
        CONVERSATION: () => {
          ran.push("reply");
          return Promise.resolve({ status: "DONE", summary: "replied" });
        },
      },
    });
    expect(ran).toEqual(["reply"]);
    expect(result.steps).toMatchObject([
      { key: "watch", runId: "old-watch", status: "DONE", summary: "3 found" },
      { key: "reply", status: "DONE" },
    ]);
    // Lead plus the one re-run step: no second run for the finished step.
    expect(runs).toHaveLength(2);
  });

  it("holds a step whose executor is missing, with the reason, instead of faking it", async () => {
    const { port } = recorder();
    const result = await runJob({
      jobId: "job-1",
      goal: "g",
      steps: [
        {
          key: "old",
          role: "WRITER",
          executor: null,
          agentName: "Writer",
          goal: "g",
          tools: [],
          dependsOn: [],
          budgetUsd: 0.1,
          outward: false,
          spawned: false,
        },
      ],
      recorder: port,
      executors: {},
    });
    expect(result.steps[0]).toMatchObject({ status: "HELD" });
  });
});
