import { z } from "zod";

import {
  ContractValidationError,
  DisclosureScopeSchema,
  MessageSensitivitySchema,
  ReliabilityClassSchema,
  UtcTimestampSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  EvidenceSourceTypeSchema,
  EvidenceSubjectRefSchema,
  SourceMetadataSchema,
  SourceTitleSchema,
  type EvidenceSource,
  type EvidenceSourceId,
  type EvidenceSubjectRef,
} from "../contracts/index.js";
import { EvidenceSourceNotFoundError } from "../domain/errors.js";
import { evidenceSourceRegisteredEvent } from "../events/index.js";
import {
  EVIDENCE_RECORD,
  EVIDENCE_VIEW,
  ownedSubject,
  subjectScope,
} from "./authority.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Source registration: "where did this originate". Trusted workflows
 * (onboarding, uploads, integrations) call this; there is no generic
 * browser route. Tenant, creator and ownership come from the actor and the
 * resolved subject, never from the request. The URL is stored as
 * provenance and is never fetched here.
 */

const SOURCE_URL = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "a source URL is an http(s) URL");

export const RegisterEvidenceSourceInputSchema = z
  .object({
    sourceType: EvidenceSourceTypeSchema,
    subject: EvidenceSubjectRefSchema,
    provider: z.string().trim().min(1).max(64).optional(),
    externalReference: z.string().trim().min(1).max(256).optional(),
    title: SourceTitleSchema.optional(),
    sourceUrl: SOURCE_URL.optional(),
    retrievedAt: UtcTimestampSchema.optional(),
    publishedAt: UtcTimestampSchema.optional(),
    reliabilityClass: ReliabilityClassSchema.optional(),
    /** Defaults to organisation_private; never broader than the subject allows here. */
    visibilityScope: DisclosureScopeSchema.optional(),
    sensitivityClass: MessageSensitivitySchema.optional(),
    metadata: SourceMetadataSchema.optional(),
  })
  .strict();
export type RegisterEvidenceSourceInput = z.infer<
  typeof RegisterEvidenceSourceInputSchema
>;

export type RegisterEvidenceSourceCommand = {
  readonly actor: ActorContext;
  readonly input: RegisterEvidenceSourceInput;
  readonly correlationId: CorrelationId;
};

/** A source registered in this packet stays inside the owning organisation. */
const REGISTRABLE_SCOPES = new Set([
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
]);

export function createRegisterEvidenceSource(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, outbox, repositories } = dependencies;
  return async (
    command: RegisterEvidenceSourceCommand,
  ): Promise<EvidenceSource> => {
    const input = RegisterEvidenceSourceInputSchema.parse(command.input);
    const { actor } = command;
    const subject = await ownedSubject(dependencies, actor, input.subject);
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_RECORD,
      resource: subjectScope(actor, subject),
    });
    const visibilityScope = input.visibilityScope ?? "organisation_private";
    if (!REGISTRABLE_SCOPES.has(visibilityScope)) {
      // Broader scopes are a disclosure decision taken elsewhere, later.
      throw new ContractValidationError("A source is private to its owner.", [
        {
          path: "visibilityScope",
          code: "invalid_value",
          message: "broader scopes are a later disclosure decision",
        },
      ]);
    }
    return transactions.run(async (tx) => {
      const source = await repositories.sources.insert(tx, {
        tenantId: actor.tenantId,
        sourceType: input.sourceType,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        provider: input.provider ?? null,
        externalReference: input.externalReference ?? null,
        title: input.title ?? null,
        sourceUrl: input.sourceUrl ?? null,
        createdByUserId: actor.actorType === "HUMAN" ? actor.userId : null,
        retrievedAt: input.retrievedAt ?? null,
        publishedAt: input.publishedAt ?? null,
        reliabilityClass: input.reliabilityClass ?? null,
        visibilityScope,
        sensitivityClass: input.sensitivityClass ?? "CONFIDENTIAL",
        metadata: input.metadata ?? {},
      });
      await outbox.enqueue(
        tx,
        evidenceSourceRegisteredEvent(
          {
            actor,
            organisationId: subject.ownerOrganisationId,
            correlationId: command.correlationId,
          },
          {
            sourceId: source.id,
            sourceType: source.sourceType,
            subjectType: source.subjectType,
            subjectId: source.subjectId,
          },
        ),
      );
      return source;
    });
  };
}

export type GetEvidenceSourceQuery = {
  readonly actor: ActorContext;
  readonly sourceId: EvidenceSourceId;
};

/** Visible only to the owning organisation; otherwise "not found". */
export function createGetEvidenceSource(
  dependencies: EvidenceServiceDependencies,
) {
  return async (query: GetEvidenceSourceQuery): Promise<EvidenceSource> => {
    const { actor } = query;
    const source = await dependencies.repositories.sources.findById(
      dependencies.sql,
      actor.tenantId,
      query.sourceId,
    );
    if (source === null) {
      throw new EvidenceSourceNotFoundError();
    }
    const subject = await ownedSubject(dependencies, actor, {
      subjectType: source.subjectType,
      subjectId: source.subjectId,
    }).catch(() => {
      throw new EvidenceSourceNotFoundError();
    });
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_VIEW,
      resource: subjectScope(actor, subject),
    });
    return source;
  };
}

export type ListEvidenceSourcesQuery = {
  readonly actor: ActorContext;
  readonly subject: EvidenceSubjectRef;
};

export function createListEvidenceSources(
  dependencies: EvidenceServiceDependencies,
) {
  return async (
    query: ListEvidenceSourcesQuery,
  ): Promise<readonly EvidenceSource[]> => {
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
    return dependencies.repositories.sources.listBySubject(
      dependencies.sql,
      actor.tenantId,
      { subjectType: subject.subjectType, subjectId: subject.subjectId },
    );
  };
}
