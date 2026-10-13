import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { GatewayPolicy, PublicGateway } from "@capital-q/gateq";
import { createConversationService } from "../src/application/conversation-service.js";
import type { IntakeService } from "../src/application/intake-service.js";
import type {
  InterviewTurnInput,
  InterviewTurnOutcome,
} from "../src/application/interviewer.js";
import type {
  ApplicationTurnRepository,
  StoredTurn,
} from "../src/application/ports.js";
import {
  ApplicationIdSchema,
  IntakeRefusedError,
} from "../src/contracts/index.js";

/** Independent regressions: uniqueness of transcript rows alone does not
 * establish one model interpretation per applicant exchange. No providers,
 * accounts, mail or application submission are involved in these tests. */
function exchangeWorld() {
  const applicationId = ApplicationIdSchema.parse(randomUUID());
  const rows: StoredTurn[] = [];
  const seen: InterviewTurnInput[] = [];
  let activeClaim: string | null = null;
  let finish: ((value: InterviewTurnOutcome) => void) | undefined;
  const outcome: InterviewTurnOutcome = {
    reply: "What supports that revenue?",
    intent: "ANSWER",
    facts: [],
    rejectedFacts: 0,
    asking: null,
    questionForQ: null,
    readyToReview: false,
  };
  const pending = new Promise<InterviewTurnOutcome>((resolve) => {
    finish = resolve;
  });
  const intake = {
    authorise: async () => ({
      application: {
        id: applicationId,
        tenantId: randomUUID(),
        gatewayId: randomUUID(),
        gatewayVersionId: randomUUID(),
        status: "IN_PROGRESS",
      },
      sessionId: randomUUID(),
    }),
    qualification: async () => ({
      access: "MAY_APPLY",
      principalMismatches: [],
      unknowns: [],
    }),
    factsFor: async () => [],
    resume: async () => ({}),
    recordFacts: async () => ({}),
    completeTurn: async (input: {
      claimId: string;
      clientTurnId: string;
      reply: string;
      asking: StoredTurn["askingDimension"];
      intent: string;
    }) => {
      if (input.claimId !== activeClaim)
        throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
      rows.push({
        seq: rows.length + 1,
        role: "Q",
        text: input.reply,
        clientTurnId: input.clientTurnId,
        askingDimension: input.asking,
        intent: input.intent,
        createdAt: "2026-10-13T12:00:00.000Z",
      });
      activeClaim = null;
    },
  } as unknown as IntakeService;
  const model = vi.fn(async (input: InterviewTurnInput) => {
    seen.push(input);
    return pending;
  });
  const conversation = createConversationService({
    intake,
    interviewer: { turn: model },
    policies: {
      policyByVersionId: async () =>
        ({ criteria: [] }) as unknown as GatewayPolicy,
      currentPolicyByPublicId: async () => null,
    },
    publicGatewayFor: async () => ({}) as PublicGateway,
    turnMemory: { lastTurn: async () => null, rememberTurn: async () => {} },
    turns: {
      claimExchange: async (input: { clientTurnId: string; text: string }) => {
        const person = rows.find(
          (row) =>
            row.role === "PERSON" && row.clientTurnId === input.clientTurnId,
        );
        if (person && person.text !== input.text)
          throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
        if (activeClaim !== null)
          throw new IntakeRefusedError("TOO_MANY_REQUESTS");
        activeClaim = randomUUID();
        return activeClaim;
      },
      assertClaim: async (
        _tx: unknown,
        _applicationId: unknown,
        claimId: string,
      ) => claimId === activeClaim,
      releaseExchange: async (_applicationId: unknown, claimId: string) => {
        if (activeClaim === claimId) activeClaim = null;
      },
      listFor: async () => [...rows],
      countFor: async () => rows.length,
      findExchange: async (_id: unknown, clientTurnId: string) => ({
        person:
          rows.find(
            (row) => row.clientTurnId === clientTurnId && row.role === "PERSON",
          ) ?? null,
        q:
          rows.find(
            (row) => row.clientTurnId === clientTurnId && row.role === "Q",
          ) ?? null,
      }),
      append: async (
        input: Parameters<ApplicationTurnRepository["append"]>[0],
      ) => {
        if (
          rows.some(
            (row) =>
              row.clientTurnId === input.clientTurnId &&
              row.role === input.role,
          )
        )
          return;
        rows.push({
          seq: rows.length + 1,
          role: input.role,
          text: input.text,
          clientTurnId: input.clientTurnId,
          askingDimension: input.askingDimension ?? null,
          intent: input.intent ?? null,
          createdAt: "2026-10-13T12:00:00.000Z",
        });
      },
    } as ApplicationTurnRepository,
  });
  const turn = (message: string) =>
    conversation.turn({
      token: "qa-owned-token",
      message,
      clientTurnId: "same-exchange",
      correlationId: "qa-owned-correlation",
    });
  return { turn, rows, seen, model, release: () => finish?.(outcome) };
}

describe("GateQ exchange idempotency independent QA", () => {
  it("does not spend a second model call for a concurrent identical retry", async () => {
    const w = exchangeWorld();
    const first = w.turn("Our annual revenue is $100k.");
    await vi.waitFor(() => expect(w.model).toHaveBeenCalledTimes(1));
    const second = w.turn("Our annual revenue is $100k.");
    const results = Promise.allSettled([first, second]);
    // Flush the second request's repository/policy reads before releasing the model.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    w.release();
    await results;
    expect(w.rows.filter((row) => row.role === "PERSON")).toHaveLength(1);
    expect(w.rows.filter((row) => row.role === "Q")).toHaveLength(1);
    expect(w.model).toHaveBeenCalledTimes(1);
  });

  it("never interprets changed retry text that is absent from the durable transcript", async () => {
    const w = exchangeWorld();
    const first = w.turn("Our annual revenue is $100k.");
    await vi.waitFor(() => expect(w.model).toHaveBeenCalledTimes(1));
    const changed = w.turn("Correction: annual revenue is $900k.");
    const results = Promise.allSettled([first, changed]);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    w.release();
    await results;
    const person = w.rows.find((row) => row.role === "PERSON");
    expect(person?.text).toBe("Our annual revenue is $100k.");
    expect(w.seen.every((input) => input.utterance === person?.text)).toBe(
      true,
    );
  });
});
