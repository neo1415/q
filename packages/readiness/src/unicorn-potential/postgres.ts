import { z } from "zod";
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
import { UNICORN_PILLARS } from "./method-v1.js";

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
  readonly listedCompanyIds: (
    limit: number,
    after?: string,
  ) => Promise<readonly string[]>;
  readonly record: (input: {
    readonly subject: InvestabilitySubject;
    readonly methodVersion: string;
    readonly basisHash: string;
    readonly cohortKey: string;
    readonly view: UnicornPotentialView;
    readonly observations: unknown;
    readonly sourcesReadAt: string;
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
export type UnicornEligibilityCandidate = {
  company_id: string;
  revision: number;
  assessed_at: Date | string;
  observations: unknown;
};

/** Time-sensitive eligibility only; no rubric, grading or extraction on a read. */
export function unicornObservationsCurrent(
  value: unknown,
  now = Date.now(),
): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((raw: unknown) => {
    if (raw === null || typeof raw !== "object") return false;
    const item = raw as Record<string, unknown>;
    if (typeof item["stale"] !== "boolean") return false;
    if (item["stale"]) return true;
    const pillar = UNICORN_PILLARS.find((p) => p.id === item["pillar"]);
    const rule = pillar?.criteria[item["criterion"] === "A" ? 0 : 1];
    const source = item["source"];
    if (rule === undefined || source === null || typeof source !== "object")
      return false;
    const at = (source as Record<string, unknown>)["at"];
    if (typeof at !== "string") return false;
    const date = Date.parse(at);
    if (
      !Number.isFinite(date) ||
      date > now ||
      now - date > rule.freshnessDays * 86400000
    )
      return false;
    return (
      pillar?.id !== "P4" ||
      new Date(date).getUTCFullYear() === new Date(now).getUTCFullYear()
    );
  });
}

/** Reauthorize all contributing sources in one batched DB query, without grading. */
export async function eligibleUnicornRevisions(
  sql: DatabaseExecutor,
  candidates: readonly UnicornEligibilityCandidate[],
  historical = false,
): Promise<ReadonlySet<string>> {
  const current = historical
    ? candidates
    : candidates.filter((candidate) =>
        unicornObservationsCurrent(candidate.observations),
      );
  if (current.length === 0) return new Set();
  const payload = z.json().parse(
    current.map((candidate) => ({
      ...candidate,
      assessed_at: new Date(candidate.assessed_at).toISOString(),
    })),
  );
  const rows = historical
    ? await sql<
        { company_id: string; revision: number }[]
      >`select company_id, revision from private.unicorn_potential_historical_revisions(${sql.json(payload)})`
    : await sql<
        { company_id: string; revision: number }[]
      >`select company_id, revision from private.unicorn_potential_eligible_revisions(${sql.json(payload)})`;
  return new Set(rows.map((row) => `${row.company_id}:${row.revision}`));
}

type Row = {
  company_id: string;
  revision: number;
  basis_hash: string;
  cohort_key: string;
  summary: unknown;
  assessed_at: Date | string;
  observations: unknown;
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
  const candidate = older[0];
  const previous =
    candidate !== undefined &&
    candidate.cohortKey === current.cohortKey &&
    candidate.view.stage === current.view.stage &&
    candidate.view.inputRulesVersion === current.view.inputRulesVersion &&
    candidate.view.overallScore !== null
      ? candidate
      : undefined;
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
    >`select company_id, revision, basis_hash, cohort_key, summary, assessed_at, observations from core.company_unicorn_potential_assessments where company_id = ${companyId}::uuid and method_version = ${methodVersion} order by revision desc limit ${bounded}`;
    const allowed = await eligibleUnicornRevisions(sql, rows, true);
    return rows
      .filter((row) => allowed.has(`${row.company_id}:${row.revision}`))
      .map(snapshot);
  };
  return {
    inputs: eligible.inputs,
    listedCompanyIds: async (limit, after) => {
      const rows =
        after === undefined
          ? await sql<
              { company_id: string }[]
            >`select p.company_id from knowledge.company_profiles p join core.companies c on c.id = p.company_id where p.listed and c.company_status = 'active' order by p.company_id limit ${limit}`
          : await sql<
              { company_id: string }[]
            >`select p.company_id from knowledge.company_profiles p join core.companies c on c.id = p.company_id where p.listed and c.company_status = 'active' and p.company_id > ${after}::uuid order by p.company_id limit ${limit}`;
      return rows.map((row) => row.company_id);
    },
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
        const allowed = await eligibleUnicornRevisions(tx, [
          {
            company_id: subject.id,
            revision: 0,
            assessed_at: input.sourcesReadAt,
            observations: input.observations,
          },
        ]);
        if (!allowed.has(`${subject.id}:0`))
          throw new Error("Unicorn Potential sources no longer eligible");
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
        await tx`insert into core.company_unicorn_potential_assessments (tenant_id, organisation_id, company_id, method_version, revision, basis_hash, cohort_key, status, score, summary, observations) values (${input.subject.tenantId}::uuid, ${input.subject.organisationId}::uuid, ${subject.id}::uuid, ${input.methodVersion}, ${revision}, ${input.basisHash}, ${input.cohortKey}, ${input.view.status}, ${input.view.overallScore}, ${tx.json(input.view)}, ${tx.json(z.json().parse(input.observations))})`;
        return { revision, created: true };
      }),
    current: async (ids, methodVersion) => {
      if (ids.length === 0) return new Map();
      // One query, never an N+1 read per feed item. Only the current revision
      // and the one before it are used (momentum compares the immediate
      // previous revision only), so read two per company, not a history:
      // a 463-company rank read 20 each and paid the egress and the parse.
      const rows = await sql<
        Row[]
      >`select a.company_id, a.revision, a.basis_hash, a.cohort_key, a.summary, a.assessed_at, a.observations from unnest(${[...new Set(ids)]}::uuid[]) requested(id) cross join lateral (select company_id, revision, basis_hash, cohort_key, summary, assessed_at, observations from core.company_unicorn_potential_assessments where company_id = requested.id and method_version = ${methodVersion} order by revision desc limit 2) a`;
      const newest = new Map<string, Row>();
      for (const row of rows) {
        const prior = newest.get(row.company_id);
        if (prior === undefined || row.revision > prior.revision)
          newest.set(row.company_id, row);
      }
      const allowed = await eligibleUnicornRevisions(sql, [...newest.values()]);
      const historicalAllowed = await eligibleUnicornRevisions(
        sql,
        rows.filter(
          (row) => row.revision !== newest.get(row.company_id)?.revision,
        ),
        true,
      );
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
        if (first !== undefined && allowed.has(`${id}:${first.revision}`))
          output.set(
            id,
            withMomentum(
              first,
              items[1] !== undefined &&
                historicalAllowed.has(`${id}:${items[1].revision}`)
                ? [items[1]]
                : [],
            ),
          );
      }
      return output;
    },
  };
}
