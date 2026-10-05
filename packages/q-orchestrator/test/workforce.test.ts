import { describe, expect, it } from "vitest";

import type { DraftReviewResult } from "@capital-q/q-core";

import {
  AGENT_REGISTRY,
  boundPlan,
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

describe("the agent registry", () => {
  it("gives the writer and the reviewer no tools of their own", () => {
    expect(AGENT_REGISTRY.WRITER.tools).toEqual([]);
    expect(AGENT_REGISTRY.REVIEWER.tools).toEqual([]);
    expect(AGENT_REGISTRY.MANDATE_WATCHER.tools).toContain(
      "relationship.interest.express",
    );
  });
});

describe("boundPlan", () => {
  const permitted = new Set([
    "search_companies",
    "relationship.interest.express",
    "chat.message.send",
  ]);

  it("keeps only tools the role has and the person allowed", () => {
    const bound = boundPlan(
      [
        {
          key: "watch",
          role: "MANDATE_WATCHER",
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
          role: "SCHEDULER",
          agentName: null,
          goal: "book calls",
          tools: ["schedule.meeting.book"],
          dependsOn: ["watch"],
        },
      ],
      { permitted, budgetUsd: 1 },
    );
    expect(bound.steps.map((step) => step.key)).toEqual(["watch"]);
    expect(bound.steps[0]?.tools).toEqual([
      "search_companies",
      "relationship.interest.express",
    ]);
    expect(bound.refused).toEqual([
      { key: "book", reason: "NO_PERMITTED_TOOL" },
    ]);
  });

  it("spawns an ad-hoc agent with only permitted tools, and refuses one with none", () => {
    const bound = boundPlan(
      [
        {
          key: "nudge",
          role: "AD_HOC",
          agentName: "Thank-you writer",
          goal: "thank the founders who replied",
          tools: ["chat.message.send", "run_sql"],
          dependsOn: [],
        },
        {
          key: "wider",
          role: "AD_HOC",
          agentName: "Booker",
          goal: "book",
          tools: ["schedule.meeting.book"],
          dependsOn: [],
        },
      ],
      { permitted, budgetUsd: 1 },
    );
    expect(bound.steps).toHaveLength(1);
    expect(bound.steps[0]).toMatchObject({
      agentName: "Thank-you writer",
      tools: ["chat.message.send"],
      spawned: true,
      outward: true,
    });
    expect(bound.refused).toEqual([
      { key: "wider", reason: "NO_PERMITTED_TOOL" },
    ]);
  });

  it("refuses steps past the job's budget, the lead as a step and unknown roles", () => {
    const bound = boundPlan(
      [
        {
          key: "a",
          role: "RESEARCH",
          agentName: null,
          goal: "g",
          tools: ["search_companies"],
          dependsOn: [],
        },
        {
          key: "b",
          role: "RESEARCH",
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
      ],
      { permitted, budgetUsd: 0.15 },
    );
    expect(bound.steps.map((step) => step.key)).toEqual(["a"]);
    expect(bound.refused.map((one) => one.reason)).toEqual([
      "OVER_BUDGET",
      "LEAD_IS_NOT_A_STEP",
      "UNKNOWN_ROLE",
    ]);
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
    expect(feedbacks).toEqual(["Open warmly; no meeting ask yet."]);
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
          role: "MANDATE_WATCHER",
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
          role: "AD_HOC",
          agentName: "Thanker",
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
        MANDATE_WATCHER: () =>
          Promise.resolve({ status: "HELD", summary: "nothing new" }),
        CONVERSATION: (step) => {
          conversation.push(step.agentName);
          return Promise.resolve({ status: "DONE", summary: "replied" });
        },
      },
    });
    expect(result.steps.map((step) => step.status)).toEqual([
      "HELD",
      "SKIPPED",
      "DONE",
    ]);
    // The spawned agent ran on the conversation executor, as itself.
    expect(conversation).toEqual(["Thanker"]);
    expect(runs[0]).toMatchObject({ role: "LEAD", spawnedBy: null });
    expect(runs.slice(1).every((run) => run.spawnedBy === "run-1")).toBe(true);
    expect(handoffs).toContain("run-2->run-3");
  });
});
