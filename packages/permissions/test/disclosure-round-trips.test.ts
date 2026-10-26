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

// Coordinator 2026-10-26: the batch must never widen what evaluateMany
// returns. A denied raise stays denied, a raise whose company is another
// tenant's never resolves, and both paths decide exactly the same.
describe("the batched raise resolution decides exactly as one by one", () => {
  const OTHER_TENANT = randomUUID();
  const READER = { tenantId: randomUUID(), organisationId: randomUUID() };
  const raise = (
    name: string,
    company: { readonly tenantId: string } | null,
  ) => ({ name, id: randomUUID(), companyId: randomUUID(), company });
  const raises = [
    // No policy: company-side private, denied.
    raise("denied", { tenantId: TENANT }),
    // Shared with this reader's organisation.
    raise("shared with them", { tenantId: TENANT }),
    // Shared with someone else only: still denied to them.
    raise("shared elsewhere", { tenantId: TENANT }),
    // The raise names a company of another tenant: never resolves.
    raise("other tenant's company", { tenantId: OTHER_TENANT }),
    // Its company is gone.
    raise("no company", null),
  ];
  const policy = (resourceId: string, recipientId: string) => ({
    id: randomUUID(),
    tenant_id: TENANT,
    owner_organisation_id: ORGANISATION,
    owner_user_id: null,
    resource_type: "capital_objective",
    resource_id: resourceId,
    scope_type: "specifically_shared",
    recipient_type: "ORGANISATION",
    recipient_id: recipientId,
    access_level: "view",
    expires_at: null,
    created_by_user_id: randomUUID(),
    created_at: "2026-10-01T00:00:00.000Z",
    revoked_at: null,
  });
  const policies = [
    policy(raises[1]?.id ?? "", READER.organisationId),
    policy(raises[2]?.id ?? "", randomUUID()),
  ];

  function decide(batched: boolean) {
    const objectives = new Map<string, (typeof raises)[number]>(
      raises.map((r) => [r.id, r]),
    );
    const companies = new Map<string, { readonly tenantId: string }>(
      raises.flatMap((r) =>
        r.company === null ? [] : [[r.companyId, r.company] as const],
      ),
    );
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (/^\s*select p\.id[\s\S]*disclosure_policies p\s*$/u.test(text)) {
        return { fragment: true };
      }
      const list = values.find((v): v is string[] => Array.isArray(v));
      const ids = text.includes("any(")
        ? (list ?? [])
        : [String(values.find((v) => typeof v === "string") ?? "")];
      if (text.includes("from core.capital_objectives o")) {
        return Promise.resolve(
          ids.flatMap((id) => {
            const r = objectives.get(id);
            return r === undefined
              ? []
              : [
                  {
                    id: r.id,
                    tenant_id: TENANT,
                    company_id: r.companyId,
                    status: "ACTIVE",
                  },
                ];
          }),
        );
      }
      if (text.includes("from core.companies c")) {
        return Promise.resolve(
          ids.flatMap((id) => {
            const c = companies.get(id);
            return c === undefined
              ? []
              : [
                  {
                    id,
                    tenant_id: c.tenantId,
                    organisation_id: ORGANISATION,
                    canonical_name: "A company",
                    company_status: "active",
                  },
                ];
          }),
        );
      }
      if (text.includes("disclosure_policies") || text.includes("unnest(")) {
        return Promise.resolve(policies);
      }
      return Promise.resolve([]);
    }) as never;
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const companyPort = createPostgresCompanyQueryPort({ sql });
    const { findCanonicalCapitalObjectives: _many, ...capitalOne } = capital;
    const { findCanonicalCompanies: _companies, ...companiesOne } = companyPort;
    const service = createDisclosureAccessService({
      sql,
      policies: createPostgresDisclosurePolicyRepository(),
      resolvers: createDisclosureResourceResolverRegistry([
        createCapitalObjectiveDisclosureResolver(
          batched
            ? { capital, companies: companyPort }
            : // The one-by-one path: no batch reads offered.
              { capital: capitalOne, companies: companiesOne },
        ),
      ]),
      relationshipParties: { resolve: () => Promise.resolve(null) },
      clock: { now: () => "2026-10-26T00:00:00.000Z" },
    });
    return service.evaluateMany(
      raises.map((r) => ({
        principal: { kind: "ORGANISATION", ...READER },
        resource: { type: "capital_objective", id: r.id },
        requestedAccess: "view",
      })) as never,
    );
  }

  it("denies what one by one denies, and resolves nothing it does not", async () => {
    const [batched, single] = await Promise.all([decide(true), decide(false)]);
    const outcome = (decisions: typeof batched) =>
      Object.fromEntries(
        raises.map((r, at) => [
          r.name,
          `${decisions[at]?.outcome ?? "?"}:${decisions[at]?.reasonCode ?? ""}`,
        ]),
      );
    expect(outcome(batched)).toEqual(outcome(single));
    const by = (name: string) =>
      batched[raises.findIndex((r) => r.name === name)];
    expect(by("denied")?.outcome).toBe("DENY");
    expect(by("shared elsewhere")?.outcome).toBe("DENY");
    expect(by("other tenant's company")).toMatchObject({
      outcome: "DENY",
      reasonCode: "UNKNOWN_RESOURCE",
    });
    expect(by("no company")).toMatchObject({
      outcome: "DENY",
      reasonCode: "UNKNOWN_RESOURCE",
    });
    // Only an explicit share to this reader can allow; nothing else does.
    const allowed = raises.filter((_, at) => batched[at]?.outcome === "ALLOW");
    expect(allowed.map((r) => r.name)).toEqual(["shared with them"]);
  });
});
