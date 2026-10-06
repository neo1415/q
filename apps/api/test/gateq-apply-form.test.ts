import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_APPLY_ANSWERS_PATH,
  GATEQ_APPLY_START_PATH,
} from "@capital-q/contracts";
import {
  IntakeRefusedError,
  type ApplicantTurnResult,
  type ConversationService,
  type IntakeService,
  type NewApplicationFact,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * F1: the GateQ form over HTTP. The same anonymous, credential-scoped
 * surface as the conversation; what differs is that no model is reached
 * and the founder's answers arrive as bounded fields.
 */

const TOKEN = `gqs_${"b".repeat(43)}`;
const PUBLIC_ID = "gq_0123456789abcdefghjkmnpqrs";

const RESULT: ApplicantTurnResult = {
  reply: "",
  deduplicated: false,
  view: {
    reference: "ga_0123456789abcdefghjkmnpqrs",
    status: "IN_PROGRESS",
    declaredName: "Kora Health",
    facts: [],
    documentCount: 0,
    submittedAt: null,
  },
  access: "NEEDS_INFORMATION",
  unmet: ["Where"],
  stillNeeded: ["Round size"],
};

function build() {
  const recorded = {
    facts: [] as NewApplicationFact[][],
    openings: 0,
  };
  const deny = () => {
    throw new IntakeRefusedError("SESSION_INVALID");
  };
  const intake = {
    authorise: (token: string) => {
      if (token !== TOKEN) deny();
      return Promise.resolve({ sessionId: "s1", application: {} });
    },
    start: () =>
      Promise.resolve({
        token: TOKEN,
        reference: RESULT.view.reference,
        view: RESULT.view,
        expiresAt: "2026-10-06T12:00:00.000Z",
      }),
    recordFacts: (input: {
      token: string;
      facts: readonly NewApplicationFact[];
    }) => {
      if (input.token !== TOKEN) deny();
      recorded.facts.push([...input.facts]);
      return Promise.resolve(RESULT.view);
    },
  } as unknown as IntakeService;
  const conversation: ConversationService = {
    openingFor: () => {
      recorded.openings += 1;
      return Promise.resolve("Hi");
    },
    turn: () => Promise.reject(new Error("the form never takes a turn")),
    summary: (token) => {
      if (token !== TOKEN) deny();
      return Promise.resolve(RESULT);
    },
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(null) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "NO_APPLICATION_IDENTITY" as const }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    gateqApply: { intake, conversation },
  });
  return { app, recorded };
}

const bearer = { authorization: `Bearer ${TOKEN}` };

describe("the GateQ form (F1)", () => {
  it("opens a form application without reaching a model", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_START_PATH,
      payload: { gatewayPublicId: PUBLIC_ID, mode: "form" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ reply: string }>().reply).toBe("");
    expect(recorded.openings).toBe(0);
  });

  it("records the answers and returns the engine's rule-by-rule answer", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_ANSWERS_PATH,
      headers: bearer,
      payload: { stage: "seed", country: "KE", raise: "DECLINED" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      application: { access: string; unmet: string[]; stillNeeded: string[] };
    }>();
    expect(body.application.access).toBe("NEEDS_INFORMATION");
    expect(body.application.unmet).toEqual(["Where"]);
    expect(body.application.stillNeeded).toEqual(["Round size"]);
    expect(recorded.facts[0]?.map((f) => [f.dimension, f.provenance])).toEqual([
      ["company.stage", "APPLICANT_PROVIDED"],
      ["company.country", "APPLICANT_PROVIDED"],
      ["raise.amount", "UNKNOWN"],
      ["raise.currency", "UNKNOWN"],
    ]);
  });

  it("refuses a forged credential with the same 404 as every guest refusal", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_ANSWERS_PATH,
      headers: { authorization: `Bearer gqs_${"z".repeat(43)}` },
      payload: { stage: "seed" },
    });
    expect(response.statusCode).toBe(404);
    expect(recorded.facts).toEqual([]);
  });

  it("refuses an outcome, a tenant or a float amount in the body", async () => {
    const { app } = build();
    for (const payload of [
      { access: "MAY_APPLY" },
      { tenantId: "c0000000-0000-4000-8000-000000000001" },
      { raise: { amount: 1200000, currency: "USD" } },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_ANSWERS_PATH,
        headers: bearer,
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
  });
});
