import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { Q_IQ_CATEGORIES, Q_IQ_DATASET } from "../src/datasets/q-iq/index.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Q on Claude, offline (DECISIONS 62; live 2026-11-06: every Q turn on
 * Claude came back "(no reply)" while the bare model answered).
 *
 * The same scripted Q-IQ run as q-iq.integration.test.ts, but the scripted
 * model answers THROUGH the real Anthropic adapter and SDK over a wire
 * double that speaks the Messages API's JSON and SSE shapes and refuses
 * what the API refuses, with the Claude routing policies switched on in
 * the world's catalogue view and no other provider registered. So the
 * real gateway, answer path, streaming and publication run exactly as
 * they do live on Claude, and a streamed Claude answer must be published
 * as the person's reply.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("Q-IQ — Q on Claude through the Anthropic wire (scripted model)", () => {
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

  it("publishes Claude's streamed answers as Q's replies, one case per category", async () => {
    const cases = Q_IQ_CATEGORIES.filter(
      (category) => category !== "DISCOVERY" && category !== "ADVERSARIAL",
    ).flatMap((category) =>
      Q_IQ_DATASET.cases.filter((c) => c.category === category).slice(0, 1),
    );
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      wire: "anthropic",
    });
    try {
      const result = await runQIq(q.subject, cases);
      if (process.env["CQ_WIRE_DUMP"] !== undefined) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          process.env["CQ_WIRE_DUMP"],
          JSON.stringify(q.world().wire?.bodies() ?? []),
        );
      }
      const providers = q.world().providerCodes;
      expect(providers).toEqual(["anthropic"]);
      const silent = result.cases
        .filter((run) => run.replies.some((reply) => reply === "(no reply)"))
        .map((run) => run.caseId);
      expect(silent).toEqual([]);
      for (const run of result.cases) {
        expect(run.error, run.caseId).toBeNull();
      }
      expect(q.world().wire?.refusals()).toEqual([]);
      expect(result.summary.overall.score).toBe(1);
    } finally {
      await q.close();
    }
  });

  it("still publishes when the API refuses Q's constrained answer schema (live 2026-11-06 shape)", async () => {
    const cases = Q_IQ_CATEGORIES.filter(
      (category) => category !== "DISCOVERY" && category !== "ADVERSARIAL",
    ).flatMap((category) =>
      Q_IQ_DATASET.cases.filter((c) => c.category === category).slice(0, 1),
    );
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      wire: "anthropic",
      // What a live refusal looks like to Q: every Sonnet request carrying a
      // constrained format is a 400. Before the plain-shape fallback, every
      // turn here was "(no reply)", with no error anywhere.
      wireRefuse: (body) =>
        body["model"] === "claude-sonnet-5-5" &&
        typeof body["output_config"] === "object" &&
        body["output_config"] !== null &&
        "format" in body["output_config"]
          ? "Schema is too complex for compilation."
          : null,
    });
    try {
      const result = await runQIq(q.subject, cases);
      const silent = result.cases
        .filter((run) => run.replies.some((reply) => reply === "(no reply)"))
        .map((run) => run.caseId);
      expect(silent).toEqual([]);
      expect(result.summary.overall.score).toBe(1);
      // Refused once, then remembered: the plain shape from then on.
      expect(q.world().wire?.refusals().length).toBe(1);
    } finally {
      await q.close();
    }
  });
});
