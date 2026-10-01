import type { DatabaseExecutor } from "@capital-q/database";

import type { AdminGrant } from "./access.js";

/**
 * The verification / KYB queue (spec §4): every CURRENT pending request,
 * oldest first, with what an operator needs beside the decision. The
 * decision itself is the verification context's (OPERATOR_DECISION); this
 * only reads.
 */

export type VerificationQueueRow = {
  readonly claimId: string;
  readonly tenantId: string;
  readonly claimType: string;
  readonly subjectType: string;
  readonly subjectName: string | null;
  readonly subjectDomain: string | null;
  readonly organisationId: string;
  readonly organisationName: string;
  readonly companyName: string | null;
  readonly website: string | null;
  readonly country: string | null;
  readonly requesterName: string | null;
  readonly requesterEmail: string | null;
  readonly synthetic: boolean;
  readonly evidenceSourceId: string | null;
  readonly requestedAt: string;
};

export async function verificationQueue(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
): Promise<readonly VerificationQueueRow[]> {
  const rows = await sql<
    {
      id: string;
      tenant_id: string;
      claim_type: string;
      subject_type: string;
      subject_name: string | null;
      subject_domain: string | null;
      organisation_id: string;
      organisation_name: string;
      company_name: string | null;
      website: string | null;
      country: string | null;
      requester_name: string | null;
      requester_email: string | null;
      synthetic: boolean;
      evidence_source_id: string | null;
      created_at: Date;
    }[]
  >`
    select c.id, c.tenant_id, c.claim_type, c.subject_type,
           sp.display_name as subject_name, c.subject_domain,
           c.organisation_id, o.display_name as organisation_name,
           co.canonical_name as company_name,
           o.website_url as website, o.country_code as country,
           rp.display_name as requester_name, ru.email::text as requester_email,
           coalesce(ru.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false) as synthetic,
           c.evidence_source_id, c.created_at
      from evidence.verification_claims c
      join identity.organisations o on o.id = c.organisation_id
      left join core.companies co on co.organisation_id = c.organisation_id
      left join identity.user_profiles sp on c.subject_type = 'PERSON' and sp.id = c.subject_id
      join identity.user_profiles rp on rp.id = c.requested_by_user_id
      left join auth.users ru on ru.id = rp.auth_user_id
     where c.status = 'PENDING'
       and c.revision = (select max(v.revision) from evidence.verification_claims v
                          where v.tenant_id = c.tenant_id and v.claim_type = c.claim_type
                            and v.subject_key = c.subject_key)
     order by c.created_at, c.id
     limit 200`;
  return rows.map((row) => ({
    claimId: row.id,
    tenantId: row.tenant_id,
    claimType: row.claim_type,
    subjectType: row.subject_type,
    subjectName: row.subject_name,
    subjectDomain: row.subject_domain,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    companyName: row.company_name,
    website: row.website,
    country: row.country,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    synthetic: row.synthetic,
    evidenceSourceId: row.evidence_source_id,
    requestedAt: new Date(row.created_at).toISOString(),
  }));
}

/** The tenant a claim lives in, for the decider (which re-checks everything). */
export async function claimTenant(
  sql: DatabaseExecutor,
  claimId: string,
): Promise<string | null> {
  const rows = await sql<{ tenant_id: string }[]>`
    select tenant_id from evidence.verification_claims where id = ${claimId}`;
  return rows[0]?.tenant_id ?? null;
}
