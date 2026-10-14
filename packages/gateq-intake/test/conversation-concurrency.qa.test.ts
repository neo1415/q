import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GatewayPolicySchema,
  QualificationResultSchema,
  type PublicGateway,
} from "@capital-q/gateq";
import { createConversationService } from "../src/application/conversation-service.js";
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
  ApplicationSchema,
  ApplicationViewSchema,
  IntakeRefusedError,
} from "../src/contracts/index.js";

/** Independent regressions: uniqueness of transcript rows alone does not
 * establish one model interpretation per applicant exchange. No providers,
 * accounts, mail or application submission are involved in these tests. */
function exchangeWorld() {
  const applicationId = ApplicationIdSchema.parse(randomUUID());
  const tenantId = randomUUID();
  const gatewayId = randomUUID();
  const gatewayVersionId = randomUUID();
  const sessionId = randomUUID();
  const at = "2026-10-13T12:00:00.000Z";
  const publicId = "gq_0123456789abcdefghjkmnpqrs";
  const policy = GatewayPolicySchema.parse({
    gateway: {
      id: gatewayId,
      tenantId,
      investorOrganisationId: randomUUID(),
      organisationId: randomUUID(),
      publicId,
      name: "QA gateway",
      status: "ACTIVE",
      createdByUserId: randomUUID(),
      createdAt: at,
      updatedAt: at,
    },
    version: {
      id: gatewayVersionId,
      gatewayId,
      tenantId,
      versionNumber: 1,
      status: "PUBLISHED",
      inboundMode: "OPEN",
      publicTitle: "QA gateway",
      publicDescription: null,
      qualificationPolicyVersion: "gateq-qualification.v1",
      createdByUserId: randomUUID(),
      publishedByUserId: randomUUID(),
      publishedAt: at,
      supersededAt: null,
      createdAt: at,
      updatedAt: at,
    },
    criteria: [],
  });
  const application = ApplicationSchema.parse({
    id: applicationId,
    tenantId,
    gatewayId,
    gatewayVersionId,
    status: "IN_PROGRESS",
    declaredName: null,
    submittedAt: null,
    createdAt: at,
    updatedAt: at,
    publicReference: "ga_0123456789abcdefghjkmnpqrs",
  });
  const view = ApplicationViewSchema.parse({
    reference: application.publicReference,
    status: "IN_PROGRESS",
    declaredName: null,
    facts: [],
    documentCount: 0,
    submittedAt: null,
  });
  const qualification = QualificationResultSchema.parse({
    gatewayId,
    gatewayVersionId,
    gatewayVersionNumber: 1,
    qualificationPolicyVersion: "gateq-qualification.v1",
    subject: { kind: "GATEQ_APPLICATION", applicationId, tenantId },
    inboundMode: "OPEN",
    outcome: "QUALIFIED",
    access: "MAY_APPLY",
    accessReasonCode: "GATEWAY_OPEN",
    criteria: [],
    principalMismatches: [],
    unknowns: [],
    evaluatedAt: at,
  });
  const publicGateway: PublicGateway = {
    publicId,
    organisationDisplayName: "QA investor",
    title: "QA gateway",
    description: null,
    inboundMode: "OPEN",
    acceptingApplications: true,
    criteria: [],
    publishedAt: at,
  };
  const unused = (): Promise<never> => {
    return Promise.resolve().then(() => {
      throw new Error("Unexpected QA fixture operation");
    });
  };
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
    assertInterviewReady: () => Promise.resolve(),
    authorise: () => Promise.resolve({ application, sessionId }),
    qualification: () => Promise.resolve(qualification),
    factsFor: () => Promise.resolve([]),
    resume: () => Promise.resolve(view),
    recordFacts: () => Promise.resolve(view),
    start: unused,
    attachDocument: unused,
    submit: unused,
    startContact: unused,
    confirmContact: unused,
    coverage: unused,
    completeTurn: (input: {
      claimId: string;
      clientTurnId: string;
      reply: string;
      asking: StoredTurn["askingDimension"];
      intent: string;
    }) => {
      return Promise.resolve().then(() => {
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
      });
    },
  };
  const model = vi.fn((input: InterviewTurnInput) => {
    return Promise.resolve().then(() => {
      seen.push(input);
      return pending;
    });
  });
  const conversation = createConversationService({
    intake,
    interviewer: { turn: model },
    policies: {
      policyByVersionId: () => Promise.resolve(policy),
      currentPolicyByPublicId: () => Promise.resolve(null),
    },
    publicGatewayFor: () => Promise.resolve(publicGateway),
    turnMemory: {
      lastTurn: () => Promise.resolve(null),
      rememberTurn: () => {
        return Promise.resolve().then(() => {});
      },
    },
    turns: {
      readOutcome: () => Promise.resolve(null),
      checkpointOutcome: () => {
        return Promise.resolve().then(() => {});
      },
      appendInTransaction: () => {
        return Promise.resolve().then(() => {});
      },
      finishExchange: () => {
        return Promise.resolve().then(() => {});
      },
      claimExchange: (input: { clientTurnId: string; text: string }) => {
        return Promise.resolve().then(() => {
          const person = rows.find(
            (row) =>
              row.role === "PERSON" && row.clientTurnId === input.clientTurnId,
          );
          if (person && person.text !== input.text)
            throw new IntakeRefusedError("NOT_READY_TO_SUBMIT");
          if (activeClaim !== null)
            throw new IntakeRefusedError("TOO_MANY_REQUESTS");
          activeClaim = randomUUID();
          if (person === undefined)
            rows.push({
              seq: rows.length + 1,
              role: "PERSON",
              text: input.text,
              clientTurnId: input.clientTurnId,
              askingDimension: null,
              intent: null,
              createdAt: at,
            });
          return activeClaim;
        });
      },
      assertClaim: (_tx: unknown, _applicationId: unknown, claimId: string) =>
        Promise.resolve(claimId === activeClaim),
      releaseExchange: (_applicationId: unknown, claimId: string) => {
        return Promise.resolve().then(() => {
          if (activeClaim === claimId) activeClaim = null;
        });
      },
      pendingFor: () => Promise.resolve(activeClaim !== null),
      listFor: () => Promise.resolve([...rows]),
      countFor: () => Promise.resolve(rows.length),
      findExchange: (_id: unknown, clientTurnId: string) =>
        Promise.resolve({
          person:
            rows.find(
              (row) =>
                row.clientTurnId === clientTurnId && row.role === "PERSON",
            ) ?? null,
          q:
            rows.find(
              (row) => row.clientTurnId === clientTurnId && row.role === "Q",
            ) ?? null,
        }),
      append: (input: Parameters<ApplicationTurnRepository["append"]>[0]) => {
        return Promise.resolve().then(() => {
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
        });
      },
    },
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
