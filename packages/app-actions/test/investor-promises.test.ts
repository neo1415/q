import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { APP_ACTIONS } from "../src/registry.js";
import type { AppActionContext } from "../src/define.js";
import type { AppActionPorts } from "../src/ports.js";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  tenantId: "10000000-0000-4000-8000-000000000002",
  organisationId: "10000000-0000-4000-8000-000000000003",
} as ActorContext;
const RELATIONSHIP = "20000000-0000-4000-8000-000000000001";
const REQUEST = "30000000-0000-4000-8000-000000000001";
const MESSAGE = "30000000-0000-4000-8000-000000000002";

const context: AppActionContext = {
  actor,
  idempotencyKey: "questions-key-0001",
  correlationId: "corr-1" as CorrelationId,
  surface: "SCREEN",
};

const action = (name: string) => {
  const found = APP_ACTIONS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

type Calls = { diligence: unknown[]; chat: unknown[] };

function ports(
  diligenceOutcome:
    | { outcome: "OK"; value: { requestId: string } }
    | { outcome: "REFUSED"; code: string },
  chatThrows = false,
): { ports: AppActionPorts; calls: Calls } {
  const calls: Calls = { diligence: [], chat: [] };
  const fake = {
    diligence: {
      request: (command: unknown) => {
        calls.diligence.push(command);
        return Promise.resolve(diligenceOutcome);
      },
    },
    chat: {
      send: (command: unknown) => {
        calls.chat.push(command);
        return chatThrows
          ? Promise.reject(new Error("not connected"))
          : Promise.resolve({
              message: { messageId: MESSAGE },
              deduplicated: false,
            });
      },
    },
  };
  return { ports: fake as unknown as AppActionPorts, calls };
}

const input = {
  relationshipId: RELATIONSHIP,
  idempotencyKey: context.idempotencyKey,
  input: {
    questions: [
      "What is your monthly burn?",
      "Can you share the billing export?",
    ],
  },
};

describe("sending questions to a company (Q.07)", () => {
  const send = action("diligence.questions.send");

  it("in diligence: one diligence request with the exact approved wording", async () => {
    const world = ports({ outcome: "OK", value: { requestId: REQUEST } });
    const out = await send.run(world.ports, context, input);
    expect(out).toEqual({
      outcome: "OK",
      value: { via: "DILIGENCE_REQUEST", id: REQUEST },
    });
    expect(world.calls.diligence).toEqual([
      expect.objectContaining({
        relationshipId: RELATIONSHIP,
        title: "Answers to 2 questions",
        note: "1. What is your monthly burn?\n2. Can you share the billing export?",
        idempotencyKey: "questions-key-0001",
      }),
    ]);
    expect(world.calls.chat).toEqual([]);
  });

  it("connected but not in diligence: one chat message, under the same key", async () => {
    const world = ports({ outcome: "REFUSED", code: "NOT_OPEN" });
    const out = await send.run(world.ports, context, input);
    expect(out).toEqual({
      outcome: "OK",
      value: { via: "CHAT_MESSAGE", id: MESSAGE },
    });
    expect(world.calls.chat).toEqual([
      expect.objectContaining({ idempotencyKey: "questions-key-0001:chat" }),
    ]);
  });

  it("not a party (another tenant's relationship): refused, nothing sent", async () => {
    const world = ports({ outcome: "REFUSED", code: "NOT_FOUND" });
    expect(await send.run(world.ports, context, input)).toEqual({
      outcome: "REFUSED",
      code: "NOT_FOUND",
    });
    expect(world.calls.chat).toEqual([]);
  });

  it("the company's side can't send investor questions", async () => {
    const world = ports({ outcome: "REFUSED", code: "INVESTOR_ONLY" });
    expect(await send.run(world.ports, context, input)).toEqual({
      outcome: "REFUSED",
      code: "INVESTOR_ONLY",
    });
    expect(world.calls.chat).toEqual([]);
  });

  it("not connected: refused by the chat service, said as such", async () => {
    const world = ports({ outcome: "REFUSED", code: "NOT_OPEN" }, true);
    expect(await send.run(world.ports, context, input)).toEqual({
      outcome: "REFUSED",
      code: "NOT_CONNECTED",
    });
  });

  it("the approval card shows the exact text", () => {
    expect(send.card(input).preview).toContain("1. What is your monthly burn?");
  });

  it("is consequential (approved before it runs) and limited to five questions", () => {
    expect(send.classification).toBe("CONSEQUENTIAL");
    expect(
      send.input.safeParse({
        ...input,
        input: { questions: Array.from({ length: 6 }, () => "Why now?") },
      }).success,
    ).toBe(false);
  });
});

describe("applying a thesis suggestion (Q.02)", () => {
  const apply = action("investor.mandate.suggestion.apply");
  const ORG = "40000000-0000-4000-8000-000000000001";
  const MANDATE = "40000000-0000-4000-8000-000000000002";

  it("is consequential, and only a well-formed suggestion id is accepted", () => {
    expect(apply.classification).toBe("CONSEQUENTIAL");
    expect(
      apply.input.safeParse({
        investorOrganisationId: ORG,
        mandateId: MANDATE,
        suggestionId: "DROP TABLE",
        input: { expectedVersion: 1 },
      }).success,
    ).toBe(false);
  });
});
