import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type {
  CorrelationId,
  VerificationClaimType,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import { verificationClaimRecordedEvent } from "../events/index.js";
import type { VerificationClaimRepository } from "./ports.js";

/**
 * Automatic verification requests (founder direction 2026-10-02): once an
 * organisation is on the network -- its onboarding is complete, it turned
 * network-visible, or it has a pitch -- Capital Q asks for its
 * ORGANISATION claim and the person's identity claim (FOUNDER_IDENTITY,
 * subject PERSON -- also used for an investor's person) on its behalf. Only acceptance stays with a person: an operator
 * decides by hand (OPERATOR_DECISION).
 *
 * What it records is only what Capital Q already knows -- the
 * organisation's name, its legal name, website and country when given, and
 * the requester's email domain with whether it matches the website. Nothing
 * is invented: a missing registration number stays missing.
 *
 * Idempotent and never re-opens a decision: a claim type that has ANY row
 * for its subject (pending, verified, revoked or expired) is left alone.
 * The claim rows, audit (as Capital Q's SYSTEM actor) and
 * `verification.claim.recorded` events are the same as a person's request.
 */

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const REQUESTED = AuditActionTypeSchema.parse("verification.claim.requested");

export type AutoRequestCandidate = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly kind: "COMPANY" | "INVESTOR";
  /** The person the request is made for: the one who onboarded, else the first member. */
  readonly requesterUserId: string;
};

export type AutoRequestOutcome = {
  readonly claims: readonly VerificationClaimType[];
  readonly submission: boolean;
};

/** "acme.com" from "https://www.Acme.com/about"; null when unreadable. */
export function websiteHost(website: string | null): string | null {
  if (website === null || website.trim() === "") return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(website) ? website : `https://${website}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether an email domain belongs to the website's domain (equal, or a
 * subdomain of it). Null when either is unknown: unknown stays unknown.
 */
export function emailDomainMatchesWebsite(
  emailDomain: string | null,
  website: string | null,
): boolean | null {
  const host = websiteHost(website);
  if (emailDomain === null || host === null) return null;
  const domain = emailDomain.toLowerCase();
  return (
    domain === host ||
    domain.endsWith(`.${host}`) ||
    host.endsWith(`.${domain}`)
  );
}

const ISO2 = /^[A-Z]{2}$/;

/** Organisations on the network with no ORGANISATION claim at all. */
export function createPostgresAutoRequestCandidateSource(
  sql: DatabaseExecutor,
) {
  return {
    candidates: async (
      limit: number,
    ): Promise<readonly AutoRequestCandidate[]> => {
      const rows = await sql<
        {
          tenant_id: string;
          organisation_id: string;
          kind: "COMPANY" | "INVESTOR";
          requester_user_id: string | null;
        }[]
      >`
        with orgs as (
          select c.tenant_id, c.organisation_id, 'COMPANY' as kind
            from core.companies c
           where c.marketplace_visibility in ('network_visible', 'public_external')
              or exists (select 1 from onboarding.sessions s
                          where s.organisation_id = c.organisation_id and s.status = 'COMPLETED')
              or exists (select 1 from media.media_assets m
                          where m.owner_organisation_id = c.organisation_id and m.deleted_at is null)
          union
          select i.tenant_id, i.organisation_id, 'INVESTOR' as kind
            from core.investor_organisations i
           where exists (select 1 from onboarding.sessions s
                          where s.organisation_id = i.organisation_id and s.status = 'COMPLETED')
        )
        select o.tenant_id, o.organisation_id, o.kind,
               coalesce(
                 (select s.user_id from onboarding.sessions s
                    join identity.organisation_memberships m
                      on m.organisation_id = s.organisation_id and m.user_id = s.user_id
                     and m.membership_status = 'active'
                   where s.organisation_id = o.organisation_id and s.status = 'COMPLETED'
                   order by s.completed_at desc limit 1),
                 (select m.user_id from identity.organisation_memberships m
                   where m.organisation_id = o.organisation_id and m.membership_status = 'active'
                   order by m.created_at limit 1)) as requester_user_id
          from orgs o
         where not exists (
                 select 1 from evidence.verification_claims v
                  where v.tenant_id = o.tenant_id and v.claim_type = 'ORGANISATION'
                    and v.subject_key = o.organisation_id::text)
         order by o.organisation_id
         limit ${limit}`;
      return rows.flatMap((row) =>
        row.requester_user_id === null
          ? []
          : [
              {
                tenantId: row.tenant_id,
                organisationId: row.organisation_id,
                kind: row.kind,
                requesterUserId: row.requester_user_id,
              },
            ],
      );
    },
  };
}

export function createAutoVerificationRequester(dependencies: {
  readonly transactions: TransactionManager;
  readonly repository: VerificationClaimRepository;
  readonly audit: MaterialActionAuditWriter;
  readonly outbox: OutboxWriter;
}) {
  const { transactions, repository, audit, outbox } = dependencies;
  return async (
    candidate: AutoRequestCandidate,
    correlationId: CorrelationId,
  ): Promise<AutoRequestOutcome> =>
    transactions.run(async (tx): Promise<AutoRequestOutcome> => {
      const tenantId = TenantIdSchema.parse(candidate.tenantId);
      const organisationId = OrganisationIdSchema.parse(
        candidate.organisationId,
      );
      await repository.lockOrganisation(tx, tenantId, organisationId);
      const subjects: { type: VerificationClaimType; subjectId: string }[] = [
        { type: "ORGANISATION", subjectId: organisationId },
        // The person's identity claim, for a founder or an investor alike
        // ("Verify you and <organisation>").
        { type: "FOUNDER_IDENTITY", subjectId: candidate.requesterUserId },
      ];
      const requested: VerificationClaimType[] = [];
      let organisationClaimId: string | null = null;
      for (const subject of subjects) {
        // Any row at all for this subject -- pending or decided -- and
        // Capital Q leaves it: never re-open a decision.
        const [existing] = await tx.sql<{ id: string }[]>`
          select id from evidence.verification_claims
           where tenant_id = ${tenantId} and claim_type = ${subject.type}
             and subject_key = ${subject.subjectId} limit 1`;
        if (existing !== undefined) continue;
        const claim = await repository.insertPending(tx, {
          tenantId,
          organisationId,
          claimType: subject.type,
          subjectId: subject.subjectId,
          requestedByUserId: candidate.requesterUserId,
        });
        if (subject.type === "ORGANISATION") organisationClaimId = claim.id;
        requested.push(subject.type);
        await audit.record(tx, {
          auditEventId: createAuditEventId(),
          tenantId,
          actorType: "SYSTEM",
          organisationId,
          actionType: REQUESTED,
          resourceType: RESOURCE,
          resourceId: claim.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            claimType: subject.type,
            revision: claim.revision,
            via: "auto",
          },
          correlationId,
        });
        await outbox.enqueue(
          tx,
          verificationClaimRecordedEvent(
            {
              tenantId,
              organisationId,
              actor: { type: "SYSTEM" },
              correlationId,
            },
            {
              claimId: claim.id,
              claimType: subject.type,
              status: "PENDING",
              revision: claim.revision,
            },
          ),
        );
      }
      if (organisationClaimId === null)
        return { claims: requested, submission: false };

      // What Capital Q already knows, and nothing more.
      const [known] = await tx.sql<
        {
          display_name: string;
          legal_name: string | null;
          website: string | null;
          jurisdiction: string | null;
          country: string | null;
          email: string | null;
        }[]
      >`
        select o.display_name,
               coalesce(o.legal_name, c.legal_name) as legal_name,
               coalesce(o.website_url, c.website_url, i.website_url) as website,
               o.jurisdiction_code as jurisdiction,
               coalesce(o.country_code, c.headquarters_country, i.hq_country) as country,
               u.email::text as email
          from identity.organisations o
          left join core.companies c on c.organisation_id = o.id
          left join core.investor_organisations i on i.organisation_id = o.id
          left join identity.user_profiles p on p.id = ${candidate.requesterUserId}
          left join auth.users u on u.id = p.auth_user_id
         where o.id = ${organisationId}`;
      const host = websiteHost(known?.website ?? null);
      const website =
        host === null
          ? null
          : /^https?:\/\//i.test(known?.website ?? "")
            ? (known?.website ?? null)
            : `https://${known?.website ?? ""}`;
      const emailDomain = known?.email?.split("@")[1]?.toLowerCase() ?? null;
      const jurisdiction =
        [known?.jurisdiction, known?.country]
          .map((value) => value?.trim().toUpperCase() ?? null)
          .find((value) => value !== null && ISO2.test(value)) ?? null;
      const inserted = await tx.sql<{ id: string }[]>`
        insert into core.kyb_submissions
          (tenant_id, organisation_id, submitted_by_user_id, source, organisation_name,
           legal_name, jurisdiction_code, website_url, contact_email_domain,
           email_domain_matches_website, claim_id, idempotency_key)
        select ${tenantId}, ${organisationId}, ${candidate.requesterUserId}, 'AUTO',
               ${known?.display_name ?? null}, ${known?.legal_name ?? null},
               ${jurisdiction}, ${website !== null && website.length <= 500 ? website : null},
               ${emailDomain !== null && /^[a-z0-9.-]{1,253}$/.test(emailDomain) ? emailDomain : null},
               ${emailDomainMatchesWebsite(emailDomain, website)}, ${organisationClaimId},
               ${`auto:${organisationId}`}
         where not exists (select 1 from core.kyb_submissions
                            where organisation_id = ${organisationId} and status = 'SUBMITTED')
        on conflict (organisation_id, idempotency_key) do nothing
        returning id`;
      await tx.sql`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        values (${tenantId}, ${candidate.requesterUserId}, 'VERIFICATION_REQUESTED',
                ${`We've asked Capital Q to verify ${known?.display_name ?? "your organisation"}`.slice(0, 200)},
                'Add a registration document to speed it up.', '/verification',
                ${`verification-auto:${organisationId}`}, 'NEEDS_YOU')
        on conflict (user_id, dedupe_key) do nothing`;
      return { claims: requested, submission: inserted.length > 0 };
    });
}

export function createAutoVerificationSweep(dependencies: {
  readonly source: ReturnType<typeof createPostgresAutoRequestCandidateSource>;
  readonly request: ReturnType<typeof createAutoVerificationRequester>;
  readonly correlation: () => CorrelationId;
  readonly limit: number;
  readonly onFailure?:
    ((organisationId: string, error: unknown) => void) | undefined;
}) {
  return async (): Promise<{
    readonly considered: number;
    readonly requested: number;
    readonly failed: number;
  }> => {
    const candidates = await dependencies.source.candidates(dependencies.limit);
    let requested = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const outcome = await dependencies.request(
          candidate,
          dependencies.correlation(),
        );
        if (outcome.claims.length > 0) requested += 1;
      } catch (error: unknown) {
        failed += 1;
        dependencies.onFailure?.(candidate.organisationId, error);
      }
    }
    return { considered: candidates.length, requested, failed };
  };
}
