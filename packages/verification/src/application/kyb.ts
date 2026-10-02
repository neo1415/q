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
  readonly standing:
    "NOT_REQUESTED" | "PENDING" | "VERIFIED" | "EXPIRED" | "REVOKED";
};

export type SubmitKybOutcome =
  | { readonly kind: "SUBMITTED" | "REPLAYED"; readonly view: KybView }
  | { readonly kind: "ALREADY_OPEN" }
  | { readonly kind: "ALREADY_VERIFIED" }
  | { readonly kind: "DOCUMENT_NOT_FOUND" }
  | { readonly kind: "NO_ORGANISATION" };

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const REQUESTED = AuditActionTypeSchema.parse("verification.claim.requested");
const KYB_SUBMITTED = AuditActionTypeSchema.parse("verification.kyb.submitted");

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
  ): Promise<KybView> {
    const [row] = await executor<SubmissionRow[]>`
      select id, source, legal_name, registration_number, jurisdiction_code,
             registered_address, website_url, document_id, status,
             decision_reason, created_at, decided_at
        from core.kyb_submissions
       where tenant_id = ${tenantId} and organisation_id = ${organisationId}
       order by created_at desc limit 1`;
    const claims = await repository.currentForOrganisation(
      executor,
      tenantId,
      organisationId,
    );
    const claim =
      claims.find(
        (c) => c.claimType === "ORGANISATION" && c.subjectId === organisationId,
      ) ?? null;
    return {
      submission: row === undefined ? null : submissionOf(row),
      standing: standingOf(claim, now()),
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
      if (organisationId === null) return null;
      return viewOf(sql, actor.tenantId, organisationId);
    },

    submit: async (command: {
      readonly actor: ActorContext;
      readonly input: KybInput;
      readonly idempotencyKey: string;
      readonly correlationId: CorrelationId;
    }): Promise<SubmitKybOutcome> => {
      const { actor, input } = command;
      const organisationId = await requireMember(actor);
      if (organisationId === null) return { kind: "NO_ORGANISATION" };
      const tenantId = actor.tenantId;
      return transactions.run(async (tx): Promise<SubmitKybOutcome> => {
        await repository.lockOrganisation(tx, tenantId, organisationId);
        const [replay] = await tx.sql<{ id: string }[]>`
          select id from core.kyb_submissions
           where organisation_id = ${organisationId}
             and idempotency_key = ${command.idempotencyKey}`;
        if (replay !== undefined) {
          return {
            kind: "REPLAYED",
            view: await viewOf(tx.sql, tenantId, organisationId),
          };
        }
        const [open] = await tx.sql<{ id: string; source: string }[]>`
          select id, source from core.kyb_submissions
           where organisation_id = ${organisationId} and status = 'SUBMITTED'`;
        if (open !== undefined && open.source !== "AUTO") {
          return { kind: "ALREADY_OPEN" };
        }
        if (input.documentId !== null) {
          const [document] = await tx.sql<{ id: string }[]>`
            select id from evidence.documents
             where id = ${input.documentId} and tenant_id = ${tenantId}
               and owner_organisation_id = ${organisationId}
               and status = 'ACTIVE' and current_version_id is not null`;
          if (document === undefined) return { kind: "DOCUMENT_NOT_FOUND" };
        }
        const claims = await repository.currentForOrganisation(
          tx.sql,
          tenantId,
          organisationId,
        );
        const current =
          claims.find(
            (c) =>
              c.claimType === "ORGANISATION" && c.subjectId === organisationId,
          ) ?? null;
        const standing = standingOf(current, now());
        if (standing === "VERIFIED") return { kind: "ALREADY_VERIFIED" };
        let claimId: string;
        if (standing === "PENDING" && current !== null) {
          claimId = current.id;
        } else {
          const claim = await repository.insertPending(tx, {
            tenantId,
            organisationId,
            claimType: "ORGANISATION",
            subjectId: organisationId,
            requestedByUserId: actor.userId,
          });
          claimId = claim.id;
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: REQUESTED,
            resourceType: RESOURCE,
            resourceId: claim.id,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              claimType: "ORGANISATION",
              revision: claim.revision,
              via: "kyb",
            },
            correlationId: command.correlationId,
          });
          await outbox.enqueue(
            tx,
            verificationClaimRecordedEvent(
              {
                tenantId,
                organisationId: OrganisationIdSchema.parse(organisationId),
                actor: { type: "HUMAN", id: actor.userId },
                correlationId: command.correlationId,
              },
              {
                claimId: claim.id,
                claimType: "ORGANISATION",
                status: "PENDING",
                revision: claim.revision,
              },
            ),
          );
        }
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
          values (${tenantId}, ${organisationId}, ${actor.userId},
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
            requestKeyHash: createHash("sha256")
              .update(command.idempotencyKey)
              .digest("hex")
              .slice(0, 16),
          },
          correlationId: command.correlationId,
        });
        return {
          kind: "SUBMITTED",
          view: await viewOf(tx.sql, tenantId, organisationId),
        };
      });
    },
  };
}

export type KybService = ReturnType<typeof createKybService>;

/**
 * After an operator decided a claim: the open submission that requested it
 * closes with the same outcome, and the person who submitted it is told.
 * Nothing open for the claim: nothing happens.
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
      { id: string; tenant_id: string; submitted_by_user_id: string }[]
    >`
      select id, tenant_id, submitted_by_user_id from core.kyb_submissions
       where claim_id = ${input.claimId} and status = 'SUBMITTED'
       for update`;
    if (
      row === undefined ||
      row.submitted_by_user_id === input.decidedByUserId
    ) {
      return false;
    }
    await tx.sql`
      update core.kyb_submissions
         set status = ${input.approved ? "APPROVED" : "REJECTED"},
             decision_reason = ${input.reason.slice(0, 1000)},
             decided_by_user_id = ${input.decidedByUserId},
             decided_at = clock_timestamp()
       where id = ${row.id}`;
    await tx.sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
      values (${row.tenant_id}, ${row.submitted_by_user_id}, 'VERIFICATION_DECIDED',
              ${input.approved ? "Your organisation is verified" : "Your organisation couldn't be verified yet"},
              ${input.approved ? "Capital Q checked your business details. Verification is not an endorsement." : input.reason.slice(0, 1000)},
              '/verification', ${`kyb:${row.id}:decided`}, 'NEEDS_YOU')
      on conflict (user_id, dedupe_key) do nothing`;
    return true;
  });
}
