import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  closestByName,
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  matchPendingRequest,
  type PendingConnectionRequest,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * An investor's answer to founders' Connection Requests (live 2026-10-02,
 * Zino: "accept their connection and send them a message" -> "which one?"
 * three times, then the company-side tool failed INVALID_ARGUMENTS). The
 * company is matched against the investor's OWN pending requests only;
 * one approval holds the answer and the opening message; anything not
 * prepared says exactly why, naming what is waiting.
 */

const KAZIKIT: PendingConnectionRequest = {
  interestId: "77777777-0000-4000-8000-0000000000a1",
  companyId: "66666666-0000-4000-8000-0000000000a1",
  companyName: "Kazikit",
  relationshipId: "88888888-0000-4000-8000-0000000000a1",
};
const TALLYLOOM: PendingConnectionRequest = {
  interestId: "77777777-0000-4000-8000-0000000000a2",
  companyId: "66666666-0000-4000-8000-0000000000a2",
  companyName: "Tallyloom",
  relationshipId: "88888888-0000-4000-8000-0000000000a2",
};

type Own = { name: string; id: string; state: string };

function world(
  pending: readonly PendingConnectionRequest[],
  own: readonly Own[] = [],
) {
  const prepared: { actionType: string; payload: unknown }[] = [];
  const port = {
    withCompany: () => Promise.resolve(null),
    withInvestor: () => Promise.resolve(null),
    byRelationship: () => Promise.resolve(null),
    incomingInterest: () => Promise.reject(new Error("not a company")),
    mayExpressInterest: () => Promise.resolve(false),
    mayAnswerInterest: () => Promise.resolve(false),
    ownRelationships: () =>
      Promise.resolve({
        side: "INVESTOR" as const,
        items: own.map((item) => ({
          counterpart: { kind: "COMPANY", id: item.id, name: item.name },
          state: item.state,
        })),
      } as never),
    pendingConnectionRequests: (actor: ActorContext) =>
      actor.userId === actorB.userId
        ? Promise.resolve(pending)
        : Promise.reject(new Error("not an investor's member")),
    prepareForApproval: (entry) => {
      prepared.push({ actionType: entry.actionType, payload: entry.payload });
      return "PREPARED";
    },
  } satisfies RelationshipIntelligencePort;
  const tools = createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ relationships: port })),
    ),
  });
  // A plan with nothing about these companies: their inbox needs none.
  const plan = (actor: ActorContext) =>
    planFor(actor, "GENERAL_QUESTION", [
      { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    ]);
  const ask = (args: Record<string, unknown>, actor: ActorContext = actorB) =>
    tools.execute(
      {
        callId: "c1",
        name: "propose_connection_request_answer",
        arguments: args,
      },
      contextFor(actor, plan(actor)),
    );
  return { ask, prepared };
}

describe("propose_connection_request_answer", () => {
  it("accepts the named request and its message as ONE approval, with no plan for that company", async () => {
    const { ask, prepared } = world([KAZIKIT, TALLYLOOM]);
    const outcome = await ask({
      company: "Kazikit",
      openingMessage:
        "Hi Kazikit team, glad to connect. Can we talk this week?",
    });
    expect(outcome.result).toEqual({
      ok: true,
      data: {
        status: "PREPARED",
        awaitingApprovalOf:
          "Accept Kazikit's connection request and send them your message",
      },
    });
    expect(prepared).toEqual([
      {
        actionType: "relationship.connection_request.respond",
        payload: {
          interestId: KAZIKIT.interestId,
          companyId: KAZIKIT.companyId,
          relationshipId: KAZIKIT.relationshipId,
          companyName: "Kazikit",
          decision: "ACCEPTED",
          openingMessage:
            "Hi Kazikit team, glad to connect. Can we talk this week?",
        },
      },
    ]);
  });

  it("with one waiting and no name, that one, with a drafted message when asked for", async () => {
    const { ask, prepared } = world([KAZIKIT]);
    const outcome = await ask({ company: null, withMessage: true });
    expect(outcome.result).toMatchObject({ data: { status: "PREPARED" } });
    expect(prepared[0]?.payload).toMatchObject({
      companyName: "Kazikit",
      openingMessage: expect.stringContaining("Kazikit") as unknown,
    });
  });

  it("with several waiting and no name, names them to ask once; prepares nothing", async () => {
    const { ask, prepared } = world([KAZIKIT, TALLYLOOM]);
    const outcome = await ask({ company: null });
    expect(outcome.result).toEqual({
      ok: true,
      data: {
        status: "WHICH_ONE",
        awaitingApprovalOf:
          "2 connection requests are waiting: Kazikit or Tallyloom. Which one should I accept?",
      },
    });
    expect(prepared).toEqual([]);
  });

  it("says exactly why when the name is not a waiting request, or nothing waits", async () => {
    const two = world([KAZIKIT, TALLYLOOM]);
    expect((await two.ask({ company: "Nixo" })).result).toEqual({
      ok: true,
      data: {
        status: "NOT_FOUND",
        awaitingApprovalOf:
          '"Nixo" isn\'t one of the connection requests waiting for you; those are Kazikit or Tallyloom.',
      },
    });
    const none = world([]);
    expect((await none.ask({ company: "Kazikit" })).result).toMatchObject({
      data: { status: "NO_PENDING_REQUESTS" },
    });
    expect(two.prepared).toEqual([]);
  });

  it("two waiting requests match the name: asks which, prepares nothing (lead 2026-10-03)", async () => {
    const KAZIKIT_LABS: PendingConnectionRequest = {
      ...KAZIKIT,
      interestId: "77777777-0000-4000-8000-0000000000a3",
      companyId: "66666666-0000-4000-8000-0000000000a3",
      companyName: "Kazikit Labs",
    };
    const { ask, prepared } = world([
      { ...KAZIKIT, companyName: "Kazikit Health" },
      KAZIKIT_LABS,
    ]);
    const outcome = await ask({ company: "Kazikit", decision: "DECLINED" });
    expect(prepared).toEqual([]);
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "WHICH_ONE",
        awaitingApprovalOf:
          'More than one connection request waiting matches "Kazikit": Kazikit Health or Kazikit Labs. Which one should I decline?',
      },
    });
  });

  it("a decline carries no message", async () => {
    const { ask, prepared } = world([KAZIKIT]);
    await ask({
      company: "Kazikit",
      decision: "DECLINED",
      openingMessage: "Hello there team",
    });
    expect(prepared[0]?.payload).toMatchObject({
      decision: "DECLINED",
      openingMessage: null,
    });
  });

  it("is refused for someone who is not an investor's member: nothing prepared", async () => {
    const { ask, prepared } = world([KAZIKIT]);
    const outcome = await ask({ company: "Kazikit" }, actorA);
    expect(outcome.status).toBe("DENIED");
    expect(prepared).toEqual([]);
  });
});

describe("matchPendingRequest", () => {
  const pending = [KAZIKIT, TALLYLOOM];
  it.each([
    ["Kazikit", "Kazikit"],
    ["kazikit ltd", "Kazikit"],
    [KAZIKIT.companyId, "Kazikit"],
    // Heard slightly wrong (the live transcript said "Kazuki", "Tareli").
    ["Kazuki", "Kazikit"],
    ["Tallyloum", "Tallyloom"],
  ])("%j is %s", (said, name) => {
    expect(matchPendingRequest(pending, said)?.companyName).toBe(name);
  });

  it("never guesses: unrelated words or an ambiguous name match nothing", () => {
    expect(matchPendingRequest(pending, "classic eight zero three")).toBeNull();
    expect(
      matchPendingRequest(
        [KAZIKIT, { ...TALLYLOOM, companyName: "Kazikit Labs" }],
        "Kazikit L",
      ),
    ).toBeNull();
  });
});

describe("live 2026-10-02 (Zino): nothing of theirs to accept is said plainly, never as an id", () => {
  const own: Own[] = [
    {
      name: "Nixo",
      id: "66666666-0000-4000-8000-0000000000b1",
      state: "CONNECTED",
    },
    { name: "Tallyloom", id: TALLYLOOM.companyId, state: "INTEREST_EXPRESSED" },
  ];
  it('"Tallyloom, accept their request and chat him up for me": their interest is Zino\'s own', async () => {
    const { ask, prepared } = world([], own);
    const outcome = await ask({ company: "Tallyloom", withMessage: true });
    expect(outcome.result).toEqual({
      ok: true,
      data: {
        status: "NO_PENDING_REQUESTS",
        awaitingApprovalOf:
          "Tallyloom hasn't accepted your interest yet, so there's no request of theirs to accept. I can look after it for you: wait for them to accept, then message them and book an introductory call.",
      },
    });
    expect(JSON.stringify(outcome.result)).not.toMatch(/\bid\b|record/i);
    expect(prepared).toEqual([]);
  });

  it("already connected: says so, and what Q can do instead", async () => {
    const { ask } = world([KAZIKIT], own);
    expect((await ask({ company: "Nixo" })).result).toMatchObject({
      data: {
        status: "NOT_FOUND",
        awaitingApprovalOf:
          "You're already connected with Nixo, so there's nothing to accept. I can send them a message or book a call with them.",
      },
    });
  });
});

describe("closestByName: a name as said or misheard", () => {
  const names = ["Nixo", "Kazikit", "Yamfield Agro", "Tallyloom"];
  it.each([
    ["TALUM", "Tallyloom"],
    ["Kazuki", "Kazikit"],
    ["yamfield", "Yamfield Agro"],
    ["Nixo", "Nixo"],
  ])("%j is %s", (said, name) => {
    expect(closestByName(names, said, (n) => n)).toEqual([name]);
  });
  it("unrelated words match nothing", () => {
    expect(closestByName(names, "classic eight zero three", (n) => n)).toEqual(
      [],
    );
  });
});
