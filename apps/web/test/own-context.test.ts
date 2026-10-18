import { describe, expect, it, vi } from "vitest";

import type { ApiSession } from "@capital-q/api-client";
import type { MyOrganisationDto } from "@capital-q/contracts";

vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve(null),
}));

import {
  companyFromMemberships,
  createContextLookups,
  onboardingPath,
  resolveOwnContextWith,
} from "@/features/q/context";

/**
 * CQ-VERIFY-001 P1: `resolveOwnContext()` returned NONE for a signed-in
 * investor whenever the API could not be asked -- a restart of the local
 * stack, another process answering on the port, a session the API no
 * longer accepted -- because every failure was caught as "not an investor".
 * These tests pin the distinction: only the API's own answer is absence.
 */

const PROBLEM = "application/problem+json";

function problem(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      type: `urn:capitalq:problem:${code.toLowerCase().replace(/_/g, "-")}`,
      title: "A problem.",
      status,
      code,
      requestId: "req_00000000-0000-4000-8000-000000000000",
    }),
    { status, headers: { "content-type": PROBLEM } },
  );
}

function html(status: number): Response {
  return new Response("<html><body>Not Found</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

/** A session whose fetch answers from a queue, one response per call. */
function sessionAnswering(
  answers: readonly (Response | Error)[],
): ApiSession & { readonly calls: () => number } {
  const queue = [...answers];
  let calls = 0;
  const fetch: typeof globalThis.fetch = () => {
    calls += 1;
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("no answer queued"));
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  };
  return {
    baseUrl: "http://api.test",
    accessToken: "a.b.c",
    fetch,
    calls: () => calls,
  };
}

const noWait = () => Promise.resolve();
const connectionRefused = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    }),
  });

describe("own context lookups tell absence from an unreachable API", () => {
  const lookups = createContextLookups(noWait);

  it("a 404 problem from the API is absence, asked once", async () => {
    const session = sessionAnswering([problem(404, "RESOURCE_NOT_FOUND")]);
    await expect(lookups.investor(session)).resolves.toEqual({
      status: "ABSENT",
    });
    expect(session.calls()).toBe(1);
  });

  it("no organisation context yet (INVALID_REQUEST) is absence", async () => {
    const session = sessionAnswering([problem(400, "INVALID_REQUEST")]);
    await expect(lookups.investor(session)).resolves.toEqual({
      status: "ABSENT",
    });
  });

  it("a refused connection is unavailable, and is retried once", async () => {
    const session = sessionAnswering([
      connectionRefused(),
      connectionRefused(),
    ]);
    await expect(lookups.investor(session)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
    expect(session.calls()).toBe(2);
  });

  it("a 404 without a problem body is another process, not absence", async () => {
    const session = sessionAnswering([html(404), html(404)]);
    await expect(lookups.founder(session)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
    expect(session.calls()).toBe(2);
  });

  it("a session the API no longer accepts is unavailable", async () => {
    const session = sessionAnswering([
      problem(401, "AUTHENTICATION_REQUIRED"),
      problem(401, "AUTHENTICATION_REQUIRED"),
    ]);
    await expect(lookups.investor(session)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
  });

  it("a server error is unavailable", async () => {
    const session = sessionAnswering([
      problem(500, "INTERNAL_SERVER_ERROR"),
      problem(500, "INTERNAL_SERVER_ERROR"),
    ]);
    await expect(lookups.founder(session)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
  });

  it("the retry can turn a blip into the API's own answer", async () => {
    const session = sessionAnswering([
      connectionRefused(),
      problem(404, "RESOURCE_NOT_FOUND"),
    ]);
    await expect(lookups.investor(session)).resolves.toEqual({
      status: "ABSENT",
    });
    expect(session.calls()).toBe(2);
  });
});

describe("resolveOwnContext composes the two lookups honestly", () => {
  const session: ApiSession = {
    baseUrl: "http://api.test",
    accessToken: "a.b.c",
  };
  const absent = () => Promise.resolve({ status: "ABSENT" as const });
  const unavailable = () => Promise.resolve({ status: "UNAVAILABLE" as const });
  const investor = () =>
    Promise.resolve({
      status: "FOUND" as const,
      value: {
        kind: "INVESTOR" as const,
        investorOrganisationId: "c7592441-0be1-4b5f-9df4-0082c78cb5f4",
        label: "Apex",
      },
    });

  it("an investor is an investor even when the founder lookup could not be made", async () => {
    await expect(
      resolveOwnContextWith(session, { founder: unavailable, investor }),
    ).resolves.toEqual({
      kind: "INVESTOR",
      investorOrganisationId: "c7592441-0be1-4b5f-9df4-0082c78cb5f4",
      label: "Apex",
    });
  });

  it("nobody, when the API said so twice", async () => {
    await expect(
      resolveOwnContextWith(session, { founder: absent, investor: absent }),
    ).resolves.toEqual({ kind: "NONE" });
  });

  it("not known to be nobody, when the investor lookup could not be made", async () => {
    await expect(
      resolveOwnContextWith(session, {
        founder: absent,
        investor: unavailable,
      }),
    ).resolves.toEqual({ kind: "NONE", unavailable: true });
  });

  it("no session is plain NONE: there was nobody to ask about", async () => {
    await expect(
      resolveOwnContextWith(null, { founder: unavailable, investor }),
    ).resolves.toEqual({ kind: "NONE" });
  });
});

describe("F11/F23: a member's company comes from their memberships", () => {
  const org = (over: Partial<MyOrganisationDto>): MyOrganisationDto => ({
    organisationId: "00000000-0000-4000-8000-0000000000a1",
    name: "Ledgerline",
    kind: "COMPANY",
    organisationType: "company",
    role: "MEMBER",
    memberCount: 4,
    active: false,
    companyId: "00000000-0000-4000-8000-0000000000c1",
    ...over,
  });

  it("a member with no setup of their own lands in the company they joined", async () => {
    const lookups = createContextLookups(noWait, () =>
      Promise.resolve([org({})]),
    );
    // Founder journey: none (404). Investor: none (404).
    const session = sessionAnswering([
      problem(404, "RESOURCE_NOT_FOUND"),
      problem(404, "RESOURCE_NOT_FOUND"),
    ]);
    await expect(resolveOwnContextWith(session, lookups)).resolves.toEqual({
      kind: "FOUNDER",
      companyId: "00000000-0000-4000-8000-0000000000c1",
      label: "Ledgerline",
    });
  });

  it("the organisation they switched to wins; a firm means no company context", () => {
    const termly = org({
      organisationId: "00000000-0000-4000-8000-0000000000a2",
      name: "Termly",
      active: true,
      companyId: "00000000-0000-4000-8000-0000000000c2",
    });
    expect(companyFromMemberships([org({}), termly])).toEqual({
      companyId: "00000000-0000-4000-8000-0000000000c2",
      label: "Termly",
    });
    expect(
      companyFromMemberships([
        org({}),
        org({ kind: "FIRM", companyId: null, active: true }),
      ]),
    ).toBe("FIRM");
    // Two companies and none active: memberships do not decide.
    expect(
      companyFromMemberships([
        org({}),
        org({ companyId: "00000000-0000-4000-8000-0000000000c3" }),
      ]),
    ).toBeNull();
    expect(companyFromMemberships(null)).toBeNull();
  });
});

describe("F15: resuming setup", () => {
  it("goes back to the screen they were on, never live voice", () => {
    expect(onboardingPath({ kind: "UNFINISHED", journey: "founder" })).toBe(
      "/onboarding/founder?from=home",
    );
    expect(onboardingPath({ kind: "NEW" })).toBe("/welcome");
    expect(onboardingPath({ kind: "DONE" })).toBeNull();
  });
});
