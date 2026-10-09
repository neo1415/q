import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { WorkforceJobDetailDtoSchema } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { ActorContext } from "@capital-q/security";

import {
  createEtiquetteSource,
  withLearned,
} from "../src/composition/etiquette.js";
import {
  createWorkforceJobs,
  type OpenConversation,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import {
  createWorkforceLearning,
  feedbackFromApprovals,
  learnedNotesFrom,
} from "../src/composition/workforce/learning.js";
import { createWorkforceModels } from "../src/composition/workforce/models.js";
import { createWorkforcePage } from "../src/composition/workforce/page.js";
import {
  createOutwardReview,
  reviewedReply,
} from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * Founder brief J9: "express interest in every company matching my
 * mandate, reply warmly to replies, book calls", carried out by Q's
 * workforce end to end with fakes: the lead Q plans, the plan is bounded
 * by the grant, the mandate watcher expresses interest, the conversation
 * agent reads each reply by meaning, the writer drafts, the reviewer grades
 * (a low draft is redrafted from feedback), the scheduler books, and a no
 * goes to the person. No live provider is called: the gateway is scripted.
 */

const OWNER = { tenantId: randomUUID(), userId: randomUUID() };

type Call = {
  readonly task: string;
  readonly taskClass: string;
  readonly correlationId: string;
  readonly prompt: string;
};

/** A scripted model: answers by the task the rendered prompt names. */
function scriptedGateway(calls: Call[], legacyPlan = false): ModelGateway {
  const gateway = {
    execute: (request: {
      taskClass: string;
      messages: { content: unknown }[];
      attribution: { correlationId: string };
    }) => {
      const prompt = JSON.stringify(request.messages);
      const task = /TASK: ([A-Z_]+)/u.exec(prompt)?.[1] ?? "?";
      calls.push({
        task,
        taskClass: request.taskClass,
        correlationId: request.attribution.correlationId,
        prompt,
      });
      const latest = (marker: string) => prompt.includes(marker);
      let value: unknown;
      switch (task) {
        case "JOB_PLAN":
          value = {
            summary:
              "Express interest in matching companies, reply warmly, book calls.",
            steps: legacyPlan
              ? [
                  // A step no executor here runs (the shape of D-02; a
                  // WRITER step no longer even parses under JOB_PLAN v2).
                  {
                    key: "deck",
                    role: "DOCUMENTS",
                    goal: "Make a one-pager",
                    tools: ["list_my_documents"],
                    dependsOn: [],
                  },
                  {
                    key: "reply",
                    role: "CONVERSATION",
                    goal: "Reply warmly to replies",
                    tools: ["list_messages", "chat.message.send"],
                    dependsOn: ["deck"],
                  },
                ]
              : [
                  {
                    key: "discover",
                    role: "DISCOVERY",
                    goal: "Shortlist every company matching the mandate",
                    tools: ["search_companies"],
                    dependsOn: [],
                  },
                  {
                    key: "reach",
                    role: "OUTREACH",
                    goal: "Express interest in the shortlist",
                    tools: ["relationship.interest.express"],
                    dependsOn: ["discover"],
                  },
                  {
                    key: "reply",
                    role: "CONVERSATION",
                    goal: "Reply warmly to replies",
                    tools: ["list_messages", "chat.message.send"],
                    dependsOn: ["reach"],
                  },
                  {
                    key: "book",
                    role: "SCHEDULING",
                    goal: "Book calls with those who want one",
                    tools: ["find_meeting_times", "schedule.meeting.book"],
                    dependsOn: ["reach"],
                  },
                ],
            cannot: [],
          };
          break;
        case "REPLY_READER":
          value = latest("sit this one out")
            ? {
                stance: "DECLINE",
                tone: "WARM",
                wantsMeeting: false,
                requests: [],
              }
            : latest("find a time for a call")
              ? {
                  stance: "INTERESTED",
                  tone: "WARM",
                  wantsMeeting: true,
                  requests: [],
                }
              : {
                  stance: "INTERESTED",
                  tone: "WARM",
                  wantsMeeting: false,
                  requests: [{ kind: "DOCUMENT", what: "your deck" }],
                };
          break;
        case "DRAFT_REVIEW": {
          const draft = prompt.slice(prompt.lastIndexOf("THE DRAFT"));
          const cold = draft.includes("Dear Sir");
          value = {
            criteria: [
              "WARM_OPENING",
              "ASK_TIMING",
              "ANSWERS_THEM",
              "CONCISE_AND_CALM",
              "READS_SIGNALS",
              "PERSONAL_STYLE",
            ].map((criterion) => ({
              criterion,
              score: cold ? 2 : 5,
              note: "",
            })),
            integrity: [
              "GROUNDED",
              "NO_COMMITMENTS",
              "NOTHING_PRIVATE",
              "HONEST_IDENTITY",
            ].map((rule) => ({ rule, ok: true, note: "" })),
            feedback: cold ? "Greet Ada by name and thank her warmly." : "",
          };
          break;
        }
        case "DRAFT_REDRAFT":
          value = {
            body: "Hi Ada, thank you for coming back to us. I'll share the deck with you today.",
          };
          break;
        default:
          throw new Error(`unscripted task ${task}`);
      }
      return Promise.resolve({
        cost: { currency: "USD", amount: 0.002, basis: "ESTIMATED" },
        output: { kind: "STRUCTURED", value },
      });
    },
  };
  // A test double of the gateway port: only `execute` is exercised.
  return gateway as unknown as ModelGateway;
}

function conversation(
  id: string,
  name: string,
  latest: string,
): OpenConversation {
  return {
    relationshipId: id,
    counterpartName: name,
    thread: `Q: Hello ${name}, Ada's fund is interested in your company.\n${name}: ${latest}`,
    latest: { id: `msg-${id}`, text: latest },
    material: `${name}'s company: seed fintech in Lagos (their Capital Q profile).`,
  };
}

function world() {
  const record = {
    interest: [] as string[],
    sent: [] as { relationshipId: string; body: string }[],
    booked: [] as { relationshipId: string; at: string }[],
    notices: [] as string[],
    metered: [] as string[],
    markers: [] as string[],
    briefs: [] as string[],
    threads: [] as string[],
  };
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Ada"),
    mandateMatches: () =>
      Promise.resolve([
        { companyId: "c-tallyloom", name: "Tallyloom" },
        { companyId: "c-spheros", name: "Spheros" },
      ]),
    expressInterest: (_owner, companyId, key) => {
      record.interest.push(`${companyId}|${key.split(":").at(-1) ?? ""}`);
      return Promise.resolve({ ok: true });
    },
    openConversations: () =>
      Promise.resolve([
        conversation(
          "r-ada",
          "Ada Obi",
          "Thanks for reaching out! Happy to share more.",
        ),
        conversation(
          "r-bola",
          "Bola",
          "Would love to find a time for a call next week.",
        ),
        conversation(
          "r-chidi",
          "Chidi",
          "Thank you, but we'll sit this one out.",
        ),
      ]),
    // The writer's first draft is too cold: the reviewer sends it back.
    writeReply: (_owner, conversation, _intent, _correlation, brief) => {
      record.briefs.push(brief ?? "");
      record.threads.push(conversation.thread);
      return Promise.resolve("Dear Sir, noted.");
    },
    send: (_owner, relationshipId, _key, body, jobId) => {
      record.sent.push({ relationshipId, body });
      record.markers.push(jobId ?? "none");
      return Promise.resolve(true);
    },
    freeSlots: () => Promise.resolve(["2026-10-08T10:00:00.000Z"]),
    book: (_owner, relationshipId, _key, at) => {
      record.booked.push({ relationshipId, at });
      return Promise.resolve({ ok: true, meetingId: randomUUID() });
    },
    notify: (_owner, notice) => {
      record.notices.push(notice.title);
      return Promise.resolve();
    },
  };
  return { ports, record };
}

describe("J9: a job carried out by Q's workforce, end to end", () => {
  it("expresses interest in every match, replies warmly after review, books calls and leaves a no to the person", async () => {
    const calls: Call[] = [];
    const store = createInMemoryWorkforceStore();
    const models = createWorkforceModels({
      gateway: scriptedGateway(calls),
      // The built-in house guide, with no personal guide.
      etiquette: createEtiquetteSource({
        platform: () => Promise.resolve(null),
        personal: () => Promise.resolve(null),
      }),
    });
    const review = createOutwardReview({ models, store });
    const { ports, record } = world();
    const jobs = createWorkforceJobs({
      store,
      models,
      review,
      ports,
      meter: (_owner, key) => {
        record.metered.push(key);
        return Promise.resolve(true);
      },
    });

    const started = await jobs.start(OWNER, {
      goal: "Express interest in every company matching my mandate, reply warmly to replies, book calls.",
      permitted: [
        "search_companies",
        "relationship.interest.express",
        "list_messages",
        "chat.message.send",
        "find_meeting_times",
        "schedule.meeting.book",
      ],
      budgetUsd: 1,
      source: { kind: "INSTRUCTION", id: "instruction-1" },
    });
    if (started.outcome !== "STARTED") throw new Error(started.outcome);

    // The plan, bounded by the registered executors and the grant.
    expect(started.refused).toEqual([]);
    expect(started.steps.map((step) => [step.key, step.status])).toEqual([
      ["discover", "DONE"],
      ["reach", "DONE"],
      ["reply", "DONE"],
      ["book", "DONE"],
    ]);
    expect(record.metered).toEqual([`wf:${started.jobId}`]);

    // Outreach: interest in every shortlisted match, idempotently keyed.
    expect(record.interest).toEqual([
      "c-tallyloom|c-tallyloom",
      "c-spheros|c-spheros",
    ]);
    // Conversation: one warm reply, the redraft that passed, never the cold one.
    expect(record.sent).toEqual([
      {
        relationshipId: "r-ada",
        body: "Hi Ada, thank you for coming back to us. I'll share the deck with you today.",
      },
    ]);
    // Scheduler: the one who asked for a call is booked; nobody else.
    expect(record.booked).toEqual([
      { relationshipId: "r-bola", at: "2026-10-08T10:00:00.000Z" },
    ]);
    // A no, read by meaning, is the person's: no reply, a notice.
    expect(record.notices).toEqual(["Chidi may have said no"]);
    // D-07: the job's message is marked as Q's; D-09: the writer is given
    // the step's goal as its brief, never an empty one.
    expect(record.markers).toEqual([started.jobId]);
    expect(record.briefs).toEqual(["Reply warmly to replies"]);
    // Founder 2026-10-09: the writer reads the thread it answers,
    // their latest message included, before it drafts.
    expect(record.threads[0]).toContain(
      "Ada Obi: Thanks for reaching out! Happy to share more.",
    );

    // Every model call is priced to its job and agent (J6), and the
    // reader is a fast classification.
    const runIds = new Set(store.rows.runs.map((run) => run.id));
    for (const call of calls) {
      const match = /^cor_job_([0-9a-f-]{36})_([0-9a-f-]{36})$/u.exec(
        call.correlationId,
      );
      expect(match?.[1]).toBe(started.jobId);
      expect(runIds.has(match?.[2] ?? "")).toBe(true);
    }
    expect(
      calls
        .filter((call) => call.task === "REPLY_READER")
        .map((call) => call.taskClass),
    ).toEqual([
      "FAST_CLASSIFICATION",
      "FAST_CLASSIFICATION",
      "FAST_CLASSIFICATION",
    ]);
    // The reviewer graded against the house guide (ADR 0050 in the prompt).
    const reviewPrompt =
      calls.find((call) => call.task === "DRAFT_REVIEW")?.prompt ?? "";
    expect(reviewPrompt).toContain("BUSINESS ETIQUETTE");

    // The workforce page: agents, hand-offs, both drafts with scores, costs.
    const page = createWorkforcePage({
      store,
      costs: (_owner, jobIds) =>
        Promise.resolve(
          calls.flatMap((call) => {
            const match = /^cor_job_([0-9a-f-]{36})_([0-9a-f-]{36})$/u.exec(
              call.correlationId,
            );
            return match !== null && jobIds.includes(match[1] ?? "")
              ? [{ jobId: match[1] ?? "", runId: match[2] ?? "", usd: "0.002" }]
              : [];
          }),
        ),
    });
    const detail = await page.detail(OWNER, started.jobId);
    if (detail === null) throw new Error("no detail");
    expect(() => WorkforceJobDetailDtoSchema.parse(detail)).not.toThrow();
    expect(new Set(detail.agents.map((agent) => agent.role))).toEqual(
      new Set([
        "LEAD",
        "MANDATE_WATCHER",
        "OUTREACH",
        "CONVERSATION",
        "SCHEDULER",
        "WRITER",
        "REVIEWER",
      ]),
    );
    expect(detail.agents.every((agent) => agent.status !== "RUNNING")).toBe(
      true,
    );
    expect(
      detail.drafts.map((draft) => [
        draft.attempt,
        draft.grade?.score,
        draft.grade?.passed,
      ]),
    ).toEqual([
      [1, 40, false],
      [2, 100, true],
    ]);
    expect(detail.drafts[1]?.outcome?.outcome).toBe("SENT");
    expect(detail.drafts[0]?.grade).toMatchObject({
      threshold: 75,
      maxRedrafts: 1,
    });
    expect(
      detail.timeline.some(
        (entry) =>
          entry.kind === "HANDOFF" &&
          entry.text.startsWith("Reviewer to Writer"),
      ),
    ).toBe(true);
    expect(Number(detail.job.costUsd)).toBeGreaterThan(0);
    expect(detail.job.status).toBe("DONE");

    // The person's own list shows the job; another person sees nothing.
    expect(
      (await page.list(OWNER, { limit: 20 })).items.map((job) => job.id),
    ).toEqual([started.jobId]);
    const stranger = { tenantId: OWNER.tenantId, userId: randomUUID() };
    expect(await page.detail(stranger, started.jobId)).toBeNull();
    expect((await page.list(stranger, { limit: 20 })).items).toEqual([]);
  });

  it("refuses the audit's WRITER plan whole: nothing runs, nothing is sent, and the job says why (D-02)", async () => {
    const calls: Call[] = [];
    const store = createInMemoryWorkforceStore();
    const models = createWorkforceModels({
      gateway: scriptedGateway(calls, true),
    });
    const { ports, record } = world();
    const jobs = createWorkforceJobs({
      store,
      models,
      review: createOutwardReview({ models, store }),
      ports,
    });
    const result = await jobs.start(OWNER, {
      goal: "Reply to Zino.",
      permitted: ["list_messages", "chat.message.send"],
      budgetUsd: 1,
      source: { kind: "JOB", id: "job-writer" },
    });
    expect(result.outcome).toBe("NOT_PLANNED");
    expect(record.sent).toEqual([]);
    expect(calls.map((call) => call.task)).toEqual(["JOB_PLAN"]);
    // The plan prompt never offered WRITER or REVIEWER as roles.
    const roster = calls[0]?.prompt ?? "";
    expect(roster).not.toMatch(/- WRITER|- REVIEWER|- AD_HOC/u);
    expect(roster).toContain("- CONVERSATION");
    const lead = store.rows.runs.find((run) => run.role === "LEAD");
    expect(lead?.status).toBe("HELD");
    expect(lead?.summary).toContain("no agent here can do");
  });

  it("holds the job when the plan's agent jobs are used up, and plans nothing", async () => {
    const calls: Call[] = [];
    const store = createInMemoryWorkforceStore();
    const models = createWorkforceModels({ gateway: scriptedGateway(calls) });
    const { ports } = world();
    const jobs = createWorkforceJobs({
      store,
      models,
      review: createOutwardReview({ models, store }),
      ports,
      meter: () => Promise.resolve(false),
    });
    const result = await jobs.start(OWNER, {
      goal: "Book calls.",
      permitted: ["schedule.meeting.book"],
      budgetUsd: 1,
      source: { kind: "JOB", id: "job-limit" },
    });
    expect(result.outcome).toBe("PLAN_LIMIT");
    expect(calls).toEqual([]);
  });
});

describe("the reviewer on a path's own reply, and learning from approvals", () => {
  it("holds a reply that never passes and tells the person why", async () => {
    const store = createInMemoryWorkforceStore();
    const review = createOutwardReview({
      store,
      models: {
        review: () =>
          Promise.resolve({
            criteria: [],
            integrity: [],
            feedback: "Invents a valuation.",
          }),
        redraft: () => Promise.resolve("Still invents it."),
      },
    });
    const result = await reviewedReply(
      review,
      OWNER,
      { kind: "ERRAND", id: "errand-9", goal: "Look after Ada" },
      {
        principalName: "Bola",
        counterpartName: "Ada",
        channel: "CHAT",
        stage: "REPLY",
        purpose: "Answer from the brief.",
        material: "We raise a seed round.",
        thread: "Ada: What valuation?",
      },
      { reply: "We're at a $20m valuation.", forPerson: [] },
    );
    expect(result?.reply).toBeNull();
    expect(result?.forPerson[0]).toContain("Q held a message to Ada");
    expect(store.rows.outcomes.map((one) => [one.outcome, one.reason])).toEqual(
      [["HELD", "INTEGRITY"]],
    );
    // Two rounds at most (Zino, 2026-10-08), each graded and kept.
    expect(store.rows.drafts.map((draft) => draft.attempt)).toEqual([1, 2]);
  });

  it("turns an edit on an offered draft into a what-worked preference through the Write Gate", async () => {
    const store = createInMemoryWorkforceStore();
    const review = createOutwardReview({
      store,
      models: {
        review: () =>
          Promise.resolve({
            criteria: (
              [
                "WARM_OPENING",
                "ASK_TIMING",
                "ANSWERS_THEM",
                "CONCISE_AND_CALM",
                "READS_SIGNALS",
                "PERSONAL_STYLE",
              ] as const
            ).map((criterion) => ({ criterion, score: 4, note: "" })),
            integrity: (
              [
                "GROUNDED",
                "NO_COMMITMENTS",
                "NOTHING_PRIVATE",
                "HONEST_IDENTITY",
              ] as const
            ).map((rule) => ({ rule, ok: true, note: "" })),
            feedback: "",
          }),
        redraft: () => Promise.resolve(null),
      },
    });
    const verdict = await review.review(
      OWNER,
      { kind: "INSTRUCTION", id: "instruction-2", goal: "Say hello" },
      {
        principalName: "Bola",
        counterpartName: "Ada",
        channel: "CHAT",
        stage: "FIRST",
        purpose: "A first hello.",
        material: "",
        thread: "",
        body: "Hello Ada, I enjoyed reading about Tallyloom.",
      },
    );
    expect(verdict.verdict).toBe("PASSED");
    const qActionId = randomUUID();
    await review.settle(OWNER, verdict, "OFFERED", qActionId);

    const remembered: {
      writeMode: string;
      quote: string | null;
      turns: readonly string[];
      key: string;
    }[] = [];
    const learning = createWorkforceLearning({
      store,
      memory: {
        remember: (command) => {
          remembered.push({
            writeMode: command.writeMode,
            quote: command.candidate.quote,
            turns: command.userTurns,
            key: command.candidate.memoryKey,
          });
          return Promise.resolve({
            outcome: "REMEMBERED",
            reason: "RECORDED",
            item: { id: randomUUID() },
          } as never);
        },
      },
    });
    const actor = {
      tenantId: OWNER.tenantId,
      userId: OWNER.userId,
    } as ActorContext;
    const onDecision = feedbackFromApprovals({ store, learning });
    await onDecision(actor, {
      qActionId,
      kind: "EDITED",
      editedBody: "Ada, lovely to meet you. Your Lagos rollout is impressive.",
    });
    // A replayed decision learns nothing twice.
    await onDecision(actor, {
      qActionId,
      kind: "EDITED",
      editedBody: "Ada, lovely to meet you. Your Lagos rollout is impressive.",
    });
    expect(store.rows.feedback.map((one) => one.kind)).toEqual(["EDITED"]);
    expect(remembered[0]).toMatchObject({
      writeMode: "USER_CONFIRMED",
      quote: "Ada, lovely to meet you. Your Lagos rollout is impressive.",
      turns: ["Ada, lovely to meet you. Your Lagos rollout is impressive."],
    });
    expect(remembered[0]?.key.startsWith("workforce.what_worked.")).toBe(true);

    // The note reaches the writer and reviewer beside the person's guide.
    const notes = learnedNotesFrom([
      {
        memoryType: "preference",
        memoryKey: remembered[0]?.key ?? "",
        content: "They rewrote it warmer.",
      },
      {
        memoryType: "fact",
        memoryKey: "workforce.what_worked.x",
        content: "never a fact",
      },
    ]);
    expect(notes).toEqual(["They rewrote it warmer."]);
    const personal = withLearned(
      { version: "personal/v2", text: "Sign off: Warmly, B." },
      notes,
    );
    expect(personal?.version).toBe("personal/v2+learned/n1");
    expect(personal?.text).toContain("Sign off: Warmly, B.");
    expect(personal?.text).toContain("They rewrote it warmer.");
  });
});
