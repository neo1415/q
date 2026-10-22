import { z } from "zod";

import type { CompanyProfileTeamMember } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  projectTeamForNetwork,
  type TeamProjectionSource,
} from "../domain/team-projection.js";

const Row = z.object({
  display_name: z.string().nullable(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  relationship_type: z.enum([
    "team_member",
    "advisor",
    "board_member",
    "contractor",
    "other",
  ]),
  business_title: z.string().nullable(),
  is_founder: z.boolean(),
  professional_summary: z.string().nullable(),
});

const PublicFounders = z.object({
  founders: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        title: z.string().trim().max(200).nullish(),
      }),
    )
    .max(20),
});

/**
 * F9 (2026-10-08): a company nobody has joined yet (an unclaimed public
 * profile) still names its founders from its own CURRENT public-web claim
 * `team.founders`, network-visible only, tenant-matched. Labelled
 * PUBLIC_SOURCE: a claim from public sources, never a verified fact and
 * never a person on Capital Q. Once anyone joins, only members are shown.
 */
async function publicFounders(
  sql: DatabaseExecutor,
  company: { readonly tenantId: string; readonly companyId: string },
): Promise<CompanyProfileTeamMember[]> {
  const rows = await sql<{ structured_value: unknown }[]>`
    select cl.structured_value
      from evidence.claims cl
     where cl.tenant_id = ${company.tenantId}
       and cl.subject_type = 'COMPANY'
       and cl.subject_id = ${company.companyId}
       and cl.claim_key = 'team.founders'
       and cl.lifecycle_status = 'CURRENT'
       and cl.visibility_scope in ('network_visible', 'public_external')
     order by cl.asserted_at desc
     limit 1`;
  const parsed = PublicFounders.safeParse(rows[0]?.structured_value);
  if (!parsed.success) return [];
  return projectTeamForNetwork(
    parsed.data.founders.map((founder) => ({
      displayName: founder.name,
      givenName: null,
      familyName: null,
      relationshipType: "team_member" as const,
      businessTitle: founder.title ?? null,
      isFounder: true,
      professionalSummary: null,
    })),
  ).map((member) => ({ ...member, source: "PUBLIC_SOURCE" as const }));
}

/**
 * A company's current team, read for the investor projection (ADR 0041).
 * Server-side, tenant-matched, current members only, founders first. The
 * query selects only the projection's inputs: no email, no user id, no
 * background summary, no visibility label. Who may see the result is the
 * caller's decision, made before this is asked.
 */
export function createPostgresCompanyTeamProjection(options: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    teamForNetwork: async (company: {
      readonly tenantId: string;
      readonly companyId: string;
    }) => {
      const rows = await options.sql`
        select p.display_name, p.given_name, p.family_name,
               m.relationship_type, m.business_title, m.is_founder,
               f.professional_summary
          from core.company_members m
          join identity.user_profiles p on p.id = m.user_id
          left join core.founder_profiles f
            on f.tenant_id = m.tenant_id and f.user_id = m.user_id
         where m.tenant_id = ${company.tenantId}
           and m.company_id = ${company.companyId}
           and m.is_current
         order by m.is_founder desc, m.started_at asc, m.id asc
         limit 50`;
      if (rows.length === 0) {
        return publicFounders(options.sql, company);
      }
      const sources: TeamProjectionSource[] = rows.map((raw) => {
        const row = Row.parse(raw);
        return {
          displayName: row.display_name,
          givenName: row.given_name,
          familyName: row.family_name,
          relationshipType: row.relationship_type,
          businessTitle: row.business_title,
          isFounder: row.is_founder,
          professionalSummary: row.professional_summary,
        };
      });
      return projectTeamForNetwork(sources);
    },
  };
}

const AffiliationRow = z.object({
  company_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  canonical_name: z.string().min(1),
  business_title: z.string().nullable(),
  is_founder: z.boolean(),
});

/**
 * Where a person works now, for their own Q Card's affiliation line (owner
 * 2026-10-22): their earliest current company membership, founders first.
 * Server-side; the person's card decides what shows and to whom.
 */
export function createPostgresCompanyAffiliationRead(options: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    currentForUser: async (
      userId: string,
    ): Promise<{
      readonly subjectId: string;
      readonly tenantId: string;
      readonly organisationId: string;
      readonly name: string;
      readonly roleTitle: string | null;
    } | null> => {
      const [raw] = await options.sql`
        select m.company_id, c.tenant_id, c.organisation_id, c.canonical_name,
               m.business_title, m.is_founder
          from core.company_members m
          join core.companies c on c.id = m.company_id
         where m.user_id = ${userId}
           and m.is_current
         order by m.is_founder desc, m.started_at asc, m.id asc
         limit 1`;
      if (raw === undefined) return null;
      const row = AffiliationRow.parse(raw);
      return {
        subjectId: row.company_id,
        tenantId: row.tenant_id,
        organisationId: row.organisation_id,
        name: row.canonical_name,
        roleTitle:
          row.business_title?.trim() || (row.is_founder ? "Founder" : null),
      };
    },
  };
}
