import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { QTurnReading } from "@capital-q/model-gateway/q";

import {
  Q_IQ_DATASET,
  Q_IQ_ENTITIES,
  type QIqCase,
} from "../src/datasets/q-iq/index.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Live 2026-11-06 (QIQ-PRO-001 on 4c04b5f3e): with the live reader on, Q
 * asked who "she", "his" and "they" were one line after naming them, where
 * the bare model answered. Scripted Q-IQ could not see it: FAKE mode
 * composed no reader, so binding never ran. These runs compose a SCRIPTED
 * reader in the Q-IQ world (no model call) that reads each turn the way
 * the live one does, through the real runtime and the reference binding:
 *
 *   - LIVE_V78: what the live reader did -- the people Q named came from
 *     authorised facts with no record ids, so no ledger entry held them,
 *     and it wrote each pointing phrase with no refs;
 *   - V79: what reader v79 does -- the same phrase carries the name as
 *     written in the recent turns.
 *
 * The scripted reader is a test double driven by each case's own
 * expectation (the entities the turn is about, when the turn does not
 * name them itself); it is never product code.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const KIND = {
  COMPANY: "COMPANY",
  INVESTOR: "INVESTOR_ORGANISATION",
  PERSON: "PERSON",
  DOCUMENT: "DOCUMENT",
} as const;

const BASE = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as const;

type Mode = "LIVE_V78" | "V79";

function scriptedReader(mode: Mode) {
  return (evalCase: QIqCase, turn: number): QTurnReading | null => {
    const said = evalCase.turns[turn];
    if (said === undefined) return null;
    const words = said.user.toLowerCase();
    // The entities the turn is about that its own words do not name: what
    // a pronoun, a role or "the other one" pointed back at.
    const pointedAt = said.expect.entityIds.flatMap((id) => {
      const entity = Q_IQ_ENTITIES.find((one) => one.id === id);
      if (entity === undefined) return [];
      const named = [entity.name, ...entity.aliases].some((name) =>
        words.includes(name.toLowerCase()),
      );
      return named ? [] : [entity];
    });
    const references = pointedAt.map((entity, index) => ({
      phrase: `that ${String(index + 1)}`,
      entityIds: [],
      confidence: mode === "V79" ? ("HIGH" as const) : ("MEDIUM" as const),
      named:
        mode === "V79" ? { name: entity.name, kind: KIND[entity.kind] } : null,
    }));
    return {
      ...BASE,
      ...(references.length === 0 ? {} : { references }),
    };
  };
}

describe("Q-IQ — reference binding through the runtime with a scripted reader", () => {
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

  const cases = Q_IQ_DATASET.cases.filter(
    (c) =>
      c.category === "PRONOUNS_PEOPLE" ||
      c.category === "AMBIGUITY" ||
      c.category === "FOLLOW_UPS",
  );

  for (const mode of ["LIVE_V78"] as const) {
    it(`${mode}: pronouns bind or are read from the turns, and the confusable pairs still ask`, async () => {
      expect(cases.some((c) => c.id === "QIQ-PRO-001")).toBe(true);
      const q = await createQIqWorldSubject({
        db,
        providerMode: "FAKE",
        scriptedReader: scriptedReader(mode),
      });
      try {
        const result = await runQIq(q.subject, cases);
        const fails = result.cases.flatMap((r) =>
          r.grade.turns
            .filter((t) => !t.pass)
            .map(
              (t) =>
                `${r.caseId}#${String(t.turn)}: ${t.reasons.join("; ")} :: ${r.replies[t.turn]?.slice(0, 160) ?? ""}`,
            ),
        );
        console.log(
          JSON.stringify(
            { mode, turns: result.summary.overall.turns, fails },
            null,
            1,
          ),
        );
        // The exact live case: no turn of it asks who was meant.
        const pro001 = result.cases.find((r) => r.caseId === "QIQ-PRO-001");
        expect(pro001?.replies).toHaveLength(4);
        for (const reply of pro001?.replies ?? []) {
          expect(reply).not.toMatch(/not sure who or what you mean/u);
        }
        expect(fails).toEqual([]);
        expect(result.summary.overall.score).toBe(1);
      } finally {
        await q.close();
      }
    }, 1_800_000);
  }
});
