import { describe, expect, it, vi } from "vitest";

import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import { DISCOVERY_GAPS } from "@capital-q/q-core";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createConversationDiscoveryRead } from "../src/composition/conversation-core-state.js";
import { discoveryCoverageOf } from "../src/composition/discovery-coverage.js";
import { patientTurnTaking } from "../src/voice/turn-patience.js";

/**
 * HQ-5: discovery's gap model reads the onboarding steps that exist, from
 * their own setup; a voice line on a conversation in discovery is patient.
 */
describe("discovery mode in q-api (HQ-5)", () => {
  it("every gap's onboarding step is a real step of that journey", () => {
    const founder = new Set<string>(Object.values(FOUNDER_STEPS));
    const investor = new Set<string>(Object.values(INVESTOR_STEPS));
    for (const gap of DISCOVERY_GAPS.FOUNDER) {
      for (const step of gap.steps) expect(founder.has(step), step).toBe(true);
    }
    for (const gap of DISCOVERY_GAPS.INVESTOR) {
      for (const step of gap.steps) expect(investor.has(step), step).toBe(true);
    }
  });

  it("covers what their latest setup answered", () => {
    expect(
      discoveryCoverageOf([
        {
          journeyType: "investor",
          lastActivityAt: "2026-11-01T00:00:00Z",
          values: { "I3.sectors": ["fintech"] },
        },
        {
          journeyType: "founder",
          lastActivityAt: "2026-11-10T00:00:00Z",
          values: { "F1.stage": "seed", "F6.target_amount": "1500000" },
        },
      ]),
    ).toEqual({ side: "FOUNDER", known: ["STAGE", "RAISE_AMOUNT"] });
    expect(discoveryCoverageOf([])).toBeNull();
  });

  it("is patient while discovering", () => {
    expect(patientTurnTaking({ discovery: true })).toBe(true);
    expect(patientTurnTaking({ discovery: false })).toBe(false);
  });

  const actor: ActorContext = {
    userId: UserIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    tenantId: TenantIdSchema.parse("00000000-0000-4000-8000-000000000002"),
    actorType: "HUMAN",
  };
  const conversation = "00000000-0000-4000-8000-000000000003";

  const sqlReturning = (rows: Promise<unknown>) =>
    (() => rows) as unknown as DatabaseExecutor;

  it("reads their own conversation's snapshot", async () => {
    const read = createConversationDiscoveryRead({
      sql: sqlReturning(
        Promise.resolve([
          {
            core_state: {
              v: 1,
              unclearInARow: 0,
              lastAction: null,
              sequence: null,
              focus: null,
              discovery: {
                active: true,
                asked: ["TRACTION"],
                underspecifiedInARow: 0,
                exited: null,
              },
            },
          },
        ]),
      ),
    });
    expect(await read(actor, conversation)).toBe(true);
    expect(await read(actor, "not-a-uuid")).toBe(false);
  });

  it("opens the line without it when the read is slow or fails", async () => {
    vi.useFakeTimers();
    try {
      const slow = createConversationDiscoveryRead({
        sql: sqlReturning(new Promise(() => undefined)),
        deadlineMs: 300,
      });
      const pending = slow(actor, conversation);
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const failing = createConversationDiscoveryRead({
      sql: sqlReturning(Promise.reject(new Error("down"))),
    });
    expect(await failing(actor, conversation)).toBe(false);
  });
});
