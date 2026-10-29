import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createPlanFiguresRead,
  heldBackToldStatement,
} from "../src/composition/workforce/plan-figures.js";

/**
 * Coordinator review 2026-10-29: founder-stated figures stored before the
 * owner's 2026-10-28 decision are HIGHLY_CONFIDENTIAL. The plan's situation
 * names only their measure as held back; their words and figure never
 * reach a model. A figure stored CONFIDENTIAL (the decision) is used.
 */
const COMPANY = "31633da0-87f9-4c5f-bd9a-a892a9251207";
const actor = {
  tenantId: "df954b3f-96e7-4768-8f55-587c9056f2ec",
  organisationId: "53fce443-e47c-45fc-a2ed-cc9ee4fda13c",
  userId: "0b6f1d4e-2a51-4f43-9a3d-5d2c8b1e7a90",
  actorType: "HUMAN",
} as unknown as ActorContext;

function fakeSql(results: readonly unknown[][]): DatabaseExecutor {
  let call = 0;
  const sql = (() => {
    const rows = results[call] ?? [];
    call += 1;
    return Promise.resolve(rows);
  }) as unknown as DatabaseExecutor;
  return sql;
}

describe("the founder's stated figures in a plan, by their stored class", () => {
  it("never carries a highly confidential figure; names its measure as held back", async () => {
    const read = createPlanFiguresRead({
      sql: fakeSql([
        [{ id: COMPANY }],
        [
          {
            knowledge_key: "financial.cash_balance",
            statement: "The founder said cash in the bank is USD 310,000.",
            sensitivity_class: "HIGHLY_CONFIDENTIAL",
            recorded_at: "2026-10-20T10:00:00Z",
          },
          {
            knowledge_key: "financial.monthly_revenue",
            statement: "The founder said monthly revenue is USD 65,000.",
            sensitivity_class: "CONFIDENTIAL",
            recorded_at: "2026-10-28T10:00:00Z",
          },
        ],
        [],
      ]),
      documentFigures: () => Promise.resolve(new Map()),
    });
    const facts = await read(actor, COMPANY);
    const text = facts.map((fact) => fact.statement).join("\n");
    expect(text).not.toContain("310,000");
    expect(text).toContain(heldBackToldStatement("financial.cash_balance"));
    expect(text).toContain("You told Q: monthly revenue is USD 65,000.");
    const held = facts.find((fact) => fact.statement.includes("cash balance"));
    expect(held?.truthClass).toBe("UNKNOWN");
  });

  it("names the measure only", () => {
    expect(heldBackToldStatement("financial.burn_rate")).toBe(
      "You told Q your burn rate earlier; it is stored as highly confidential, so Q does not use it. Tell Q again and Q will use it as yours.",
    );
  });
});
