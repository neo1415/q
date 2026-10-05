import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  NETWORK_EVENTS,
  relationshipCommitmentChangedEvent,
  type CommitmentStep,
} from "@capital-q/network/events";

import {
  moneyWords,
  withCommitmentNotices,
} from "../src/network/commitment-notice-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * 2026-10-04: each commitment step reaches the other side, by name and
 * amount, linking to their Capital page; a transfer reference never does.
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = "88888888-0000-4000-8000-000000000004";
const COMMITMENT = "77777777-0000-4000-8000-000000000004";
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});
const changed = (step: CommitmentStep, side: "INVESTOR" | "COMPANY") =>
  relationshipCommitmentChangedEvent({
    tenantId: TENANT_A,
    actorUserId: "b0000000-0000-4000-8000-000000000001",
    correlationId: `cor_${randomUUID()}`,
    relationshipId: RELATIONSHIP,
    commitmentId: COMMITMENT,
    step,
    side,
  });

function harness() {
  const told: {
    title: string;
    body: string | null;
    kind: string;
    actingSide: string;
    target: string;
    priority: string;
  }[] = [];
  const fake = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("network.commitments")) {
      expect(text).not.toContain("transfer_reference");
      return Promise.resolve([
        {
          company: "Fictional Co",
          investor: "Ada Capital",
          amount: "1000000",
          currency: "USD",
        },
      ]);
    }
    return Promise.reject(new Error(`unexpected: ${text}`));
  };
  const handle = withCommitmentNotices(
    (): Promise<MessageOutcome> => Promise.resolve({ kind: "DONE" }),
    {
      registry,
      sql: fake as unknown as DatabaseExecutor,
      notices: {
        notify: (input) => {
          told.push({
            title: input.title,
            body: input.body,
            kind: input.kind,
            actingSide: input.actingSide,
            target: input.target,
            priority: input.priority,
          });
          return Promise.resolve(1);
        },
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, told };
}

describe("the other side hears each commitment step", () => {
  it("names who acted and the amount, and links to Capital", async () => {
    const h = harness();
    await h.handle(message(changed("AMOUNT_STATED", "COMPANY")));
    await h.handle(message(changed("AMOUNT_CONFIRMED", "INVESTOR")));
    await h.handle(message(changed("TRANSFER_SENT", "INVESTOR")));
    await h.handle(message(changed("RECEIVED", "COMPANY")));
    expect(h.told).toEqual([
      {
        kind: "COMMITMENT",
        title: "Fictional Co confirmed USD 1,000,000",
        body: "Confirm the amount if it's right.",
        actingSide: "COMPANY",
        target: "CAPITAL",
        priority: "NEEDS_YOU",
      },
      {
        kind: "COMMITMENT",
        title: "Ada Capital confirmed USD 1,000,000",
        body: "Both sides have confirmed the amount.",
        actingSide: "INVESTOR",
        target: "CAPITAL",
        priority: "UPDATE",
      },
      {
        kind: "COMMITMENT",
        title: "Ada Capital sent USD 1,000,000",
        body: "Confirm when it arrives.",
        actingSide: "INVESTOR",
        target: "CAPITAL",
        priority: "NEEDS_YOU",
      },
      {
        kind: "COMMITMENT",
        title: "Fictional Co received USD 1,000,000",
        body: null,
        actingSide: "COMPANY",
        target: "CAPITAL",
        priority: "UPDATE",
      },
    ]);
  });

  it("writes money exactly, without a float", () => {
    expect(moneyWords("1500000.5", "NGN")).toBe("NGN 1,500,000.50");
    expect(moneyWords("12345678901234.99", "USD")).toBe(
      "USD 12,345,678,901,234.99",
    );
    expect(moneyWords("500000.00", "USD")).toBe("USD 500,000");
  });
});
