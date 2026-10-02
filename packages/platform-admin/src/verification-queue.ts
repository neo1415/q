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
  /** The KYB details submitted with this request, when there are any. */
  readonly kyb: {
    readonly submissionId: string;
    readonly source: "PERSON" | "AUTO";
    readonly organisationName: string | null;
    readonly legalName: string | null;
    readonly registrationNumber: string | null;
    readonly jurisdictionCode: string | null;
    readonly registeredAddress: string | null;
    readonly websiteUrl: string | null;
    readonly contactEmailDomain: string | null;
    readonly emailDomainMatchesWebsite: boolean | null;
    readonly hasDocument: boolean;
  } | null;
  /** ADMIN-4: the identity details a person sent for their own claim. */
  readonly identity: {
    readonly submissionId: string;
    readonly nameOnId: string;
    readonly role: string;
    readonly hasDocument: boolean;
  } | null;
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
      kyb_id: string | null;
      kyb_source: "PERSON" | "AUTO" | null;
      kyb_org_name: string | null;
      kyb_email_domain: string | null;
      kyb_domain_match: boolean | null;
      kyb_legal_name: string | null;
      kyb_registration_number: string | null;
      kyb_jurisdiction: string | null;
      kyb_address: string | null;
      kyb_website: string | null;
      kyb_has_document: boolean | null;
      identity_id: string | null;
      identity_name: string | null;
      identity_role: string | null;
      identity_has_document: boolean | null;
    }[]
  >`
    select c.id, c.tenant_id, c.claim_type, c.subject_type,
           sp.display_name as subject_name, c.subject_domain,
           c.organisation_id, o.display_name as organisation_name,
           co.canonical_name as company_name,
           o.website_url as website, o.country_code as country,
           rp.display_name as requester_name, ru.email::text as requester_email,
           coalesce(ru.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false) as synthetic,
           c.evidence_source_id, c.created_at,
           k.id as kyb_id, k.source as kyb_source, k.organisation_name as kyb_org_name,
           k.contact_email_domain as kyb_email_domain,
           k.email_domain_matches_website as kyb_domain_match,
           k.legal_name as kyb_legal_name,
           k.registration_number as kyb_registration_number,
           k.jurisdiction_code as kyb_jurisdiction, k.registered_address as kyb_address,
           k.website_url as kyb_website, (k.document_id is not null) as kyb_has_document,
           i.id as identity_id, i.name_on_id as identity_name, i.role as identity_role,
           (i.document_id is not null) as identity_has_document
      from evidence.verification_claims c
      left join core.kyb_submissions k on k.claim_id = c.id and k.status = 'SUBMITTED'
      left join core.identity_submissions i on i.claim_id = c.id and i.status = 'SUBMITTED'
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
    kyb:
      row.kyb_id === null
        ? null
        : {
            submissionId: row.kyb_id,
            source: row.kyb_source ?? "PERSON",
            organisationName: row.kyb_org_name,
            legalName: row.kyb_legal_name,
            registrationNumber: row.kyb_registration_number,
            jurisdictionCode: row.kyb_jurisdiction,
            contactEmailDomain: row.kyb_email_domain,
            emailDomainMatchesWebsite: row.kyb_domain_match,
            registeredAddress: row.kyb_address,
            websiteUrl: row.kyb_website,
            hasDocument: row.kyb_has_document === true,
          },
    identity:
      row.identity_id === null
        ? null
        : {
            submissionId: row.identity_id,
            nameOnId: row.identity_name ?? "",
            role: row.identity_role ?? "",
            hasDocument: row.identity_has_document === true,
          },
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

/**
 * The document a KYB or identity submission points at, for a one-minute signed read by
 * the operator deciding it. Null when the submission has none or is not
 * open.
 */
export async function kybDocument(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
  submissionId: string,
): Promise<{
  readonly tenantId: string;
  readonly documentId: string;
  readonly versionId: string;
} | null> {
  const rows = await sql<
    { tenant_id: string; document_id: string; version_id: string }[]
  >`
    select k.tenant_id, d.id as document_id, d.current_version_id as version_id
      from (select id, tenant_id, document_id from core.kyb_submissions
            union all
            select id, tenant_id, document_id from core.identity_submissions) k
      join evidence.documents d on d.id = k.document_id and d.tenant_id = k.tenant_id
     where k.id = ${submissionId} and d.current_version_id is not null`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        tenantId: row.tenant_id,
        documentId: row.document_id,
        versionId: row.version_id,
      };
}
