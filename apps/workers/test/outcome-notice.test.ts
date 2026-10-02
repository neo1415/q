import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  NETWORK_EVENTS,
  relationshipOutcomeRecordedEvent,
  type RelationshipOutcome,
} from "@capital-q/network/events";

import {
  outcomeNotice,
  withOutcomeNotices,
} from "../src/network/outcome-notice-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * 2026-10-02: the founder hears "<Fund> has decided not to proceed for
 * now", with the reason only when the investor shared it.
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = "88888888-0000-4000-8000-000000000002";
const PASS = "77777777-0000-4000-8000-000000000002";
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});
const recorded = (
  outcome: RelationshipOutcome,
  side: "INVESTOR" | "COMPANY" = "INVESTOR",
) =>
  relationshipOutcomeRecordedEvent({
    tenantId: TENANT_A,
    organisationId: undefined,
    actorUserId: "b0000000-0000-4000-8000-000000000001",
    correlationId: `cor_${randomUUID()}`,
    relationshipId: RELATIONSHIP,
    companyId: "a0000000-0000-4000-8000-000000000001",
    investorOrganisationId: "11111111-0000-4000-8000-000000000013",
    outcome,
    side,
    ...(outcome === "PASSED" ? { passId: PASS } : {}),
  });

/** The pass query answers only when the query itself asks for a shared row. */
function harness(passShared: boolean) {
  const told: { title: string; body: string | null; kind: string }[] = [];
  const queries: string[] = [];
  const fake = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("investor_organisations")) {
      return Promise.resolve([{ name: "Ada Capital" }]);
    }
    if (text.includes("relationship_passes")) {
      return Promise.resolve(
        passShared && text.includes("p.share_with_founder")
          ? [{ label: "Timing", note: "Too early for this fund" }]
          : [],
      );
    }
    return Promise.reject(new Error(`unexpected: ${text}`));
  };
  const handle = withOutcomeNotices(
    (): Promise<MessageOutcome> => Promise.resolve({ kind: "DONE" }),
    {
      registry,
      sql: fake as unknown as DatabaseExecutor,
      notices: {
        notify: (input) => {
          told.push({ title: input.title, body: input.body, kind: input.kind });
          return Promise.resolve(1);
        },
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, told, queries };
}

describe("the founder's notice of an investor's outcome", () => {
  it("a private reason is never read, never told: only that they passed", async () => {
    const h = harness(false);
    await h.handle(message(recorded("PASSED")));
    expect(h.told).toEqual([
      {
        kind: "RELATIONSHIP_OUTCOME",
        title: "Ada Capital has decided not to proceed for now",
        body: "Thank you for the time you gave them. Your conversation stays where it is.",
      },
    ]);
    expect(h.queries.filter((q) => q.includes("relationship_passes"))).toEqual([
      expect.stringContaining("p.share_with_founder"),
    ]);
  });

  it("a shared reason is told", async () => {
    const h = harness(true);
    await h.handle(message(recorded("PASSED")));
    expect(h.told[0]?.body).toBe(
      'Their reason: Timing. "Too early for this fund"',
    );
  });

  it("pause and resume are told plainly; a founder's own outcome tells nobody here", async () => {
    const h = harness(false);
    await h.handle(message(recorded("PAUSED")));
    await h.handle(message(recorded("RESUMED")));
    await h.handle(message(recorded("DILIGENCE_STARTED")));
    await h.handle(message(recorded("PAUSED", "COMPANY")));
    expect(h.told.map((t) => t.title)).toEqual([
      "Ada Capital has paused for now",
      "Ada Capital has picked things up again",
    ]);
  });

  it("words: respectful, never 'rejected'", () => {
    const words = outcomeNotice({
      outcome: "PASSED",
      investor: "Ada Capital",
      sharedReason: null,
    });
    expect(`${words.title} ${words.body ?? ""}`).not.toMatch(/reject|declin/i);
  });
});
