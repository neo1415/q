import { z } from "zod";

import {
  ContractValidationError,
  DisclosureScopeSchema,
  EvidenceStatusSchema,
  MessageSensitivitySchema,
  ReliabilityClassSchema,
  UtcTimestampSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  DocumentVersionIdSchema,
  EvidenceItemIdSchema,
  EvidenceLocatorSchema,
  EvidenceSourceIdSchema,
  EvidenceSubjectRefSchema,
  EvidenceSummarySchema,
  EvidenceTypeSchema,
  StructuredValueSchema,
  type EvidenceItem,
  type EvidenceItemId,
  type EvidenceSubjectRef,
} from "../contracts/index.js";
import {
  DocumentVersionNotFoundError,
  EvidenceItemNotFoundError,
  EvidenceRuleError,
  EvidenceSourceNotFoundError,
} from "../domain/errors.js";
import { strongestSensitivity } from "../domain/sensitivity.js";
import { evidenceItemCreatedEvent } from "../events/index.js";
import {
  EVIDENCE_RECORD,
  EVIDENCE_VIEW,
  ownedSubject,
  subjectScope,
} from "./authority.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Evidence items: something identified inside a registered source about
 * the source's subject, with a typed locator back to where it was found.
 * Trusted workflows (and, later, the extraction pipeline) record them;
 * nothing here parses, scans or infers. An item never widens its source's
 * disclosure and never weakens its sensitivity.
 */

const NON_WIDENING: Readonly<Record<string, number>> = {
  personal_private: 0,
  founder_private: 1,
  investor_private: 1,
  organisation_private: 2,
  specifically_shared: 3,
  relationship_shared: 4,
  network_visible: 5,
  public_external: 6,
};

export const CreateEvidenceItemInputSchema = z
  .object({
    sourceId: EvidenceSourceIdSchema,
    evidenceType: EvidenceTypeSchema,
    summary: EvidenceSummarySchema,
    structuredValue: StructuredValueSchema.nullable().default(null),
    locator: EvidenceLocatorSchema,
    validFrom: UtcTimestampSchema.nullable().default(null),
    validTo: UtcTimestampSchema.nullable().default(null),
    evidenceStatus: EvidenceStatusSchema,
    reliabilityClass: ReliabilityClassSchema.optional(),
    visibilityScope: DisclosureScopeSchema.optional(),
    sensitivityClass: MessageSensitivitySchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.validFrom === null ||
      value.validTo === null ||
      value.validFrom <= value.validTo,
    { message: "validFrom must not follow validTo", path: ["validTo"] },
  );
export type CreateEvidenceItemInput = z.input<
  typeof CreateEvidenceItemInputSchema
>;

export type CreateEvidenceItemCommand = {
  readonly actor: ActorContext;
  readonly input: CreateEvidenceItemInput;
  readonly correlationId: CorrelationId;
};

export function createCreateEvidenceItem(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, outbox, repositories } = dependencies;
  return async (command: CreateEvidenceItemCommand): Promise<EvidenceItem> => {
    const input = CreateEvidenceItemInputSchema.parse(command.input);
    const { actor } = command;
    const source = await repositories.sources.findById(
      dependencies.sql,
      actor.tenantId,
      input.sourceId,
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
      capability: EVIDENCE_RECORD,
      resource: subjectScope(actor, subject),
    });
    if (input.evidenceStatus === "NO_EVIDENCE") {
      throw new EvidenceRuleError(
        "an evidence item is evidence; use a claim for absence",
      );
    }
    const visibilityScope = input.visibilityScope ?? source.visibilityScope;
    if (
      (NON_WIDENING[visibilityScope] ?? 0) >
      (NON_WIDENING[source.visibilityScope] ?? 0)
    ) {
      throw new ContractValidationError(
        "Evidence is never broader than its source.",
        [
          {
            path: "visibilityScope",
            code: "invalid_value",
            message: `wider than the source's ${source.visibilityScope}`,
          },
        ],
      );
    }
    const sensitivityClass = strongestSensitivity(
      source.sensitivityClass,
      input.sensitivityClass ?? source.sensitivityClass,
    );
    if (input.locator.kind === "document") {
      // A document locator must point into a version this tenant holds;
      // knowing the id still grants no access to the file.
      const version = await repositories.documentVersions.findById(
        dependencies.sql,
        actor.tenantId,
        DocumentVersionIdSchema.parse(input.locator.documentVersionId),
      );
      if (version === null) {
        throw new DocumentVersionNotFoundError();
      }
    }
    return transactions.run(async (tx) => {
      const item = await repositories.evidenceItems.insert(tx, {
        tenantId: actor.tenantId,
        sourceId: source.id,
        subjectType: source.subjectType,
        subjectId: source.subjectId,
        evidenceType: input.evidenceType,
        summary: input.summary,
        structuredValue: input.structuredValue,
        locator: input.locator,
        validFrom: input.validFrom,
        validTo: input.validTo,
        evidenceStatus: input.evidenceStatus,
        reliabilityClass: input.reliabilityClass ?? source.reliabilityClass,
        visibilityScope,
        sensitivityClass,
        createdByUserId: actor.actorType === "HUMAN" ? actor.userId : null,
      });
      await outbox.enqueue(
        tx,
        evidenceItemCreatedEvent(
          {
            actor,
            organisationId: subject.ownerOrganisationId,
            correlationId: command.correlationId,
          },
          {
            evidenceItemId: item.id,
            sourceId: item.sourceId,
            subjectType: item.subjectType,
            subjectId: item.subjectId,
          },
        ),
      );
      return item;
    });
  };
}

export type GetEvidenceItemQuery = {
  readonly actor: ActorContext;
  readonly evidenceItemId: EvidenceItemId;
};

export function createGetEvidenceItem(
  dependencies: EvidenceServiceDependencies,
) {
  return async (query: GetEvidenceItemQuery): Promise<EvidenceItem> => {
    const { actor } = query;
    const item = await dependencies.repositories.evidenceItems.findById(
      dependencies.sql,
      actor.tenantId,
      EvidenceItemIdSchema.parse(query.evidenceItemId),
    );
    if (item === null) {
      throw new EvidenceItemNotFoundError();
    }
    const subject = await ownedSubject(dependencies, actor, {
      subjectType: item.subjectType,
      subjectId: item.subjectId,
    }).catch(() => {
      throw new EvidenceItemNotFoundError();
    });
    await dependencies.authorization.requireCapability({
      actor,
      capability: EVIDENCE_VIEW,
      resource: subjectScope(actor, subject),
    });
    return item;
  };
}

export type ListEvidenceItemsQuery = {
  readonly actor: ActorContext;
  readonly subject: EvidenceSubjectRef;
};

export function createListEvidenceItems(
  dependencies: EvidenceServiceDependencies,
) {
  return async (
    query: ListEvidenceItemsQuery,
  ): Promise<readonly EvidenceItem[]> => {
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
    return dependencies.repositories.evidenceItems.listBySubject(
      dependencies.sql,
      actor.tenantId,
      { subjectType: subject.subjectType, subjectId: subject.subjectId },
    );
  };
}
