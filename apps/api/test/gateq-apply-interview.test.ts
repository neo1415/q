import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  ApplicationContactResponseSchema,
  ApplicationCoverageDtoSchema,
  ApplicationTranscriptDtoSchema,
  GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
  GATEQ_APPLY_CONTACT_CONFIRM_PATH,
  GATEQ_APPLY_CONTACT_PATH,
  GATEQ_APPLY_COVERAGE_PATH,
  GATEQ_APPLY_SUBMIT_PATH,
  GATEQ_APPLY_TRANSCRIPT_PATH,
  type ApplicationContactResponse,
  type ApplicationCoverageDto,
} from "@capital-q/contracts";
import {
  createGuestThrottle,
  GATEQ_GUEST_QUOTAS,
  IntakeRefusedError,
  type ApplicantTurnResult,
  type ContactDetails,
  type ConversationService,
  type IntakeService,
} from "@capital-q/gateq-intake";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * GateQ slice 1 over HTTP: the contact, the transcript and the coverage
 * check. The same anonymous, credential-scoped surface as the rest of
 * `/v1/gateq/apply`: nothing about identity in a body, one 404 for every
 * wrong credential, a 429 for a spent allowance, and a 409 only for the
 * one refusal a founder can fix on the same screen.
 */

const TOKEN = `gqs_${"c".repeat(43)}`;
const OTHER = `gqs_${"d".repeat(43)}`;

const RESULT: ApplicantTurnResult = {
  reply: "",
  deduplicated: false,
  view: {
    reference: "ga_0123456789abcdefghjkmnpqrs",
    status: "IN_PROGRESS",
    declaredName: "Rails Ltd",
    facts: [],
    documentCount: 0,
    submittedAt: null,
  },
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
};

const CONTACT_RESPONSE: ApplicationContactResponse = {
  contact: {
    name: "Ada Founder",
    email: "ada@example.test",
    role: "CEO",
    companyName: "Rails Ltd",
    phone: null,
    preferredChannel: null,
    emailConfirmed: false,
    confirmedVia: null,
  },
  codeSent: true,
  codeExpiresInMinutes: 30,
};

const COVERAGE: ApplicationCoverageDto = {
  coverage: {
    version: 1,
    access: "MAY_APPLY",
    unmet: [],
    stillNeeded: [],
    answered: [
      {
        dimension: "company.country",
        label: "Where the company is based",
        group: "COMPANY",
        summary: "Nigeria",
        provenance: "APPLICANT_PROVIDED",
      },
    ],
    unknown: [],
    declined: [],
    missing: [
      {
        dimension: "company.team",
        label: "Team",
        group: "TEAM",
        reason: "UNDERSTANDING",
      },
    ],
    contradictions: [],
  },
  contact: { required: true, confirmed: false },
  documentCount: 0,
  transcriptTurns: 2,
};

function build(options: { readonly contactUnconfirmed?: boolean } = {}) {
  const recorded = {
    contacts: [] as { token: string; contact: ContactDetails }[],
    codes: [] as string[],
    accountCalls: 0,
  };
  const deny = () => {
    throw new IntakeRefusedError("SESSION_INVALID");
  };
  const intake = {
    authorise: (token: string) => {
      if (token !== TOKEN && token !== OTHER) deny();
      return Promise.resolve({
        sessionId: `s-${token.slice(-4)}`,
        application: {},
      });
    },
    startContact: (input: { token: string; contact: ContactDetails }) => {
      if (input.token !== TOKEN && input.token !== OTHER) deny();
      recorded.contacts.push(input);
      return Promise.resolve(CONTACT_RESPONSE);
    },
    confirmContact: (input: { token: string; code: string }) => {
      if (input.token !== TOKEN) deny();
      recorded.codes.push(input.code);
      return Promise.resolve(
        input.code === "123456"
          ? {
              status: "CONFIRMED",
              contact: {
                ...CONTACT_RESPONSE.contact,
                emailConfirmed: true,
                confirmedVia: "EMAIL_CODE",
              },
            }
          : { status: "WRONG_CODE", contact: CONTACT_RESPONSE.contact },
      );
    },
    coverage: (token: string) => {
      if (token !== TOKEN) deny();
      return Promise.resolve(COVERAGE);
    },
    submit: (input: { token: string }) => {
      if (input.token !== TOKEN) deny();
      if (options.contactUnconfirmed === true) {
        throw new IntakeRefusedError("CONTACT_NOT_CONFIRMED");
      }
      return Promise.resolve({
        submittedAt: "2026-10-13T12:00:00.000Z",
        qualification: {} as never,
        deduplicated: false,
      });
    },
  } as unknown as IntakeService;
  const conversation: ConversationService = {
    openingFor: () => Promise.resolve("Hi"),
    turn: () => Promise.reject(new Error("not used")),
    summary: (token) => {
      if (token !== TOKEN) deny();
      return Promise.resolve(RESULT);
    },
    transcript: (token) => {
      if (token !== TOKEN && token !== OTHER) deny();
      // Each credential sees its own application's conversation only.
      return Promise.resolve(
        token === TOKEN
          ? [
              {
                seq: 1,
                role: "PERSON",
                text: "We sell to banks.",
                at: "2026-10-13T11:00:00.000Z",
              },
              {
                seq: 2,
                role: "Q",
                text: "Who pays you?",
                at: "2026-10-13T11:00:01.000Z",
              },
            ]
          : [],
      );
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
    // The GateQ routes register as a group; this test reaches only the
    // account-contact route among them.
    gateq: {} as never,
    gateqApply: {
      intake,
      conversation,
      throttle: createGuestThrottle(),
    },
    gateqApplicationContact: () => {
      recorded.accountCalls += 1;
      return Promise.resolve(CONTACT_RESPONSE);
    },
  });
  return { app, recorded };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const CONTACT_BODY = {
  name: "Ada Founder",
  email: "Ada@Example.test",
  role: "CEO",
  companyName: "Rails Ltd",
};

describe("the applicant contact over HTTP (GateQ slice 1)", () => {
  it("saves the contact, sends a code and lowercases the email", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_PATH,
      headers: bearer(TOKEN),
      payload: {
        ...CONTACT_BODY,
        phone: "+234 800 000 0000",
        preferredChannel: "EMAIL",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      ApplicationContactResponseSchema.parse(response.json()).codeSent,
    ).toBe(true);
    expect(recorded.contacts[0]?.contact.email).toBe("ada@example.test");
    expect(recorded.contacts[0]?.token).toBe(TOKEN);
  });

  it("takes nothing about identity or confirmation from the body", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_PATH,
      headers: bearer(TOKEN),
      payload: { ...CONTACT_BODY, emailConfirmed: true, tenantId: "t" },
    });
    expect(response.statusCode).toBe(422);
    expect(recorded.contacts).toHaveLength(0);
  });

  it("refuses a forged credential with the same 404 as every guest refusal", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_PATH,
      headers: bearer(`gqs_${"z".repeat(43)}`),
      payload: CONTACT_BODY,
    });
    expect(response.statusCode).toBe(404);
    expect(recorded.contacts).toHaveLength(0);
  });

  it("stops sending codes once the session's allowance is spent", async () => {
    const { app, recorded } = build();
    const statuses: number[] = [];
    for (let i = 0; i <= GATEQ_GUEST_QUOTAS.CONTACT.limit; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_CONTACT_PATH,
        headers: bearer(TOKEN),
        payload: CONTACT_BODY,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(recorded.contacts).toHaveLength(GATEQ_GUEST_QUOTAS.CONTACT.limit);
    // Another applicant's allowance is their own.
    const other = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_PATH,
      headers: bearer(OTHER),
      payload: CONTACT_BODY,
    });
    expect(other.statusCode).toBe(200);
  });

  it("confirms with the six-digit code and reports a wrong one as such", async () => {
    const { app } = build();
    const wrong = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_CONFIRM_PATH,
      headers: bearer(TOKEN),
      payload: { code: "000000" },
    });
    expect(wrong.json<{ status: string }>().status).toBe("WRONG_CODE");
    const right = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_CONFIRM_PATH,
      headers: bearer(TOKEN),
      payload: { code: "123456" },
    });
    expect(right.statusCode).toBe(200);
    expect(right.json<{ status: string }>().status).toBe("CONFIRMED");
    const malformed = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_CONFIRM_PATH,
      headers: bearer(TOKEN),
      payload: { code: "12ab56" },
    });
    expect(malformed.statusCode).toBe(422);
  });

  it("refuses Submit with a 409 until the contact is confirmed", async () => {
    const { app } = build({ contactUnconfirmed: true });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_SUBMIT_PATH,
      headers: bearer(TOKEN),
      payload: { clientRequestId: "req-000000000001" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("RESOURCE_CONFLICT");
  });

  it("needs a signed-in account for the account-confirmed contact", async () => {
    const { app, recorded } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
      payload: { ...CONTACT_BODY, sessionToken: TOKEN },
    });
    expect(response.statusCode).toBe(401);
    expect(recorded.accountCalls).toBe(0);
  });
});

describe("the transcript and coverage over HTTP (GateQ slice 1)", () => {
  it("returns the applicant's own transcript, oldest first", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_TRANSCRIPT_PATH,
      headers: bearer(TOKEN),
    });
    expect(response.statusCode).toBe(200);
    const body = ApplicationTranscriptDtoSchema.parse(response.json());
    expect(body.turns.map((t) => t.role)).toEqual(["PERSON", "Q"]);
    const other = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_TRANSCRIPT_PATH,
      headers: bearer(OTHER),
    });
    expect(ApplicationTranscriptDtoSchema.parse(other.json()).turns).toEqual(
      [],
    );
  });

  it("refuses a missing credential with a 404", async () => {
    const { app } = build();
    for (const url of [
      GATEQ_APPLY_TRANSCRIPT_PATH,
      GATEQ_APPLY_COVERAGE_PATH,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
    }
  });

  it("returns the deterministic coverage check", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_COVERAGE_PATH,
      headers: bearer(TOKEN),
    });
    expect(response.statusCode).toBe(200);
    const body = ApplicationCoverageDtoSchema.parse(response.json());
    expect(body.coverage.missing.map((m) => m.dimension)).toEqual([
      "company.team",
    ]);
    expect(body.contact).toEqual({ required: true, confirmed: false });
  });
});

describe("the signed-in founder's contact over HTTP (GateQ slice 1)", () => {
  const PRINCIPAL: AuthenticatedPrincipal = {
    authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
  };
  const CONTEXT: ActorContext = {
    userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
    tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
    organisationId: OrganisationIdSchema.parse(
      "d0000000-0000-4000-8000-000000000001",
    ),
    membershipId: MembershipIdSchema.parse(
      "e0000000-0000-4000-8000-000000000001",
    ),
    actorType: "HUMAN",
  };

  function signedIn() {
    const calls: { actor: ActorContext; sessionToken: string }[] = [];
    const security: ApiSecurityDependencies = {
      authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    };
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      gateq: {} as never,
      gateqApplicationContact: ({ actor, request }) => {
        calls.push({ actor, sessionToken: request.sessionToken });
        // As the composition: the guest credential is verified first.
        if (request.sessionToken !== TOKEN) {
          throw new IntakeRefusedError("SESSION_INVALID");
        }
        return Promise.resolve({
          ...CONTACT_RESPONSE,
          contact: {
            ...CONTACT_RESPONSE.contact,
            emailConfirmed: true,
            confirmedVia: "ACCOUNT",
          },
          codeSent: false,
          codeExpiresInMinutes: null,
        });
      },
    });
    return { app, calls };
  }

  it("confirms through the server-resolved actor, never the body", async () => {
    const { app, calls } = signedIn();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
      payload: { ...CONTACT_BODY, sessionToken: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<ApplicationContactResponse>().contact.confirmedVia,
    ).toBe("ACCOUNT");
    expect(calls[0]?.actor.userId).toBe(CONTEXT.userId);
    const forged = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
      payload: {
        ...CONTACT_BODY,
        sessionToken: TOKEN,
        accountEmail: "ada@example.test",
        userId: "someone-else",
      },
    });
    expect(forged.statusCode).toBe(422);
  });

  it("answers another application's credential with the same 404", async () => {
    const { app } = signedIn();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
      payload: { ...CONTACT_BODY, sessionToken: OTHER },
    });
    expect(response.statusCode).toBe(404);
  });

  it("refuses a forged credential on the code confirmation with a 404", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_CONTACT_CONFIRM_PATH,
      headers: bearer(`gqs_${"z".repeat(43)}`),
      payload: { code: "123456" },
    });
    expect(response.statusCode).toBe(404);
  });
});
