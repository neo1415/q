import { createHash, randomInt, randomUUID } from "node:crypto";

import {
  CLAIM_EVIDENCE_MAX_BYTES,
  type ClaimEvidenceCompleteDto,
  type ClaimEvidenceUploadDto,
  type ClaimEvidenceUploadRequest,
} from "@capital-q/contracts";
import type {
  ClaimableCompanyDto,
  ClaimDecisionResultDto,
  CompanyClaimRequest,
  CompanyClaimResultDto,
  ConfirmClaimCodeResultDto,
  PendingClaimDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import { parseCompanySearch } from "../domain/company-search.js";
import { companySearchJoins } from "../infrastructure/company-search-sql.js";

/**
 * F8: who is searching. A person with no organisation yet (exactly who
 * joins a team) searches too; their own organisation, when they have one,
 * adds their own company.
 */
export type ClaimSearcher = {
  readonly userId: string;
  readonly tenantId?: string | undefined;
  readonly organisationId?: string | undefined;
};

/**
 * F3 (2026-10-06): "Find my startup". A founder finds their company among
 * the companies they may already see, and asks to claim it, or to join it
 * when it already has members.
 *
 *   one canonical company: nothing here creates a company or a duplicate
 *   a claim request ≠ a membership: only a decision makes one
 *
 * What a founder may find is what they may already see: companies shared
 * with the network (network_visible / public_external, ADR-001) and their
 * own organisation's. An organisation-private company never appears to a
 * partial search, so a search cannot become a way to list private
 * companies. F8: a teammate who types the company's exact website domain
 * already knows it exists; that exact match finds it (name, city and
 * website only, which they typed), so they can ask its members to let them
 * in before it is verified.
 */

const VISIBLE = ["network_visible", "public_external"];

function hostOf(website: string | null): string | null {
  if (website === null) return null;
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Is this email at the company's own website domain (or a subdomain of it)? */
export function emailAtCompany(email: string, website: string | null): boolean {
  const host = hostOf(website);
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return (
    host !== null &&
    host !== "" &&
    (domain === host || domain.endsWith(`.${host}`))
  );
}

/** P14: how long a work-email code works, and how many tries it allows. */
export const CLAIM_CODE_TTL_MINUTES = 30;
export const CLAIM_CODE_MAX_ATTEMPTS = 5;

const hashCode = (code: string) =>
  createHash("sha256").update(`claim-code:${code}`, "utf8").digest("hex");

/**
 * P14: sends the one-time code to the work email (the composition renders
 * it through the app's email sender). False: it did not go.
 */
export type ClaimCodeMailer = (input: {
  readonly to: string;
  readonly companyName: string;
  readonly code: string;
  readonly expiresInMinutes: number;
}) => Promise<boolean>;

/**
 * 2026-10-08: private storage for a claim's registry document, composed by
 * the app (bucket and provider stay there). The browser puts the bytes
 * straight to storage; this module only issues the key and reads back what
 * storage observed.
 */
export type ClaimEvidenceStorage = {
  readonly authorizeUpload: (input: {
    readonly key: string;
    readonly contentType: string;
    readonly maxBytes: number;
  }) => Promise<{
    readonly method: "PUT";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly providerExpiresAt: string;
  }>;
  readonly stat: (
    key: string,
  ) => Promise<{ readonly sizeBytes: number } | null>;
  readonly authorizeDownload: (input: {
    readonly key: string;
    readonly fileName: string;
  }) => Promise<{ readonly url: string; readonly providerExpiresAt: string }>;
};

export function createCompanyClaims(options: {
  readonly sql: DatabaseExecutor;
  readonly evidenceStorage?: ClaimEvidenceStorage | undefined;
  readonly codeMailer?: ClaimCodeMailer | undefined;
  /** Test seam: a known code. */
  readonly newCode?: (() => string) | undefined;
  /**
   * P14: admission once a claim is approved (the organisations context's
   * own command, composed by the app). Absent: decisions record only.
   */
  readonly admit?:
    | ((input: {
        readonly organisationId: string;
        readonly userId: string;
        readonly role: "OWNER" | "MEMBER";
        readonly decidedByUserId: string;
        readonly claimRequestId: string;
      }) => Promise<unknown>)
    | undefined;
}) {
  const { sql } = options;
  const newCode =
    options.newCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));

  type Row = {
    id: string;
    tenant_id: string;
    organisation_id: string | null;
    canonical_name: string;
    website_url: string | null;
    headquarters_city: string | null;
    headquarters_country: string | null;
    members: number;
    yours: boolean;
    requested: boolean;
  };

  const visible = (
    actor: ClaimSearcher,
    where: ReturnType<typeof sql>,
    exactHost: string | null = null,
  ) => sql<Row[]>`
    select c.id, c.tenant_id, c.organisation_id, c.canonical_name, c.website_url, c.headquarters_city,
           c.headquarters_country,
           (select count(*)::int from identity.organisation_memberships m
             where m.organisation_id = c.organisation_id and m.membership_status = 'active') as members,
           exists (select 1 from identity.organisation_memberships m
                    where m.organisation_id = c.organisation_id and m.user_id = ${actor.userId}
                      and m.membership_status = 'active') as yours,
           exists (select 1 from core.company_claim_requests r
                    where r.company_id = c.id and r.requester_user_id = ${actor.userId}
                      and r.status = 'PENDING') as requested
      from core.companies c
     where c.company_status = 'active'
       and (c.marketplace_visibility = any(${VISIBLE}::text[])
            or (c.organisation_id = ${actor.organisationId ?? null}::uuid
                and c.tenant_id = ${actor.tenantId ?? null}::uuid)
            or (${exactHost}::text is not null
                and lower(regexp_replace(c.website_url, '^https?://(www\\.)?([^/:?#]+).*$', '\\2')) = ${exactHost}::text))
       and ${where}
     order by c.canonical_name
     limit 20`;

  const toDto = (row: Row): ClaimableCompanyDto => ({
    companyId: row.id,
    organisationId: row.organisation_id,
    name: row.canonical_name,
    website: row.website_url,
    city: row.headquarters_city,
    country: row.headquarters_country,
    members: row.members,
    yours: row.yours,
    requested: row.requested,
  });

  const claims = {
    search: async (
      actor: ClaimSearcher,
      text: string,
    ): Promise<readonly ClaimableCompanyDto[]> => {
      const query = text.trim().slice(0, 120);
      if (query.length < 2) return [];
      const parsed = parseCompanySearch(query);
      if (parsed === null) return [];
      // P13: the same reading and ranking as every company search (exact,
      // website, sound-alike, prefix, contains, close misspelling, described),
      // best first; the legal name still finds a company by its own text.
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const host = hostOf(query.includes("://") ? query : `https://${query}`);
      // Only a query that looks like a domain can match a private company,
      // and only exactly (P14).
      const exactHost = host !== null && host.includes(".") ? host : null;
      const rows = await sql<Row[]>`
        select c.id, c.tenant_id, c.organisation_id, c.canonical_name, c.website_url, c.headquarters_city,
               c.headquarters_country,
               (select count(*)::int from identity.organisation_memberships m
                 where m.organisation_id = c.organisation_id and m.membership_status = 'active') as members,
               exists (select 1 from identity.organisation_memberships m
                        where m.organisation_id = c.organisation_id and m.user_id = ${actor.userId}
                          and m.membership_status = 'active') as yours,
               exists (select 1 from core.company_claim_requests r
                        where r.company_id = c.id and r.requester_user_id = ${actor.userId}
                          and r.status = 'PENDING') as requested
          from core.companies c
          ${companySearchJoins(sql, parsed)}
         where c.company_status = 'active'
           and (c.marketplace_visibility = any(${VISIBLE}::text[])
                or (c.organisation_id = ${actor.organisationId ?? null}::uuid
                    and c.tenant_id = ${actor.tenantId ?? null}::uuid)
                or (${exactHost}::text is not null
                    and lower(regexp_replace(c.website_url, '^https?://(www\\.)?([^/:?#]+).*$', '\\2')) = ${exactHost}::text))
           and (s.score > 0 or c.legal_name ilike ${like})
         order by greatest(s.score, case when c.legal_name ilike ${like} then 640 else 0 end) desc,
                  c.canonical_name, c.id
         limit 20`;
      return rows.map(toDto);
    },

    request: async (
      actor: ClaimSearcher,
      companyId: string,
      input: CompanyClaimRequest,
    ): Promise<CompanyClaimResultDto | null> => {
      const rows = await visible(actor, sql`c.id = ${companyId}`);
      const company = rows[0];
      // Not visible to them is the same answer as not existing.
      if (company === undefined) return null;
      if (company.yours) return { status: "ALREADY_YOURS" };
      if (
        input.method === "WORK_EMAIL" &&
        !emailAtCompany(input.workEmail ?? "", company.website_url)
      ) {
        return { status: "EMAIL_NOT_AT_COMPANY" };
      }
      const inserted = await sql<{ id: string }[]>`
        insert into core.company_claim_requests
          (tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
        values (${company.tenant_id}, ${company.id}, ${actor.userId}, ${input.method},
                ${input.method === "WORK_EMAIL" ? (input.workEmail ?? null) : null}, ${input.clientRequestId})
        on conflict do nothing
        returning id`;
      const id = inserted[0]?.id;
      if (id === undefined) return { status: "ALREADY_REQUESTED" };
      if (input.method !== "WORK_EMAIL" || input.workEmail === undefined) {
        return { status: "REQUESTED" };
      }
      // P14: the work email gets a one-time code; only its hash is kept.
      const code = newCode();
      await sql`
        update core.company_claim_requests
           set code_hash = ${hashCode(code)},
               code_expires_at = now() + make_interval(mins => ${CLAIM_CODE_TTL_MINUTES})
         where id = ${id}`;
      const codeSent =
        options.codeMailer === undefined
          ? false
          : await options
              .codeMailer({
                to: input.workEmail,
                companyName: company.canonical_name,
                code,
                expiresInMinutes: CLAIM_CODE_TTL_MINUTES,
              })
              .catch(() => false);
      return { status: "REQUESTED", codeSent };
    },

    /**
     * P14: the requester types the code from their work email. Bounded
     * attempts; a confirmed address is evidence for whoever decides, never
     * a decision by itself.
     */
    confirmCode: async (
      requester: { readonly userId: string },
      companyId: string,
      code: string,
    ): Promise<ConfirmClaimCodeResultDto> => {
      const rows = await sql<
        {
          id: string;
          code_hash: string | null;
          expired: boolean;
          attempts: number;
        }[]
      >`
        select id, code_hash, code_expires_at < now() as expired, code_attempts as attempts
          from core.company_claim_requests
         where company_id = ${companyId} and requester_user_id = ${requester.userId}
           and status = 'PENDING' and method = 'WORK_EMAIL'
           and email_confirmed_at is null and code_hash is not null
         limit 1`;
      const row = rows[0];
      if (row === undefined) return { status: "NOT_FOUND" };
      if (row.expired || row.attempts >= CLAIM_CODE_MAX_ATTEMPTS) {
        return { status: "EXPIRED" };
      }
      if (row.code_hash !== hashCode(code)) {
        await sql`
          update core.company_claim_requests
             set code_attempts = code_attempts + 1
           where id = ${row.id} and code_attempts < 10`;
        return { status: "WRONG_CODE" };
      }
      await sql`
        update core.company_claim_requests
           set email_confirmed_at = now(), code_hash = null, code_expires_at = null
         where id = ${row.id}`;
      return { status: "CONFIRMED" };
    },

    /**
     * P14: pending claims. With a company id, that company's (for its own
     * admins); without, those on companies nobody has claimed (for platform
     * admins). Names and the email's domain only.
     */
    pending: async (
      scope: { readonly companyId: string } | { readonly unclaimed: true },
    ): Promise<readonly PendingClaimDto[]> => {
      const rows = await sql<
        {
          id: string;
          company_id: string;
          canonical_name: string;
          requester_name: string | null;
          method: PendingClaimDto["method"];
          work_email: string | null;
          email_confirmed: boolean;
          created_at: Date;
          evidence_file_name: string | null;
          evidence_content_type: string | null;
          evidence_size_bytes: number | null;
          evidence_uploaded_at: Date | null;
        }[]
      >`
        select r.id, r.company_id, c.canonical_name, p.display_name as requester_name,
               r.method, r.work_email, r.email_confirmed_at is not null as email_confirmed,
               r.created_at, r.evidence_file_name, r.evidence_content_type,
               r.evidence_size_bytes, r.evidence_uploaded_at
          from core.company_claim_requests r
          join core.companies c on c.id = r.company_id and c.tenant_id = r.tenant_id
          left join identity.user_profiles p on p.id = r.requester_user_id
         where r.status = 'PENDING'
           and ${
             "companyId" in scope
               ? sql`r.company_id = ${scope.companyId}`
               : sql`not exists (select 1 from identity.organisation_memberships m
                                  where m.organisation_id = c.organisation_id
                                    and m.membership_status = 'active')`
           }
         order by r.created_at
         limit 200`;
      return rows.map((row) => ({
        requestId: row.id,
        companyId: row.company_id,
        companyName: row.canonical_name,
        requesterName: row.requester_name,
        method: row.method,
        workEmailDomain:
          row.work_email === null
            ? null
            : (row.work_email.split("@")[1] ?? null),
        emailConfirmed: row.email_confirmed,
        requestedAt: new Date(row.created_at).toISOString(),
        evidence:
          row.evidence_uploaded_at === null ||
          row.evidence_file_name === null ||
          row.evidence_size_bytes === null
            ? null
            : {
                fileName: row.evidence_file_name,
                contentType: row.evidence_content_type ?? "application/pdf",
                sizeBytes: row.evidence_size_bytes,
                uploadedAt: new Date(row.evidence_uploaded_at).toISOString(),
              },
      }));
    },

    /**
     * 2026-10-08: a short-lived direct upload for the claimant's registry
     * document, on their own pending REGISTRY_DOCUMENT claim only. A new
     * upload replaces the one before it (a new key; nothing is overwritten).
     */
    evidenceUpload: async (
      requester: { readonly userId: string },
      companyId: string,
      input: ClaimEvidenceUploadRequest,
    ): Promise<ClaimEvidenceUploadDto> => {
      const storage = options.evidenceStorage;
      if (storage === undefined) return { status: "UNAVAILABLE" };
      const rows = await sql<{ id: string }[]>`
        select id from core.company_claim_requests
         where company_id = ${companyId} and requester_user_id = ${requester.userId}
           and status = 'PENDING' and method = 'REGISTRY_DOCUMENT'
         limit 1`;
      const id = rows[0]?.id;
      if (id === undefined) return { status: "NOT_FOUND" };
      const key = `company-claims/${id}/${randomUUID()}`;
      const upload = await storage.authorizeUpload({
        key,
        contentType: input.contentType,
        maxBytes: CLAIM_EVIDENCE_MAX_BYTES,
      });
      await sql`
        update core.company_claim_requests
           set evidence_object_key = ${key},
               evidence_file_name = ${input.fileName},
               evidence_content_type = ${input.contentType},
               evidence_size_bytes = null,
               evidence_uploaded_at = null
         where id = ${id} and status = 'PENDING'`;
      return {
        status: "READY",
        upload: {
          method: upload.method,
          url: upload.url,
          headers: { ...upload.headers },
          expiresAt: upload.providerExpiresAt,
        },
      };
    },

    /** 2026-10-08: the upload finished; record what storage observed. */
    evidenceComplete: async (
      requester: { readonly userId: string },
      companyId: string,
    ): Promise<ClaimEvidenceCompleteDto> => {
      const storage = options.evidenceStorage;
      if (storage === undefined) return { status: "UNAVAILABLE" };
      const rows = await sql<{ id: string; key: string | null }[]>`
        select id, evidence_object_key as key from core.company_claim_requests
         where company_id = ${companyId} and requester_user_id = ${requester.userId}
           and status = 'PENDING' and method = 'REGISTRY_DOCUMENT'
         limit 1`;
      const row = rows[0];
      if (row === undefined || row.key === null) return { status: "NOT_FOUND" };
      const stat = await storage.stat(row.key);
      if (
        stat === null ||
        stat.sizeBytes < 1 ||
        stat.sizeBytes > CLAIM_EVIDENCE_MAX_BYTES
      ) {
        return { status: "NOT_UPLOADED" };
      }
      await sql`
        update core.company_claim_requests
           set evidence_size_bytes = ${stat.sizeBytes}, evidence_uploaded_at = now()
         where id = ${row.id} and evidence_object_key = ${row.key}`;
      return { status: "ATTACHED" };
    },

    /**
     * 2026-10-08: a platform admin reads a pending claim's document, on a
     * company nobody holds (the same scope as the claims queue). Null:
     * nothing to show (one answer, no oracle).
     */
    evidenceForAdmin: async (
      requestId: string,
    ): Promise<{
      readonly url: string;
      readonly fileName: string;
      readonly expiresAt: string;
    } | null> => {
      const storage = options.evidenceStorage;
      if (storage === undefined) return null;
      const rows = await sql<{ key: string; file_name: string }[]>`
        select r.evidence_object_key as key, r.evidence_file_name as file_name
          from core.company_claim_requests r
          join core.companies c on c.id = r.company_id and c.tenant_id = r.tenant_id
         where r.id = ${requestId} and r.status = 'PENDING'
           and r.evidence_uploaded_at is not null and r.evidence_object_key is not null
           and not exists (select 1 from identity.organisation_memberships m
                            where m.organisation_id = c.organisation_id
                              and m.membership_status = 'active')
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const out = await storage.authorizeDownload({
        key: row.key,
        fileName: row.file_name,
      });
      return {
        url: out.url,
        fileName: row.file_name,
        expiresAt: out.providerExpiresAt,
      };
    },

    /** P14: is this person an admin or owner of the company's organisation, now? */
    isCompanyAdmin: async (
      userId: string,
      companyId: string,
    ): Promise<boolean> => {
      const rows = await sql<{ yes: boolean }[]>`
        select exists (
          select 1
            from core.companies c
            join identity.organisation_memberships m
              on m.organisation_id = c.organisation_id and m.membership_status = 'active'
            join identity.membership_roles mr on mr.membership_id = m.id
            join permissions.roles ro on ro.id = mr.role_id and ro.status = 'active'
           where c.id = ${companyId} and m.user_id = ${userId}
             and ro.code in ('organisation_admin', 'organisation_owner')
             and mr.valid_from <= now()
             and (mr.valid_until is null or mr.valid_until > now())
        ) as yes`;
      return rows[0]?.yes === true;
    },

    /**
     * P14: record a decision, once. COMPANY_MEMBER decides only a claim on
     * its own company (the caller checked the decider is an admin there);
     * PLATFORM_ADMIN only a claim on a company nobody holds. Null: nothing
     * pending that this authority may decide (one answer, no oracle).
     * Admission into the organisation is the caller's next step.
     */
    decide: async (input: {
      readonly requestId: string;
      readonly approve: boolean;
      readonly deciderUserId: string;
      readonly via: "COMPANY_MEMBER" | "PLATFORM_ADMIN";
      readonly companyId?: string | undefined;
      readonly reason?: string | undefined;
    }): Promise<
      | (ClaimDecisionResultDto & {
          readonly requesterUserId: string;
          readonly organisationId: string;
          readonly companyId: string;
          readonly unclaimed: boolean;
        })
      | null
    > => {
      const rows = await sql<
        {
          requester_user_id: string;
          organisation_id: string;
          company_id: string;
          unclaimed: boolean;
        }[]
      >`
        with target as (
          select r.id, r.requester_user_id, c.organisation_id, c.id as company_id,
                 not exists (select 1 from identity.organisation_memberships m
                              where m.organisation_id = c.organisation_id
                                and m.membership_status = 'active') as unclaimed
            from core.company_claim_requests r
            join core.companies c on c.id = r.company_id and c.tenant_id = r.tenant_id
           where r.id = ${input.requestId} and r.status = 'PENDING'
             and (${input.companyId ?? null}::uuid is null or r.company_id = ${input.companyId ?? null}::uuid)
           for update of r
        )
        update core.company_claim_requests r
           set status = ${input.approve ? "APPROVED" : "DECLINED"}::text,
               decided_at = now(),
               decided_by_user_id = ${input.deciderUserId},
               decided_via = ${input.via},
               decision_reason = ${input.reason ?? null}
          from target t
         where r.id = t.id
           and (${input.via}::text = 'COMPANY_MEMBER' or t.unclaimed)
        returning t.requester_user_id, t.organisation_id, t.company_id, t.unclaimed`;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        status: input.approve ? "APPROVED" : "DECLINED",
        requesterUserId: row.requester_user_id,
        organisationId: row.organisation_id,
        companyId: row.company_id,
        unclaimed: row.unclaimed,
      };
    },
  };

  return {
    ...claims,
    /**
     * P14: a company admin's decision (the declared action's run): only an
     * admin or owner of that company, only a claim on it; approval admits
     * the requester as a Member. Null: nothing they may decide.
     */
    decideAsMember: async (
      actor: { readonly userId: string },
      companyId: string,
      requestId: string,
      input: {
        readonly approve: boolean;
        readonly reason?: string | undefined;
      },
    ): Promise<ClaimDecisionResultDto | null> => {
      if (!(await claims.isCompanyAdmin(actor.userId, companyId))) return null;
      const decided = await claims.decide({
        requestId,
        approve: input.approve,
        deciderUserId: actor.userId,
        via: "COMPANY_MEMBER",
        companyId,
        reason: input.reason,
      });
      if (decided === null) return null;
      if (decided.status === "APPROVED" && options.admit !== undefined) {
        await options.admit({
          organisationId: decided.organisationId,
          userId: decided.requesterUserId,
          role: "MEMBER",
          decidedByUserId: actor.userId,
          claimRequestId: requestId,
        });
      }
      return { status: decided.status };
    },
  };
}

export type CompanyClaims = ReturnType<typeof createCompanyClaims>;
