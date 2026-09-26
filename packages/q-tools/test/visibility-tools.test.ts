import { describe, expect, it } from "vitest";

import type { VisibilityStateDto } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type VisibilityIntelligencePort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * Who can see what, through Q (CQ-BIZ-003). Held to:
 *
 *   1. the firewall first: a company the plan did not bind is refused
 *      before the permissions context is asked;
 *   2. the answer is the permissions context's own, in words, and a
 *      refusal there (not the company's organisation) is NOT_AVAILABLE;
 *   3. nothing is shared or revoked by a tool: a proposal prepares the
 *      exact payload for approval, and only for a relationship the company
 *      can see and a share that exists.
 */

const APEX = "88888888-0000-4000-8000-000000000001";
const HORIZON = "88888888-0000-4000-8000-000000000002";
const POLICY = "99999999-0000-4000-8000-000000000001";

const STATE: VisibilityStateDto = {
  companyId: COMPANY_A,
  objects: [
    {
      object: "COMPANY_PROFILE",
      resourceId: COMPANY_A,
      scope: "network_visible",
      choices: ["organisation_private", "network_visible"],
      shareable: false,
    },
    {
      object: "CAPITAL_OBJECTIVE",
      resourceId: "33333333-0000-4000-8000-000000000001",
      scope: "founder_private",
      choices: [],
      shareable: true,
    },
  ],
  shares: [
    {
      policyId: POLICY,
      object: "CAPITAL_OBJECTIVE",
      relationshipId: APEX,
      recipientName: "Apex Ventures",
      accessLevel: "view",
      createdAt: "2026-09-25T10:00:00.000Z",
      expiresAt: null,
    },
  ],
  relationships: [
    {
      relationshipId: APEX,
      investorOrganisationId: APEX,
      name: "Apex Ventures",
    },
    {
      relationshipId: HORIZON,
      investorOrganisationId: HORIZON,
      name: "Horizon Capital",
    },
  ],
};

function fakeVisibility() {
  const reads: string[] = [];
  const prepared: {
    actionType: string;
    payload: Readonly<Record<string, string>>;
  }[] = [];
  const port: VisibilityIntelligencePort = {
    state: (actor: ActorContext, companyId) => {
      reads.push(companyId);
      return actor.userId === actorA.userId && companyId === COMPANY_A
        ? Promise.resolve(STATE)
        : Promise.reject(new Error("not this company's organisation"));
    },
    prepareForApproval: (entry) => {
      prepared.push({ actionType: entry.actionType, payload: entry.payload });
      return "PREPARED";
    },
  };
  return { port, reads, prepared };
}

const founderPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
]);

function tools(port: VisibilityIntelligencePort) {
  return createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ visibility: port })),
    ),
  });
}

describe("get_disclosure_state", () => {
  it("says who can see each thing, from the permissions context, in words", async () => {
    const { port } = fakeVisibility();
    const outcome = await tools(port).execute(
      {
        callId: "d1",
        name: "get_disclosure_state",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as {
      items: { what: string; scope: string; sharedWith: string[] }[];
      shareableWith: { name: string }[];
    };
    const raise = data.items.find((i) => i.scope === "founder_private");
    expect(raise?.what).toContain("never the use of funds");
    expect(raise?.sharedWith).toEqual(["Apex Ventures"]);
    expect(data.shareableWith.map((r) => r.name)).toEqual(["Horizon Capital"]);
  });

  it("is refused before the permissions context is asked for a company the plan did not bind", async () => {
    const { port, reads } = fakeVisibility();
    const outcome = await tools(port).execute(
      {
        callId: "d1",
        name: "get_disclosure_state",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(reads).toEqual([]);
  });

  it("is NOT_AVAILABLE when the permissions context refuses the actor", async () => {
    const { port } = fakeVisibility();
    const investorPlan = planFor(actorB, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "INTERNAL",
        companyId: COMPANY_A,
      },
    ]);
    const outcome = await tools(port).execute(
      {
        callId: "d1",
        name: "get_disclosure_state",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
  });
});

describe("the proposal tools prepare exactly one approval and share nothing", () => {
  it("propose_share_raise prepares the share for a relationship the company can see", async () => {
    const { port, prepared } = fakeVisibility();
    const outcome = await tools(port).execute(
      {
        callId: "p1",
        name: "propose_share_raise",
        arguments: { companyId: COMPANY_A, relationshipId: HORIZON },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toEqual([
      {
        actionType: "disclosure.raise.share",
        payload: {
          companyId: COMPANY_A,
          relationshipId: HORIZON,
          recipientName: "Horizon Capital",
        },
      },
    ]);
  });

  it("refuses a relationship the company cannot see, and one already shared with", async () => {
    const { port, prepared } = fakeVisibility();
    for (const relationshipId of [
      APEX,
      "88888888-0000-4000-8000-000000000099",
    ]) {
      const outcome = await tools(port).execute(
        {
          callId: "p1",
          name: "propose_share_raise",
          arguments: { companyId: COMPANY_A, relationshipId },
        },
        contextFor(actorA, founderPlan),
      );
      expect(outcome.status, relationshipId).toBe("DENIED");
    }
    expect(prepared).toEqual([]);
  });

  it("propose_revoke_share prepares only a share that exists", async () => {
    const { port, prepared } = fakeVisibility();
    const missing = await tools(port).execute(
      {
        callId: "r1",
        name: "propose_revoke_share",
        arguments: {
          companyId: COMPANY_A,
          shareId: "99999999-0000-4000-8000-000000000099",
        },
      },
      contextFor(actorA, founderPlan),
    );
    expect(missing.status).toBe("DENIED");
    const outcome = await tools(port).execute(
      {
        callId: "r2",
        name: "propose_revoke_share",
        arguments: { companyId: COMPANY_A, shareId: POLICY },
      },
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toEqual([
      {
        actionType: "disclosure.share.revoke",
        payload: {
          companyId: COMPANY_A,
          policyId: POLICY,
          recipientName: "Apex Ventures",
        },
      },
    ]);
  });
});
