import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { PendingAppAction } from "@capital-q/q-specialists";

import { createPostgresAwaitingActions } from "../src/composition/awaiting-actions.js";
import { createPostgresConversationCore } from "../src/composition/conversation-core-state.js";

/**
 * Production 12 Nov 2026: both stores wrote a pre-stringified `::jsonb`
 * parameter, which postgres.js stores as a JSON string. The core state's
 * save requires an object, so it never saved; the awaiting action read back
 * a string, so Q's pending question was never found. They now pass the
 * value through jsonbParam, and an older string row reads as its value.
 */
const SCOPE = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function fakeSql(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$").replace(/\s+/g, " "), values });
      return Promise.resolve(rows);
    },
    { json: (value: unknown) => ({ json: value }) },
  ) as unknown as DatabaseExecutor;
  return { sql, calls };
}

const pending = {
  action: { tool: "app.example/v1", arguments: {} },
  needs: "which company",
} as unknown as Omit<PendingAppAction, "at">;

describe("awaiting actions", () => {
  it("holds the pending action as a JSON value", async () => {
    const { sql, calls } = fakeSql();
    await createPostgresAwaitingActions({ sql }).hold(SCOPE, pending);
    const held = calls[0]?.values.find(
      (value): value is { json: { needs: string; at: number } } =>
        typeof value === "object" && value !== null && "json" in value,
    );
    expect(held?.json.needs).toBe("which company");
    expect(typeof held?.json.at).toBe("number");
  });

  it("takes a row written before the fix as its value", async () => {
    const at = Date.now();
    const { sql } = fakeSql([{ awaiting: JSON.stringify({ ...pending, at }) }]);
    const taken = await createPostgresAwaitingActions({ sql }).take(SCOPE);
    expect(taken?.needs).toBe("which company");
    expect(taken?.at).toBe(at);
  });
});

describe("conversation core state", () => {
  it("saves the snapshot as a JSON value, still bounded and object-only", async () => {
    const { sql, calls } = fakeSql();
    await createPostgresConversationCore({ sql }).save(SCOPE, { series: 2 });
    expect(calls[0]?.values).toContainEqual({ json: { series: 2 } });
    expect(calls[0]?.text).toContain(
      "jsonb_typeof(candidate.value) = 'object'",
    );
  });
});
