import { describe, expect, it } from "vitest";

import type { InterestService } from "@capital-q/network";
import {
  createQActionPort,
  type QActionProposer,
  type QActionService,
} from "@capital-q/q-actions";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  chainProposers,
  createRelationshipActionBoard,
  createRelationshipIntelligencePort,
} from "../src/composition/relationship-intelligence.js";

/**
 * From a relationship tool to the Approval Engine (CQ-Q-030). Proven here:
 * what a tool prepares becomes a proposal awaiting the person's approval,
 * for the person and tenant the tool ran for and nobody else, in the
 * approved action's exact payload shape -- and no Network command runs.
 * The command runs only when an approved action executes (the
 * relationship.interest.* action tests).
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000030";
const COMPANY = "a0000000-0000-4000-8000-000000000001";

const INVESTOR: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

const context = (actor: ActorContext = INVESTOR, runId = RUN) =>
  ({
    actor,
    runId,
    correlationId: "cor_00000000-0000-4000-8000-000000000001",
    plan: {},
    subjects: [],
  }) as never;

function harness() {
  const commands: string[] = [];
  const interests = {
    expressInterest: () => {
      commands.push("expressInterest");
      return Promise.reject(new Error("must not run before approval"));
    },
    respondToInterest: () => {
      commands.push("respondToInterest");
      return Promise.reject(new Error("must not run before approval"));
    },
  } as Partial<InterestService> as InterestService;
  const proposals: { actionType: string; payload: unknown }[] = [];
  const service = {
    propose: (command: { actionType: string; payload: unknown }) => {
      proposals.push({
        actionType: command.actionType,
        payload: command.payload,
      });
      return Promise.resolve({
        action: { id: "11111111-1111-4111-8111-111111111111" },
        approval: { id: "22222222-2222-4222-8222-222222222222" },
      });
    },
    executeApproved: () => {
      commands.push("executeApproved");
      return Promise.resolve({ kind: "EXECUTED" });
    },
  } as unknown as QActionService;
  const board = createRelationshipActionBoard();
  const port = createRelationshipIntelligencePort({ interests, board });
  let later = 0;
  const profileBoard: QActionProposer = {
    propose: () => {
      later += 1;
      return Promise.resolve(null);
    },
  };
  const actions = createQActionPort({
    service,
    proposer: chainProposers(board.proposer, profileBoard),
  });
  return {
    commands,
    proposals,
    port,
    actions,
    laterAsked: () => later,
  };
}

const express = {
  runId: RUN,
  tenantId: TENANT,
  actorUserId: USER,
  actionType: "relationship.interest.express" as const,
  payload: { companyId: COMPANY, companyName: "Kora" },
};

describe("relationship actions reach the person only as an approval", () => {
  it("a prepared action becomes a proposal awaiting approval, and no command runs", async () => {
    const h = harness();
    expect(h.port.prepareForApproval(express)).toBe("PREPARED");
    const outcome = await h.actions.prepare(context());
    expect(outcome).toEqual({
      kind: "AWAITING_APPROVAL",
      actionId: "11111111-1111-4111-8111-111111111111",
      approvalId: "22222222-2222-4222-8222-222222222222",
    });
    expect(h.proposals).toEqual([
      {
        actionType: "relationship.interest.express",
        payload: { companyId: COMPANY, companyName: "Kora" },
      },
    ]);
    expect(h.commands).toEqual([]);
    // Taken once: the next prepare for this run has nothing.
    expect(await h.actions.prepare(context())).toEqual({ kind: "NONE" });
  });

  it("holds one action per answer: the same one twice is one, a different one waits", () => {
    const h = harness();
    expect(h.port.prepareForApproval(express)).toBe("PREPARED");
    expect(h.port.prepareForApproval(express)).toBe("PREPARED");
    expect(
      h.port.prepareForApproval({
        ...express,
        payload: { companyId: COMPANY, companyName: "Other" },
      }),
    ).toBe("ONE_PER_TURN");
  });

  it("is bound to the person and tenant the tool ran for", async () => {
    const h = harness();
    h.port.prepareForApproval(express);
    const stranger: ActorContext = {
      ...INVESTOR,
      userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000099"),
    };
    expect(await h.actions.prepare(context(stranger))).toEqual({
      kind: "NONE",
    });
    expect(h.proposals).toEqual([]);
  });

  it("a payload that does not fit the approved action's shape is refused, not proposed", async () => {
    const h = harness();
    h.port.prepareForApproval({
      ...express,
      actionType: "relationship.interest.respond",
      payload: { interestId: "not-an-id", decision: "MAYBE" },
    });
    expect(await h.actions.prepare(context())).toEqual({ kind: "NONE" });
    expect(h.proposals).toEqual([]);
  });

  it("an answer to an interest is prepared in the respond action's exact shape", async () => {
    const h = harness();
    h.port.prepareForApproval({
      ...express,
      actionType: "relationship.interest.respond",
      payload: {
        interestId: "77777777-0000-4000-8000-000000000001",
        companyId: COMPANY,
        decision: "DECLINED",
        investorName: "Beacon Ventures",
      },
    });
    await h.actions.prepare(context());
    expect(h.proposals).toEqual([
      {
        actionType: "relationship.interest.respond",
        payload: {
          interestId: "77777777-0000-4000-8000-000000000001",
          companyId: COMPANY,
          decision: "DECLINED",
          investorName: "Beacon Ventures",
        },
      },
    ]);
    expect(h.commands).toEqual([]);
  });

  it("with nothing prepared, the next proposer is asked as before", async () => {
    const h = harness();
    expect(await h.actions.prepare(context())).toEqual({ kind: "NONE" });
    expect(h.laterAsked()).toBe(1);
  });
});

describe("R35: the person's own relationships, for Q", () => {
  const REL = "e0000000-0000-4000-8000-000000000035";
  const INVESTOR_ORG = "e1000000-0000-4000-8000-000000000035";
  const listing = (counterpartName: string) =>
    ({
      relationship: {
        id: REL,
        companyId: COMPANY,
        investorOrganisationId: INVESTOR_ORG,
      },
      projection: {
        state: "CONNECTED",
        stateSince: "2026-09-14T00:00:00.000Z",
        milestones: [
          { state: "INTEREST_EXPRESSED", at: "2026-09-12T00:00:00.000Z" },
          { state: "CONNECTED", at: "2026-09-14T00:00:00.000Z" },
        ],
        version: 1,
      },
      nextStep: "SCHEDULE_MEETING",
      counterpartName,
    }) as never;

  it("an investor's member gets their organisation's list, as the investor side, with dated milestones", async () => {
    const asked: string[] = [];
    const interests = {
      listRelationshipsForInvestor: ({ actor }: { actor: ActorContext }) => {
        asked.push(`investor:${actor.organisationId ?? ""}`);
        return Promise.resolve([listing("Kestrel Bio")]);
      },
      listRelationshipsForCompany: () => {
        asked.push("company");
        return Promise.resolve([]);
      },
    } as Partial<InterestService> as InterestService;
    const port = createRelationshipIntelligencePort({
      interests,
      board: createRelationshipActionBoard(),
      ownCompany: () => Promise.resolve(COMPANY),
    });
    const own = await port.ownRelationships?.(INVESTOR);
    expect(asked).toEqual([`investor:${ORG}`]);
    expect(own).toEqual({
      side: "INVESTOR",
      items: [
        {
          relationshipId: REL,
          counterpart: { kind: "COMPANY", id: COMPANY, name: "Kestrel Bio" },
          state: "CONNECTED",
          stateSince: "2026-09-14T00:00:00.000Z",
          nextStep: "SCHEDULE_MEETING",
          milestones: [
            { state: "INTEREST_EXPRESSED", at: "2026-09-12T00:00:00.000Z" },
            { state: "CONNECTED", at: "2026-09-14T00:00:00.000Z" },
          ],
        },
      ],
    });
  });

  it("a founder (not an investor) gets their own company's list; nobody on either side gets null", async () => {
    const { InterestNotPermittedError } = await import("@capital-q/network");
    const interests = {
      listRelationshipsForInvestor: () =>
        Promise.reject(new InterestNotPermittedError()),
      listRelationshipsForCompany: ({ companyId }: { companyId: string }) =>
        Promise.resolve(companyId === COMPANY ? [listing("Ivy Capital")] : []),
    } as Partial<InterestService> as InterestService;
    const founder = createRelationshipIntelligencePort({
      interests,
      board: createRelationshipActionBoard(),
      ownCompany: () => Promise.resolve(COMPANY),
    });
    const own = await founder.ownRelationships?.(INVESTOR);
    expect(own?.side).toBe("COMPANY");
    expect(own?.items[0]?.counterpart).toEqual({
      kind: "INVESTOR_ORGANISATION",
      id: INVESTOR_ORG,
      name: "Ivy Capital",
    });
    const nobody = createRelationshipIntelligencePort({
      interests,
      board: createRelationshipActionBoard(),
      ownCompany: () => Promise.resolve(null),
    });
    expect(await nobody.ownRelationships?.(INVESTOR)).toBeNull();
  });
});
