import { describe, expect, it, vi } from "vitest";

/**
 * L1 latency sweep (2026-10-06): the app layout asked for the founder
 * journey, then the investor journey, one after the other on every page
 * (hosted GET /v1/onboarding/sessions/current p50 178 ms). They are now
 * asked side by side, with the same answer.
 */
const READ_MS = 120;
type JourneyStatus = "ACTIVE" | "COMPLETED" | 404;
const journeys = vi.hoisted(() => {
  const status: Record<string, JourneyStatus> = {};
  return { status, inFlight: 0, most: 0 };
});

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  getSessionAccessToken: () => Promise.resolve("token"),
}));
vi.mock("@capital-q/config/web", () => ({
  loadWebServerConfig: () => ({
    apiBaseUrl: "http://api.test",
    qApiBaseUrl: "http://q.test",
  }),
}));
vi.mock("@capital-q/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capital-q/api-client")>();
  return {
    ...actual,
    // An unfinished journey also asks which teams the person is in; no
    // network in a unit test (unmocked, it made this test slow and flaky).
    getMyOrganisations: () => Promise.resolve({ items: [] }),
    getCurrentOnboardingSession: (_session: unknown, journey: string) => {
      journeys.inFlight += 1;
      journeys.most = Math.max(journeys.most, journeys.inFlight);
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          journeys.inFlight -= 1;
          const status = journeys.status[journey] ?? 404;
          if (status === 404) {
            reject(new actual.ApiProblemError("Not Found", 404, "NOT_FOUND"));
          } else {
            resolve({ session: { status } });
          }
        }, READ_MS),
      );
    },
  };
});

const { resolveOnboardingState } = await import("./context");

describe("where a person stands with onboarding", () => {
  it("asks both journeys side by side: ~120 ms, not 240 ms, founder first", async () => {
    journeys.status = { founder: "ACTIVE", investor: "ACTIVE" };
    journeys.most = 0;
    // Fake timers, not the wall clock: on a loaded machine real time made
    // this flaky. Both reads finish after one READ_MS only if they overlap.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let settled = false;
      const state = resolveOnboardingState().finally(() => {
        settled = true;
      });
      // Let the reads start (real ticks; the read clock stays frozen).
      for (let tick = 0; tick < 200 && journeys.inFlight < 2; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(journeys.inFlight).toBe(2);
      await vi.advanceTimersByTimeAsync(READ_MS);
      // The answer's own continuations, on real ticks; the clock stays put,
      // so a read started only after the first finished could not land.
      for (let tick = 0; tick < 200 && !settled; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(settled).toBe(true);
      expect(await state).toEqual({ kind: "UNFINISHED", journey: "founder" });
      expect(journeys.most).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is DONE when either journey completed, whatever the other says", async () => {
    journeys.status = { founder: "ACTIVE", investor: "COMPLETED" };
    expect(await resolveOnboardingState()).toEqual({ kind: "DONE" });
  });

  it("a journey this person does not have (404) is not a failure", async () => {
    journeys.status = { investor: "ACTIVE" };
    expect(await resolveOnboardingState()).toEqual({
      kind: "UNFINISHED",
      journey: "investor",
    });
  });
});
