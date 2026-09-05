import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  ContractValidationError,
  DisclosureScopeSchema,
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  MessageSensitivitySchema,
  TruthClassSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  ClaimAsserterTypeSchema,
  ClaimEvidenceRelationshipSchema,
  ClaimEvidenceWeightSchema,
  ClaimIdSchema,
  ClaimKeySchema,
  ClaimStatementSchema,
  ClaimTypeSchema,
  EvidenceItemIdSchema,
  EvidenceSourceIdSchema,
  EvidenceSubjectRefSchema,
  StructuredValueSchema,
  type Claim,
  type ClaimEvidenceLink,
  type ClaimId,
  type ClaimRevision,
  type EvidenceSubjectRef,
} from "../contracts/index.js";
import {
  ClaimNotFoundError,
  ClaimRevisionConflictError,
  EvidenceItemNotFoundError,
  EvidenceRuleError,
  EvidenceSourceNotFoundError,
} from "../domain/errors.js";
import { strongestSensitivity } from "../domain/sensitivity.js";
import { claimChangedEvent } from "../events/index.js";
import {
  EVIDENCE_RECORD,
  EVIDENCE_VIEW,
  ownedSubject,
  subjectScope,
} from "./authority.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Claims: assertions about a subject with independent truth, evidence and
 * lifecycle axes (ADR-001). A claim is never accepted truth and never
 * writes canonical domain state; promotion is a later workflow. Every
 * change is a new revision -- there is no update path that skips history.
 */

const RESOURCE_CLAIM = AuditResourceTypeSchema.parse("claim");
const ACTION = {
  created: AuditActionTypeSchema.parse("claim.created"),
  revised: AuditActionTypeSchema.parse("claim.revised"),
  evidenceLinked: AuditActionTypeSchema.parse("claim.evidence_linked"),
};

const Validity = z
  .object({
    validFrom: UtcTimestampSchema.nullable().default(null),
    validTo: UtcTimestampSchema.nullable().default(null),
  })
  .refine(
    (value) =>
      value.validFrom === null ||
      value.validTo === null ||
      value.validFrom <= value.validTo,
    { message: "validFrom must not follow validTo", path: ["validTo"] },
  );

const ClaimContentSchema = z.object({
  statement: ClaimStatementSchema,
  structuredValue: StructuredValueSchema.nullable().default(null),
  truthClass: TruthClassSchema,
  evidenceStatus: EvidenceStatusSchema,
  lifecycleStatus: LifecycleStatusSchema.default("CURRENT"),
});

/** VERIFIED claims need verifying evidence; Q inferences are not producible here. */
function checkAxes(input: {
  readonly truthClass: string;
  readonly evidenceStatus: string;
  readonly actor: ActorContext;
}) {
  if (
    input.truthClass === "VERIFIED" &&
    !["EXTERNALLY_VERIFIED", "PLATFORM_VERIFIED"].includes(input.evidenceStatus)
  ) {
    throw new EvidenceRuleError(
      "a VERIFIED claim carries EXTERNALLY_VERIFIED or PLATFORM_VERIFIED evidence",
    );
  }
  if (input.truthClass === "Q_INFERENCE" && input.actor.actorType !== "Q") {
    throw new EvidenceRuleError("only Q records Q inferences");
  }
}

export const CreateClaimInputSchema = z
  .object({
    subject: EvidenceSubjectRefSchema,
    claimType: ClaimTypeSchema,
    claimKey: ClaimKeySchema,
    ...ClaimContentSchema.shape,
    ...Validity.shape,
    assertedByType: ClaimAsserterTypeSchema.optional(),
    assertedById: UuidSchema.optional(),
    assertedAt: UtcTimestampSchema.optional(),
    /** Provenance of the assertion, when it came from a registered source. */
    sourceId: EvidenceSourceIdSchema.optional(),
    visibilityScope: DisclosureScopeSchema.optional(),
    sensitivityClass: MessageSensitivitySchema.optional(),
  })
  .strict();
export type CreateClaimInput = z.input<typeof CreateClaimInputSchema>;

export type CreateClaimCommand = {
  readonly actor: ActorContext;
  readonly input: CreateClaimInput;
  readonly correlationId: CorrelationId;
};

const PRIVATE_SCOPES = new Set([
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
]);

export function createCreateClaim(dependencies: EvidenceServiceDependencies) {
  const { transactions, audit, outbox, repositories } = dependencies;
  return async (command: CreateClaimCommand): Promise<Claim> => {
    const input = CreateClaimInputSchema.parse(command.input);
    Validity.parse(input);
    const { actor } = command;
    checkAxes({ ...input, actor });
    const subject = await ownedSubject(dependencies, actor, input.subject);
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_RECORD,
      resource: subjectScope(actor, subject),
    });
    const visibilityScope = input.visibilityScope ?? "organisation_private";
    if (!PRIVATE_SCOPES.has(visibilityScope)) {
      throw new ContractValidationError("A claim is private to its owner.", [
        {
          path: "visibilityScope",
          code: "invalid_value",
          message: "broader scopes are a later disclosure decision",
        },
      ]);
    }
    return transactions.run(async (tx) => {
      let sensitivityClass = input.sensitivityClass ?? "CONFIDENTIAL";
      if (input.sourceId !== undefined) {
        const source = await repositories.sources.findById(
          tx.sql,
          actor.tenantId,
          input.sourceId,
        );
        if (
          source === null ||
          source.subjectType !== subject.subjectType ||
          source.subjectId !== subject.subjectId
        ) {
          throw new EvidenceSourceNotFoundError();
        }
        // Derived information inherits the strongest source sensitivity.
        sensitivityClass = strongestSensitivity(
          sensitivityClass,
          source.sensitivityClass,
        );
      }
      const claim = await repositories.claims.insert(tx, {
        tenantId: actor.tenantId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        claimType: input.claimType,
        claimKey: input.claimKey,
        statement: input.statement,
        structuredValue: input.structuredValue,
        truthClass: input.truthClass,
        evidenceStatus: input.evidenceStatus,
        lifecycleStatus: input.lifecycleStatus,
        validFrom: input.validFrom,
        validTo: input.validTo,
        assertedByType: input.assertedByType ?? "USER",
        assertedById: input.assertedById ?? actor.userId,
        assertedAt:
          input.assertedAt ??
          UtcTimestampSchema.parse(new Date().toISOString()),
        visibilityScope,
        sensitivityClass,
        changedByType: actor.actorType === "HUMAN" ? "USER" : "SYSTEM",
        changedById: actor.userId,
        sourceId: input.sourceId ?? null,
      });
      if (actor.actorType === "HUMAN") {
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.created,
          resourceType: RESOURCE_CLAIM,
          resourceId: claim.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            subjectType: claim.subjectType,
            subjectId: claim.subjectId,
            claimKey: claim.claimKey,
            truthClass: claim.truthClass,
            evidenceStatus: claim.evidenceStatus,
          },
          correlationId: command.correlationId,
        });
      }
      await outbox.enqueue(
        tx,
        claimChangedEvent(
          {
            actor,
            organisationId: subject.ownerOrganisationId,
            correlationId: command.correlationId,
          },
          {
            claimId: claim.id,
            subjectType: claim.subjectType,
            subjectId: claim.subjectId,
            changeKind: "CREATED",
            revisionNumber: claim.currentRevisionNumber,
          },
        ),
      );
      return claim;
    });
  };
}

export const ReviseClaimInputSchema = z
  .object({
    claimId: ClaimIdSchema,
    expectedRevisionNumber: z.number().int().min(1),
    ...ClaimContentSchema.partial().shape,
    validFrom: UtcTimestampSchema.nullable().optional(),
    validTo: UtcTimestampSchema.nullable().optional(),
    changeReason: z.string().trim().min(1).max(500),
    sourceId: EvidenceSourceIdSchema.optional(),
  })
  .strict();
export type ReviseClaimInput = z.input<typeof ReviseClaimInputSchema>;

export type ReviseClaimCommand = {
  readonly actor: ActorContext;
  readonly input: ReviseClaimInput;
  readonly correlationId: CorrelationId;
};

/**
 * A revision: the next revision row plus the current projection, in one
 * transaction, guarded by the revision number the caller last read.
 * Lifecycle and evidence-state changes go through here as well; there is
 * no separate "set status" path that would bypass history.
 */
export function createReviseClaim(dependencies: EvidenceServiceDependencies) {
  const { transactions, audit, outbox, repositories } = dependencies;
  return async (command: ReviseClaimCommand): Promise<Claim> => {
    const input = ReviseClaimInputSchema.parse(command.input);
    const { actor } = command;
    const { claim: visible, subject } = await visibleClaim(
      dependencies,
      actor,
      input.claimId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_RECORD,
      resource: subjectScope(actor, subject),
    });
    return transactions.run(async (tx) => {
      const claim = await repositories.claims.lockById(
        tx,
        actor.tenantId,
        visible.id,
      );
      if (claim === null) {
        throw new ClaimNotFoundError();
      }
      if (claim.currentRevisionNumber !== input.expectedRevisionNumber) {
        throw new ClaimRevisionConflictError();
      }
      const next = {
        statement: input.statement ?? claim.statement,
        structuredValue:
          input.structuredValue === undefined
            ? claim.structuredValue
            : input.structuredValue,
        truthClass: input.truthClass ?? claim.truthClass,
        evidenceStatus: input.evidenceStatus ?? claim.evidenceStatus,
        lifecycleStatus: input.lifecycleStatus ?? claim.lifecycleStatus,
        validFrom:
          input.validFrom === undefined ? claim.validFrom : input.validFrom,
        validTo: input.validTo === undefined ? claim.validTo : input.validTo,
      };
      Validity.parse(next);
      checkAxes({ ...next, actor });
      if (input.sourceId !== undefined) {
        const source = await repositories.sources.findById(
          tx.sql,
          actor.tenantId,
          input.sourceId,
        );
        if (
          source === null ||
          source.subjectType !== claim.subjectType ||
          source.subjectId !== claim.subjectId
        ) {
          throw new EvidenceSourceNotFoundError();
        }
      }
      const revised = await repositories.claims.revise(tx, {
        tenantId: actor.tenantId,
        claimId: claim.id,
        expectedRevisionNumber: claim.currentRevisionNumber,
        ...next,
        changeReason: input.changeReason,
        changedByType: actor.actorType === "HUMAN" ? "USER" : "SYSTEM",
        changedById: actor.userId,
        sourceId: input.sourceId ?? null,
      });
      if (revised === null) {
        throw new ClaimRevisionConflictError();
      }
      if (actor.actorType === "HUMAN") {
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.revised,
          resourceType: RESOURCE_CLAIM,
          resourceId: revised.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            revisionNumber: revised.currentRevisionNumber,
            truthClass: revised.truthClass,
            evidenceStatus: revised.evidenceStatus,
            lifecycleStatus: revised.lifecycleStatus,
          },
          correlationId: command.correlationId,
        });
      }
      await outbox.enqueue(
        tx,
        claimChangedEvent(
          {
            actor,
            organisationId: subject.ownerOrganisationId,
            correlationId: command.correlationId,
          },
          {
            claimId: revised.id,
            subjectType: revised.subjectType,
            subjectId: revised.subjectId,
            changeKind: "REVISED",
            revisionNumber: revised.currentRevisionNumber,
          },
        ),
      );
      return revised;
    });
  };
}

export const LinkClaimEvidenceInputSchema = z
  .object({
    claimId: ClaimIdSchema,
    evidenceItemId: EvidenceItemIdSchema,
    relationship: ClaimEvidenceRelationshipSchema,
    /** Extension point; unset in V1. */
    weight: ClaimEvidenceWeightSchema.optional(),
  })
  .strict();
export type LinkClaimEvidenceInput = z.infer<
  typeof LinkClaimEvidenceInputSchema
>;

export type LinkClaimEvidenceCommand = {
  readonly actor: ActorContext;
  readonly input: LinkClaimEvidenceInput;
  readonly correlationId: CorrelationId;
};

/**
 * Links evidence to a claim. SUPPORTS and CONTRADICTS coexist; nothing is
 * removed, and no relationship changes the claim's truth axes by itself.
 * Idempotent on (claim, evidence item, relationship).
 */
export function createLinkClaimEvidence(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;
  return async (
    command: LinkClaimEvidenceCommand,
  ): Promise<ClaimEvidenceLink> => {
    const input = LinkClaimEvidenceInputSchema.parse(command.input);
    const { actor } = command;
    const { claim, subject } = await visibleClaim(
      dependencies,
      actor,
      input.claimId,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_RECORD,
      resource: subjectScope(actor, subject),
    });
    const item = await repositories.evidenceItems.findById(
      dependencies.sql,
      actor.tenantId,
      input.evidenceItemId,
    );
    if (
      item === null ||
      item.subjectType !== claim.subjectType ||
      item.subjectId !== claim.subjectId
    ) {
      throw new EvidenceItemNotFoundError();
    }
    return transactions.run(async (tx) => {
      const { link, created } = await repositories.claimEvidence.link(tx, {
        tenantId: actor.tenantId,
        claimId: claim.id,
        evidenceItemId: item.id,
        relationship: input.relationship,
        weight: input.weight === undefined ? null : String(input.weight),
        createdByUserId: actor.actorType === "HUMAN" ? actor.userId : null,
      });
      if (created) {
        if (actor.actorType === "HUMAN") {
          await audit.record(tx, {
            ...auditActorFromContext(actor),
            auditEventId: createAuditEventId(),
            actionType: ACTION.evidenceLinked,
            resourceType: RESOURCE_CLAIM,
            resourceId: claim.id,
            occurredAt: occurredNow(),
            outcome: "SUCCEEDED",
            metadata: {
              evidenceItemId: item.id,
              relationship: link.relationship,
            },
            correlationId: command.correlationId,
          });
        }
        await outbox.enqueue(
          tx,
          claimChangedEvent(
            {
              actor,
              organisationId: subject.ownerOrganisationId,
              correlationId: command.correlationId,
            },
            {
              claimId: claim.id,
              subjectType: claim.subjectType,
              subjectId: claim.subjectId,
              changeKind: "EVIDENCE_LINKED",
              revisionNumber: claim.currentRevisionNumber,
              relationship: link.relationship,
              evidenceItemId: item.id,
            },
          ),
        );
      }
      return link;
    });
  };
}

export type GetClaimQuery = {
  readonly actor: ActorContext;
  readonly claimId: ClaimId;
};

async function visibleClaim(
  dependencies: EvidenceServiceDependencies,
  actor: ActorContext,
  claimId: ClaimId,
) {
  const claim = await dependencies.repositories.claims.findById(
    dependencies.sql,
    actor.tenantId,
    claimId,
  );
  if (claim === null) {
    throw new ClaimNotFoundError();
  }
  const subject = await ownedSubject(dependencies, actor, {
    subjectType: claim.subjectType,
    subjectId: claim.subjectId,
  }).catch(() => {
    throw new ClaimNotFoundError();
  });
  return { claim, subject };
}

export function createGetClaim(dependencies: EvidenceServiceDependencies) {
  return async (
    query: GetClaimQuery,
  ): Promise<{
    readonly claim: Claim;
    readonly revisions: readonly ClaimRevision[];
    readonly evidence: readonly ClaimEvidenceLink[];
  }> => {
    const { actor } = query;
    const { claim, subject } = await visibleClaim(
      dependencies,
      actor,
      ClaimIdSchema.parse(query.claimId),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_VIEW,
      resource: subjectScope(actor, subject),
    });
    const [revisions, evidence] = await Promise.all([
      dependencies.repositories.claims.listRevisions(
        dependencies.sql,
        actor.tenantId,
        claim.id,
      ),
      dependencies.repositories.claimEvidence.listByClaim(
        dependencies.sql,
        actor.tenantId,
        claim.id,
      ),
    ]);
    return { claim, revisions, evidence };
  };
}

export type ListClaimsQuery = {
  readonly actor: ActorContext;
  readonly subject: EvidenceSubjectRef;
  readonly claimKey?: string | undefined;
};

export function createListClaims(dependencies: EvidenceServiceDependencies) {
  return async (query: ListClaimsQuery): Promise<readonly Claim[]> => {
    const { actor } = query;
    const subject = await ownedSubject(
      dependencies,
      actor,
      EvidenceSubjectRefSchema.parse(query.subject),
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_VIEW,
      resource: subjectScope(actor, subject),
    });
    return dependencies.repositories.claims.listBySubject(
      dependencies.sql,
      actor.tenantId,
      { subjectType: subject.subjectType, subjectId: subject.subjectId },
      {
        claimKey:
          query.claimKey === undefined
            ? undefined
            : ClaimKeySchema.parse(query.claimKey),
      },
    );
  };
}
