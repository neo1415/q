import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";

import {
  createPostgresConversationToolResults,
  FETCHED_READ_MAX,
  withKeptToolResults,
  type ConversationToolResultsStore,
} from "../src/composition/conversation-tool-results.js";

/**
 * Owner live 2026-10-17: what Q fetched in a conversation is kept for its
 * follow-ups. Only successful read-only results the run already received,
 * at most CONFIDENTIAL, kept off the turn's path; read back for the
 * conversation's owner only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const RUN = "11111111-1111-4111-8111-111111111111";

const context = {
  actor: { tenantId: TENANT, userId: USER },
  runId: RUN,
} as unknown as QToolExecutionContext;

const outcome = (over: Partial<QToolCallOutcome>): QToolCallOutcome => ({
  callId: "c1",
  toolName: "fit.profile",
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "NETWORK_VISIBLE",
  result: { ok: true, data: { name: "Clearwater Assurance", score: 8.8 } },
  latencyMs: 3,
  ...over,
});

function port(result: QToolCallOutcome): QToolPort {
  return {
    offer: () => Promise.resolve([]),
    execute: () => Promise.resolve(result),
  };
}

function store(fail = false) {
  const kept: Parameters<ConversationToolResultsStore["record"]>[0][] = [];
  const s: ConversationToolResultsStore = {
    record: (entry) => {
      kept.push(entry);
      return fail ? Promise.reject(new Error("no table")) : Promise.resolve();
    },
    recent: () => Promise.resolve([]),
  };
  return { s, kept };
}

const proposal = {
  callId: "c1",
  name: "fit_profile",
  arguments: { id: "x" },
} as never;

describe("tool results kept for follow-ups", () => {
  it("keeps a successful read, numbered per run, and returns the outcome untouched", async () => {
    const { s, kept } = store();
    const result = outcome({});
    const tools = withKeptToolResults(port(result), s);
    expect(await tools.execute(proposal, context)).toBe(result);
    await tools.execute(proposal, context);
    expect(kept.map((k) => k.callIndex)).toEqual([0, 1]);
    expect(kept[0]).toMatchObject({
      tenantId: TENANT,
      userId: USER,
      runId: RUN,
      toolName: "fit.profile",
      arguments: { id: "x" },
      result: { name: "Clearwater Assurance", score: 8.8 },
      sensitivity: "NETWORK_VISIBLE",
    });
  });

  it.each([
    ["a denied call", { status: "DENIED" as const }],
    ["a failed call", { status: "FAILED" as const }],
    ["a side effect", { classification: "SIDE_EFFECT" as const }],
    [
      "anything above CONFIDENTIAL",
      { sensitivity: "HIGHLY_CONFIDENTIAL" as const },
    ],
    [
      "an error result",
      {
        result: { ok: false as const, error: { code: "X", safeMessage: "no" } },
      },
    ],
  ])("never keeps %s", async (_label, over) => {
    const { s, kept } = store();
    await withKeptToolResults(port(outcome(over)), s).execute(
      proposal,
      context,
    );
    expect(kept).toHaveLength(0);
  });

  it("a store that fails (migration not applied) never fails the call", async () => {
    const { s } = store(true);
    const result = outcome({});
    await expect(
      withKeptToolResults(port(result), s).execute(proposal, context),
    ).resolves.toBe(result);
  });
});

describe("the Postgres store", () => {
  function fakeSql(rows: unknown[] = []) {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$").replace(/\s+/g, " "), values });
      return Promise.resolve(rows);
    }) as unknown as DatabaseExecutor;
    return { sql, calls };
  }

  it("takes owner and conversation from the run, never from the caller", async () => {
    const { sql, calls } = fakeSql();
    await createPostgresConversationToolResults({ sql }).record({
      tenantId: TENANT,
      userId: USER,
      runId: RUN,
      callIndex: 0,
      toolName: "fit.profile",
      arguments: {},
      result: { a: 1 },
      sensitivity: "PUBLIC",
    });
    expect(calls[0]?.text).toContain(
      "select r.tenant_id, r.conversation_id, r.actor_user_id, r.id",
    );
    expect(calls[0]?.text).toContain("and r.actor_user_id = $");
    expect(calls[0]?.text).toContain(
      "on conflict (run_id, call_index) do nothing",
    );
  });

  it("does not keep an oversized result", async () => {
    const { sql, calls } = fakeSql();
    await createPostgresConversationToolResults({ sql }).record({
      tenantId: TENANT,
      userId: USER,
      runId: RUN,
      callIndex: 0,
      toolName: "x",
      arguments: {},
      result: { blob: "x".repeat(70_000) },
      sensitivity: "PUBLIC",
    });
    expect(calls).toHaveLength(0);
  });

  it("reads back the owner's own rows of this run's conversation, unexpired, newest first", async () => {
    const { sql, calls } = fakeSql([
      {
        run_id: "r0",
        tool_name: "fit.profile",
        arguments: {},
        result: { score: 8.8 },
        sensitivity: "NETWORK_VISIBLE",
        created_at: new Date("2026-10-17T09:14:19Z"),
      },
      {
        run_id: "r0",
        tool_name: "odd",
        arguments: {},
        result: {},
        sensitivity: "NOT_A_CLASS",
        created_at: new Date("2026-10-17T09:14:19Z"),
      },
    ]);
    const rows = await createPostgresConversationToolResults({ sql }).recent({
      tenantId: TENANT,
      userId: USER,
      runId: RUN,
    });
    const text = calls[0]?.text ?? "";
    expect(text).toContain("t.user_id = $");
    expect(text).toContain("r.actor_user_id = $");
    expect(text).toContain("t.expires_at > now()");
    expect(text).toContain("order by t.created_at desc");
    expect(calls[0]?.values).toContain(FETCHED_READ_MAX);
    expect(rows).toEqual([
      {
        runId: "r0",
        toolName: "fit.profile",
        arguments: {},
        result: { score: 8.8 },
        sensitivity: "NETWORK_VISIBLE",
        fetchedAt: "2026-10-17T09:14:19.000Z",
      },
    ]);
  });
});

it("never retains premium assessment results for later ungated replay", async () => {
  for (const toolName of [
    "intelligence.unicorn_potential",
    "unicorn_potential",
  ]) {
    const { s, kept } = store();
    const result = outcome({ toolName });
    expect(
      await withKeptToolResults(port(result), s).execute(proposal, context),
    ).toBe(result);
    expect(kept).toEqual([]);
  }
});
