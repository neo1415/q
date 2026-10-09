import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Recovery K (Tier B): prepared business knowledge, so Q never re-discovers
 * stable facts. The port over `knowledge.*` (migration 20261220181000);
 * callers never write SQL against it.
 *
 * Every read takes the viewer and checks it in the same statement:
 *   - companies: the viewer is a Capital Q participant (an active
 *     membership). Only LISTED companies (network_visible / public_external)
 *     exist here, with only what Discover may show -- never founder-private
 *     fields, never the capital objective, never an unconfirmed Q inference.
 *     Per-viewer discovery rules (disclosure, relationships, passes, mandate
 *     exclusions) remain the discovery engine's.
 *   - mandate and fit summaries: the viewer's own investor organisation in
 *     the viewer's own tenant; anyone else's mandate is the same "none".
 *
 * Each row carries a `version` (a global, monotonic sequence). A Tier A
 * working snapshot keeps the versions it used and asks `versions` before
 * reusing a fact: a different version, or null (no longer listed or not
 * the viewer's), means the cached fact is stale and must not be served.
 */

export type CompanyKnowledge = {
  readonly companyId: string;
  readonly name: string;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly websiteUrl: string | null;
  readonly countryCode: string | null;
  readonly city: string | null;
  /** Taxonomy canonical codes: declared industry nodes and their ancestors. */
  readonly sectorCodes: readonly string[];
  readonly subsectorCodes: readonly string[];
  /** The country's geography node and its ancestors (nigeria, west_africa, africa). */
  readonly geographyCodes: readonly string[];
  readonly businessModelCodes: readonly string[];
  readonly stageCode: string | null;
  readonly discoveryEligible: boolean;
  readonly pitchMediaPresent: boolean;
  /** Separate axes (ADR-001): the organisation claim, and the facts' support. */
  readonly verificationStatus: "VERIFIED" | "UNVERIFIED";
  readonly evidenceStatus: "NO_EVIDENCE" | "SELF_REPORTED";
  /** Monotonic version of this row (a bigint, as a decimal string). */
  readonly version: string;
  readonly updatedAt: string;
};

export type DiscoverCompaniesQuery = {
  /** Any of these sector codes (a parent matches its children). */
  readonly sectorCodes?: readonly string[] | undefined;
  /** Any of these geography codes (a region matches its countries). */
  readonly geographyCodes?: readonly string[] | undefined;
  readonly stageCodes?: readonly string[] | undefined;
  readonly limit: number;
  /** Keyset: the last row's name and id from the previous page. */
  readonly after?:
    { readonly name: string; readonly companyId: string } | null | undefined;
};

export type MandateSummary = {
  readonly mandateId: string;
  readonly investorOrganisationId: string;
  readonly name: string;
  readonly status: string;
  readonly discoveryMode: string | null;
  /** The canonical mandate's own version ("mandate v7"). */
  readonly mandateVersion: number;
  readonly sectorCodes: readonly string[];
  readonly excludedSectorCodes: readonly string[];
  readonly geographyCodes: readonly string[];
  readonly minStageCode: string | null;
  readonly maxStageCode: string | null;
  /** Money as decimal strings with an ISO currency; never floats. */
  readonly minCheque: string | null;
  readonly maxCheque: string | null;
  readonly currencyCode: string | null;
  readonly hardExclusions: number;
  readonly version: string;
  readonly updatedAt: string;
};

export type FitSummary = {
  readonly mandateId: string;
  readonly mandateVersion: number;
  readonly slateId: string | null;
  readonly slateGeneratedAt: string | null;
  readonly slateItemCount: number;
  /** The current slate's companies, in rank order (at most 25). */
  readonly topCompanyIds: readonly string[];
  readonly eligibleCount: number;
  readonly version: string;
  readonly updatedAt: string;
};

export type KnowledgeVersionKind = "COMPANY" | "MANDATE" | "FIT";

export type CompanyKnowledgePort = {
  /** DISCOVER_COMPANIES: listed, eligible companies by sector, geography, stage. */
  readonly discoverCompanies: (
    viewer: ActorContext,
    query: DiscoverCompaniesQuery,
  ) => Promise<readonly CompanyKnowledge[]>;
  readonly companies: (
    viewer: ActorContext,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, CompanyKnowledge>>;
  /** The viewer's own mandate: the one named, else their single ACTIVE one. */
  readonly mandateSummary: (
    viewer: ActorContext,
    mandateId?: string | null,
  ) => Promise<MandateSummary | null>;
  readonly fitSummary: (
    viewer: ActorContext,
    mandateId: string,
  ) => Promise<FitSummary | null>;
  /**
   * Tier A staleness check: each id's current version, or null when it is
   * no longer listed (companies) or not the viewer's (mandates, fits).
   */
  readonly versions: (
    viewer: ActorContext,
    kind: KnowledgeVersionKind,
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, string | null>>;
};

export const KNOWLEDGE_DISCOVER_LIMIT_MAX = 50;
const IDS_MAX = 200;

const Text = z.string();
const Codes = z.array(z.string());
const Stamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );
const Big = z.union([z.string(), z.number(), z.bigint()]).transform(String);

const CompanyRow = z.object({
  company_id: z.string().uuid(),
  canonical_name: Text,
  short_description: Text.nullable(),
  primary_description: Text.nullable(),
  website_url: Text.nullable(),
  country_code: Text.nullable(),
  city: Text.nullable(),
  sector_codes: Codes,
  subsector_codes: Codes,
  geography_codes: Codes,
  business_model_codes: Codes,
  stage_code: Text.nullable(),
  discovery_eligible: z.boolean(),
  pitch_media_present: z.boolean(),
  verification_status: z.enum(["VERIFIED", "UNVERIFIED"]),
  evidence_status: z.enum(["NO_EVIDENCE", "SELF_REPORTED"]),
  version: Big,
  updated_at: Stamp,
});

function toCompany(raw: unknown): CompanyKnowledge {
  const row = CompanyRow.parse(raw);
  return {
    companyId: row.company_id,
    name: row.canonical_name,
    shortDescription: row.short_description,
    description: row.primary_description,
    websiteUrl: row.website_url,
    countryCode: row.country_code,
    city: row.city,
    sectorCodes: row.sector_codes,
    subsectorCodes: row.subsector_codes,
    geographyCodes: row.geography_codes,
    businessModelCodes: row.business_model_codes,
    stageCode: row.stage_code,
    discoveryEligible: row.discovery_eligible,
    pitchMediaPresent: row.pitch_media_present,
    verificationStatus: row.verification_status,
    evidenceStatus: row.evidence_status,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

const Money = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((value) => (value === null ? null : String(value)));

const MandateRow = z.object({
  mandate_id: z.string().uuid(),
  investor_organisation_id: z.string().uuid(),
  name: Text,
  status: Text,
  discovery_mode: Text.nullable(),
  mandate_version: z.number().int(),
  sector_codes: Codes,
  excluded_sector_codes: Codes,
  geography_codes: Codes,
  min_stage_code: Text.nullable(),
  max_stage_code: Text.nullable(),
  min_cheque: Money,
  max_cheque: Money,
  currency_code: Text.nullable(),
  hard_exclusions: z.number().int(),
  version: Big,
  updated_at: Stamp,
});

const FitRow = z.object({
  mandate_id: z.string().uuid(),
  mandate_version: z.number().int(),
  slate_id: z.string().uuid().nullable(),
  slate_generated_at: Stamp.nullable(),
  slate_item_count: z.number().int(),
  top_company_ids: z.array(z.string().uuid()),
  eligible_count: z.number().int(),
  version: Big,
  updated_at: Stamp,
});

const COMPANY_COLUMNS = (sql: DatabaseExecutor) => sql`
  p.company_id, p.canonical_name, p.short_description, p.primary_description, p.website_url,
  p.country_code, p.city, p.sector_codes, p.subsector_codes, p.geography_codes,
  p.business_model_codes, p.stage_code, p.discovery_eligible, p.pitch_media_present,
  p.verification_status, p.evidence_status, p.version::text as version, p.updated_at`;

const codes = (values: readonly string[] | undefined) =>
  [...new Set(values ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value))
    .slice(0, 50);

export function createPostgresCompanyKnowledge(options: {
  readonly sql: DatabaseExecutor;
}): CompanyKnowledgePort {
  const { sql } = options;

  /** The viewer as a participant: an active membership, in their own tenant. */
  const participant = (viewer: ActorContext) => sql`
    exists (select 1 from identity.organisation_memberships m
             where m.user_id = ${viewer.userId} and m.tenant_id = ${viewer.tenantId}
               and m.membership_status = 'active')`;

  /** The viewer's own investor organisation(s), in their own tenant. */
  const ownMandate = (viewer: ActorContext) =>
    viewer.organisationId === undefined
      ? sql`false`
      : sql`s.tenant_id = ${viewer.tenantId}
            and s.investor_organisation_id in (
              select io.id from core.investor_organisations io
               where io.tenant_id = ${viewer.tenantId}
                 and io.organisation_id = ${viewer.organisationId})
            and ${participant(viewer)}`;

  return {
    discoverCompanies: async (viewer, query) => {
      if (viewer.actorType !== "HUMAN") return [];
      const sectors = codes(query.sectorCodes);
      const geographies = codes(query.geographyCodes);
      const stages = codes(query.stageCodes);
      const limit = Math.min(
        Math.max(Math.trunc(query.limit), 1),
        KNOWLEDGE_DISCOVER_LIMIT_MAX,
      );
      const after = query.after ?? null;
      const rows = await sql`
        select ${COMPANY_COLUMNS(sql)}
          from knowledge.company_profiles p
         where p.listed and p.discovery_eligible
           and ${participant(viewer)}
           and (${sectors.length === 0} or p.sector_codes && ${sectors}::text[])
           and (${geographies.length === 0} or p.geography_codes && ${geographies}::text[])
           and (${stages.length === 0} or p.stage_code = any(${stages}::text[]))
           and (${after === null} or (p.canonical_name, p.company_id)
                > (${after?.name ?? ""}::text, ${after?.companyId ?? "00000000-0000-0000-0000-000000000000"}::uuid))
         order by p.canonical_name, p.company_id
         limit ${limit}`;
      return rows.map(toCompany);
    },

    companies: async (viewer, companyIds) => {
      const ids = [...new Set(companyIds)].slice(0, IDS_MAX);
      const out = new Map<string, CompanyKnowledge>();
      if (ids.length === 0 || viewer.actorType !== "HUMAN") return out;
      const rows = await sql`
        select ${COMPANY_COLUMNS(sql)}
          from knowledge.company_profiles p
         where p.company_id = any(${ids}::uuid[]) and p.listed
           and ${participant(viewer)}`;
      for (const raw of rows) {
        const company = toCompany(raw);
        out.set(company.companyId, company);
      }
      return out;
    },

    mandateSummary: async (viewer, mandateId = null) => {
      if (viewer.actorType !== "HUMAN") return null;
      const rows = await sql`
        select s.mandate_id, s.investor_organisation_id, s.name, s.status, s.discovery_mode,
               s.mandate_version, s.sector_codes, s.excluded_sector_codes, s.geography_codes,
               s.min_stage_code, s.max_stage_code, s.min_cheque::text as min_cheque,
               s.max_cheque::text as max_cheque, s.currency_code, s.hard_exclusions,
               s.version::text as version, s.updated_at
          from knowledge.mandate_summaries s
         where ${ownMandate(viewer)}
           and (${mandateId === null} or s.mandate_id = ${mandateId ?? "00000000-0000-0000-0000-000000000000"}::uuid)
           and (${mandateId !== null} or s.status = 'ACTIVE')
         order by s.updated_at desc
         limit 2`;
      // Two active mandates and none named: ambiguous, so none is guessed.
      if (mandateId === null && rows.length !== 1) return null;
      const row = rows[0];
      if (row === undefined) return null;
      const m = MandateRow.parse(row);
      return {
        mandateId: m.mandate_id,
        investorOrganisationId: m.investor_organisation_id,
        name: m.name,
        status: m.status,
        discoveryMode: m.discovery_mode,
        mandateVersion: m.mandate_version,
        sectorCodes: m.sector_codes,
        excludedSectorCodes: m.excluded_sector_codes,
        geographyCodes: m.geography_codes,
        minStageCode: m.min_stage_code,
        maxStageCode: m.max_stage_code,
        minCheque: m.min_cheque,
        maxCheque: m.max_cheque,
        currencyCode: m.currency_code,
        hardExclusions: m.hard_exclusions,
        version: m.version,
        updatedAt: m.updated_at,
      };
    },

    fitSummary: async (viewer, mandateId) => {
      if (viewer.actorType !== "HUMAN") return null;
      const rows = await sql`
        select s.mandate_id, s.mandate_version, s.slate_id, s.slate_generated_at,
               s.slate_item_count, s.top_company_ids, s.eligible_count,
               s.version::text as version, s.updated_at
          from knowledge.fit_summaries s
         where s.mandate_id = ${mandateId}::uuid and ${ownMandate(viewer)}`;
      const row = rows[0];
      if (row === undefined) return null;
      const f = FitRow.parse(row);
      return {
        mandateId: f.mandate_id,
        mandateVersion: f.mandate_version,
        slateId: f.slate_id,
        slateGeneratedAt: f.slate_generated_at,
        slateItemCount: f.slate_item_count,
        topCompanyIds: f.top_company_ids,
        eligibleCount: f.eligible_count,
        version: f.version,
        updatedAt: f.updated_at,
      };
    },

    versions: async (viewer, kind, ids) => {
      const wanted = [...new Set(ids)].slice(0, IDS_MAX);
      const out = new Map<string, string | null>(
        wanted.map((id) => [id, null]),
      );
      if (wanted.length === 0 || viewer.actorType !== "HUMAN") return out;
      const rows =
        kind === "COMPANY"
          ? await sql<{ id: string; version: string }[]>`
              select p.company_id as id, p.version::text as version
                from knowledge.company_profiles p
               where p.company_id = any(${wanted}::uuid[]) and p.listed
                 and ${participant(viewer)}`
          : kind === "MANDATE"
            ? await sql<{ id: string; version: string }[]>`
                select s.mandate_id as id, s.version::text as version
                  from knowledge.mandate_summaries s
                 where s.mandate_id = any(${wanted}::uuid[]) and ${ownMandate(viewer)}`
            : await sql<{ id: string; version: string }[]>`
                select s.mandate_id as id, s.version::text as version
                  from knowledge.fit_summaries s
                 where s.mandate_id = any(${wanted}::uuid[]) and ${ownMandate(viewer)}`;
      for (const row of rows) out.set(row.id, row.version);
      return out;
    },
  };
}
