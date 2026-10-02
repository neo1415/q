import { createHash } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  OrganisationIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import { standingOf } from "../domain/claims.js";
import { verificationClaimRecordedEvent } from "../events/index.js";
import { VERIFICATION_REQUEST } from "./company-verification.js";
import type { VerificationClaimRepository } from "./ports.js";

/**
 * Manual KYB for V1 (spec docs/specs/2026-10/admin-escalation-kyb.md;
 * PADL progressive verification, Spec 8.1, doc 15 §81). An organisation
 * member with `verification.request` submits the business details and,
 * optionally, a document already uploaded to the organisation's evidence
 * storage. This records the ORGANISATION verification claim as PENDING --
 * the same row, audit and event as every request -- and a submission row
 * beside it. A Capital Q operator decides the claim (OPERATOR_DECISION);
 * `closeForClaim` then closes the submission with the same outcome and
 * tells the person who submitted it.
 *
 * Verification is not endorsement, and stays its own axis (ADR-001).
 */

/**
 * A future KYB vendor plugs in here. V1 has no vendor: Capital Q's
 * operators review by hand. A vendor adapter would submit the same details
 * and report back a result and a provider reference -- never raw identity
 * documents into Capital Q's records (doc 15 §81).
 */
export type KybProvider = {
  readonly name: string;
  readonly submit: (input: {
    readonly legalName: string;
    readonly registrationNumber: string;
    readonly jurisdictionCode: string;
  }) => Promise<{
    readonly providerReference: string;
    readonly result: "MATCH" | "NO_MATCH" | "PENDING";
  }>;
};

export type KybInput = {
  readonly legalName: string;
  readonly registrationNumber: string;
  readonly jurisdictionCode: string;
  readonly registeredAddress: string | null;
  readonly websiteUrl: string | null;
  readonly documentId: string | null;
};

/** The person's own identity details (ADMIN-4: "Verify you and <org>"). */
export type PersonIdentityInput = {
  readonly nameOnId: string;
  readonly role: string;
  /** An ID document already in the organisation's evidence storage. */
  readonly documentId: string | null;
};

type Standing =
  "NOT_REQUESTED" | "PENDING" | "VERIFIED" | "EXPIRED" | "REVOKED";

export type KybView = {
  readonly submission: {
    readonly submissionId: string;
    /** AUTO: Capital Q asked from what it knew; PERSON: they sent details. */
    readonly source: "PERSON" | "AUTO";
    readonly legalName: string | null;
    readonly registrationNumber: string | null;
    readonly jurisdictionCode: string | null;
    readonly registeredAddress: string | null;
    readonly websiteUrl: string | null;
    readonly hasDocument: boolean;
    readonly status: "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    readonly decisionReason: string | null;
    readonly submittedAt: string;
    readonly decidedAt: string | null;
  } | null;
  /** The organisation's ORGANISATION standing, from the claim itself. */
  readonly standing: Standing;
  /** The organisation's display name, for "Verify you and <name>". */
  readonly organisationName: string | null;
  readonly organisationKind: "COMPANY" | "INVESTOR" | null;
  /** The signed-in person's own identity claim and what they sent for it. */
  readonly person: {
    readonly standing: Standing;
    /** An operator's reason when the person's identity was declined. */
    readonly declineReason: string | null;
    readonly submission: {
      readonly submissionId: string;
      readonly nameOnId: string;
      readonly role: string;
      readonly hasDocument: boolean;
      readonly status: "SUBMITTED" | "APPROVED" | "REJECTED";
      readonly decisionReason: string | null;
      readonly submittedAt: string;
    } | null;
  };
};

export type VerificationPart = "ORGANISATION" | "PERSON";

export type SubmitKybOutcome =
  | { readonly kind: "SUBMITTED" | "REPLAYED"; readonly view: KybView }
  | { readonly kind: "ALREADY_OPEN"; readonly part: VerificationPart }
  | { readonly kind: "ALREADY_VERIFIED"; readonly part: VerificationPart }
  | { readonly kind: "DOCUMENT_NOT_FOUND"; readonly part: VerificationPart }
  | { readonly kind: "NO_ORGANISATION" };

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const REQUESTED = AuditActionTypeSchema.parse("verification.claim.requested");
const KYB_SUBMITTED = AuditActionTypeSchema.parse("verification.kyb.submitted");
const IDENTITY_SUBMITTED = AuditActionTypeSchema.parse(
  "verification.identity.submitted",
);

type SubmissionRow = {
  id: string;
  source: "PERSON" | "AUTO";
  legal_name: string | null;
  registration_number: string | null;
  jurisdiction_code: string | null;
  registered_address: string | null;
  website_url: string | null;
  document_id: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  decision_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
};

type IdentityRow = {
  id: string;
  name_on_id: string;
  role: string;
  document_id: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  decision_reason: string | null;
  created_at: Date;
};

function submissionOf(row: SubmissionRow): NonNullable<KybView["submission"]> {
  return {
    submissionId: row.id,
    source: row.source,
    legalName: row.legal_name,
    registrationNumber: row.registration_number,
    jurisdictionCode: row.jurisdiction_code,
    registeredAddress: row.registered_address,
    websiteUrl: row.website_url,
    hasDocument: row.document_id !== null,
    status: row.status,
    decisionReason: row.decision_reason,
    submittedAt: new Date(row.created_at).toISOString(),
    decidedAt:
      row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
  };
}

function scope(actor: ActorContext, organisationId: string) {
  return {
    kind: "ORGANISATION" as const,
    tenantId: actor.tenantId,
    organisationId: OrganisationIdSchema.parse(organisationId),
  };
}

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createKybService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly repository: VerificationClaimRepository;
  readonly audit: MaterialActionAuditWriter;
  readonly outbox: OutboxWriter;
  readonly now?: (() => Date) | undefined;
}) {
  const { sql, transactions, authorization, repository, audit, outbox } =
    dependencies;
  const now = dependencies.now ?? (() => new Date());

  async function viewOf(
    executor: DatabaseExecutor,
    tenantId: string,
    organisationId: string,
    userId: string,
  ): Promise<KybView> {
    const [row] = await executor<SubmissionRow[]>`
      select id, source, legal_name, registration_number, jurisdiction_code,
             registered_address, website_url, document_id, status,
             decision_reason, created_at, decided_at
        from core.kyb_submissions
       where tenant_id = ${tenantId} and organisation_id = ${organisationId}
       order by created_at desc limit 1`;
    const [identity] = await executor<IdentityRow[]>`
      select id, name_on_id, role, document_id, status, decision_reason, created_at
        from core.identity_submissions
       where tenant_id = ${tenantId} and organisation_id = ${organisationId}
         and user_id = ${userId}
       order by created_at desc limit 1`;
    const [organisation] = await executor<
      { display_name: string; kind: "COMPANY" | "INVESTOR" | null }[]
    >`
      select o.display_name,
             case when exists (select 1 from core.companies c where c.organisation_id = o.id)
                  then 'COMPANY'
                  when exists (select 1 from core.investor_organisations i where i.organisation_id = o.id)
                  then 'INVESTOR' end as kind
        from identity.organisations o where o.id = ${organisationId}`;
    const claims = await repository.currentForOrganisation(
      executor,
      tenantId,
      organisationId,
    );
    const claim =
      claims.find(
        (c) => c.claimType === "ORGANISATION" && c.subjectId === organisationId,
      ) ?? null;
    const personClaim =
      claims.find(
        (c) => c.claimType === "FOUNDER_IDENTITY" && c.subjectId === userId,
      ) ?? null;
    const personStanding = standingOf(personClaim, now());
    return {
      submission: row === undefined ? null : submissionOf(row),
      standing: standingOf(claim, now()),
      organisationName: organisation?.display_name ?? null,
      organisationKind: organisation?.kind ?? null,
      person: {
        standing: personStanding,
        declineReason:
          personStanding === "REVOKED"
            ? (personClaim?.revocationReason ?? null)
            : null,
        submission:
          identity === undefined
            ? null
            : {
                submissionId: identity.id,
                nameOnId: identity.name_on_id,
                role: identity.role,
                hasDocument: identity.document_id !== null,
                status: identity.status,
                decisionReason: identity.decision_reason,
                submittedAt: new Date(identity.created_at).toISOString(),
              },
      },
    };
  }

  async function requireMember(actor: ActorContext): Promise<string | null> {
    if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
      return null;
    }
    await authorization.requireCapability({
      actor,
      capability: VERIFICATION_REQUEST,
      resource: scope(actor, actor.organisationId),
    });
    return actor.organisationId;
  }

  return {
    current: async (actor: ActorContext): Promise<KybView | null> => {
      const organisationId = await requireMember(actor);
      if (organisationId === null || actor.actorType !== "HUMAN") return null;
      return viewOf(sql, actor.tenantId, organisationId, actor.userId);
    },

    /**
     * One flow: the organisation's details, the person's identity details,
     * or both, in ONE transaction -- both claims are PENDING together or
     * neither is. A part already verified or already with Capital Q is
     * refused rather than re-sent; a decided claim is never re-opened (a
     * fresh request after a decline is a new revision, as with every
     * request).
     */
    submit: async (command: {
      readonly actor: ActorContext;
      readonly organisation: KybInput | null;
      readonly person: PersonIdentityInput | null;
      readonly idempotencyKey: string;
      readonly correlationId: CorrelationId;
    }): Promise<SubmitKybOutcome> => {
      const { actor } = command;
      const organisationId = await requireMember(actor);
      if (organisationId === null || actor.actorType !== "HUMAN") {
        return { kind: "NO_ORGANISATION" };
      }
      const tenantId = actor.tenantId;
      const userId = actor.userId;
      return transactions.run(async (tx): Promise<SubmitKybOutcome> => {
        await repository.lockOrganisation(tx, tenantId, organisationId);
        const [replay] = await tx.sql<{ id: string }[]>`
          select id from core.kyb_submissions
           where organisation_id = ${organisationId}
             and idempotency_key = ${command.idempotencyKey}
          union all
          select id from core.identity_submissions
           where user_id = ${userId} and idempotency_key = ${command.idempotencyKey}
          limit 1`;
        if (replay !== undefined) {
          return {
            kind: "REPLAYED",
            view: await viewOf(tx.sql, tenantId, organisationId, userId),
          };
        }
        const claims = await repository.currentForOrganisation(
          tx.sql,
          tenantId,
          organisationId,
        );
        const currentOf = (claimType: string, subjectId: string) =>
          claims.find(
            (c) => c.claimType === claimType && c.subjectId === subjectId,
          ) ?? null;
        const documentIsOurs = async (documentId: string) => {
          const [document] = await tx.sql<{ id: string }[]>`
            select id from evidence.documents
             where id = ${documentId} and tenant_id = ${tenantId}
               and owner_organisation_id = ${organisationId}
               and status = 'ACTIVE' and current_version_id is not null`;
          return document !== undefined;
        };

        // Check every part before writing anything.
        const [open] = await tx.sql<{ id: string; source: string }[]>`
          select id, source from core.kyb_submissions
           where organisation_id = ${organisationId} and status = 'SUBMITTED'`;
        if (command.organisation !== null) {
          if (open !== undefined && open.source !== "AUTO") {
            return { kind: "ALREADY_OPEN", part: "ORGANISATION" };
          }
          if (
            standingOf(currentOf("ORGANISATION", organisationId), now()) ===
            "VERIFIED"
          ) {
            return { kind: "ALREADY_VERIFIED", part: "ORGANISATION" };
          }
          if (
            command.organisation.documentId !== null &&
            !(await documentIsOurs(command.organisation.documentId))
          ) {
            return { kind: "DOCUMENT_NOT_FOUND", part: "ORGANISATION" };
          }
        }
        if (command.person !== null) {
          const [openIdentity] = await tx.sql<{ id: string }[]>`
            select id from core.identity_submissions
             where organisation_id = ${organisationId} and user_id = ${userId}
               and status = 'SUBMITTED'`;
          if (openIdentity !== undefined) {
            return { kind: "ALREADY_OPEN", part: "PERSON" };
          }
          if (
            standingOf(currentOf("FOUNDER_IDENTITY", userId), now()) ===
            "VERIFIED"
          ) {
            return { kind: "ALREADY_VERIFIED", part: "PERSON" };
          }
          if (
            command.person.documentId !== null &&
            !(await documentIsOurs(command.person.documentId))
          ) {
            return { kind: "DOCUMENT_NOT_FOUND", part: "PERSON" };
          }
        }

        /** The PENDING claim to attach to: the open one, else a new request. */
        const pendingClaim = async (
          claimType: "ORGANISATION" | "FOUNDER_IDENTITY",
          subjectId: string,
          via: string,
        ): Promise<string> => {
          const current = currentOf(claimType, subjectId);
          if (current !== null && standingOf(current, now()) === "PENDING") {
            return current.id;
          }
          const claim = await repository.insertPending(tx, {
            tenantId,
            organisationId,
            claimType,
            subjectId,
            requestedByUserId: userId,
          });
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: REQUESTED,
            resourceType: RESOURCE,
            resourceId: claim.id,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: { claimType, revision: claim.revision, via },
            correlationId: command.correlationId,
          });
          await outbox.enqueue(
            tx,
            verificationClaimRecordedEvent(
              {
                tenantId,
                organisationId: OrganisationIdSchema.parse(organisationId),
                actor: { type: "HUMAN", id: userId },
                correlationId: command.correlationId,
              },
              {
                claimId: claim.id,
                claimType,
                status: "PENDING",
                revision: claim.revision,
              },
            ),
          );
          return claim.id;
        };

        if (command.organisation !== null) {
          const input = command.organisation;
          const claimId = await pendingClaim(
            "ORGANISATION",
            organisationId,
            "kyb",
          );
          // Their own details replace what Capital Q asked with on its own.
          if (open !== undefined) {
            await tx.sql`
              update core.kyb_submissions
                 set status = 'SUPERSEDED',
                     decision_reason = 'Replaced by the organisation''s own details.',
                     decided_at = clock_timestamp()
               where id = ${open.id}`;
          }
          const [row] = await tx.sql<{ id: string }[]>`
            insert into core.kyb_submissions
              (tenant_id, organisation_id, submitted_by_user_id, legal_name,
               registration_number, jurisdiction_code, registered_address,
               website_url, document_id, claim_id, idempotency_key)
            values (${tenantId}, ${organisationId}, ${userId},
                    ${input.legalName.trim()}, ${input.registrationNumber.trim()},
                    ${input.jurisdictionCode}, ${input.registeredAddress},
                    ${input.websiteUrl}, ${input.documentId}, ${claimId},
                    ${command.idempotencyKey})
            returning id`;
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: KYB_SUBMITTED,
            resourceType: AuditResourceTypeSchema.parse("kyb_submission"),
            resourceId: row?.id ?? claimId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              claimId,
              hasDocument: input.documentId !== null,
              requestKeyHash: keyHash(command.idempotencyKey),
            },
            correlationId: command.correlationId,
          });
        }
        if (command.person !== null) {
          const input = command.person;
          const claimId = await pendingClaim(
            "FOUNDER_IDENTITY",
            userId,
            "identity",
          );
          const [row] = await tx.sql<{ id: string }[]>`
            insert into core.identity_submissions
              (tenant_id, organisation_id, user_id, name_on_id, role,
               document_id, claim_id, idempotency_key)
            values (${tenantId}, ${organisationId}, ${userId},
                    ${input.nameOnId.trim()}, ${input.role.trim()},
                    ${input.documentId}, ${claimId}, ${command.idempotencyKey})
            returning id`;
          // The audit never carries the person's name or document.
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: IDENTITY_SUBMITTED,
            resourceType: AuditResourceTypeSchema.parse("identity_submission"),
            resourceId: row?.id ?? claimId,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              claimId,
              hasDocument: input.documentId !== null,
              requestKeyHash: keyHash(command.idempotencyKey),
            },
            correlationId: command.correlationId,
          });
        }
        return {
          kind: "SUBMITTED",
          view: await viewOf(tx.sql, tenantId, organisationId, userId),
        };
      });
    },
  };
}

export type KybService = ReturnType<typeof createKybService>;

/**
 * After an operator decided a claim: the open submission that requested it
 * -- the organisation's details or a person's identity details -- closes
 * with the same outcome, and the person who sent it is told. Nothing open
 * for the claim: nothing happens.
 */
export async function closeKybForClaim(
  transactions: TransactionManager,
  input: {
    readonly claimId: string;
    readonly approved: boolean;
    readonly reason: string;
    readonly decidedByUserId: string;
  },
): Promise<boolean> {
  return transactions.run(async (tx) => {
    const [row] = await tx.sql<
      {
        id: string;
        tenant_id: string;
        submitted_by_user_id: string;
        part: "ORGANISATION" | "PERSON";
      }[]
    >`
      select id, tenant_id, submitted_by_user_id, 'ORGANISATION' as part
        from core.kyb_submissions
       where claim_id = ${input.claimId} and status = 'SUBMITTED'
      union all
      select id, tenant_id, user_id, 'PERSON'
        from core.identity_submissions
       where claim_id = ${input.claimId} and status = 'SUBMITTED'
       limit 1`;
    if (
      row === undefined ||
      row.submitted_by_user_id === input.decidedByUserId
    ) {
      return false;
    }
    const status = input.approved ? "APPROVED" : "REJECTED";
    const reason = input.reason.slice(0, 1000);
    if (row.part === "ORGANISATION") {
      await tx.sql`
        update core.kyb_submissions
           set status = ${status}, decision_reason = ${reason},
               decided_by_user_id = ${input.decidedByUserId},
               decided_at = clock_timestamp()
         where id = ${row.id} and status = 'SUBMITTED'`;
    } else {
      await tx.sql`
        update core.identity_submissions
           set status = ${status}, decision_reason = ${reason},
               decided_by_user_id = ${input.decidedByUserId},
               decided_at = clock_timestamp()
         where id = ${row.id} and status = 'SUBMITTED'`;
    }
    const subject = row.part === "ORGANISATION" ? "Your organisation" : "You";
    await tx.sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
      values (${row.tenant_id}, ${row.submitted_by_user_id}, 'VERIFICATION_DECIDED',
              ${input.approved ? `${subject} ${row.part === "ORGANISATION" ? "is" : "are"} verified` : `${subject} couldn't be verified yet`},
              ${input.approved ? "Capital Q checked the details you sent. Verification is not an endorsement." : reason},
              '/verification', ${`${row.part === "ORGANISATION" ? "kyb" : "identity"}:${row.id}:decided`}, 'NEEDS_YOU')
      on conflict (user_id, dedupe_key) do nothing`;
    return true;
  });
}
