import { describe, expect, it } from "vitest";

import { createPostgresCompanyTeamProjection } from "../src/index.js";

/**
 * F9 (2026-10-08): a real company seeded as an unclaimed public profile
 * showed "Team: No one named yet" although its public-web claim names its
 * founders. With no members, the team is that claim, labelled as public
 * sources; once anyone joins, only members are shown.
 */
function scriptedSql(answers: unknown[][]) {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return Promise.resolve(answers.shift() ?? []);
  };
  return { sql: sql as never, queries };
}

const COMPANY = { tenantId: "t1", companyId: "c1" };

describe("team for the network", () => {
  it("names the founders from the company's public claim when nobody has joined", async () => {
    const { sql, queries } = scriptedSql([
      [],
      [
        {
          structured_value: {
            kind: "FOUNDERS",
            founders: [
              { name: "Kelvin Umechukwu", title: "CEO and co-founder" },
              { name: "Adetunji Opayele", title: "CTO and co-founder" },
            ],
          },
        },
      ],
    ]);
    const team = await createPostgresCompanyTeamProjection({
      sql,
    }).teamForNetwork(COMPANY);
    expect(team).toEqual([
      expect.objectContaining({
        name: "Kelvin Umechukwu",
        businessTitle: "CEO and co-founder",
        isFounder: true,
        source: "PUBLIC_SOURCE",
      }),
      expect.objectContaining({
        name: "Adetunji Opayele",
        source: "PUBLIC_SOURCE",
      }),
    ]);
    expect(queries[1]).toContain("cl.claim_key = 'team.founders'");
    expect(queries[1]).toContain(
      "cl.visibility_scope in ('network_visible', 'public_external')",
    );
    expect(queries[1]).toContain("cl.lifecycle_status = 'CURRENT'");
  });

  it("shows only members once the company has any, and never asks for the claim", async () => {
    const { sql, queries } = scriptedSql([
      [
        {
          display_name: "Kelvin",
          given_name: null,
          family_name: null,
          relationship_type: "team_member",
          business_title: "CEO",
          is_founder: true,
          professional_summary: null,
        },
      ],
    ]);
    const team = await createPostgresCompanyTeamProjection({
      sql,
    }).teamForNetwork(COMPANY);
    expect(team).toHaveLength(1);
    expect(team[0]?.source).toBeUndefined();
    expect(queries).toHaveLength(1);
  });

  it("is empty when the claim is missing or malformed", async () => {
    const { sql } = scriptedSql([[], [{ structured_value: { founders: 3 } }]]);
    await expect(
      createPostgresCompanyTeamProjection({ sql }).teamForNetwork(COMPANY),
    ).resolves.toEqual([]);
  });
});
