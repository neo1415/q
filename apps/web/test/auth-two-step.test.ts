import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two-step verification and email confirmation at the web boundary.
 *
 * The Auth server is a fake that keeps one person: whether their address is
 * confirmed, whether they have a verified authenticator factor, and the
 * assurance level their session reached. Every check here is what the web
 * app does with the Auth server's answers; the API and q-api refuse an aal1
 * token on their own (packages/security tests).
 */

const USER_ID = "a0000000-0000-4000-8000-000000000001";

type Person = {
  confirmed: boolean;
  factor: "none" | "unverified" | "verified";
  aal: "aal1" | "aal2" | null; // null: no session
  authReachable: boolean;
};

const person: Person = {
  confirmed: true,
  factor: "none",
  aal: null,
  authReachable: true,
};
const calls = {
  getUser: 0,
  resend: [] as unknown[],
  verify: [] as unknown[],
  unenroll: [] as unknown[],
};

class FakeAuthApiError extends Error {
  readonly __isAuthError = true;
  readonly status = 400;
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "AuthApiError";
  }
}

function factors() {
  return person.factor === "none"
    ? []
    : [
        {
          id: "f0000000-0000-4000-8000-000000000001",
          factor_type: "totp",
          status: person.factor,
        },
      ];
}

function fakeAuth() {
  return {
    getClaims: () =>
      Promise.resolve(
        person.aal === null
          ? { data: null, error: null }
          : {
              data: { claims: { sub: USER_ID, aal: person.aal } },
              error: null,
            },
      ),
    getUser: () => {
      calls.getUser += 1;
      if (!person.authReachable || person.aal === null) {
        return Promise.resolve({
          data: { user: null },
          error: new Error("unreachable"),
        });
      }
      return Promise.resolve({
        data: { user: { id: USER_ID, factors: factors() } },
        error: null,
      });
    },
    signInWithPassword: ({ password }: { password: string }) => {
      if (password !== "right-password") {
        return Promise.resolve({
          data: { user: null, session: null },
          error: new FakeAuthApiError("invalid_credentials"),
        });
      }
      if (!person.confirmed) {
        return Promise.resolve({
          data: { user: null, session: null },
          error: new FakeAuthApiError("email_not_confirmed"),
        });
      }
      person.aal = "aal1";
      return Promise.resolve({
        data: { user: { id: USER_ID, factors: factors() }, session: {} },
        error: null,
      });
    },
    signUp: () =>
      Promise.resolve({
        // Confirmation on: an account, no session, an email sent.
        data: { user: { id: USER_ID }, session: null },
        error: null,
      }),
    resend: (input: unknown) => {
      calls.resend.push(input);
      return Promise.resolve({ data: {}, error: null });
    },
    exchangeCodeForSession: () => {
      person.confirmed = true;
      person.aal = "aal1";
      return Promise.resolve({ error: null });
    },
    verifyOtp: () => {
      person.aal = "aal1";
      return Promise.resolve({ error: null });
    },
    mfa: {
      listFactors: () => {
        const all = factors();
        return Promise.resolve({
          data: {
            all,
            totp: all.filter((factor) => factor.status === "verified"),
            phone: [],
            webauthn: [],
          },
          error: null,
        });
      },
      challengeAndVerify: (input: { factorId: string; code: string }) => {
        calls.verify.push(input);
        if (input.code !== "123456") {
          return Promise.resolve({
            data: null,
            error: new FakeAuthApiError("mfa_verification_failed"),
          });
        }
        person.aal = "aal2";
        if (person.factor === "unverified") person.factor = "verified";
        return Promise.resolve({ data: {}, error: null });
      },
      unenroll: (input: unknown) => {
        calls.unenroll.push(input);
        person.factor = "none";
        return Promise.resolve({ data: {}, error: null });
      },
      enroll: () =>
        Promise.resolve({
          data: {
            id: "f0000000-0000-4000-8000-000000000002",
            totp: {
              qr_code: "data:image/svg+xml;utf-8,<svg/>",
              secret: "SECRET",
              uri: "otpauth://totp/x",
            },
          },
          error: null,
        }),
    },
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  isAuthApiError: (error: unknown) => error instanceof FakeAuthApiError,
}));
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({
    auth: {
      appOrigin: "https://capitalq.test",
      supabase: {
        url: "http://127.0.0.1:54321",
        publishableKey: "disabled-locally-000000000000",
      },
    },
  }),
}));
vi.mock("../src/auth/cookie-options", () => ({
  sessionCookieOptions: () => ({}),
}));
vi.mock("../src/auth/supabase-server", () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: fakeAuth() }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: fakeAuth() }),
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ delete: () => undefined }),
}));
class Redirect extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect ${to}`);
    this.to = to;
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  // Per-request memoisation is React's; each call here is its own request.
  cache: <T>(fn: T) => fn,
}));

const actions = await import("../src/auth/actions");
const { GET: callback } = await import("../app/auth/callback/route");
const { handleSessionProxy } = await import("../src/auth/session-proxy");
const secondStep = await import("../src/auth/second-step");
const settingsActions = await import("../src/auth/two-step-actions");

const IDLE = { status: "idle" } as const;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

const at = (path: string) =>
  handleSessionProxy(new NextRequest(new URL(path, "https://capitalq.test")));
const locationOf = (response: Response) => {
  const location = response.headers.get("location");
  return location === null
    ? null
    : `${new URL(location).pathname}${new URL(location).search}`;
};

beforeEach(() => {
  Object.assign(person, {
    confirmed: true,
    factor: "none",
    aal: null,
    authReachable: true,
  });
  calls.getUser = 0;
  calls.resend = [];
  calls.verify = [];
  calls.unenroll = [];
  secondStep.forgetFactorLookup(USER_ID);
});

describe("the rule", () => {
  it("owes a second step only with a verified factor and less than aal2", () => {
    expect(
      secondStep.requiresSecondStep({ aal: "aal1", hasVerifiedFactor: true }),
    ).toBe(true);
    expect(
      secondStep.requiresSecondStep({
        aal: undefined,
        hasVerifiedFactor: true,
      }),
    ).toBe(true);
    expect(
      secondStep.requiresSecondStep({ aal: "aal2", hasVerifiedFactor: true }),
    ).toBe(false);
    expect(
      secondStep.requiresSecondStep({ aal: "aal1", hasVerifiedFactor: false }),
    ).toBe(false);
  });

  it("returns only to a safe path, or to choosing a new password", () => {
    expect(secondStep.resolveSecondStepReturn("/settings")).toBe("/settings");
    expect(secondStep.resolveSecondStepReturn("/auth/update-password")).toBe(
      "/auth/update-password",
    );
    expect(secondStep.resolveSecondStepReturn("https://evil.example")).toBe(
      "/welcome",
    );
    expect(secondStep.resolveSecondStepReturn("/auth/sign-in")).toBe(
      "/welcome",
    );
  });

  it("asks the Auth server once a minute per person, never for an aal2 session", async () => {
    person.aal = "aal1";
    const client = { auth: fakeAuth() } as never;
    await secondStep.secondStepRequired(client, { sub: USER_ID, aal: "aal1" });
    await secondStep.secondStepRequired(client, { sub: USER_ID, aal: "aal1" });
    expect(calls.getUser).toBe(1);
    await secondStep.secondStepRequired(client, { sub: USER_ID, aal: "aal2" });
    expect(calls.getUser).toBe(1);
  });

  it("fails closed when the Auth server cannot be asked", async () => {
    person.aal = "aal1";
    person.authReachable = false;
    await expect(
      secondStep.secondStepRequired({ auth: fakeAuth() } as never, {
        sub: USER_ID,
        aal: "aal1",
      }),
    ).resolves.toBe(true);
  });
});

describe("the proxy treats a session owing its code as not signed in", () => {
  it("sends an enrolled aal1 session from an app route to the code page", async () => {
    person.factor = "verified";
    person.aal = "aal1";
    expect(locationOf(await at("/settings?tab=x"))).toBe(
      `/auth/two-step?next=${encodeURIComponent("/settings?tab=x")}`,
    );
  });

  it("lets an aal2 session of an enrolled person through", async () => {
    person.factor = "verified";
    person.aal = "aal2";
    expect(locationOf(await at("/settings"))).toBeNull();
  });

  it("lets an un-enrolled aal1 session through (the demo accounts)", async () => {
    person.aal = "aal1";
    expect(locationOf(await at("/settings"))).toBeNull();
    // An unfinished setup is not a factor.
    person.factor = "unverified";
    secondStep.forgetFactorLookup(USER_ID);
    expect(locationOf(await at("/settings"))).toBeNull();
  });

  it("still shows sign-in to a session owing its code", async () => {
    person.factor = "verified";
    person.aal = "aal1";
    expect(locationOf(await at("/auth/sign-in"))).toBeNull();
    person.factor = "none";
    secondStep.forgetFactorLookup(USER_ID);
    expect(locationOf(await at("/auth/sign-in"))).toBe("/welcome");
  });
});

describe("password sign-in", () => {
  it("goes straight on for a person without a factor", async () => {
    await expect(
      redirectOf(() =>
        actions.signInWithPasswordAction(
          IDLE,
          form({
            email: "p@example.invalid",
            password: "right-password",
            next: "/discover",
          }),
        ),
      ),
    ).resolves.toBe("/discover");
  });

  it("goes to the code page, keeping the return path, with a factor", async () => {
    person.factor = "verified";
    await expect(
      redirectOf(() =>
        actions.signInWithPasswordAction(
          IDLE,
          form({
            email: "p@example.invalid",
            password: "right-password",
            next: "/discover",
          }),
        ),
      ),
    ).resolves.toBe("/auth/two-step?next=%2Fdiscover");
  });

  it("says to confirm the email, and offers the link again, only with the right password", async () => {
    person.confirmed = false;
    await expect(
      actions.signInWithPasswordAction(
        IDLE,
        form({ email: "p@example.invalid", password: "right-password" }),
      ),
    ).resolves.toMatchObject({
      status: "unconfirmed",
      email: "p@example.invalid",
    });
    // A wrong password learns nothing about the account.
    await expect(
      actions.signInWithPasswordAction(
        IDLE,
        form({ email: "p@example.invalid", password: "wrong" }),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "Email or password wasn't recognised.",
    });
  });

  it("resends the confirmation link to the callback, then shows check-email", async () => {
    await expect(
      redirectOf(() =>
        actions.resendConfirmationAction(
          IDLE,
          form({ email: "p@example.invalid", next: "/discover" }),
        ),
      ),
    ).resolves.toBe("/auth/check-email?purpose=confirm");
    expect(calls.resend).toEqual([
      {
        type: "signup",
        email: "p@example.invalid",
        options: {
          emailRedirectTo:
            "https://capitalq.test/auth/callback?next=%2Fdiscover",
        },
      },
    ]);
  });
});

describe("sign-up with confirmation on: check-email, callback, first page", () => {
  it("sends a new account to check its email when no session comes back", async () => {
    await expect(
      redirectOf(() =>
        actions.signUpWithPasswordAction(
          IDLE,
          form({
            email: "new@example.invalid",
            password: "long-enough-password",
            fullName: "New Person",
            journey: "founder",
          }),
        ),
      ),
    ).resolves.toBe("/auth/check-email?purpose=confirm");
  });

  it("lands the confirmation link on the safe return path", async () => {
    person.confirmed = false;
    const response = await callback(
      new NextRequest(
        "https://capitalq.test/auth/callback?code=abc&next=%2Fdiscover",
      ),
    );
    expect(locationOf(response)).toBe("/discover");
    expect(person.confirmed).toBe(true);
  });

  it("sends a Google, link or recovery sign-in with a factor to the code page", async () => {
    person.factor = "verified";
    expect(
      locationOf(
        await callback(
          new NextRequest(
            "https://capitalq.test/auth/callback?code=abc&next=%2Fdiscover",
          ),
        ),
      ),
    ).toBe("/auth/two-step?next=%2Fdiscover");
    expect(
      locationOf(
        await callback(
          new NextRequest(
            "https://capitalq.test/auth/callback?code=abc&flow=recovery",
          ),
        ),
      ),
    ).toBe("/auth/two-step?next=%2Fauth%2Fupdate-password");
  });

  it("leaves a Google sign-in without a factor unchanged", async () => {
    expect(
      locationOf(
        await callback(
          new NextRequest("https://capitalq.test/auth/callback?code=abc"),
        ),
      ),
    ).toBe("/welcome");
  });
});

describe("the code page's action", () => {
  beforeEach(() => {
    person.factor = "verified";
    person.aal = "aal1";
  });

  it("refuses a wrong code and a malformed one", async () => {
    await expect(
      actions.verifySecondStepAction(IDLE, form({ code: "000000" })),
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      actions.verifySecondStepAction(IDLE, form({ code: "12ab56" })),
    ).resolves.toMatchObject({ status: "error" });
    expect(person.aal).toBe("aal1");
  });

  it("verifies the session's own factor, then goes on", async () => {
    await expect(
      redirectOf(() =>
        actions.verifySecondStepAction(
          IDLE,
          form({ code: "123 456", next: "/discover" }),
        ),
      ),
    ).resolves.toBe("/discover");
    expect(calls.verify).toEqual([
      { factorId: "f0000000-0000-4000-8000-000000000001", code: "123456" },
    ]);
    expect(person.aal).toBe("aal2");
  });
});

describe("Settings → Security", () => {
  it("turns it on: a factor, its QR code, then the first code", async () => {
    person.aal = "aal1";
    const started = await settingsActions.startTwoStepAction();
    expect(started).toMatchObject({ status: "enrolling", secret: "SECRET" });
    person.factor = "unverified";
    await expect(
      redirectOf(() =>
        settingsActions.confirmTwoStepAction(
          IDLE,
          form({
            code: "123456",
            factorId: "f0000000-0000-4000-8000-000000000001",
          }),
        ),
      ),
    ).resolves.toBe("/settings/security?two-step=on");
    expect(person.factor).toBe("verified");
  });

  it("turns it off only with a fresh code", async () => {
    person.factor = "verified";
    person.aal = "aal2";
    await expect(
      settingsActions.turnOffTwoStepAction(IDLE, form({ code: "000000" })),
    ).resolves.toMatchObject({ status: "error" });
    expect(calls.unenroll).toEqual([]);
    await expect(
      redirectOf(() =>
        settingsActions.turnOffTwoStepAction(IDLE, form({ code: "123456" })),
      ),
    ).resolves.toBe("/settings/security?two-step=off");
    expect(person.factor).toBe("none");
  });

  it("refuses a session that still owes its code", async () => {
    person.factor = "verified";
    person.aal = "aal1";
    await expect(
      redirectOf(() =>
        settingsActions.turnOffTwoStepAction(IDLE, form({ code: "123456" })),
      ),
    ).resolves.toBe("/auth/sign-in?next=%2Fsettings%2Fsecurity");
    expect(calls.unenroll).toEqual([]);
  });
});
