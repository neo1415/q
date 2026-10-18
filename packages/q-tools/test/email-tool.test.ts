import { describe, expect, it } from "vitest";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type EmailIntelligencePort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * propose_email (BIZ-007): a draft to the other side of one relationship,
 * for the person's approval. The recipient is always one of the
 * counterparty's own people; the tool sends nothing.
 */

const RELATIONSHIP = "88888888-0000-4000-8000-0000000000e1";
const ADA = { name: "Ada Founder", email: "ada@founder.example.invalid" };

function world(options: { readonly mailbox?: boolean } = {}) {
  const prepared: unknown[] = [];
  const email: EmailIntelligencePort = {
    counterpart: (actor, relationshipId) =>
      Promise.resolve(
        actor.userId === actorB.userId && relationshipId === RELATIONSHIP
          ? {
              kind: "COMPANY" as const,
              id: COMPANY_B_NETWORK,
              name: "Apex",
              contacts: [ADA],
            }
          : null,
      ),
    mailbox: () =>
      Promise.resolve(
        options.mailbox === false
          ? null
          : { email: "investor@example.invalid" },
      ),
    prepareForApproval: (entry) => {
      prepared.push(entry.payload);
      return "PREPARED";
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(fakePorts({ email }))),
  });
  return { executor, prepared };
}

const investorPlan = planFor(actorB, "GENERAL_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

const call = (args: Record<string, unknown>) => ({
  callId: "e1",
  name: "propose_email",
  arguments: {
    relationshipId: RELATIONSHIP,
    subject: "Following up on Apex",
    body: "Hi Ada, could we talk this week? Best, Ben",
    ...args,
  },
});

describe("propose_email", () => {
  it("prepares a draft to the relationship's own person and sends nothing", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({}),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        relationshipId: RELATIONSHIP,
        to: ADA.email,
        toName: ADA.name,
        counterpartName: "Apex",
        subject: "Following up on Apex",
        body: "Hi Ada, could we talk this week? Best, Ben",
      },
    ]);
  });

  it("refuses a recipient who is not on the relationship", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({ recipientEmail: "someone@elsewhere.example.invalid" }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(prepared).toEqual([]);
  });

  it("refuses a relationship the person is not a party to", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({}),
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [
          { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
        ]),
      ),
    );
    expect(outcome.status).toBe("DENIED");
    expect(prepared).toEqual([]);
  });

  it("asks the person to connect Gmail rather than preparing what cannot be sent", async () => {
    const { executor, prepared } = world({ mailbox: false });
    const outcome = await executor.execute(
      call({}),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "MAILBOX_NOT_CONNECTED" },
    });
    expect(prepared).toEqual([]);
  });

  it("refuses a subject that would inject a header", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({ subject: "hi\r\nBcc: x@example.invalid" }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });
});

describe("propose_email by name, from any page (action parity 2026-10-02)", () => {
  it("'email apex' drafts to the relationship they have with Apex; a stranger gets nothing", async () => {
    const prepared: unknown[] = [];
    const email: EmailIntelligencePort = {
      counterpart: (actor, relationshipId) =>
        Promise.resolve(
          actor.userId === actorB.userId && relationshipId === RELATIONSHIP
            ? {
                kind: "COMPANY" as const,
                id: COMPANY_B_NETWORK,
                name: "Apex",
                contacts: [ADA],
              }
            : null,
        ),
      mailbox: () => Promise.resolve({ email: "investor@example.invalid" }),
      prepareForApproval: (entry) => {
        prepared.push(entry.payload);
        return "PREPARED";
      },
    };
    const relationships = {
      ownRelationships: (actor: typeof actorA) =>
        Promise.resolve({
          side: "INVESTOR" as const,
          items:
            actor.userId === actorB.userId
              ? [
                  {
                    relationshipId: RELATIONSHIP,
                    counterpart: {
                      kind: "COMPANY",
                      id: COMPANY_B_NETWORK,
                      name: "Apex",
                    },
                    state: "CONNECTED",
                  },
                ]
              : [],
        } as never),
    } as never;
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(fakePorts({ email, relationships })),
      ),
    });
    const named = {
      callId: "e9",
      name: "propose_email",
      arguments: {
        counterpartName: "apex",
        subject: "Next steps",
        body: "Hi Ada, shall we talk this week? Best, Ben",
      },
    };
    // A Home plan: no relationship on screen.
    const outcome = await executor.execute(
      named,
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toHaveLength(1);
    const stranger = await executor.execute(
      named,
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [
          { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
        ]),
      ),
    );
    expect(stranger.status).not.toBe("SUCCEEDED");
    expect(prepared).toHaveLength(1);
  });
});
