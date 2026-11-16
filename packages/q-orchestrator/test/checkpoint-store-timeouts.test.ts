import type pg from "pg";
import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_QUERY_DEADLINE_GRACE_MS,
  createPostgresQCheckpointStore,
} from "../src/checkpoint-store.js";

/**
 * The checkpoint pool is a second pool against the same database: it gets
 * the service's statement budget too, sent at connect and enforced by the
 * client, because the pooler drops startup parameters (16 Nov 2026).
 * Construction opens no socket.
 */

const URL = "postgresql://test:synthetic-test-value@127.0.0.1:9/test";

function poolOptions(store: { readonly saver: unknown }): pg.PoolConfig {
  return (
    store.saver as { readonly pool: pg.Pool & { options: pg.PoolConfig } }
  ).pool.options;
}

describe("checkpoint pool limits", () => {
  it("carries the statement budget and a client-side query deadline", async () => {
    const store = createPostgresQCheckpointStore({
      connectionString: URL,
      statementTimeoutMs: 10_000,
    });
    const options = poolOptions(store);
    expect(options.statement_timeout).toBe(10_000);
    expect(options.query_timeout).toBe(
      10_000 + CHECKPOINT_QUERY_DEADLINE_GRACE_MS,
    );
    await store.close();
  });

  it("sets neither when no budget is given", async () => {
    const store = createPostgresQCheckpointStore({ connectionString: URL });
    const options = poolOptions(store);
    expect(options.statement_timeout).toBeUndefined();
    expect(options.query_timeout).toBeUndefined();
    await store.close();
  });
});
