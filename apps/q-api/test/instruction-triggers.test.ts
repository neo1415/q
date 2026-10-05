import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { handleEverythingGrant } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  inScope,
  instructionPeople,
  type InstructionFiringResult,
} from "../src/composition/instructions/engine.js";
import { createInstructionTriggers } from "../src/composition/instructions/triggers.js";

/** ADR 0043 S4: when instructions fire, and who they may concern. */

const actor = ActorContextSchema.parse({
  userId: randomUUID(),
  tenantId: randomUUID(),
  actorType: "HUMAN",
});

function result(
  outcome: InstructionFiringResult["outcome"],
): InstructionFiringResult {
  return { outcome, done: 0, asked: 0, refused: 0, cannot: [] };
}

describe("instruction triggers", () => {
  it("fires each claimed instruction once under its claim's run key; outside hours it is deferred", async () => {
    const claimedAt = new Date("2026-10-07T09:00:00Z");
    const [a, b] = [randomUUID(), randomUUID()];
    const fired: [string, string][] = [];
    const deferred: [string, number][] = [];
    let claims = 0;
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => {
          claims += 1;
          return Promise.resolve(
            claims === 1
              ? [
                  { id: a, claimed_at: claimedAt },
                  { id: b, claimed_at: claimedAt },
                ]
              : [],
          );
        },
        defer: (id, minutes) => {
          deferred.push([id, minutes]);
          return Promise.resolve();
        },
        wakeFor: () => Promise.resolve(0),
      },
      engine: () => ({
        fire: (id: string, runKey: string) => {
          fired.push([id, runKey]);
          return Promise.resolve(result(id === a ? "RAN" : "OUTSIDE_HOURS"));
        },
      }),
    });
    // Two sweeps at once on one instance: one pass.
    const [first, second] = await Promise.all([
      triggers.sweep(),
      triggers.sweep(),
    ]);
    expect([first, second]).toEqual([2, 2]);
    expect(claims).toBe(1);
    expect(fired).toEqual([
      [a, "sched-2026-10-07T09:00:00.000Z"],
      [b, "sched-2026-10-07T09:00:00.000Z"],
    ]);
    expect(deferred).toEqual([[b, 30]]);
  });

  it("a relationship event makes the instructions that worked on it due, and sweeps", async () => {
    let swept = 0;
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => {
          swept += 1;
          return Promise.resolve([]);
        },
        defer: () => Promise.resolve(),
        wakeFor: (relationshipId) =>
          Promise.resolve(relationshipId === "rel-known" ? 1 : 0),
      },
      engine: () => ({ fire: () => Promise.resolve(result("RAN")) }),
    });
    expect(await triggers.wake("rel-unknown")).toBe(0);
    expect(swept).toBe(0);
    expect(await triggers.wake("rel-known")).toBe(1);
    await triggers.sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
  });
  it("each sweep resolves 'needs your yes' notices whose cards are all answered (QA run 8a1d57b9)", async () => {
    let resolved = 0;
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => Promise.resolve([]),
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        resolveAnswered: () => {
          resolved += 1;
          return Promise.resolve(2);
        },
      },
      engine: () => ({ fire: () => Promise.resolve(result("RAN")) }),
    });
    await triggers.sweep();
    expect(resolved).toBe(1);
  });

  it("a chat message on a covered relationship makes its instructions due at once, and sweeps (QA run 8a1d57b9)", async () => {
    let swept = 0;
    const woken: string[] = [];
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => {
          swept += 1;
          return Promise.resolve([]);
        },
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        wakeForChat: (relationshipId) => {
          woken.push(relationshipId);
          return Promise.resolve(relationshipId === "rel-covered" ? 1 : 0);
        },
      },
      engine: () => ({ fire: () => Promise.resolve(result("RAN")) }),
    });
    expect(await triggers.wakeChat("rel-elsewhere")).toBe(0);
    expect(swept).toBe(0);
    expect(await triggers.wakeChat("rel-covered")).toBe(1);
    await triggers.sweep();
    expect(woken).toEqual(["rel-elsewhere", "rel-covered"]);
    expect(swept).toBeGreaterThanOrEqual(1);
  });

  it("on (re)start, accepts missed while nobody listened make their instructions due, and sweep (live 2026-10-05, Spheros)", async () => {
    let swept = 0;
    let missed = 1;
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => {
          swept += 1;
          return Promise.resolve([]);
        },
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        wakeForMissedMoves: () => {
          const now = missed;
          missed = 0;
          return Promise.resolve(now);
        },
      },
      engine: () => ({ fire: () => Promise.resolve(result("RAN")) }),
    });
    expect(await triggers.catchUpMoves()).toBe(1);
    await triggers.sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    // Idempotent: a second start finds nothing new.
    expect(await triggers.catchUpMoves()).toBe(0);
  });

  it("a company becoming ready brings forward instructions open to new companies (founder 2026-10-05)", async () => {
    const asked: string[] = [];
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => Promise.resolve([]),
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        wakeForNewCompany: (companyId) => {
          asked.push(companyId);
          return Promise.resolve(1);
        },
      },
      engine: () => ({ fire: () => Promise.resolve(result("RAN")) }),
    });
    expect(await triggers.wakeNewCompany("company-1")).toBe(1);
    expect(asked).toEqual(["company-1"]);
  });
});

describe("who an instruction may concern", () => {
  const REL = randomUUID();
  const CONNECTED = randomUUID();
  const SAVED = randomUUID();
  const FEED = randomUUID();
  const PASSED = randomUUID();

  const people = () =>
    instructionPeople(actor, {
      relationships: () =>
        Promise.resolve({
          items: [
            {
              relationshipId: REL,
              counterpart: { kind: "COMPANY", id: CONNECTED, name: "Acme" },
              state: "CONNECTED",
            },
            {
              relationshipId: randomUUID(),
              counterpart: { kind: "COMPANY", id: randomUUID(), name: "Gone" },
              state: "DECLINED",
            },
          ],
        }),
      feed: () =>
        Promise.resolve([
          { companyId: FEED, name: "New Co" },
          { companyId: CONNECTED, name: "Acme" },
          { companyId: PASSED, name: "Passed Co" },
        ]),
      decisions: () =>
        Promise.resolve([
          { companyId: SAVED, name: "Saved Co", decision: "SAVED" },
          { companyId: PASSED, name: "Passed Co", decision: "PASSED" },
        ]),
    });

  it("relationships, then saved and feed companies; never declined or passed; each once", async () => {
    const found = await people();
    expect(found.map((person) => [person.counterpartId, person.state])).toEqual(
      [
        [CONNECTED, "CONNECTED"],
        [SAVED, "SAVED_NOT_CONTACTED"],
        [FEED, "IN_FEED_NOT_CONTACTED"],
      ],
    );
  });

  it("new companies are in scope only when the grant includes them", async () => {
    const found = await people();
    const base = handleEverythingGrant({ timeZone: "UTC" });
    expect(inScope(base, found).map((p) => p.counterpartId)).toEqual([
      CONNECTED,
    ]);
    const monitor = handleEverythingGrant({
      timeZone: "UTC",
      includeNewCompanies: true,
    });
    expect(inScope(monitor, found)).toHaveLength(3);
  });

  it("a read that fails leaves the others", async () => {
    const found = await instructionPeople(actor, {
      relationships: () => Promise.reject(new Error("down")),
      feed: () => Promise.resolve([{ companyId: FEED, name: "New Co" }]),
      decisions: () => Promise.reject(new Error("down")),
    });
    expect(found.map((person) => person.counterpartId)).toEqual([FEED]);
  });
});
