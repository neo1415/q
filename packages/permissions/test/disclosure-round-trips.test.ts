import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";

import {
  createCapitalObjectiveDisclosureResolver,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (live 7fb7e429 on 964ea98dd, a network rank: ~900
 * database round trips in each of fit_top_candidates and
 * discover_companies, below batched ports). Each raise's disclosure check
 * resolved its objective and then its company, one query each, per raise.
 * Through the real repository adapters, the round trips for a batch are
 * now a fixed few, whatever its size.
 */

const TENANT = randomUUID();
const ORGANISATION = randomUUID();

function database(objectives: readonly { id: string; companyId: string }[]) {
  const byId = new Map(objectives.map((o) => [o.id, o]));
  let roundTrips = 0;
  const FRAGMENT = { fragment: true };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    // A query fragment composed into another is not a round trip.
    if (/^\s*select p\.id[\s\S]*disclosure_policies p\s*$/u.test(text)) {
      return FRAGMENT;
    }
    roundTrips += 1;
    const list = values.find((v): v is string[] => Array.isArray(v)) ?? [];
    if (text.includes("from core.capital_objectives o")) {
      const ids = text.includes("any(") ? list : [String(values[0])];
      return Promise.resolve(
        ids.flatMap((id) => {
          const o = byId.get(id);
          return o === undefined
            ? []
            : [
                {
                  id: o.id,
                  tenant_id: TENANT,
                  company_id: o.companyId,
                  status: "ACTIVE",
                },
              ];
        }),
      );
    }
    if (text.includes("from core.companies c")) {
      const ids = text.includes("any(") ? list : [String(values[0])];
      return Promise.resolve(
        ids.map((id) => ({
          id,
          tenant_id: TENANT,
          organisation_id: ORGANISATION,
          canonical_name: `Company ${id.slice(0, 4)}`,
          company_status: "active",
        })),
      );
    }
    return Promise.resolve([]);
  };
  return { sql: sql as never, trips: () => roundTrips };
}

function checked(count: number) {
  const objectives = Array.from({ length: count }, () => ({
    id: randomUUID(),
    companyId: randomUUID(),
  }));
  const db = database(objectives);
  const service = createDisclosureAccessService({
    sql: db.sql,
    policies: createPostgresDisclosurePolicyRepository(),
    resolvers: createDisclosureResourceResolverRegistry([
      createCapitalObjectiveDisclosureResolver({
        capital: createPostgresCapitalObjectiveQueryPort({ sql: db.sql }),
        companies: createPostgresCompanyQueryPort({ sql: db.sql }),
      }),
    ]),
    relationshipParties: { resolve: () => Promise.resolve(null) },
    clock: { now: () => "2026-10-26T00:00:00.000Z" },
  });
  const principal = {
    kind: "ORGANISATION",
    tenantId: randomUUID(),
    organisationId: randomUUID(),
  };
  return {
    db,
    run: () =>
      service.evaluateMany(
        objectives.map((o) => ({
          principal,
          resource: { type: "capital_objective", id: o.id },
          requestedAccess: "view",
        })) as never,
      ),
  };
}

describe("a batch of raise disclosure checks, through the real adapters", () => {
  it("costs the same few round trips for 5 raises as for 200", async () => {
    const few = checked(5);
    const many = checked(200);
    const a = await few.run();
    const b = await many.run();
    // Each raise was resolved (company-side private, so denied to a
    // stranger without a policy), not left out as an unknown resource.
    for (const decisions of [a, b]) {
      expect(decisions.every((d) => d.reasonCode !== "UNKNOWN_RESOURCE")).toBe(
        true,
      );
    }
    // Objectives, their companies, their policies: three, at any size.
    expect(few.db.trips()).toBe(3);
    expect(many.db.trips()).toBe(3);
  });
});
