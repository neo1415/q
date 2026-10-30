import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { JobPlanResultV9Input } from "@capital-q/q-core";
import {
  createToolTeamJobPort,
  priorAnswerOf,
  teamJobLine,
} from "@capital-q/q-specialists";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";
import {
  createQJobTools,
  PROPOSE_Q_JOB,
  type QJobPriorAnswer,
} from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import { createWorkforceJobBoard } from "../src/composition/workforce/job-actions.js";
import {
  createWorkforceJobs,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import type { PlanVariables } from "../src/composition/workforce/models.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Live 2026-10-28 (run 8b649d10): a founder asked for their gaps, Q listed
 * them, and "can you make it into a plan and then go ahead and execute that
 * plan for me" was planned from those words alone -- the lead planned no
 * step and Q said it couldn't make a plan. Q's own earlier answer now goes
 * beside the goal (Q_INFERENCE), the lead sees it, an empty plan is asked
 * for once more, and still empty Q asks which item comes first. No model or
 * provider is called: the planner is a fake that records what it is given.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

const GAPS_ANSWER = [
  "Here are the three gaps investors will see first:",
  "1. **No audited financials** for 2025",
  "2. No named customer references",
  "3. The cap table is not in your data room",
  "Want me to help close them?",
].join("\n");

const ASKED = "Can you make that into a plan and then go ahead and execute it";

const EMPTY: JobPlanResultV9Input = {
  summary: "Nothing to plan.",
  outcome: "Nothing.",
  steps: [],
  cannot: [],
  prerequisites: [],
  nextActions: [],
};

const RESEARCHED: JobPlanResultV9Input = {
  ...EMPTY,
  summary: "Research what investors expect for each gap.",
  outcome: "A plan to close your three gaps.",
  steps: [
    {
      key: "research",
      role: "RESEARCH",
      goal: "Learn what investors expect for audited financials, references and a cap table",
      tools: ["public_web.search"],
      dependsOn: [],
      why: "It tells you what closes each gap.",
      evidence: [],
      fallbackFor: null,
    },
  ],
};

function world(answers: readonly JobPlanResultV9Input[]) {
  const store = createInMemoryWorkforceStore();
  const seen: PlanVariables[] = [];
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Tolu Ade"),
    mandateMatches: () => Promise.resolve([]),
    expressInterest: () => Promise.resolve({ ok: false }),
    openConversations: () => Promise.resolve([]),
    writeReply: () => Promise.resolve(null),
    send: () => Promise.resolve(false),
    freeSlots: () => Promise.resolve([]),
    book: () => Promise.resolve({ ok: false, meetingId: null }),
    notify: () => Promise.resolve(),
    research: (() => Promise.resolve(null)) as unknown as NonNullable<
      WorkforcePorts["research"]
    >,
  };
  const jobsFor = () =>
    createWorkforceJobs({
      store,
      models: {
        plan: (_who, _trace, variables) => {
          seen.push(variables);
          const answer = answers[Math.min(seen.length, answers.length) - 1];
          return Promise.resolve(answer ?? null);
        },
        readReply: () => Promise.resolve(null),
      },
      review: createOutwardReview({
        store,
        models: {
          review: () => Promise.resolve(null),
          redraft: () => Promise.resolve(null),
        },
      }),
      ports,
    });
  // Room for a research step (the default job budget is smaller).
  const board = createWorkforceJobBoard({ jobsFor, budgetUsd: 5 });
  const [tool] = createQJobTools(board.port);
  if (tool === undefined) throw new Error("no tool");
  // The tool as the run's tool port runs it: its own input schema first.
  const tools: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: async (call) => {
      expect(call.name).toBe("propose_q_job");
      const input = tool.input.parse(call.arguments);
      const data = await tool.execute(
        input,
        {
          actor,
          runId: "run-plan-from-answer",
        } as unknown as Parameters<typeof tool.execute>[1],
        null,
      );
      return {
        status: "SUCCEEDED",
        failureCode: null,
        result: { ok: true, data },
      } as unknown as Awaited<ReturnType<QToolPort["execute"]>>;
    },
  };
  return { seen, board, tool, port: createToolTeamJobPort({ tools }) };
}

const request = {
  actor,
  runId: "run-plan-from-answer",
  correlationId: "cor_test",
  capability: "ANSWER",
  plan: { scopes: [] },
} as unknown as QAnswerRequest;

const history = [
  { role: "USER", content: "What are my gaps?" },
  { role: "Q", content: GAPS_ANSWER },
  { role: "USER", content: ASKED },
];

describe("a plan made from Q's own earlier answer (run 8b649d10)", () => {
  it("reads Q's last answer and its three listed gaps, in order", () => {
    const prior = priorAnswerOf(history);
    expect(prior?.items).toEqual([
      "No audited financials for 2025",
      "No named customer references",
      "The cap table is not in your data room",
    ]);
    expect(prior?.text).toContain("Want me to help close them?");
    // Not Q's turn before this one: nothing to refer to.
    expect(priorAnswerOf([{ role: "USER", content: ASKED }])).toBeNull();
  });

  it("the tool carries the answer as Q_INFERENCE only, beside the goal", () => {
    const { tool } = world([RESEARCHED]);
    expect(tool.id).toBe(PROPOSE_Q_JOB);
    expect(() =>
      tool.input.parse({
        goal: ASKED,
        priorAnswer: { truthClass: "VERIFIED", text: "x", items: [] },
      }),
    ).toThrow();
  });

  it("the planner receives the goal in the person's words and the three gaps beside it", async () => {
    const { seen, port } = world([RESEARCHED]);
    const prior = priorAnswerOf(history);
    if (prior === null) throw new Error("no prior answer");
    const outcome = await port.propose(request, ASKED, { priorAnswer: prior });
    expect(outcome.status).toBe("PREPARED");
    expect(seen).toHaveLength(1);
    const variables = seen[0];
    expect(variables?.goal).toBe(ASKED);
    expect(variables?.goal).not.toContain("audited");
    for (const gap of [
      "No audited financials",
      "No named customer references",
      "The cap table is not in your data room",
    ]) {
      expect(variables?.priorAnswer).toContain(gap);
    }
    // Q's inference never becomes a fact of the situation.
    expect(variables?.situation).not.toContain("audited");
  });

  it("an empty plan is asked for once more, then Q asks which gap comes first", async () => {
    const { seen, port } = world([EMPTY, EMPTY]);
    const prior = priorAnswerOf(history);
    if (prior === null) throw new Error("no prior answer");
    const outcome = await port.propose(request, ASKED, { priorAnswer: prior });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.priorAnswer).toContain("No audited financials");
    expect(seen[1]?.allowed).toMatch(/YOUR LAST PLAN HAD NO STEPS/u);
    expect(outcome).toEqual({ status: "NOT_PLANNED", choices: prior.items });
    const line = teamJobLine(outcome, "FOUNDER");
    expect(line).toBe(
      "Tell me which of these you want done first: 1) No audited financials for 2025; 2) No named customer references; 3) The cap table is not in your data room. Nothing has started yet; once you pick, I'll plan it and get going.",
    );
    expect(line).not.toMatch(/couldn't turn that into a plan/u);
  });

  it("the retry's second plan is offered when it has steps", async () => {
    const { seen, port } = world([EMPTY, RESEARCHED]);
    const prior = priorAnswerOf(history);
    if (prior === null) throw new Error("no prior answer");
    const outcome = await port.propose(request, ASKED, { priorAnswer: prior });
    expect(seen).toHaveLength(2);
    expect(outcome.status).toBe("PREPARED");
  });

  // Live 2026-10-29 (sweep I16): a clear research request, no earlier
  // answer, came back with no steps and was never asked again.
  it("without an earlier answer an empty plan is asked again once, saying so", async () => {
    const { seen, port } = world([EMPTY, RESEARCHED]);
    const outcome = await port.propose(
      request,
      "Investigate the Nigerian B2B payments sector and give me an evidence-backed report",
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]?.priorAnswer).toBeUndefined();
    expect(seen[1]?.priorAnswer).toBeUndefined();
    expect(seen[1]?.allowed).toMatch(
      /YOUR LAST PLAN HAD NO STEPS\. The job is work the person asked you to carry out/u,
    );
    expect(outcome.status).toBe("PREPARED");
  });

  it("without an earlier answer, still empty after the retry is not planned", async () => {
    const { seen, port } = world([EMPTY, EMPTY]);
    const outcome = await port.propose(request, "Do the thing");
    expect(seen).toHaveLength(2);
    expect(outcome).toEqual({ status: "NOT_PLANNED" });
  });

  it("the tool passes the earlier answer to the board port unchanged", async () => {
    const received: (QJobPriorAnswer | undefined)[] = [];
    const [tool] = createQJobTools({
      prepare: (_actor, _runId, _goal, options) => {
        received.push(options?.priorAnswer);
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    });
    if (tool === undefined) throw new Error("no tool");
    const priorAnswer = {
      truthClass: "Q_INFERENCE" as const,
      text: GAPS_ANSWER,
      items: ["No audited financials"],
    };
    await tool.execute(
      tool.input.parse({ goal: ASKED, priorAnswer }),
      { actor, runId: "run-x" } as unknown as Parameters<
        typeof tool.execute
      >[1],
      null,
    );
    expect(received).toEqual([priorAnswer]);
  });
});
