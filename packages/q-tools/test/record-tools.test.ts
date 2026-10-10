import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createApprovePendingProposalTool,
  createDeclinePendingProposalTool,
  createOpenPageTool,
  createOwnRecordTools,
  createQToolExecutor,
  createQToolRegistry,
  matchCounterpart,
  nameSimilarity,
  type ConversationProposal,
  type OwnRecordsPort,
  type PendingProposalPort,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R33 backlog: the record forms as Prepare → Approve, reads of the
 * person's own records, opening a record's page, and approving or
 * declining an inbox item. Whose record is always code's to resolve.
 */

function ownPlan(
  actor = actorA,
  companyIds: readonly string[] = [COMPANY_A],
): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ...companyIds.map((companyId) => ({
      kind: "COMPANY_PROFILE" as const,
      sensitivity: "CONFIDENTIAL" as const,
      companyId,
    })),
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

const dataOf = (outcome: { result: unknown }) =>
  (outcome.result as { data: Record<string, unknown> }).data;

describe("reading their own records", () => {
  const seen: Parameters<OwnRecordsPort["read"]>[1][] = [];
  const records: OwnRecordsPort = {
    read: (_actor, query) => {
      seen.push(query);
      return Promise.resolve(
        query.record === "VERIFICATION_STATUS" ? { state: "UNVERIFIED" } : null,
      );
    },
    reassessReadiness: () => Promise.resolve({ state: "NOT_READY" }),
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createOwnRecordTools({ ...fakePorts(), ownRecords: records }),
    ),
  });

  it("reads the screen's record for their own company, and says NONE when there is none", async () => {
    const found = await executor.execute(
      call("read_my_record", { record: "VERIFICATION_STATUS" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(found)).toEqual({
      status: "FOUND",
      data: { state: "UNVERIFIED" },
    });
    expect(seen[0]).toMatchObject({
      subjectType: "COMPANY",
      subjectId: COMPANY_A,
    });
    const none = await executor.execute(
      call("read_my_record", { record: "COMPANY_TEAM" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(none)).toEqual({ status: "NONE", data: null });
  });

  it("answers 'why can't investors see my pitch?' from the readiness facts: every outstanding requirement reaches Q (live 2026-10-02)", async () => {
    const assessment = {
      state: "not_ready",
      requirements: [
        {
          requirement: "MINIMUM_COMPANY_PROFILE",
          outcome: "OUTSTANDING",
          description:
            "Your company profile is missing something investors need first: a description, a stage or where you are based.",
        },
        {
          requirement: "FOUNDER_IDENTITY_VERIFIED",
          outcome: "OUTSTANDING",
          description: "A founder's identity has not been verified yet.",
        },
      ],
    };
    const readiness = createQToolExecutor({
      registry: createQToolRegistry(
        createOwnRecordTools({
          ...fakePorts(),
          ownRecords: {
            ...records,
            reassessReadiness: () => Promise.resolve(assessment),
          },
        }),
      ),
    });
    const outcome = await readiness.execute(
      call("reassess_marketplace_readiness", {}),
      contextFor(actorA, {
        ...ownPlan(),
        purpose: { ...ownPlan().purpose, taskClass: "OWN_COMPANY_QUESTION" },
      }),
    );
    expect(dataOf(outcome)).toEqual({ status: "FOUND", data: assessment });
    const tool = createOwnRecordTools({
      ...fakePorts(),
      ownRecords: records,
    }).find(
      (definition) =>
        definition.providerName === "reassess_marketplace_readiness",
    );
    // The tool tells Q what the facts mean: feeds need readiness, not a pitch.
    expect(tool?.description).toMatch(/feeds/);
  });

  it("is refused with no own company in the plan", async () => {
    const outcome = await executor.execute(
      call("read_my_record", { record: "MARKETPLACE_READINESS" }),
      contextFor(actorB, ownPlan(actorB, [COMPANY_A])),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("opening a record's page", () => {
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createOpenPageTool(fakePorts())]),
  });

  it("carries the page for a company in their tenant", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY", id: COMPANY_A }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({ kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY_A });
  });

  it("opens a network-visible company in another tenant, by id or by name (R0, Zino live 2026-10-06)", async () => {
    for (const args of [
      { page: "COMPANY", id: COMPANY_B_NETWORK },
      { page: "COMPANY", name: "Beacon Analytics" },
    ]) {
      const outcome = await executor.execute(
        call("open_page", args),
        contextFor(actorA, ownPlan()),
      );
      expect(
        QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
      ).toEqual({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: COMPANY_B_NETWORK,
      });
    }
  });

  it("never opens another tenant's private company, even by its id", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY", id: COMPANY_B_PRIVATE }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("refuses a name in place of an id", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY", id: "Alpha Robotics" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("opening one of their documents by its title (follow-55, Zino live 2026-10-04)", () => {
  const QUESTIONS = "8e4b6f4b-bd88-4ab1-8a4f-3d4e5f607182";
  const DECK = "9f5c7a5c-ce99-4bc2-9b5a-4e5f60718293";
  const DRAFT = "a06d8b6d-dfaa-4cd3-8c6b-5f6071829304";
  const listed: { actor: string; limit: number }[] = [];
  const documents = {
    list: (actor: { userId: string }, limit: number) => {
      listed.push({ actor: actor.userId, limit });
      return Promise.resolve([
        {
          artifactId: QUESTIONS,
          type: "Q_REPORT",
          status: "READY",
          title: "Questions for Priya Khandelwal",
          currentVersion: 1,
          updatedAt: "2026-10-03T10:00:00.000Z",
        },
        {
          artifactId: DECK,
          type: "PITCH_DECK",
          status: "READY",
          title: "Nixo pitch deck",
          currentVersion: 2,
          updatedAt: "2026-10-02T10:00:00.000Z",
        },
        {
          artifactId: DRAFT,
          type: "INVESTMENT_BRIEF",
          status: "PREPARING",
          title: "Brief on Clinicrest",
          currentVersion: 0,
          updatedAt: "2026-10-04T08:00:00.000Z",
        },
      ]);
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createOpenPageTool({ ...fakePorts(), documents }),
    ]),
  });

  it("'open the questions for…' opens that document in the viewer, by its cut-short title", async () => {
    for (const said of [
      "the questions for",
      "questions for Priya",
      "Questions for Priya Khandelwal",
    ]) {
      const outcome = await executor.execute(
        call("open_page", { page: "DOCUMENT", name: said }),
        contextFor(actorA, ownPlan()),
      );
      expect(
        QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
      ).toEqual({ kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: QUESTIONS });
    }
    // Their own list, read as them.
    expect(listed.every((entry) => entry.actor === actorA.userId)).toBe(true);
  });

  it("opens one of their own ready documents by id", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "DOCUMENT", id: DECK }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({ kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: DECK });
  });

  it("never opens a document that is not on their list, or not ready", async () => {
    for (const args of [
      { page: "DOCUMENT", id: COMPANY_A },
      { page: "DOCUMENT", id: DRAFT },
      { page: "DOCUMENT", name: "brief on clinicrest" },
      { page: "DOCUMENT", name: "board minutes" },
    ]) {
      const outcome = await executor.execute(
        call("open_page", args),
        contextFor(actorA, ownPlan()),
      );
      expect(outcome.status).not.toBe("SUCCEEDED");
    }
  });

  it("without the documents port nothing opens as a document", async () => {
    const bare = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(fakePorts())]),
    });
    const outcome = await bare.execute(
      call("open_page", { page: "DOCUMENT", id: DECK }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});

describe("opening a chat by a spoken name (founder report 2026-09-30)", () => {
  const YAMFIELD = "5b1f3c1e-8a55-4d8e-9d1c-0a1b2c3d4e5f";
  const KOLA = "6c2f4d2f-9b66-4e9f-8e2d-1b2c3d4e5f60";
  const FUND = "7d3a5e3a-ac77-4fa0-9f3e-2c3d4e5f6071";
  const opened: string[] = [];
  const counterpart = (
    kind: "COMPANY" | "INVESTOR_ORGANISATION",
    id: string,
    name: string,
  ) => ({
    relationshipId: id,
    counterpart: { kind, id, name },
    state: "CONNECTED" as const,
    stateSince: "2026-09-20T10:00:00.000Z",
    nextStep: "SCHEDULE_MEETING" as const,
    milestones: [],
  });
  const relationships: RelationshipIntelligencePort = {
    ownRelationships: (actor) =>
      Promise.resolve(
        actor.userId === actorA.userId
          ? {
              side: "INVESTOR" as const,
              items: [
                counterpart("COMPANY", YAMFIELD, "Yamfield Agro"),
                counterpart("COMPANY", KOLA, "Kola Logistics"),
                counterpart("INVESTOR_ORGANISATION", FUND, "Agro Fund"),
              ],
            }
          : null,
      ),
    withCompany: (_actor, companyId) => {
      opened.push(companyId);
      return Promise.resolve(
        companyId === YAMFIELD || companyId === KOLA ? ({} as never) : null,
      );
    },
    withInvestor: () => Promise.resolve(null),
    byRelationship: () => Promise.resolve(null),
    incomingInterest: () => Promise.resolve([]),
    mayExpressInterest: () => Promise.resolve(false),
    mayAnswerInterest: () => Promise.resolve(false),
    prepareForApproval: () => "PREPARED",
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createOpenPageTool({ ...fakePorts(), relationships }),
    ]),
  });

  it("a misheard name opens the chat with their own counterpart, straight away", async () => {
    for (const heard of ["young field agro", "yamfield", "Yam Field Agro"]) {
      const outcome = await executor.execute(
        call("open_page", {
          page: "RELATIONSHIP_COMPANY_MESSAGES",
          name: heard,
        }),
        contextFor(actorA, ownPlan()),
      );
      expect(
        QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
      ).toEqual({
        kind: "OPEN_RECORD_PAGE",
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        id: YAMFIELD,
      });
    }
  });

  it("'show me Yamfield's pitch' opens that company in Your companies; a company not theirs never does (follow-55)", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "COMPANY_PITCH", name: "yamfield" }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_PITCH",
      id: YAMFIELD,
    });
    const stranger = await executor.execute(
      call("open_page", { page: "COMPANY_PITCH", id: COMPANY_A }),
      contextFor(actorA, ownPlan()),
    );
    expect(stranger.status).not.toBe("SUCCEEDED");
  });

  it("an investor organisation is never matched for a company page", () => {
    expect(
      matchCounterpart("agro fund", [
        { id: YAMFIELD, name: "Yamfield Agro" },
        { id: KOLA, name: "Kola Logistics" },
      ]),
    ).toBeNull();
  });

  it("a name nothing of theirs resembles opens nothing", async () => {
    const outcome = await executor.execute(
      call("open_page", {
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        name: "Tesla",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("someone else's relationships are never searched", async () => {
    const outcome = await executor.execute(
      call("open_page", {
        page: "RELATIONSHIP_COMPANY_MESSAGES",
        name: "Yamfield Agro",
      }),
      contextFor(actorB, ownPlan(actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("an investor's own page opens by name from what they can see", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "INVESTOR", name: "agro fun" }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({ kind: "OPEN_RECORD_PAGE", page: "INVESTOR", id: FUND });
  });

  it("an investor nobody showed them does not open by id", async () => {
    const outcome = await executor.execute(
      call("open_page", {
        page: "INVESTOR",
        id: "8e4b6f4b-bd88-40b1-8a4f-3d4e5f607182",
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("neither an id nor a name opens nothing", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "RELATIONSHIP_COMPANY" }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });

  it("a rehearsal opens by the short name people say (REHEARSE audit)", async () => {
    // Live 2026-10-01: "rehearse my meeting with Tidewater" did not find
    // "Tidewater Growth Partners (fictional)".
    expect(
      matchCounterpart("Tidewater", [
        { id: FUND, name: "Tidewater Growth Partners (fictional)" },
        { id: KOLA, name: "Zino Aviation" },
      ]),
    ).toBe(FUND);
    const outcome = await executor.execute(
      call("open_page", { page: "INVESTOR_REHEARSAL", name: "Agro" }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "INVESTOR_REHEARSAL",
      id: FUND,
    });
  });

  it("two names too close to tell apart are ambiguous", () => {
    expect(
      matchCounterpart("agro", [
        { id: YAMFIELD, name: "Agro One" },
        { id: KOLA, name: "Agro Two" },
      ]),
    ).toBeNull();
    expect(nameSimilarity("Yamfield Agro", "yamfield agro")).toBe(1);
  });
});

describe("approving and declining an inbox item (lead decision 2026-09-27)", () => {
  function world(
    item: {
      -readonly [K in keyof ConversationProposal]: ConversationProposal[K];
    } & {
      owner: string;
    },
  ) {
    const decided: string[] = [];
    const port: PendingProposalPort = {
      inConversation: () => Promise.resolve([]),
      approve: (_context, proposalId) => {
        decided.push(`approve:${proposalId}`);
        item.status = "SAVED";
        return Promise.resolve({ status: "SAVED" });
      },
      decline: (_context, proposalId) => {
        decided.push(`decline:${proposalId}`);
        item.status = "DECLINED";
        return Promise.resolve({ status: "DECLINED" });
      },
      inboxItem: (context, approvalId) =>
        Promise.resolve(
          approvalId === "ap-1" && context.actor.userId === item.owner
            ? { ...item }
            : null,
        ),
    };
    const decline = port.decline;
    if (decline === undefined) throw new Error("composed above");
    const executor = createQToolExecutor({
      registry: createQToolRegistry([
        createApprovePendingProposalTool(port),
        createDeclinePendingProposalTool(port, decline),
      ]),
    });
    return { executor, decided };
  }

  it("approves the listed item once, by its approval id", async () => {
    const { executor, decided } = world({
      owner: actorA.userId,
      proposalId: "p-7",
      summary: "Update your raise",
      status: "PENDING",
    });
    const first = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(first)["outcome"]).toBe("SAVED");
    const again = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(again)["outcome"]).toBe("ALREADY_DECIDED");
    expect(decided).toEqual(["approve:p-7"]);
  });

  it("never decides another person's approval, and needs exactly one id", async () => {
    const { executor, decided } = world({
      owner: actorB.userId,
      proposalId: "p-8",
      summary: "x",
      status: "PENDING",
    });
    const theirs = await executor.execute(
      call("decline_pending_proposal", { approvalId: "ap-1" }),
      contextFor(actorA, ownPlan()),
    );
    expect(dataOf(theirs)["outcome"]).toBe("NOT_FOUND");
    const both = await executor.execute(
      call("approve_pending_proposal", { approvalId: "ap-1", proposalId: "p" }),
      contextFor(actorA, ownPlan()),
    );
    expect(both.status).not.toBe("SUCCEEDED");
    expect(decided).toEqual([]);
  });
});

describe("rehearsing with a researched external person (W4)", () => {
  const OWN = "00000000-0000-4000-8000-0000000e0001";
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createOpenPageTool({
        ...fakePorts(),
        externalRehearsal: {
          canRehearse: (_actor, id) => Promise.resolve(id === OWN),
        },
      }),
    ]),
  });

  it("opens the rehearsal for an entity the asker may rehearse with", async () => {
    const outcome = await executor.execute(
      call("open_page", { page: "EXTERNAL_REHEARSAL", id: OWN }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      QClientActionToolResultSchema.parse(dataOf(outcome)).clientAction,
    ).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "EXTERNAL_REHEARSAL",
      id: OWN,
    });
  });

  it("never opens one by a name, a stranger's id, or when the port is absent", async () => {
    for (const args of [
      { page: "EXTERNAL_REHEARSAL", name: "Shadi Qishta" },
      {
        page: "EXTERNAL_REHEARSAL",
        id: "00000000-0000-4000-8000-0000000e0999",
      },
      { page: "EXTERNAL_REHEARSAL", id: "not-an-id" },
    ]) {
      const outcome = await executor.execute(
        call("open_page", args),
        contextFor(actorA, ownPlan()),
      );
      expect(outcome.status).not.toBe("SUCCEEDED");
    }
    const bare = createQToolExecutor({
      registry: createQToolRegistry([createOpenPageTool(fakePorts())]),
    });
    const outcome = await bare.execute(
      call("open_page", { page: "EXTERNAL_REHEARSAL", id: OWN }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});
