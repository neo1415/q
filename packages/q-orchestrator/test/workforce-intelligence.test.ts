import { describe, expect, it } from "vitest";

import type { RelationshipBrief } from "@capital-q/contracts";

import {
  boundPlan,
  executorRosterText,
  groundReasoning,
  needsApproval,
  nextSteps,
  planProgress,
  registeredExecutors,
  runJob,
  situationFrom,
  situationText,
  type AgentExecutor,
  type BoundStep,
  type JobRecorder,
  type StepResult,
} from "../src/index.js";

/**
 * Workforce intelligence (wf 2026-10-16): code invariants around the lead's
 * reasoning. The situation is written by code and unknown stays unknown;
 * the model's references are grounded; approval is code's decision; a
 * fallback runs only when its step did not finish, inside the approved
 * plan; nothing outward goes on top of a contradiction.
 */

const AT = "2026-10-10T09:00:00.000Z";

function brief(overrides: Partial<RelationshipBrief> = {}): RelationshipBrief {
  return {
    relationshipId: "00000000-0000-4000-8000-000000000001",
    yourSide: "INVESTOR",
    counterparty: {
      kind: "COMPANY",
      id: "00000000-0000-4000-8000-000000000002",
      name: "Harbourline Cargo",
    },
    generatedAt: AT,
    state: {
      state: "MEETING_HELD",
      stateSince: AT,
      milestones: [],
      nextStep: "DECIDE_NEXT_STEP",
    },
    messages: {
      count: 4,
      latest: { status: "OK", message: null, fromThem: null },
    },
    noShows: [],
    meetings: { status: "OK", items: [], nextScheduled: null },
    pendingDecisions: {
      items: [{ kind: "DECIDE_NEXT_STEP", owner: "YOU", since: AT }],
      complete: true,
    },
    obligations: {
      status: "OK",
      openRequests: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          title: "Unit economics by lane",
        },
      ],
      answeredCount: 0,
    },
    documents: { status: "OK", items: [] },
    sourceVersions: {
      projector: "relationship-state.v2",
      historySequence: 7,
      brief: "relationship-brief.v1",
    },
    ...overrides,
  };
}

function recorder(): JobRecorder & {
  readonly ended: Map<string, { status: string; summary: string }>;
} {
  let next = 0;
  const ended = new Map<string, { status: string; summary: string }>();
  return {
    ended,
    startRun: (input) => {
      next += 1;
      return Promise.resolve(input.stepKey ?? `lead-${String(next)}`);
    },
    endRun: (runId, status, summary) => {
      ended.set(runId, { status, summary });
      return Promise.resolve();
    },
    handoff: () => Promise.resolve(),
  };
}

function step(key: string, overrides: Partial<BoundStep> = {}): BoundStep {
  return {
    key,
    role: "RESEARCH",
    executor: "RESEARCH",
    agentName: key,
    goal: `Do ${key}`,
    tools: ["public_web.search"],
    dependsOn: [],
    budgetUsd: 0.01,
    outward: false,
    spawned: false,
    ...overrides,
  };
}

describe("the situation the lead reads", () => {
  it("is code's facts from the brief, and a source that could not be read is unknown, never none", () => {
    const situation = situationFrom({
      briefs: [
        brief({
          meetings: { status: "UNAVAILABLE", reason: "READ_FAILED" },
          messages: {
            count: 4,
            latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
          },
        }),
      ],
      waiting: [{ summary: "Q's team: a memo on Harbourline Cargo" }],
    });
    expect(situation.facts.map((fact) => fact.ref)).toEqual(
      situation.facts.map((_, index) => `F${String(index + 1)}`),
    );
    const texts = situation.facts.map((fact) => `${fact.kind} ${fact.text}`);
    expect(texts).toContain(
      "UNKNOWN Messages with Harbourline Cargo: not known right now.",
    );
    expect(texts).toContain(
      "UNKNOWN Calls with Harbourline Cargo: not known right now.",
    );
    expect(texts.some((text) => /no (calls|messages)/iu.test(text))).toBe(
      false,
    );
    expect(texts).toContain(
      "OPEN_REQUEST Open diligence request with Harbourline Cargo: Unit economics by lane.",
    );
    expect(situation.moves).toEqual([
      expect.objectContaining({ owner: "YOU", kind: "DECIDE_NEXT_STEP" }),
    ]);
    expect(texts.at(-1)).toMatch(/^WAITING_APPROVAL /u);
  });

  it("says a relationship list it could not read is unknown", () => {
    const situation = situationFrom({ briefs: [], overview: null });
    expect(situation.facts).toEqual([
      expect.objectContaining({ kind: "UNKNOWN" }),
    ]);
  });
});

describe("grounding the lead's reasoning", () => {
  const situation = situationFrom({ briefs: [brief()] });

  it("drops invented references, never lets MET stand without a fact, and binds only real steps", () => {
    const grounded = groundReasoning(
      {
        outcome: "Ready for diligence on Harbourline Cargo.",
        prerequisites: [
          {
            what: "Unit economics by lane",
            status: "MISSING",
            blocking: true,
            evidence: ["F3", "F19"],
            resolvedBy: "questions",
          },
          {
            what: "The founder's data room is complete",
            status: "MET",
            blocking: false,
            evidence: ["F42"],
            resolvedBy: "nowhere",
          },
        ],
        nextActions: [
          {
            action: "Book the diligence call",
            why: "The meeting was held.",
            evidence: ["F1", "F9"],
            tool: "schedule.meeting.book",
          },
          {
            action: "Read the latest thread",
            why: "Know where things stand.",
            evidence: [],
            tool: "list_messages",
          },
        ],
      },
      situation,
      [{ key: "questions", evidence: [] }],
    );
    expect(grounded.droppedRefs).toBe(3);
    const [missing, claimed] = grounded.reasoning.prerequisites;
    expect(missing?.evidence).toEqual(["F3"]);
    expect(missing?.resolvedBy).toBe("questions");
    expect(claimed?.status).toBe("UNKNOWN");
    expect(claimed?.resolvedBy).toBeNull();
    const [book, read, move] = grounded.reasoning.nextActions;
    expect(book?.needsApproval).toBe(true);
    expect(read?.needsApproval).toBe(false);
    // Their own move the plan did not take up, from code, with its fact.
    expect(move).toMatchObject({ source: "SITUATION", tool: null });
    expect(move?.evidence).toHaveLength(1);
  });

  it("decides approval from the tool's class, never the model", () => {
    expect(needsApproval("chat.message.send")).toBe(true);
    expect(needsApproval("diligence.questions.prepare")).toBe(true);
    expect(needsApproval("search_companies")).toBe(false);
    expect(needsApproval(null)).toBe(false);
  });
});

describe("fallback steps (replanning inside the approval)", () => {
  const executors = registeredExecutors({ research: true });
  const permitted = new Set(["public_web.search", "search_companies"]);
  const proposed = (fallbackFor?: string, dependsOn: string[] = []) => ({
    key: `alt_${String(dependsOn.length)}`,
    role: "DISCOVERY",
    agentName: null,
    goal: "Shortlist from the catalog instead",
    tools: ["search_companies"],
    dependsOn,
    ...(fallbackFor === undefined ? {} : { fallbackFor }),
  });
  const research = {
    key: "research",
    role: "RESEARCH",
    agentName: null,
    goal: "Research the sector",
    tools: ["public_web.search"],
    dependsOn: [],
  };

  it("keeps a fallback for an earlier step, and refuses one that waits on it, a second one, or a step that waits on a fallback", () => {
    const ok = boundPlan([research, proposed("research")], {
      permitted,
      budgetUsd: 1,
      executors,
    });
    expect(ok.refused).toEqual([]);
    expect(ok.steps[1]?.fallbackFor).toBe("research");
    for (const plan of [
      [research, proposed("research", ["research"])],
      [research, proposed("missing")],
      [
        research,
        proposed("research"),
        { ...proposed("research"), key: "alt_two" },
      ],
      [
        research,
        proposed("research"),
        { ...proposed(), key: "reads", dependsOn: ["alt_0"] },
      ],
    ]) {
      const bound = boundPlan(plan, { permitted, budgetUsd: 1, executors });
      expect(bound.refused.map((one) => one.reason)).toContain(
        "INVALID_FALLBACK",
      );
    }
  });

  it("runs a fallback only when its step did not finish, and what waited on the step reads the fallback's result", async () => {
    const seen: string[] = [];
    const run = async (failResearch: boolean) => {
      const rec = recorder();
      const exec: AgentExecutor = (one, context) => {
        seen.push(one.key);
        if (one.key === "research" && failResearch) {
          return Promise.resolve({
            status: "FAILED",
            summary: "Nothing found.",
          });
        }
        if (one.key === "memo") {
          const input = context.results.get("research");
          return Promise.resolve({
            status: "DONE",
            summary: `Memo from ${String(input?.outputs?.["from"])}.`,
          });
        }
        return Promise.resolve({
          status: "DONE",
          summary: "Done.",
          outputs: { from: one.key },
        } satisfies StepResult);
      };
      const result = await runJob({
        jobId: "job",
        goal: "Prepare",
        steps: [
          step("research"),
          step("catalog", {
            fallbackFor: "research",
            role: "MANDATE_WATCHER",
            executor: "DISCOVERY",
          }),
          step("memo", { dependsOn: ["research"] }),
        ],
        executors: { RESEARCH: exec, DISCOVERY: exec },
        recorder: rec,
      });
      return { result, rec };
    };

    const failed = await run(true);
    const memo = failed.result.steps.find((one) => one.key === "memo");
    expect(memo).toMatchObject({
      status: "DONE",
      summary: "Memo from catalog.",
    });
    expect(
      failed.result.steps.find((one) => one.key === "research")?.counts,
    ).toBe(false);
    // The research failed, the fallback stood in: the job is done.
    expect([...failed.rec.ended.values()].at(-1)).toEqual({
      status: "DONE",
      summary: "2 of 2 steps done.",
    });

    seen.length = 0;
    const fine = await run(false);
    expect(seen).not.toContain("catalog");
    expect(
      fine.result.steps.find((one) => one.key === "catalog"),
    ).toMatchObject({
      status: "SKIPPED",
      counts: false,
    });
    expect([...fine.rec.ended.values()].at(-1)?.status).toBe("DONE");
  });

  it("still runs independent steps side by side", async () => {
    let running = 0;
    let peak = 0;
    const exec: AgentExecutor = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { status: "DONE", summary: "Done." };
    };
    await runJob({
      jobId: "job",
      goal: "Prepare",
      steps: [step("a"), step("b"), step("c", { dependsOn: ["a", "b"] })],
      executors: { RESEARCH: exec },
      recorder: recorder(),
    });
    expect(peak).toBe(2);
  });
});

describe("a contradiction found mid-task", () => {
  it("holds an outward step downstream of it, and lets unrelated outward work go", async () => {
    const sent: string[] = [];
    const critique: AgentExecutor = () =>
      Promise.resolve({
        status: "DONE",
        summary: "Found a contradiction.",
        outputs: {
          signals: [
            {
              kind: "CONTRADICTION",
              note: "Revenue: the deck says $1.2M ARR, the model says $0.8M.",
              stepKey: "critique",
            },
          ],
        },
      });
    const send: AgentExecutor = (one) => {
      sent.push(one.key);
      return Promise.resolve({ status: "DONE", summary: "Sent." });
    };
    const result = await runJob({
      jobId: "job",
      goal: "Memo, then thank the founder",
      steps: [
        step("critique", { role: "DOCUMENTS", executor: "DOCUMENTS" }),
        step("thanks", {
          role: "CONVERSATION",
          executor: "CONVERSATION",
          outward: true,
          dependsOn: ["critique"],
        }),
        step("other", {
          role: "CONVERSATION",
          executor: "CONVERSATION",
          outward: true,
        }),
      ],
      executors: { DOCUMENTS: critique, CONVERSATION: send },
      recorder: recorder(),
    });
    expect(sent).toEqual(["other"]);
    expect(result.steps.find((one) => one.key === "thanks")).toMatchObject({
      status: "HELD",
    });
    expect(result.steps.find((one) => one.key === "thanks")?.summary).toMatch(
      /contradiction/iu,
    );
  });
});

describe("next steps and progress after the job", () => {
  const steps = [
    {
      key: "memo",
      who: "Documents",
      goal: "Prepare a memo",
      tools: ["documents.own.prepare"],
      dependsOn: [],
      evidence: ["F2"],
    },
    {
      key: "research",
      who: "Research",
      goal: "Research the market",
      tools: ["public_web.search"],
      dependsOn: [],
    },
    {
      key: "alt",
      who: "Discovery",
      goal: "Use the catalog",
      tools: ["search_companies"],
      dependsOn: [],
      fallbackFor: "memo",
    },
  ];

  it("reconciles contradictions, asks for what is missing, retries what failed, and drops moves a finished step took up", () => {
    const situation = situationFrom({ briefs: [brief()] });
    const reasoning = groundReasoning(
      { outcome: "Ready for diligence.", prerequisites: [], nextActions: [] },
      situation,
      [],
    ).reasoning;
    const next = nextSteps({
      reasoning: {
        ...reasoning,
        // The move rests on F2 (pretend), which the memo step took up.
        nextActions: reasoning.nextActions.map((one) => ({
          ...one,
          evidence: ["F2"],
        })),
      },
      steps,
      outcomes: new Map([
        [
          "memo",
          {
            status: "DONE" as const,
            summary: "Prepared.",
            outputs: {
              signals: [
                { kind: "CONTRADICTION", note: "ARR differs", stepKey: "memo" },
                {
                  kind: "MISSING_INFORMATION",
                  note: "Churn is not known",
                  stepKey: "memo",
                },
              ],
            },
          },
        ],
        ["research", { status: "FAILED" as const, summary: "Nothing found." }],
      ]),
    });
    expect(next.map((one) => one.action)).toEqual([
      "Reconcile before relying on it: ARR differs",
      "Ask the founder: Churn is not known",
      "Try again: Research the market",
    ]);
    expect(next.map((one) => one.needsApproval)).toEqual([false, true, false]);
  });

  it("shows a fallback that was not needed, and a step that never ran once the job stopped", () => {
    const progress = planProgress({
      reasoning: undefined,
      steps,
      outcomes: new Map([
        ["memo", { status: "DONE" as const, summary: "Prepared." }],
      ]),
      finished: true,
    });
    expect(progress.steps.map((one) => one.status)).toEqual([
      "DONE",
      "SKIPPED",
      "NOT_NEEDED",
    ]);
    expect({ done: progress.done, total: progress.total }).toEqual({
      done: 1,
      total: 2,
    });
  });
});

describe("a fallback never goes round the person or a contradiction", () => {
  it("does not run when its step is held for the person, and inherits what that step rested on", async () => {
    const ran: string[] = [];
    const exec: AgentExecutor = (one) => {
      ran.push(one.key);
      if (one.key === "check") {
        return Promise.resolve({
          status: "DONE",
          summary: "Found one.",
          outputs: {
            signals: [
              { kind: "CONTRADICTION", note: "ARR differs", stepKey: "check" },
            ],
          },
        });
      }
      if (one.key === "book") {
        return Promise.resolve({ status: "FAILED", summary: "No slot." });
      }
      return Promise.resolve({
        status: "HELD",
        summary: "Below the bar; yours to look at.",
      });
    };
    const outward = {
      role: "CONVERSATION" as const,
      executor: "CONVERSATION" as const,
      outward: true,
    };
    const held = await runJob({
      jobId: "job",
      goal: "Reply",
      steps: [
        step("reply", outward),
        step("alt_reply", { ...outward, fallbackFor: "reply" }),
      ],
      executors: { CONVERSATION: exec },
      recorder: recorder(),
    });
    expect(ran).toEqual(["reply"]);
    expect(held.steps.find((one) => one.key === "alt_reply")).toMatchObject({
      status: "SKIPPED",
      counts: false,
    });

    ran.length = 0;
    const contradicted = await runJob({
      jobId: "job",
      goal: "Check, then book or offer times",
      steps: [
        step("check", { role: "DOCUMENTS", executor: "DOCUMENTS" }),
        step("book", { ...outward, dependsOn: ["check"] }),
        step("offer", { ...outward, fallbackFor: "book" }),
      ],
      executors: { DOCUMENTS: exec, CONVERSATION: exec },
      recorder: recorder(),
    });
    // The booking is held on the contradiction, and so is its fallback.
    expect(ran).toEqual(["check"]);
    for (const key of ["book", "offer"]) {
      const one = contradicted.steps.find((entry) => entry.key === key);
      expect(one?.status).toBe("HELD");
      expect(one?.summary).toMatch(/contradiction/iu);
    }
  });
});

describe("a step must carry the tool its role acts through (production 2026-10-15)", () => {
  it("refuses a CONVERSATION step with only list_messages before approval, and says what each role must include", () => {
    const executors = registeredExecutors({ research: true });
    const permitted = new Set(["list_messages", "chat.message.send"]);
    const bound = boundPlan(
      [
        {
          key: "intro",
          role: "CONVERSATION",
          agentName: null,
          goal: "Prepare an intro; do not send it",
          tools: ["list_messages"],
          dependsOn: [],
        },
      ],
      { permitted, budgetUsd: 1, executors },
    );
    expect(bound.refused).toEqual([
      { key: "intro", reason: "MISSING_REQUIRED_TOOL" },
    ]);
    expect(executorRosterText(executors, permitted)).toContain(
      "A CONVERSATION step must include chat.message.send.",
    );
  });
});

describe("loose references from the live planner (2026-10-15)", () => {
  it("reads the F number out of any shape the model writes, and keeps only facts it was shown", () => {
    const situation = situationFrom({ briefs: [brief()] });
    const grounded = groundReasoning(
      {
        outcome: "Ready for diligence on Harbourline Cargo.",
        prerequisites: [],
        nextActions: [
          {
            action: "Decide the next step",
            why: "Yours to decide.",
            evidence: [
              "F2 [YOUR_MOVE] Your move with Harbourline Cargo",
              "[f1]",
              "F99",
              "the meeting",
            ],
            tool: null,
          },
        ],
      },
      situation,
      [],
    );
    expect(grounded.reasoning.nextActions[0]?.evidence).toEqual(["F2", "F1"]);
    expect(grounded.droppedRefs).toBe(2);
  });
});

describe("MET needs a fact that shows it in place (live 2026-10-16)", () => {
  it("never reads a pending move or a waiting card as MET", () => {
    const situation = situationFrom({
      briefs: [brief()],
      waiting: [{ summary: "Q's team: prepare diligence" }],
    });
    const move = situation.facts.find((fact) => fact.kind === "YOUR_MOVE");
    const waiting = situation.facts.find(
      (fact) => fact.kind === "WAITING_APPROVAL",
    );
    const state = situation.facts.find(
      (fact) => fact.kind === "RELATIONSHIP_STATE",
    );
    const grounded = groundReasoning(
      {
        outcome: "Ready for diligence on Harbourline Cargo.",
        prerequisites: [
          {
            what: "The diligence call has been set up",
            status: "MET",
            blocking: true,
            evidence: [move?.ref ?? "", waiting?.ref ?? ""],
            resolvedBy: null,
          },
          {
            what: "A meeting was held",
            status: "MET",
            blocking: false,
            evidence: [state?.ref ?? ""],
            resolvedBy: null,
          },
        ],
        nextActions: [],
      },
      situation,
      [],
    );
    expect(grounded.reasoning.prerequisites.map((one) => one.status)).toEqual([
      "UNKNOWN",
      "MET",
    ]);
  });
});

describe("the lead reads their declared mandate (live case A, 2026-10-29)", () => {
  it("puts the mandate first, as MANDATE facts", () => {
    const situation = situationFrom({
      briefs: [brief()],
      mandate: [
        "Mandate 'Aster Seed Fintech': seed to Series A; Nigeria, Ghana, Kenya; B2B payments.",
        "Thesis note: back infrastructure that owns a recurring business workflow.",
      ],
    });
    expect(situation.facts.slice(0, 2)).toEqual([
      expect.objectContaining({ ref: "F1", kind: "MANDATE" }),
      expect.objectContaining({ ref: "F2", kind: "MANDATE" }),
    ]);
    expect(situationText(situation)).toContain(
      "F2 [MANDATE] Thesis note: back infrastructure",
    );
  });

  it("an unreadable mandate is unknown; none on record adds nothing", () => {
    expect(situationFrom({ briefs: [], mandate: null }).facts).toEqual([
      expect.objectContaining({
        kind: "UNKNOWN",
        text: "Your declared mandate and thesis: not known right now.",
      }),
    ]);
    expect(situationFrom({ briefs: [], mandate: [] }).facts).toEqual([]);
  });
});
