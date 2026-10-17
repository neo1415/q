import {
  UnicornPotentialDtoSchema,
  type UnicornPotentialDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresInvestabilityStore,
  type InvestabilityStore,
  type InvestabilitySubject,
} from "../investability/postgres.js";

export type UnicornPotentialView = Omit<
  UnicornPotentialDto,
  "assessedAt" | "momentum"
>;
export type UnicornPotentialSnapshot = {
  readonly revision: number;
  readonly basisHash: string;
  readonly cohortKey: string;
  readonly view: UnicornPotentialDto;
};
export type UnicornPotentialStore = {
  readonly inputs: InvestabilityStore["inputs"];
  readonly listedCompanyIds: InvestabilityStore["listedCompanyIds"];
  readonly record: (input: {
    readonly subject: InvestabilitySubject;
    readonly methodVersion: string;
    readonly basisHash: string;
    readonly cohortKey: string;
    readonly view: UnicornPotentialView;
    readonly observations: unknown;
  }) => Promise<{ readonly revision: number; readonly created: boolean }>;
  readonly current: (
    ids: readonly string[],
    methodVersion: string,
  ) => Promise<ReadonlyMap<string, UnicornPotentialDto>>;
  readonly history: (
    companyId: string,
    methodVersion: string,
    limit?: number,
  ) => Promise<readonly UnicornPotentialSnapshot[]>;
};
type Row = {
  company_id: string;
  revision: number;
  basis_hash: string;
  cohort_key: string;
  summary: unknown;
  assessed_at: Date | string;
};
const iso = (at: Date | string): string => new Date(at).toISOString();
function snapshot(row: Row): UnicornPotentialSnapshot {
  return {
    revision: row.revision,
    basisHash: row.basis_hash,
    cohortKey: row.cohort_key,
    view: UnicornPotentialDtoSchema.parse({
      ...(row.summary as Record<string, unknown>),
      assessedAt: iso(row.assessed_at),
      momentum: null,
    }),
  };
}
function withMomentum(
  current: UnicornPotentialSnapshot,
  older: readonly UnicornPotentialSnapshot[],
): UnicornPotentialDto {
  const previous = older.find(
    (item) =>
      item.cohortKey === current.cohortKey &&
      item.view.stage === current.view.stage &&
      item.view.inputRulesVersion === current.view.inputRulesVersion &&
      item.view.overallScore !== null,
  );
  if (
    current.view.overallScore === null ||
    previous?.view.overallScore === null ||
    previous === undefined ||
    previous.view.assessedAt === null
  )
    return current.view;
  const drivers: string[] = [];
  for (const pillar of current.view.pillars) {
    const old = previous.view.pillars.find((item) => item.id === pillar.id);
    if (old === undefined) continue;
    if (pillar.grade !== old.grade)
      drivers.push(
        `${pillar.label}: grade ${old.grade ?? "unknown"} → ${pillar.grade ?? "unknown"}; changed observed evidence or fact correction.`,
      );
    else if (
      pillar.criteria.some(
        (criterion, index) =>
          criterion.state === "STALE" && old.criteria[index]?.state !== "STALE",
      )
    )
      drivers.push(
        `${pillar.label}: source aging changed current evidence coverage.`,
      );
  }
  if (drivers.length === 0)
    drivers.push(
      "Evidence revision changed; no pillar grade change. This is not proof of business growth.",
    );
  return UnicornPotentialDtoSchema.parse({
    ...current.view,
    momentum: {
      delta: current.view.overallScore - previous.view.overallScore,
      previousScore: previous.view.overallScore,
      previousAt: previous.view.assessedAt,
      drivers: drivers.slice(0, 12),
    },
  });
}
export function createPostgresUnicornPotentialStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): UnicornPotentialStore {
  const { sql, transactions } = options;
  const eligible = createPostgresInvestabilityStore({ sql });
  const history: UnicornPotentialStore["history"] = async (
    companyId,
    methodVersion,
    limit = 20,
  ) => {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await sql<
      Row[]
    >`select company_id, revision, basis_hash, cohort_key, summary, assessed_at from core.company_unicorn_potential_assessments where company_id = ${companyId}::uuid and method_version = ${methodVersion} order by revision desc limit ${bounded}`;
    return rows.map(snapshot);
  };
  return {
    inputs: eligible.inputs,
    listedCompanyIds: eligible.listedCompanyIds,
    history,
    record: async (input) =>
      transactions.run(async ({ sql: tx }) => {
        // Canonical company lock serializes all versions and writers. A latest-only
        // comparison preserves A→B→A rather than globally deduplicating old hashes.
        const [subject] = await tx<
          { id: string }[]
        >`select id from core.companies where id = ${input.subject.companyId}::uuid and tenant_id = ${input.subject.tenantId}::uuid and organisation_id = ${input.subject.organisationId}::uuid for update`;
        if (subject === undefined)
          throw new Error("Unicorn Potential canonical subject mismatch");
        const [latest] = await tx<
          { revision: number; basis_hash: string }[]
        >`select revision, basis_hash from core.company_unicorn_potential_assessments where company_id = ${subject.id}::uuid and method_version = ${input.methodVersion} order by revision desc limit 1`;
        if (latest?.basis_hash === input.basisHash)
          return { revision: latest.revision, created: false };
        UnicornPotentialDtoSchema.parse({
          ...input.view,
          assessedAt: null,
          momentum: null,
        });
        if (input.view.methodVersion !== input.methodVersion)
          throw new Error("Unicorn Potential method mismatch");
        const revision = (latest?.revision ?? 0) + 1;
        await tx`insert into core.company_unicorn_potential_assessments (tenant_id, organisation_id, company_id, method_version, revision, basis_hash, cohort_key, status, score, summary, observations) values (${input.subject.tenantId}::uuid, ${input.subject.organisationId}::uuid, ${subject.id}::uuid, ${input.methodVersion}, ${revision}, ${input.basisHash}, ${input.cohortKey}, ${input.view.status}, ${input.view.overallScore}, ${tx.json(input.view)}, ${tx.json(input.observations as never)})`;
        return { revision, created: true };
      }),
    current: async (ids, methodVersion) => {
      if (ids.length === 0) return new Map();
      // Bounded history in one query, never an N+1 read per feed item.
      const rows = await sql<
        Row[]
      >`select a.company_id, a.revision, a.basis_hash, a.cohort_key, a.summary, a.assessed_at from unnest(${[...new Set(ids)]}::uuid[]) requested(id) cross join lateral (select company_id, revision, basis_hash, cohort_key, summary, assessed_at from core.company_unicorn_potential_assessments where company_id = requested.id and method_version = ${methodVersion} order by revision desc limit 20) a`;
      const grouped = new Map<string, UnicornPotentialSnapshot[]>();
      for (const row of rows) {
        const items = grouped.get(row.company_id) ?? [];
        items.push(snapshot(row));
        grouped.set(row.company_id, items);
      }
      const output = new Map<string, UnicornPotentialDto>();
      for (const [id, items] of grouped) {
        items.sort((a, b) => b.revision - a.revision);
        const first = items[0];
        if (first !== undefined)
          output.set(id, withMomentum(first, items.slice(1)));
      }
      return output;
    },
  };
}
