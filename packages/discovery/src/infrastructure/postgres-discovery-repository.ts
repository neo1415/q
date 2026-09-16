import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import type {
  CandidateCompany,
  CandidateInvestor,
  DiscoveryRepository,
  OwnMandate,
} from "../ports.js";

/**
 * Discovery's reads, in PostgreSQL.
 *
 * Two things here are deliberate and worth stating.
 *
 * The candidate queries are CROSS-TENANT and say so in SQL. "Visible to
 * the network" means visible to authenticated Capital Q participants
 * (ADR-001), and every organisation has its own tenant, so scoping
 * discovery to the caller's tenant would make network visibility mean
 * nothing — which is exactly the bug this replaced. The filter is the
 * declared visibility column; the caller's own organisation is the only
 * exclusion, because their own company is the subject of their own
 * conversations, not a discovery result.
 *
 * The mandate read is tenant-scoped and organisation-scoped, because it is
 * the caller's OWN mandate. Nobody else's is readable from here: there is
 * no query in this file that returns another organisation's mandate,
 * preferences or constraints, and that absence is the guarantee.
 */

const DISCOVERABLE = ["network_visible", "public_external"] as const;

const CompanyRow = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  website_url: z.string().nullable(),
  headquarters_country: z.string().nullable(),
  current_stage_code: z.string().nullable(),
  short_description: z.string().nullable(),
  nodes: z
    .array(
      z.object({
        node_id: z.string().uuid(),
        vocabulary: z.string(),
        label: z.string(),
      }),
    )
    .nullable(),
});

const InvestorRow = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  investor_type: z.string(),
  website_url: z.string().nullable(),
  hq_country: z.string().nullable(),
  public_description: z.string().nullable(),
  deployment_state: z.string().nullable(),
});

const MandateRow = z.object({
  id: z.string().uuid(),
  min_stage_code: z.string().nullable(),
  max_stage_code: z.string().nullable(),
});

const SideRow = z.object({
  is_investor: z.boolean(),
  is_founder: z.boolean(),
});

const PreferenceRow = z.object({
  node_id: z.string().uuid(),
  vocabulary: z.string(),
  label: z.string(),
  preference_strength: z.string(),
  is_exclusion: z.boolean(),
});

export function createPostgresDiscoveryRepository(options: {
  readonly sql: DatabaseExecutor;
}): DiscoveryRepository {
  const { sql } = options;

  return {
    discoverableCompanies: async (actor, input) => {
      const ownOrganisation = actor.organisationId ?? null;
      const rows = await sql`
        select c.id,
               c.canonical_name,
               c.website_url,
               c.headquarters_country,
               c.current_stage_code,
               c.short_description,
               (
                 select coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'node_id', n.id,
                       'vocabulary', v.code,
                       'label', n.display_name
                     )
                   ),
                   '[]'::jsonb
                 )
                   from taxonomy.entity_assignments a
                   join taxonomy.nodes n on n.id = a.node_id
                   join taxonomy.vocabularies v on v.id = n.vocabulary_id
                  where a.entity_type = 'COMPANY'
                    and a.entity_id = c.id
                    and a.status = 'ACTIVE'
               ) as nodes
          from core.companies c
         where c.company_status = 'active'
           and c.marketplace_visibility = any(${[...DISCOVERABLE]}::text[])
           and (${ownOrganisation}::uuid is null
                or c.organisation_id <> ${ownOrganisation}::uuid)
           and (${input.afterId}::uuid is null or c.id > ${input.afterId}::uuid)
         order by c.id
         limit ${input.limit}`;
      const candidates: CandidateCompany[] = [];
      for (const raw of rows) {
        const parsed = CompanyRow.safeParse(raw);
        if (!parsed.success) continue;
        const row = parsed.data;
        candidates.push({
          companyId: row.id,
          canonicalName: row.canonical_name,
          websiteUrl: row.website_url,
          headquartersCountry: row.headquarters_country,
          currentStageCode: row.current_stage_code,
          shortDescription: row.short_description,
          classifications: (row.nodes ?? []).map((node) => ({
            nodeId: node.node_id,
            vocabulary: node.vocabulary,
            label: node.label,
          })),
        });
      }
      return candidates;
    },

    discoverableInvestors: async (actor, input) => {
      const ownOrganisation = actor.organisationId ?? null;
      const rows = await sql`
        select i.id,
               i.display_name,
               i.investor_type,
               i.website_url,
               i.hq_country,
               i.public_description,
               i.deployment_state
          from core.investor_organisations i
         where i.marketplace_visibility = 'network_visible'
           and (${ownOrganisation}::uuid is null
                or i.organisation_id <> ${ownOrganisation}::uuid)
           and (${input.afterId}::uuid is null or i.id > ${input.afterId}::uuid)
         order by i.id
         limit ${input.limit}`;
      const candidates: CandidateInvestor[] = [];
      for (const raw of rows) {
        const parsed = InvestorRow.safeParse(raw);
        if (!parsed.success) continue;
        const row = parsed.data;
        candidates.push({
          investorOrganisationId: row.id,
          displayName: row.display_name,
          investorType: row.investor_type,
          websiteUrl: row.website_url,
          hqCountry: row.hq_country,
          publicDescription: row.public_description,
          deploymentState: row.deployment_state,
        });
      }
      return candidates;
    },

    ownSide: async (actor) => {
      const organisationId = actor.organisationId;
      if (organisationId === undefined) return "NONE";
      const rows = await sql`
        select
          exists (
            select 1 from core.investor_organisations i
             where i.tenant_id = ${actor.tenantId}
               and i.organisation_id = ${organisationId}
          ) as is_investor,
          exists (
            select 1 from core.companies c
             where c.tenant_id = ${actor.tenantId}
               and c.organisation_id = ${organisationId}
               and c.company_status = 'active'
          ) as is_founder`;
      const parsed = SideRow.safeParse(rows[0]);
      if (!parsed.success) return "NONE";
      // An organisation that is somehow both reads as an investor: the
      // mandate is the thing that produces a matched slate.
      if (parsed.data.is_investor) return "INVESTOR";
      return parsed.data.is_founder ? "FOUNDER" : "NONE";
    },

    ownActiveMandate: async (actor): Promise<OwnMandate | null> => {
      const organisationId = actor.organisationId;
      if (organisationId === undefined) return null;
      // The caller's own mandate only: named tenant, named organisation.
      const mandates = await sql`
        select m.id, m.min_stage_code, m.max_stage_code
          from core.investor_mandates m
          join core.investor_organisations i
            on i.id = m.investor_organisation_id
         where m.tenant_id = ${actor.tenantId}
           and i.organisation_id = ${organisationId}
           and m.status = 'ACTIVE'
         order by m.created_at desc
         limit 1`;
      if (mandates.length === 0) return null;
      const mandate = MandateRow.safeParse(mandates[0]);
      if (!mandate.success) return null;

      const preferenceRows = await sql`
        select p.node_id,
               v.code as vocabulary,
               n.display_name as label,
               p.preference_strength,
               p.is_exclusion
          from taxonomy.mandate_preferences p
          join taxonomy.nodes n on n.id = p.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where p.tenant_id = ${actor.tenantId}
           and p.mandate_id = ${mandate.data.id}`;
      const preferences = preferenceRows.flatMap((raw) => {
        const parsed = PreferenceRow.safeParse(raw);
        return parsed.success
          ? [
              {
                nodeId: parsed.data.node_id,
                vocabulary: parsed.data.vocabulary,
                label: parsed.data.label,
                strength: parsed.data.preference_strength,
                isExclusion: parsed.data.is_exclusion,
              },
            ]
          : [];
      });

      return {
        mandateId: mandate.data.id,
        minStageCode: mandate.data.min_stage_code,
        maxStageCode: mandate.data.max_stage_code,
        preferences,
      };
    },
  };
}
