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
import { DIFFERENT_COUNTERPARTS } from "../src/tools/chat.js";

/**
 * propose_email (BIZ-007): a draft to the other side of one relationship,
 * for the person's approval. The recipient is always one of the
 * counterparty's own people; the tool sends nothing.
 */

const RELATIONSHIP = "88888888-0000-4000-8000-0000000000e1";
const ADA = { name: "Ada Founder", email: "ada@founder.example.invalid" };

function world(
  options: { readonly mailbox?: boolean; readonly noContacts?: boolean } = {},
) {
  const prepared: unknown[] = [];
  const email: EmailIntelligencePort = {
    counterpart: (actor, relationshipId) =>
      Promise.resolve(
        actor.userId === actorB.userId && relationshipId === RELATIONSHIP
          ? {
              kind: "COMPANY" as const,
              id: COMPANY_B_NETWORK,
              name: "Apex",
              contacts: options.noContacts === true ? [] : [ADA],
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

  // Guard F-106 (production a3f2a0f81, run 891e2a3d): a name in
  // recipientEmail failed the whole email with INVALID_ARGUMENTS.
  it("takes a recipient that is not an address as none named", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      call({ recipientEmail: "Savanna Seed Partners" }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([expect.objectContaining({ to: ADA.email })]);
  });

  it("says it has no address for them, never a silent failure", async () => {
    const { executor, prepared } = world({ noContacts: true });
    const outcome = await executor.execute(
      call({}),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toEqual({
      ok: true,
      data: {
        status: "NO_RECIPIENT",
        awaitingApprovalOf: "I don't have an email address for Apex.",
      },
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
  // Sweep 2026-10-29: "draft an update email to my investors" with one
  // investor was answered "no specific relationship was named".
  it("an email for their relationships as a group goes to their one relationship, for approval", async () => {
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
    const outcome = await executor.execute(
      {
        callId: "e10",
        name: "propose_email",
        arguments: {
          theirOnlyRelationship: true,
          subject: "Our October update",
          body: "Hi Ada, a short update on our month. Best, Ben",
        },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toHaveLength(1);
    expect(JSON.stringify(prepared[0])).toContain(ADA.email);
  });

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

// Live d3a197b4 (2026-10-26): an asked email drafted in its first round was
// refused at "(root)" (it named the other side more than once, or not at
// all) and cost three more rounds before the card. Named more than once,
// every reference must be the same one of their relationships (#550): an
// email is never aimed by picking one reference over another.
describe("propose_email from a first round", () => {
  const OTHER_COMPANY = "99999999-0000-4000-8000-0000000000f1";
  const BASKETARI = "88888888-0000-4000-8000-0000000000e2";
  const byName = () => {
    const prepared: unknown[] = [];
    const reasons: (string | undefined)[] = [];
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
        reasons.push(entry.reason);
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
                  {
                    relationshipId: BASKETARI,
                    counterpart: {
                      kind: "COMPANY",
                      id: OTHER_COMPANY,
                      name: "Basketari",
                    },
                    state: "CONNECTED",
                  },
                ]
              : [],
        } as never),
      withCompany: () => Promise.resolve(null),
      withInvestor: () => Promise.resolve(null),
    } as never;
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(fakePorts({ email, relationships })),
      ),
    });
    return { executor, prepared, reasons };
  };
  const first = (target: Record<string, unknown>) => ({
    callId: "e1",
    name: "propose_email",
    arguments: {
      ...target,
      subject: "Our latest traction",
      body: "Hi Ada, 96 kiosks are live. Best, Ben",
    },
  });
  const refusal = (outcome: { result: unknown }) =>
    (outcome.result as { ok: boolean; error?: { safeMessage: string } }).error
      ?.safeMessage ?? "";

  // Live a1db17ec (2026-10-26): the first call carried a field the email
  // did not take (unrecognized_keys) where every proposal beside it takes
  // the card's reason. It validates, and the reason reaches the card.
  it("a first call with the card's reason validates, and the reason reaches the card", async () => {
    const { executor, prepared, reasons } = byName();
    const outcome = await executor.execute(
      first({
        counterpartName: "apex",
        reason: "They led your seed round and asked for quarterly numbers.",
      }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toHaveLength(1);
    expect(reasons).toEqual([
      "They led your seed round and asked for quarterly numbers.",
    ]);
  });

  it("a field no proposal takes is still refused, and named for the log only", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({ counterpartName: "apex", attachments: ["deck.pdf"] }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    expect(refusal(outcome)).toContain("a field this tool does not take");
    expect(refusal(outcome)).not.toContain("deck.pdf");
    expect(prepared).toEqual([]);
  });

  it("their name and an id that agree: validates and prepares to that relationship", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({ counterpartName: "apex", relationshipId: RELATIONSHIP }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toEqual([
      expect.objectContaining({ relationshipId: RELATIONSHIP, to: ADA.email }),
    ]);
  });

  it("their name and an id for another of their relationships: refused, nothing prepared", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({ counterpartName: "apex", relationshipId: BASKETARI }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(refusal(outcome)).toBe(DIFFERENT_COUNTERPARTS);
    expect(prepared).toEqual([]);
  });

  it("their name and an id that names none of theirs: refused, never sent by the name alone", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({ counterpartName: "apex", companyId: OTHER_COMPANY }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(refusal(outcome)).toBe(DIFFERENT_COUNTERPARTS);
    expect(prepared).toEqual([]);
  });

  it("a reply to an inbound email that also names a relationship: refused", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({
        inboundEmailId: "77777777-0000-4000-8000-0000000000a1",
        counterpartName: "apex",
      }),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(refusal(outcome)).toBe(DIFFERENT_COUNTERPARTS);
    expect(prepared).toEqual([]);
  });

  it("named twice by someone with no such relationship, still prepares nothing", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({ counterpartName: "apex", relationshipId: RELATIONSHIP }),
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [
          { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
        ]),
      ),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });

  it("named not at all, says what to fix, in the schema's words, never a value", async () => {
    const { executor, prepared } = byName();
    const outcome = await executor.execute(
      first({}),
      contextFor(actorB, investorPlan),
    );
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    const said = refusal(outcome);
    expect(said).toContain("Arguments are invalid at: (root).");
    expect(said).toContain("name the other side: counterpartName");
    expect(said).not.toContain("96 kiosks");
    expect(prepared).toEqual([]);
  });
});
