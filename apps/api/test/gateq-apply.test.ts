import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_APPLY_SESSION_PATH,
  GATEQ_APPLY_START_PATH,
  GATEQ_APPLY_SUBMIT_PATH,
  GATEQ_APPLY_TURN_PATH,
  GATEQ_TURN_MAX_CHARS,
} from "@capital-q/contracts";
import {
  createGuestThrottle,
  GATEQ_GUEST_QUOTAS,
  IntakeRefusedError,
  issueSessionToken,
  type ApplicantTurnResult,
  type ConversationService,
  type GuestThrottle,
  type IntakeService,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/gateq/apply` over HTTP (CQ-GATE-002R §2–§5, §23).
 *
 * The only anonymous write surface in the product. These cases are about
 * what it refuses, what it will not accept from a browser, and whether the
 * answer it gives is the deterministic one — not about the interview,
 * which is proved in the intake package.
 */

const TOKEN = `gqs_${"a".repeat(43)}`;
const PUBLIC_ID = "gq_0123456789abcdefghjkmnpqrs";
const REFERENCE = "ga_0123456789abcdefghjkmnpqrs";
const TENANT = "c0000000-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";

const RESULT: ApplicantTurnResult = {
  reply: "Lagos, got it. What does the product actually do for them?",
  deduplicated: false,
  view: {
    reference: REFERENCE,
    status: "IN_PROGRESS",
    declaredName: "KoboLogistics",
    facts: [
      {
        dimension: "company.country",
        value: { kind: "CODE", code: "NG" },
        provenance: "APPLICANT_PROVIDED",
      },
    ],
    documentCount: 0,
    submittedAt: null,
  },
  access: "NEEDS_INFORMATION",
  unmet: [],
  stillNeeded: ["Sector"],
};

type Recorded = {
  readonly starts: string[];
  readonly turns: { token: string; message: string; clientTurnId: string }[];
  readonly submits: { token: string; clientRequestId: string }[];
};

function buildApp(options: {
  readonly refuse?: boolean;
  readonly result?: ApplicantTurnResult;
  readonly submitDeduplicated?: boolean;
  readonly throttle?: GuestThrottle | undefined;
  readonly anyToken?: boolean;
}): { readonly app: FastifyInstance; readonly recorded: Recorded } {
  const recorded: Recorded = { starts: [], turns: [], submits: [] };
  const deny = () => {
    throw new IntakeRefusedError("SESSION_INVALID");
  };
  const result = options.result ?? RESULT;

  const intake = {
    // `charge` verifies before it counts, so the double must refuse an
    // unrecognised credential here exactly as the real service does --
    // otherwise a forged token would appear to earn a quota.
    authorise: (token: string) => {
      if (options.refuse === true) deny();
      if (options.anyToken !== true && token !== TOKEN) deny();
      return Promise.resolve({
        sessionId: `session-${token.slice(-8)}`,
        application: {},
      });
    },
    start: (input: { gatewayPublicId: string }) => {
      recorded.starts.push(input.gatewayPublicId);
      if (options.refuse === true) deny();
      return Promise.resolve({
        token: TOKEN,
        reference: REFERENCE,
        view: result.view,
        expiresAt: "2026-10-05T12:00:00.000Z",
      });
    },
    submit: (input: { token: string; clientRequestId: string }) => {
      recorded.submits.push(input);
      if (options.refuse === true) deny();
      return Promise.resolve({
        submittedAt: "2026-09-21T12:00:00.000Z",
        qualification: {} as never,
        deduplicated: options.submitDeduplicated ?? false,
      });
    },
  } as unknown as IntakeService;

  const conversation: ConversationService = {
    openingFor: () => {
      if (options.refuse === true) deny();
      return Promise.resolve("Hi — what are you building?");
    },
    turn: (input) => {
      // The real service authorises the credential before anything else,
      // so the double refuses an unrecognised one rather than pretending
      // the route is what stops it.
      if (options.refuse === true) deny();
      if (options.anyToken !== true && input.token !== TOKEN) deny();
      recorded.turns.push({
        token: input.token,
        message: input.message,
        clientTurnId: input.clientTurnId,
      });
      return Promise.resolve(result);
    },
    summary: (token) => {
      if (options.refuse === true) deny();
      if (options.anyToken !== true && token !== TOKEN) deny();
      return Promise.resolve(result);
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
    gateqApply: {
      intake,
      conversation,
      ...(options.throttle === undefined ? {} : { throttle: options.throttle }),
    },
  });
  return { app, recorded };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("starting an application", () => {
  it("needs no account and hands back the credential once", async () => {
    const { app, recorded } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_START_PATH,
      payload: { gatewayPublicId: PUBLIC_ID },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(recorded.starts).toEqual([PUBLIC_ID]);

    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(
      ["application", "expiresAt", "reply", "sessionToken"].sort(),
    );
    expect(body["sessionToken"]).toBe(TOKEN);
    // Q opened the conversation; nothing was appended to it by the route.
    expect(body["reply"]).toBe("Hi — what are you building?");
  });

  it("2: takes nothing about identity from the body", async () => {
    // A tenant, an investor organisation, a gateway version or an outcome
    // in the payload is not a field the server reads -- the schema has
    // nowhere to put them, so the request is refused outright.
    const { app } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_START_PATH,
      payload: {
        gatewayPublicId: PUBLIC_ID,
        tenantId: TENANT,
        investorOrganisationId: INVESTOR,
        access: "MAY_APPLY",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("3: an unknown, unpublished, closed or malformed gateway is one answer", async () => {
    const refused = buildApp({ refuse: true });
    for (const gatewayPublicId of [PUBLIC_ID, "gateway-1", ""]) {
      const response = await refused.app.inject({
        method: "POST",
        url: GATEQ_APPLY_START_PATH,
        payload: { gatewayPublicId },
      });
      expect([404, 422]).toContain(response.statusCode);
      // Never a hint about which of the four it was.
      const text = response.body.toLowerCase();
      for (const forbidden of [
        "closed",
        "unpublished",
        "sql",
        "gateq.",
        "uuid",
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe("the credential is the authority", () => {
  it("resumes with a valid bearer credential", async () => {
    const { app } = buildApp({});
    const response = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_SESSION_PATH,
      headers: bearer(TOKEN),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body["reference"]).toBe(REFERENCE);
    // GATE-001's answer, and the investor's own labels for what is still
    // needed -- never a threshold, a country list or a node id.
    expect(body["access"]).toBe("NEEDS_INFORMATION");
    expect(body["stillNeeded"]).toEqual(["Sector"]);
  });

  it("refuses a missing, malformed or wrong credential alike", async () => {
    const { app } = buildApp({});
    for (const headers of [
      {},
      bearer(""),
      bearer("not-a-token"),
      bearer(`gqs_${"b".repeat(43)}`),
      { authorization: TOKEN },
      { authorization: `Basic ${TOKEN}` },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: GATEQ_APPLY_SESSION_PATH,
        headers: headers as Record<string, string>,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("never returns an internal identifier", async () => {
    const { app } = buildApp({});
    const response = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_SESSION_PATH,
      headers: bearer(TOKEN),
    });
    const text = JSON.stringify(response.json());
    for (const forbidden of [
      TENANT,
      INVESTOR,
      "gatewayVersionId",
      "applicationId",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("a turn", () => {
  it("passes the message through and answers with the deterministic state", async () => {
    const { app, recorded } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      headers: bearer(TOKEN),
      payload: { message: "We're in Lagos.", clientTurnId: "turn-000000001" },
    });
    expect(response.statusCode).toBe(200);
    expect(recorded.turns).toEqual([
      {
        token: TOKEN,
        message: "We're in Lagos.",
        clientTurnId: "turn-000000001",
      },
    ]);
    const body = response.json<Record<string, unknown>>();
    expect(body["reply"]).toBe(RESULT.reply);
    expect(body["deduplicated"]).toBe(false);
    expect((body["application"] as Record<string, unknown>)["access"]).toBe(
      "NEEDS_INFORMATION",
    );
  });

  it("5: reports a replayed turn as the same turn", async () => {
    const { app } = buildApp({
      result: { ...RESULT, deduplicated: true },
    });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      headers: bearer(TOKEN),
      payload: { message: "We're in Lagos.", clientTurnId: "turn-000000001" },
    });
    expect(response.json<Record<string, unknown>>()["deduplicated"]).toBe(true);
  });

  it("4: refuses a message longer than the bound", async () => {
    // An anonymous conversational endpoint without a length bound is
    // somebody else's token budget.
    const { app, recorded } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      headers: bearer(TOKEN),
      payload: {
        message: "x".repeat(GATEQ_TURN_MAX_CHARS + 1),
        clientTurnId: "turn-000000001",
      },
    });
    expect(response.statusCode).toBe(422);
    // And it never reached the model.
    expect(recorded.turns).toEqual([]);
  });

  it("4: refuses an empty message and a missing turn id", async () => {
    const { app } = buildApp({});
    for (const payload of [
      { message: "", clientTurnId: "turn-000000001" },
      { message: "hello", clientTurnId: "short" },
      { message: "hello" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_TURN_PATH,
        headers: bearer(TOKEN),
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
  });

  it("19: the model's own sentence does not change the applicant's standing", async () => {
    // The reply claims one thing; the payload beside it carries GATE-001's
    // answer. They come from different places on purpose.
    const { app } = buildApp({
      result: {
        ...RESULT,
        reply: "Great news, looks like you qualify!",
        access: "MAY_NOT_APPLY",
        unmet: ["Where you are"],
        stillNeeded: [],
      },
    });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      headers: bearer(TOKEN),
      payload: { message: "anything", clientTurnId: "turn-000000001" },
    });
    const body = response.json<Record<string, unknown>>();
    const application = body["application"] as Record<string, unknown>;
    expect(body["reply"]).toContain("looks like you qualify");
    expect(application["access"]).toBe("MAY_NOT_APPLY");
    expect(application["unmet"]).toEqual(["Where you are"]);
  });

  it("refuses without a credential", async () => {
    const { app } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      payload: { message: "hello", clientTurnId: "turn-000000001" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("submission", () => {
  it("submits once and reports a retry as the same submission", async () => {
    const first = buildApp({});
    const ok = await first.app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(TOKEN),
      payload: { clientRequestId: "req-000000001" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Record<string, unknown>>()["deduplicated"]).toBe(false);
    expect(first.recorded.submits).toEqual([
      { token: TOKEN, clientRequestId: "req-000000001" },
    ]);

    const retried = buildApp({ submitDeduplicated: true });
    const again = await retried.app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(TOKEN),
      payload: { clientRequestId: "req-000000001" },
    });
    expect(again.json<Record<string, unknown>>()["deduplicated"]).toBe(true);
  });

  it("refuses a submission the door would not admit", async () => {
    const { app } = buildApp({ refuse: true });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(TOKEN),
      payload: { clientRequestId: "req-000000001" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("refuses a request with no idempotency key", async () => {
    const { app, recorded } = buildApp({});
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(TOKEN),
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(recorded.submits).toEqual([]);
  });
});

describe("what one credential may do", () => {
  const turn = (app: FastifyInstance, token: string) =>
    app.inject({
      method: "POST",
      url: GATEQ_APPLY_TURN_PATH,
      headers: bearer(token),
      payload: { message: "We are in Lagos.", clientTurnId: "turn-000000001" },
    });

  it("8: spends that credential's allowance and nobody else's", async () => {
    // The property that matters. A public conversational endpoint with one
    // global counter is a denial-of-service tool pointed at every other
    // applicant: one script, and nobody can finish an application.
    const { app } = buildApp({
      throttle: createGuestThrottle(),
      anyToken: true,
    });
    const guestA = issueSessionToken();
    const guestB = issueSessionToken();

    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      expect((await turn(app, guestA)).statusCode).toBe(200);
    }
    const limited = await turn(app, guestA);
    expect(limited.statusCode).toBe(429);

    // Guest B has touched nothing and is unaffected.
    expect((await turn(app, guestB)).statusCode).toBe(200);
  });

  it("8: says to come back later, not that the application vanished", async () => {
    // A 404 here would tell an honest founder their work was gone when
    // only their turn budget ran out.
    const { app } = buildApp({
      throttle: createGuestThrottle(),
      anyToken: true,
    });
    const guest = issueSessionToken();
    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit; i += 1) {
      await turn(app, guest);
    }
    const response = await turn(app, guest);
    expect(response.statusCode).toBe(429);
    const body = response.json<Record<string, unknown>>();
    expect(String(body["title"])).toContain("Too many requests");
    // Nothing about the credential, the quota or where the edge is. The
    // request id is a random UUID that can contain the limit's digits by
    // chance, so it is checked on its own and left out of the number check.
    const text = JSON.stringify(body);
    expect(text).not.toContain(guest);
    expect(text.toLowerCase()).not.toContain("quota");
    expect(String(body["requestId"])).toMatch(/^req_[0-9a-f-]{36}$/);
    const { requestId: _requestId, ...rest } = body;
    expect(JSON.stringify(rest)).not.toContain(
      String(GATEQ_GUEST_QUOTAS.TURN.limit),
    );
  });

  it("8: the raw credential never reaches the response on any path", async () => {
    const { app } = buildApp({
      throttle: createGuestThrottle(),
      anyToken: true,
    });
    const guest = issueSessionToken();
    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit + 1; i += 1) {
      const response = await turn(app, guest);
      expect(response.body).not.toContain(guest);
    }
  });

  it("8: a forged credential buys no quota and is still one 404", async () => {
    const throttle = createGuestThrottle();
    const { app } = buildApp({ throttle });
    const forged = issueSessionToken();

    // Well past the turn allowance, on a credential that does not verify.
    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit + 5; i += 1) {
      const response = await turn(app, forged);
      // The same refusal every real forgery gets; never a 429, which would
      // confirm the shape of the credential was at least plausible.
      expect(response.statusCode).toBe(404);
    }
    // And a real guest's allowance is untouched by any of it.
    const real = buildApp({ throttle, anyToken: true });
    expect((await turn(real.app, issueSessionToken())).statusCode).toBe(200);
  });

  it("8: submitting is its own allowance, so a long conversation can finish", async () => {
    const { app } = buildApp({
      throttle: createGuestThrottle(),
      anyToken: true,
    });
    const guest = issueSessionToken();
    for (let i = 0; i < GATEQ_GUEST_QUOTAS.TURN.limit + 1; i += 1) {
      await turn(app, guest);
    }
    const submitted = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(guest),
      payload: { clientRequestId: "req-000000001" },
    });
    expect(submitted.statusCode).toBe(200);
  });
});

describe("opening conversations from an embedded gateway (P7)", () => {
  it("caps how many conversations one gateway can be made to open, before any row", async () => {
    const { app, recorded } = buildApp({ throttle: createGuestThrottle() });
    const start = () =>
      app.inject({
        method: "POST",
        url: GATEQ_APPLY_START_PATH,
        payload: { gatewayPublicId: PUBLIC_ID },
      });
    for (let i = 0; i < GATEQ_GUEST_QUOTAS.START.limit; i += 1) {
      expect((await start()).statusCode).toBe(201);
    }
    const limited = await start();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["content-type"]).toContain(
      "application/problem+json",
    );
    // The refused start never reached the intake service.
    expect(recorded.starts).toHaveLength(GATEQ_GUEST_QUOTAS.START.limit);
  });
});
