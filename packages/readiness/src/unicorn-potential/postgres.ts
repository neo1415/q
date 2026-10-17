import { z } from "zod";
import {
  UnicornPotentialDtoSchema,
  UnicornSourceSchema,
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
  readonly sweepCompanyIds: (
    methodVersion: string,
    limit: number,
    afterCompanyId?: string,
  ) => Promise<readonly string[]>;
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
  observations: unknown;
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
  const observationSources = z
    .array(z.object({ source: UnicornSourceSchema }).passthrough())
    .max(2000);
  const eligibleRows = async (
    rows: readonly Row[],
    historical = false,
  ): Promise<ReadonlySet<string>> => {
    const requests: {
      company_id: string;
      kind: string;
      id: string;
      revision: string;
    }[] = [];
    const sourceKeys = new Map<string, string[]>();
    for (const row of rows) {
      const parsed = observationSources.safeParse(row.observations);
      if (!parsed.success) continue; // Unknown lineage format fails closed.
      const parsedView = UnicornPotentialDtoSchema.safeParse({
        ...(row.summary as Record<string, unknown>),
        assessedAt: null,
        momentum: null,
      });
      if (!parsedView.success) continue;
      const sources = [
        ...parsed.data.map((item) => item.source),
        ...parsedView.data.pillars.flatMap((pillar) =>
          pillar.criteria.flatMap((criterion) => criterion.sources),
        ),
      ];
      const keys: string[] = [];
      for (const source of sources) {
        const key = `${row.company_id}/${source.kind}/${source.id}/${source.revision}`;
        keys.push(key);
        requests.push({
          company_id: row.company_id,
          kind: source.kind,
          id: source.id,
          revision: source.revision,
        });
      }
      sourceKeys.set(`${row.company_id}/${row.revision}`, keys);
    }
    const allowed = await sql<{ source_key: string }[]>`
      with requested as (select * from jsonb_to_recordset(${sql.json(requests)}) as x(company_id text, kind text, id text, revision text))
      select r.company_id || '/' || r.kind || '/' || r.id || '/' || r.revision as source_key
      from requested r
      join core.companies company on company.id::text = r.company_id and company.company_status = 'active'
      join knowledge.company_profiles profile on profile.company_id = company.id and profile.listed
      where (r.kind = 'CLAIM' and exists (
        select 1 from evidence.claims c where c.id::text = r.id and c.tenant_id = company.tenant_id
        and c.subject_type = 'COMPANY' and c.subject_id = company.id
        and c.visibility_scope in ('network_visible', 'public_external') and (${historical} or c.lifecycle_status <> 'SUPERSEDED')
        and (${historical} or c.asserted_at = r.revision::timestamptz)))
      or (r.kind = 'FOUNDER_BACKGROUND' and exists (
        select 1 from core.founder_background_entries b join core.company_members m on m.user_id = b.user_id and m.tenant_id = b.tenant_id
        where b.id::text = r.id and m.company_id = company.id and m.is_founder and (${historical} or m.is_current) and b.visibility_scope = 'network_visible'))
      or (r.kind = 'DECK_SECTION' and exists (
        select 1 from evidence.deck_extractions x
        join evidence.documents d on d.id = x.document_id and d.company_id = company.id and d.tenant_id = company.tenant_id
        join evidence.document_versions v on v.id = x.document_version_id and v.tenant_id = d.tenant_id
        join evidence.document_versions current_version on current_version.id = d.current_version_id and current_version.tenant_id = d.tenant_id
        left join evidence.data_room_entries e on e.document_id = d.id
        where x.id::text = split_part(r.id, ':', 1) and x.company_id = company.id
        and d.owner_kind = 'ORGANISATION' and d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE'
        and v.malware_scan_status <> 'BLOCKED' and current_version.malware_scan_status <> 'BLOCKED'
        and (${historical} or v.id = d.current_version_id) and (e.level = 'PUBLIC' or d.download_audience = 'INVESTORS')
        and (${historical} or x.id = (select newer.id from evidence.deck_extractions newer where newer.document_version_id = v.id order by newer.created_at desc limit 1))
        and (${historical} or not exists (select 1 from evidence.deck_section_reviews review where review.extraction_id = x.id and review.section = split_part(r.id, ':', 2) and review.action = 'DISMISS'
          and review.created_at = (select max(last_review.created_at) from evidence.deck_section_reviews last_review where last_review.extraction_id = x.id and last_review.section = review.section)))))
      or (r.kind = 'PITCH' and exists (
        select 1 from media.media_assets m where m.id::text = r.id and m.owner_type = 'COMPANY' and m.owner_id = company.id and m.tenant_id = company.tenant_id
        and m.purpose = 'FOUNDER_PITCH' and m.status = 'READY' and m.moderation_status = 'ALLOWED' and m.playback_policy in ('AUTHORISED','PUBLIC') and m.deleted_at is null and m.superseded_at is null))`;
    const allowedKeys = new Set(allowed.map((row) => row.source_key));
    return new Set(
      [...sourceKeys]
        .filter(([, keys]) => keys.every((key) => allowedKeys.has(key)))
        .map(([key]) => key),
    );
  };
  const history: UnicornPotentialStore["history"] = async (
    companyId,
    methodVersion,
    limit = 20,
  ) => {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await sql<
      Row[]
    >`select company_id, revision, basis_hash, cohort_key, summary, observations, assessed_at from core.company_unicorn_potential_assessments where company_id = ${companyId}::uuid and method_version = ${methodVersion} order by revision desc limit ${bounded}`;
    const allowed = await eligibleRows(rows, true);
    return rows
      .filter((row) => allowed.has(`${row.company_id}/${row.revision}`))
      .map(snapshot);
  };
  return {
    inputs: eligible.inputs,
    listedCompanyIds: eligible.listedCompanyIds,
    sweepCompanyIds: async (_methodVersion, limit, afterCompanyId) => {
      const rows = await sql<
        { company_id: string }[]
      >`select p.company_id from knowledge.company_profiles p join core.companies c on c.id = p.company_id and c.company_status = 'active'
        where p.listed and (${afterCompanyId ?? null}::uuid is null or p.company_id > ${afterCompanyId ?? null}::uuid)
        order by p.company_id limit ${limit}`;
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
      // Bounded history in one query, never an N+1 read per feed item.
      const rows = await sql<
        Row[]
      >`select a.company_id, a.revision, a.basis_hash, a.cohort_key, a.summary, a.observations, a.assessed_at from unnest(${[...new Set(ids)]}::uuid[]) requested(id) cross join lateral (select company_id, revision, basis_hash, cohort_key, summary, observations, assessed_at from core.company_unicorn_potential_assessments where company_id = requested.id and method_version = ${methodVersion} order by revision desc limit 20) a`;
      const allowed = await eligibleRows(rows);
      const historicalAllowed = await eligibleRows(rows, true);
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
        if (first !== undefined && allowed.has(`${id}/${first.revision}`))
          output.set(
            id,
            withMomentum(
              first,
              items[1] !== undefined &&
                historicalAllowed.has(`${id}/${items[1].revision}`)
                ? [items[1]]
                : [],
            ),
          );
      }
      return output;
    },
  };
}
