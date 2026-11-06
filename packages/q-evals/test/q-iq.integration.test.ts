import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { actionClaims } from "@capital-q/model-gateway/q";
import {
  inferredPresentedAsStated,
  PAST_TURNS_LABEL,
} from "@capital-q/q-knowledge";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { Q_IQ_DATASET, Q_IQ_CATEGORIES } from "../src/datasets/q-iq/index.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Q-IQ through the REAL Q runtime with the scripted model: one case per
 * category, multi-turn in one stored conversation. Proves the Q subject
 * carries the conversation, releases the authorised facts under the
 * firewall plan and returns what was persisted — at no cost.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("Q-IQ — Q subject against local PostgreSQL (scripted model)", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "8",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const stateCount = async (): Promise<number> => {
    const [row] = await db.sql<{ n: number }[]>`
      select count(*)::int as n from q_runtime.conversation_states`;
    return row?.n ?? 0;
  };

  it("runs a case per category through the runtime and scores the reference replies", async () => {
    // CQ_Q_IQ_ALL=1: every case (the scripted regression check for a
    // change to the conversation machinery); otherwise one per category.
    const all = process.env["CQ_Q_IQ_ALL"] === "1";
    const only = process.env["CQ_Q_IQ_CASE"];
    const cases = all
      ? Q_IQ_DATASET.cases.filter((c) => only === undefined || c.id === only)
      : Q_IQ_CATEGORIES.flatMap((category) =>
          Q_IQ_DATASET.cases.filter((c) => c.category === category).slice(0, 1),
        );
    expect(cases).toHaveLength(
      all
        ? only === undefined
          ? Q_IQ_DATASET.cases.length
          : 1
        : Q_IQ_CATEGORIES.length,
    );
    const statesBefore = await stateCount();
    // CQ_Q_IQ_MEMORY=0: without step 9's recall, for a before/after.
    const memory = process.env["CQ_Q_IQ_MEMORY"] !== "0";
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      memory,
    });
    try {
      const result = await runQIq(q.subject, cases);
      for (const run of result.cases) {
        expect(run.error, run.caseId).toBeNull();
      }
      // Q intelligence step 2: each conversation's state was folded from
      // its stored turns and saved (one row per case's conversation).
      expect((await stateCount()) - statesBefore).toBe(cases.length);
      // Scripted providers only: any cost here is the gateway's own token
      // estimate priced at catalogue rates, never spend.
      expect(q.world().providerMode).toBe("FAKE");
      // Step 8: every reply went through the promise check, so an action
      // claim still in a reply was backed by a tool of its run; a rewrite
      // means the draft claimed one that no tool did.
      const replies = result.cases.flatMap((r) => r.replies);
      const actionClaimsKept = replies.filter(
        (reply) => actionClaims(reply).length > 0,
      ).length;
      const promiseRewrites = replies.filter((reply) =>
        /\bI haven't (?:prepared that yet|sent it|scheduled it|saved that yet)\b/u.test(
          reply,
        ),
      ).length;
      console.log(
        JSON.stringify(
          {
            actionClaimsKept,
            promiseRewrites,
            estimatedUsd: result.costUsd,
            input: result.inputTokens,
            turns: result.summary.overall.turns,
            fails: result.cases.flatMap((r) =>
              r.grade.turns
                .filter((t) => !t.pass)
                .map(
                  (t) =>
                    `${r.caseId}#${t.turn}: ${t.reasons.join("; ")} :: ${r.replies[t.turn]?.slice(0, 160)}`,
                ),
            ),
          },
          null,
          1,
        ),
      );
      expect(result.summary.overall.score).toBe(1);
      // Step 9: a case with earlier conversations was answered with the
      // person's own past turns recalled into the prompt.
      if (memory && cases.some((c) => c.priorConversations.length > 0)) {
        const recalled = q
          .world()
          .recorder.calls()
          .some((c) =>
            // Up to its first quote: the label JSON-escapes its quotes.
            JSON.stringify(c).includes(PAST_TURNS_LABEL.split('"')[0] ?? ""),
          );
        expect(recalled).toBe(true);
      }
      // Step 9: no inferred memory is presented as stated, in any reply or
      // in the memory the prompts carried (deterministic).
      const items = await db.sql<
        { write_mode: string; content: string; quote: string | null }[]
      >`select write_mode, content, quote from q_knowledge.memory_items
         where owner_context_id = ${q.world().people.INVESTOR.actor.userId}`;
      const memories = items.map((row) => ({
        writeMode: row.write_mode as never,
        content: row.content,
        quote: row.quote,
      }));
      for (const text of [
        ...replies,
        ...q
          .world()
          .recorder.calls()
          .map((c) => c.systemText),
      ]) {
        expect(inferredPresentedAsStated(text, memories)).toEqual([]);
      }
      // The facts reached the model: the answer prompt carries them.
      const prompts = q
        .world()
        .recorder.calls()
        .map((c) => JSON.stringify(c));
      expect(
        prompts.some((p) => p.includes("Ledgerfold annual recurring revenue")),
      ).toBe(true);
    } finally {
      await q.close();
    }
  }, 1_800_000);
});
