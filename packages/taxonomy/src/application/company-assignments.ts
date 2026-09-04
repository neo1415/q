import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import { CorrelationIdSchema, type CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  ActorContextSchema,
  capability,
  type ActorContext,
  type AuthorizationService,
  type OrganisationId,
} from "@capital-q/security";

import {
  TAXONOMY_RAW_SOURCE_TEXT_MAX_LENGTH,
  TaxonomyNodeIdSchema,
  TaxonomyVocabularyCodeSchema,
  UuidSchema,
  type TaxonomyEntityAssignment,
  type TaxonomyNode,
  type TaxonomyNodeId,
  type TaxonomySubjectDescriptor,
  type TaxonomyVocabularyCode,
} from "../contracts/index.js";
import {
  TaxonomyNodeNotSelectableError,
  TaxonomySubjectNotFoundError,
  TaxonomyVocabularyNotFoundError,
} from "../domain/errors.js";
import { entityAssignmentsChangedEvent } from "../events/index.js";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
} from "./ports.js";
import type { TaxonomySubjectResolverRegistry } from "./subject-resolvers.js";

/**
 * Confirmed company classification.
 *
 *   resolve company in the caller's tenant (enumeration-safe) ->
 *   company.edit on the exact company -> validate vocabulary + nodes
 *   (exist, ACTIVE, in that vocabulary) -> [tx] lock subject -> diff the
 *   current active set of that vocabulary against the desired set ->
 *   supersede removed (valid_to) -> insert added (user_selected, confirmed
 *   by the actor) -> audit -> outbox -> COMMIT
 *
 * Multi-label: any number of nodes per vocabulary. Unchanged assignments
 * are left untouched; nothing is ever deleted. The assignment source is
 * chosen here, never by a client, and Q has no write path: a model's
 * suggestion becomes a row only after a human confirms it (CQ-TAX-002).
 */

export const COMPANY_EDIT = capability("company.edit");
export const COMPANY_VIEW = capability("company.view");

export const RESOURCE_COMPANY = AuditResourceTypeSchema.parse("company");
const ACTION_UPDATED = AuditActionTypeSchema.parse(
  "taxonomy.company_assignments.updated",
);

const DesiredNodeSchema = z
  .object({
    nodeId: TaxonomyNodeIdSchema,
    /** What the founder actually said; preserved verbatim, never rewritten. */
    rawSourceText: z
      .string()
      .trim()
      .min(1)
      .max(TAXONOMY_RAW_SOURCE_TEXT_MAX_LENGTH)
      .optional(),
  })
  .strict();

const ReplaceCommandSchema = z
  .object({
    actor: ActorContextSchema,
    companyId: UuidSchema,
    vocabularyCode: TaxonomyVocabularyCodeSchema,
    nodes: z.array(DesiredNodeSchema).max(50),
    correlationId: CorrelationIdSchema,
  })
  .strict();

export type ReplaceCompanyAssignmentsCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly nodes: readonly {
    readonly nodeId: TaxonomyNodeId;
    readonly rawSourceText?: string | undefined;
  }[];
  readonly correlationId: CorrelationId;
};

export type ReplaceCompanyAssignmentsResult = {
  readonly current: readonly TaxonomyEntityAssignment[];
  readonly added: number;
  readonly removed: number;
};

export type ListCompanyAssignmentsQuery = {
  readonly actor: ActorContext;
  readonly companyId: string;
  readonly vocabularyCode?: TaxonomyVocabularyCode | undefined;
  readonly includeHistory?: boolean | undefined;
};

export type CompanyAssignmentDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly reference: TaxonomyReferenceRepository;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly subjects: TaxonomySubjectResolverRegistry;
};

/**
 * The company must be visible in the actor's tenant AND owned by the
 * actor's active organisation. Shared by every company-scoped taxonomy
 * command (assignments, classification runs, candidate decisions).
 */
export async function requireVisibleCompany(
  dependencies: Pick<CompanyAssignmentDependencies, "subjects">,
  actor: ActorContext,
  companyId: string,
): Promise<{
  readonly subject: TaxonomySubjectDescriptor;
  readonly organisationId: OrganisationId;
}> {
  const subject = await dependencies.subjects.resolve(
    "COMPANY",
    actor.tenantId,
    companyId,
  );
  // A company in another tenant or organisation is indistinguishable from
  // one that does not exist.
  if (
    subject === null ||
    actor.organisationId === undefined ||
    subject.organisationId !== actor.organisationId
  ) {
    throw new TaxonomySubjectNotFoundError();
  }
  return { subject, organisationId: actor.organisationId };
}

/** Every desired node must exist, be ACTIVE and belong to the vocabulary. */
export async function requireSelectableNodes(
  reference: TaxonomyReferenceRepository,
  sql: DatabaseExecutor,
  nodeIds: readonly TaxonomyNodeId[],
  vocabularyCode?: TaxonomyVocabularyCode,
): Promise<ReadonlyMap<TaxonomyNodeId, TaxonomyNode>> {
  const seen = new Set<string>();
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      throw new TaxonomyNodeNotSelectableError("DUPLICATE", nodeId);
    }
    seen.add(nodeId);
  }
  const nodes = await reference.findNodesByIds(sql, nodeIds);
  const byId = new Map<TaxonomyNodeId, TaxonomyNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  for (const nodeId of nodeIds) {
    const node = byId.get(nodeId);
    if (node === undefined) {
      throw new TaxonomyNodeNotSelectableError("UNKNOWN_NODE", nodeId);
    }
    if (node.status !== "ACTIVE") {
      throw new TaxonomyNodeNotSelectableError("DEPRECATED", nodeId);
    }
    if (
      vocabularyCode !== undefined &&
      node.vocabularyCode !== vocabularyCode
    ) {
      throw new TaxonomyNodeNotSelectableError("WRONG_VOCABULARY", nodeId);
    }
  }
  return byId;
}

export type CompanyAssignmentChange = {
  readonly actor: ActorContext;
  readonly subject: TaxonomySubjectDescriptor;
  readonly organisationId: OrganisationId;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  /** Safe identifiers only (e.g. a classification run id); never raw text. */
  readonly provenance?: { readonly classificationRunId: string } | undefined;
};

/**
 * The one audit + outbox path for a canonical company classification
 * change. Candidate acceptance (CQ-TAX-002) reuses it rather than
 * inventing a second audit fact or event for the same mutation.
 */
export async function recordCompanyAssignmentChange(
  tx: TransactionContext,
  dependencies: Pick<CompanyAssignmentDependencies, "audit" | "outbox">,
  change: CompanyAssignmentChange,
): Promise<void> {
  await dependencies.audit.record(tx, {
    ...auditActorFromContext(change.actor),
    auditEventId: createAuditEventId(),
    actionType: ACTION_UPDATED,
    resourceType: RESOURCE_COMPANY,
    resourceId: change.subject.subjectId,
    occurredAt: change.occurredAt,
    outcome: "SUCCEEDED",
    metadata: {
      vocabularyCode: change.vocabularyCode,
      addedCount: change.addedCount,
      removedCount: change.removedCount,
      ...(change.provenance === undefined
        ? {}
        : { classificationRunId: change.provenance.classificationRunId }),
    },
    correlationId: change.correlationId,
  });
  await dependencies.outbox.enqueue(
    tx,
    entityAssignmentsChangedEvent({
      tenantId: change.actor.tenantId,
      organisationId: change.organisationId,
      actorUserId: change.actor.userId,
      correlationId: change.correlationId,
      subjectType: change.subject.subjectType,
      subjectId: change.subject.subjectId,
      changedVocabularyCodes: [change.vocabularyCode],
    }),
  );
}

export function createReplaceCompanyAssignments(
  dependencies: CompanyAssignmentDependencies,
) {
  const {
    sql,
    transactions,
    authorization,
    outbox,
    audit,
    reference,
    assignments,
  } = dependencies;

  return async (
    raw: ReplaceCompanyAssignmentsCommand,
  ): Promise<ReplaceCompanyAssignmentsResult> => {
    const command = ReplaceCommandSchema.parse(raw);
    const { actor } = command;
    const { subject, organisationId } = await requireVisibleCompany(
      dependencies,
      actor,
      command.companyId,
    );
    await authorization.requireCapability({
      actor,
      capability: COMPANY_EDIT,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId,
        resourceType: "company",
        resourceId: subject.subjectId,
      },
    });

    const vocabulary = await reference.findVocabularyByCode(
      sql,
      command.vocabularyCode,
    );
    if (vocabulary === null) {
      throw new TaxonomyVocabularyNotFoundError();
    }
    if (vocabulary.status !== "ACTIVE") {
      throw new TaxonomyNodeNotSelectableError(
        "VOCABULARY_RETIRED",
        command.nodes[0]?.nodeId ?? vocabulary.id,
      );
    }
    await requireSelectableNodes(
      reference,
      sql,
      command.nodes.map((node) => node.nodeId),
      command.vocabularyCode,
    );

    return transactions.run(async (tx) => {
      await assignments.lockSubject(tx, subject);
      const current = await assignments.listCurrent(
        tx.sql,
        actor.tenantId,
        subject,
        command.vocabularyCode,
      );
      const desired = new Map(command.nodes.map((node) => [node.nodeId, node]));
      const currentByNode = new Map(current.map((row) => [row.nodeId, row]));

      const removed = current.filter((row) => !desired.has(row.nodeId));
      const added = command.nodes.filter(
        (node) => !currentByNode.has(node.nodeId),
      );

      if (removed.length === 0 && added.length === 0) {
        return { current, added: 0, removed: 0 };
      }

      if (removed.length > 0) {
        await assignments.supersede(
          tx,
          actor.tenantId,
          removed.map((row) => row.id),
        );
      }
      const now = occurredNow();
      for (const node of added) {
        await assignments.insert(tx, {
          tenantId: actor.tenantId,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          nodeId: node.nodeId,
          assignmentSource: "user_selected",
          confidence: null,
          rawSourceText: node.rawSourceText ?? null,
          sourceId: null,
          classificationRunId: null,
          confirmedByUserId: actor.userId,
          confirmedAt: now,
        });
      }

      await recordCompanyAssignmentChange(
        tx,
        { audit, outbox },
        {
          actor,
          subject,
          organisationId,
          vocabularyCode: command.vocabularyCode,
          addedCount: added.length,
          removedCount: removed.length,
          occurredAt: now,
          correlationId: command.correlationId,
        },
      );

      const updated = await assignments.listCurrent(
        tx.sql,
        actor.tenantId,
        subject,
        command.vocabularyCode,
      );
      return { current: updated, added: added.length, removed: removed.length };
    });
  };
}

/** Current (or full) classification of a company visible to the caller; `company.view`. */
export function createListCompanyAssignments(
  dependencies: CompanyAssignmentDependencies,
) {
  const { sql, authorization, assignments } = dependencies;
  return async (
    query: ListCompanyAssignmentsQuery,
  ): Promise<readonly TaxonomyEntityAssignment[]> => {
    const { subject, organisationId } = await requireVisibleCompany(
      dependencies,
      query.actor,
      query.companyId,
    );
    await authorization.requireCapability({
      actor: query.actor,
      capability: COMPANY_VIEW,
      resource: {
        kind: "RESOURCE",
        tenantId: query.actor.tenantId,
        organisationId,
        resourceType: "company",
        resourceId: subject.subjectId,
      },
    });
    if (query.includeHistory === true) {
      const history = await assignments.listHistory(
        sql,
        query.actor.tenantId,
        subject,
      );
      return query.vocabularyCode === undefined
        ? history
        : history.filter((row) => row.vocabularyCode === query.vocabularyCode);
    }
    return assignments.listCurrent(
      sql,
      query.actor.tenantId,
      subject,
      query.vocabularyCode,
    );
  };
}
