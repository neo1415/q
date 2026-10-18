import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { createPostgresApplicationFounders } from "../src/index.js";

/**
 * P14: linking a signed-in founder's application names the canonical pair
 * (their company, the gateway's investor organisation) so Network can
 * ensure the ONE relationship; no company, no pair. Recording the joined
 * relationship never overwrites an earlier one.
 */
function scripted(answers: unknown[][]) {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return Promise.resolve(answers.shift() ?? []);
  };
  return { sql, queries };
}

const actor = {
  userId: "u1",
  tenantId: "t1",
  organisationId: "o1",
} as ActorContext;

describe("a GateQ application joins the canonical relationship", () => {
  it("names the pair when the founder has a company", async () => {
    const { sql } = scripted([
      [{ id: "c1" }],
      [],
      [{ company_id: "c1", investor_organisation_id: "i1" }],
    ]);
    const founders = createPostgresApplicationFounders({ sql: sql as never });
    expect(
      await founders.link({ applicationId: "a1", tenantId: "t9", actor }),
    ).toEqual({ companyId: "c1", investorOrganisationId: "i1" });
  });

  it("names nothing for a founder with no company", async () => {
    const { sql } = scripted([[], [], []]);
    const founders = createPostgresApplicationFounders({ sql: sql as never });
    expect(
      await founders.link({ applicationId: "a1", tenantId: "t9", actor }),
    ).toBeNull();
  });

  it("F27 backfill rebuilds the founder's own context, skipping bad rows", async () => {
    const { sql, queries } = scripted([
      [
        {
          application_id: "00000000-0000-4000-8000-0000000000a1",
          tenant_id: "00000000-0000-4000-8000-0000000000f1",
          user_id: "00000000-0000-4000-8000-0000000000b1",
          membership_id: "00000000-0000-4000-8000-0000000000c1",
          member_tenant_id: "00000000-0000-4000-8000-0000000000d1",
          organisation_id: "00000000-0000-4000-8000-0000000000e1",
        },
        { application_id: "x", tenant_id: "y", user_id: "not-a-uuid" },
      ],
    ]);
    const rows = await createPostgresApplicationFounders({
      sql: sql as never,
    }).unlinked(100);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toMatchObject({
      userId: "00000000-0000-4000-8000-0000000000b1",
      organisationId: "00000000-0000-4000-8000-0000000000e1",
      actorType: "HUMAN",
    });
    expect(queries[0]).toContain("relationship_id is null");
    expect(queries[0]).toContain("membership_status = 'active'");
  });

  it("records the relationship once, never replacing one", async () => {
    const { sql, queries } = scripted([[]]);
    await createPostgresApplicationFounders({
      sql: sql as never,
    }).setRelationship({ applicationId: "a1", relationshipId: "r1" });
    expect(queries[0]).toContain("relationship_id is null");
  });
});
