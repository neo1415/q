import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  NETWORK_EVENTS,
  relationshipCommitmentChangedEvent,
} from "@capital-q/network/events";

import { withCommitmentNotices } from "../src/network/commitment-notice-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * SPEC §5 scenario H, "duplicate event". pgmq delivers at least once, and
 * the dead q.action rows (DEF-A1) will be delivered late once requeued. A
 * consumer that tells a person something must tell them once: the notice
 * is keyed by the outbox event id, and the store refuses a second row for
 * the same (user, key).
 */

const REPO = resolve(import.meta.dirname, "../../..");
const registry = createEventRegistry([...NETWORK_EVENTS]);

describe("a redelivered event tells nobody twice (scenario H)", () => {
  it("passes the same dedupe key, the outbox event id, on every delivery", async () => {
    const keys: string[] = [];
    let downstream = 0;
    const handle = withCommitmentNotices(
      (): Promise<MessageOutcome> => {
        downstream += 1;
        return Promise.resolve({ kind: "DONE" });
      },
      {
        registry,
        sql: ((strings: TemplateStringsArray) =>
          strings.join("?").includes("network.commitments")
            ? Promise.resolve([
                {
                  company: "Fictional Co",
                  investor: "Ada Capital",
                  amount: "250000",
                  currency: "EUR",
                },
              ])
            : Promise.reject(
                new Error("unexpected query"),
              )) as unknown as DatabaseExecutor,
        notices: {
          notify: (input) => {
            keys.push(input.key);
            return Promise.resolve(keys.length === 1 ? 1 : 0);
          },
        },
        logger: createRecordingLogger(),
      },
    );
    const event = relationshipCommitmentChangedEvent({
      tenantId: TENANT_A,
      actorUserId: "b0000000-0000-4000-8000-000000000001",
      correlationId: `cor_${randomUUID()}`,
      relationshipId: "88888888-0000-4000-8000-000000000009",
      commitmentId: "77777777-0000-4000-8000-000000000009",
      step: "TRANSFER_SENT",
      side: "INVESTOR",
    });
    const delivery = (readCount: number): QueueMessage => ({
      msgId: 7,
      readCount,
      enqueuedAt: new Date().toISOString(),
      message: event,
    });

    await handle(delivery(1));
    await handle(delivery(2));

    expect(keys).toEqual([event.id, event.id]);
    // Redelivery still reaches the rest of the chain (the projection is
    // itself idempotent); only the person is not told twice.
    expect(downstream).toBe(2);
  });

  it("the notification store refuses a second row for the same person and key", () => {
    const notices = readFileSync(
      resolve(REPO, "packages/communication/src/counterpart-notices.ts"),
      "utf8",
    );
    expect(notices).toContain("on conflict (user_id, dedupe_key) do nothing");
    const migration = readFileSync(
      resolve(
        REPO,
        "supabase/migrations/20261019090000_communication_meetings_reminders.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(/unique \(user_id, dedupe_key\)/);
  });
});
