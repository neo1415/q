import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import { createPostgresGateqVideoSessions } from "../src/video/postgres-video-sessions.js";

const APP = "00000000-0000-4000-8000-0000000000a1";
const TENANT = "00000000-0000-4000-8000-0000000000b1";

function recording(handler: (q: string) => readonly unknown[]) {
  const calls: string[] = [];
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push(q);
    return Promise.resolve(handler(q));
  }) as unknown as DatabaseExecutor;
  const transactions = {
    run: (work: (tx: { sql: DatabaseExecutor }) => Promise<unknown>) =>
      work({ sql }),
  } as unknown as TransactionManager;
  return {
    store: createPostgresGateqVideoSessions({ sql, transactions }),
    calls,
  };
}

const input = {
  id: "00000000-0000-4000-8000-0000000000c1",
  tenantId: TENANT,
  applicationId: APP,
  bridgeTokenHash: "a".repeat(64),
  eventsTokenHash: "b".repeat(64),
  guestCredentialSealed: "sealed",
  maxSeconds: 180,
  perApplication: 1,
  concurrency: 2,
};

describe("the video session store", () => {
  it("locks the application, then the global cap, before counting; refuses past the allowance", async () => {
    const { store, calls } = recording((q) =>
      q.startsWith("select status from gateq.applications")
        ? [{ status: "IN_PROGRESS" }]
        : q.startsWith("select ( select count(*)") ||
            q.startsWith("select (select count(*)")
          ? [{ used: 1, live: 0 }]
          : [],
    );
    expect(await store.reserve(input)).toEqual({ kind: "ALLOWANCE" });
    expect(calls[0]).toContain("for update");
    expect(calls[1]).toContain("pg_advisory_xact_lock");
    expect(calls.some((c) => c.startsWith("insert"))).toBe(false);
  });

  it("refuses at the concurrency cap and never reserves for a submitted application", async () => {
    const busy = recording((q) =>
      q.startsWith("select status from gateq.applications")
        ? [{ status: "IN_PROGRESS" }]
        : q.includes("as used")
          ? [{ used: 0, live: 2 }]
          : [],
    );
    expect(await busy.store.reserve(input)).toEqual({ kind: "CONCURRENCY" });
    const submitted = recording((q) =>
      q.startsWith("select status from gateq.applications")
        ? [{ status: "SUBMITTED" }]
        : [],
    );
    expect(await submitted.store.reserve(input)).toEqual({ kind: "ALLOWANCE" });
    expect(submitted.calls).toHaveLength(1);
  });

  it("fixes the end at creation from the database clock and the session's own cap", async () => {
    const { store, calls } = recording((q) =>
      q.startsWith("select status from gateq.applications")
        ? [{ status: "IN_PROGRESS" }]
        : q.includes("as used")
          ? [{ used: 0, live: 0 }]
          : q.startsWith("insert")
            ? [
                {
                  id: input.id,
                  tenant_id: TENANT,
                  application_id: APP,
                  status: "STARTING",
                  ended_reason: null,
                  provider_conversation_id: null,
                  join_url_sealed: null,
                  guest_credential_sealed: "sealed",
                  max_seconds: 180,
                  created_at: "2026-10-15T09:00:00Z",
                  ends_at: "2026-10-15T09:03:00Z",
                },
              ]
            : [],
    );
    const result = await store.reserve(input);
    expect(result).toMatchObject({ kind: "CREATED", row: { maxSeconds: 180 } });
    const insert = calls.find((c) => c.startsWith("insert"));
    expect(insert).toContain("now() + make_interval(secs => ?)");
  });

  it("finds a bridge session only by a well-formed hash", async () => {
    const { store, calls } = recording(() => []);
    expect(await store.byBridgeTokenHash("not-a-hash")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
