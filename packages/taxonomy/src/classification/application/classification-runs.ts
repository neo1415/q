import { z } from "zod";

import { occurredNow, type MaterialActionAuditWriter } from "@capital-q/audit";
import {
  CorrelationIdSchema,
  TAXONOMY_CANDIDATE_DEFAULT_LIMIT,
  TAXONOMY_CANDIDATE_MAX_LIMIT,
  TAXONOMY_CANDIDATE_MAX_VOCABULARIES,
  TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH,
  TaxonomyClassificationStrategySchema,
  type CorrelationId,
  type TaxonomyClassificationStrategy,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { Logger } from "@capital-q/observability";
import {
  ActorContextSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  COMPANY_EDIT,
  COMPANY_VIEW,
  recordCompanyAssignmentChange,
  requireSelectableNodes,
  requireVisibleCompany,
} from "../../application/company-assignments.js";
import type {
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
} from "../../application/ports.js";
import type { TaxonomySubjectResolverRegistry } from "../../application/subject-resolvers.js";
import {
  TAXONOMY_RAW_SOURCE_TEXT_MAX_LENGTH,
  TaxonomyNodeIdSchema,
  TaxonomySubjectTypeSchema,
  TaxonomyVocabularyCodeSchema,
  UuidSchema,
  type TaxonomyEntityAssignment,
  type TaxonomyNodeId,
  type TaxonomySubjectType,
  type TaxonomyVocabularyCode,
} from "../../contracts/index.js";
import {
  TAXONOMY_CLASSIFIER_IDENTITY,
  TaxonomyClassificationRunIdSchema,
  TaxonomyInputSourceTypeSchema,
  type TaxonomyClassificationCandidateRecord,
  type TaxonomyClassificationResult,
  type TaxonomyClassificationRun,
  type TaxonomyClassificationRunId,
  type TaxonomyClassificationRunMetadata,
  type TaxonomyInputSourceType,
} from "../contracts/index.js";
import {
  TaxonomyClassificationCandidateDecidedError,
  TaxonomyClassificationCandidateNotFoundError,
  TaxonomyClassificationInputError,
  TaxonomyClassificationRunNotFoundError,
} from "../domain/errors.js";
import { hashClassificationInput } from "../domain/tokenize.js";
import type { TaxonomyClassifier } from "./candidate-service.js";
import { getTaxonomyMetrics, observeClassification } from "./metrics.js";
import type { TaxonomyClassificationRunRepository } from "./ports.js";

/**
 * Persistent classification (provenance) and human confirmation.
 *
 *   classifyWithProvenance: trusted subject + canonical input source ->
 *     company.edit -> run RUNNING -> deterministic candidates ->
 *     COMPLETED | ABSTAINED (FAILED only on execution failure)
 *   acceptCompanyCandidate: run in the actor's tenant -> company.edit ->
 *     candidate belongs to the run and is undecided -> node ACTIVE ->
 *     [tx] canonical assignment (user_selected, raw text, run id,
 *     confirmed by the actor) + candidate accepted + the CQ-TAX-001
 *     audit/outbox path -> COMMIT
 *   rejectCompanyCandidate: accepted = false, nothing canonical changes.
 *
 * Raw text never enters a run row; the SHA-256 hash and length do. A
 * candidate never becomes canonical without a human decision, and a
 * decision is history, never a toggle. Runs are provenance, not audit.
 */

const DETERMINISTIC_COST_USD = "0";

const InputSourceSchema = z
  .object({
    type: TaxonomyInputSourceTypeSchema,
    id: UuidSchema,
  })
  .strict();

const ClassifyCommandSchema = z
  .object({
    actor: ActorContextSchema,
    subject: z
      .object({
        subjectType: TaxonomySubjectTypeSchema,
        subjectId: UuidSchema,
      })
      .strict(),
    inputSource: InputSourceSchema.nullable(),
    text: z
      .string()
      .max(TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH)
      .refine((value) => value.trim().length > 0, {
        message: "text must not be empty",
      }),
    vocabularyCodes: z
      .array(TaxonomyVocabularyCodeSchema)
      .min(1)
      .max(TAXONOMY_CANDIDATE_MAX_VOCABULARIES)
      .optional(),
    strategy: TaxonomyClassificationStrategySchema.optional(),
    limit: z.number().int().min(1).max(TAXONOMY_CANDIDATE_MAX_LIMIT).optional(),
    correlationId: CorrelationIdSchema,
  })
  .strict();

export type ClassifyWithProvenanceCommand = {
  readonly actor: ActorContext;
  readonly subject: {
    readonly subjectType: TaxonomySubjectType;
    readonly subjectId: string;
  };
  /** A canonical source the text came from, or null for trusted ad-hoc text. */
  readonly inputSource: {
    readonly type: TaxonomyInputSourceType;
    readonly id: string;
  } | null;
  readonly text: string;
  readonly vocabularyCodes?: readonly TaxonomyVocabularyCode[] | undefined;
  readonly strategy?: TaxonomyClassificationStrategy | undefined;
  readonly limit?: number | undefined;
  readonly correlationId: CorrelationId;
};

export type TaxonomyClassificationRunResult = {
  readonly run: TaxonomyClassificationRun;
  readonly result: TaxonomyClassificationResult;
  readonly candidates: readonly TaxonomyClassificationCandidateRecord[];
};

const DecisionCommandSchema = z
  .object({
    actor: ActorContextSchema,
    runId: TaxonomyClassificationRunIdSchema,
    nodeId: TaxonomyNodeIdSchema,
    /** The source language, supplied by the owning workflow from the canonical source. */
    rawSourceText: z
      .string()
      .trim()
      .min(1)
      .max(TAXONOMY_RAW_SOURCE_TEXT_MAX_LENGTH)
      .optional(),
    correlationId: CorrelationIdSchema,
  })
  .strict();

export type DecideCompanyCandidateCommand = {
  readonly actor: ActorContext;
  readonly runId: TaxonomyClassificationRunId;
  readonly nodeId: TaxonomyNodeId;
  readonly rawSourceText?: string | undefined;
  readonly correlationId: CorrelationId;
};

export type AcceptCompanyCandidateResult = {
  readonly candidate: TaxonomyClassificationCandidateRecord;
  readonly assignment: TaxonomyEntityAssignment;
  /** False when the node was already a current assignment (nothing changed). */
  readonly assignmentCreated: boolean;
};

export type GetClassificationRunQuery = {
  readonly actor: ActorContext;
  readonly runId: TaxonomyClassificationRunId;
};

export type ClassificationRunDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly reference: TaxonomyReferenceRepository;
  readonly assignments: TaxonomyAssignmentRepository;
  readonly subjects: TaxonomySubjectResolverRegistry;
  readonly runs: TaxonomyClassificationRunRepository;
  readonly classifier: TaxonomyClassifier;
  readonly logger?: Logger | undefined;
};

async function authorizedCompanyRun(
  dependencies: ClassificationRunDependencies,
  actor: ActorContext,
  runId: TaxonomyClassificationRunId,
  capabilityCode: typeof COMPANY_EDIT,
) {
  const run = await dependencies.runs.findRun(
    dependencies.sql,
    actor.tenantId,
    runId,
  );
  // Another tenant's run is indistinguishable from a missing one.
  if (run === null || run.subjectType !== "COMPANY") {
    throw new TaxonomyClassificationRunNotFoundError();
  }
  const { subject, organisationId } = await requireVisibleCompany(
    dependencies,
    actor,
    run.subjectId,
  );
  await dependencies.authorization.requireCapability({
    actor,
    capability: capabilityCode,
    resource: {
      kind: "RESOURCE",
      tenantId: actor.tenantId,
      organisationId,
      resourceType: "company",
      resourceId: subject.subjectId,
    },
  });
  return { run, subject, organisationId };
}

export function createClassifyWithProvenance(
  dependencies: ClassificationRunDependencies,
) {
  const { sql, transactions, authorization, runs, classifier, logger } =
    dependencies;

  return async (
    raw: ClassifyWithProvenanceCommand,
  ): Promise<TaxonomyClassificationRunResult> => {
    const command = ClassifyCommandSchema.parse(raw);
    const { actor } = command;
    const strategy = classifier.requireSupportedStrategy(command.strategy);

    if (command.subject.subjectType !== "COMPANY") {
      throw new TaxonomyClassificationInputError("UNSUPPORTED_SUBJECT");
    }
    const { subject, organisationId } = await requireVisibleCompany(
      dependencies,
      actor,
      command.subject.subjectId,
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
    // COMPANY_PROFILE = the canonical company row: it must be this subject.
    if (
      command.inputSource !== null &&
      command.inputSource.type === "COMPANY_PROFILE" &&
      command.inputSource.id !== subject.subjectId
    ) {
      throw new TaxonomyClassificationInputError(
        "INPUT_SOURCE_SUBJECT_MISMATCH",
      );
    }

    const scope = await classifier.resolveScope(sql, command.vocabularyCodes);
    const limit = command.limit ?? TAXONOMY_CANDIDATE_DEFAULT_LIMIT;
    const baseMetadata: TaxonomyClassificationRunMetadata = {
      strategy,
      vocabularyCodes: [...scope.vocabularyCodes],
      inputHash: hashClassificationInput(command.text),
      inputLength: command.text.length,
    };

    const run = await transactions.run((tx) =>
      runs.insertRun(tx, {
        tenantId: subject.tenantId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        inputSourceType: command.inputSource?.type ?? null,
        inputSourceId: command.inputSource?.id ?? null,
        classifierProvider: TAXONOMY_CLASSIFIER_IDENTITY.provider,
        classifierModel: TAXONOMY_CLASSIFIER_IDENTITY.model,
        classifierVersion: TAXONOMY_CLASSIFIER_IDENTITY.version,
        taxonomyVersion: scope.versions,
        metadata: baseMetadata,
      }),
    );

    const started = performance.now();
    let result: TaxonomyClassificationResult;
    try {
      result = await classifier.classifyInScope(sql, scope, {
        text: command.text,
        strategy,
        limit,
      });
    } catch (error) {
      // Execution failure only. "No candidate" is never FAILED.
      await transactions.run((tx) =>
        runs.finishRun(tx, {
          tenantId: subject.tenantId,
          runId: run.id,
          status: "FAILED",
          costUsd: DETERMINISTIC_COST_USD,
          metadata: { ...baseMetadata, failureCode: "CLASSIFIER_ERROR" },
        }),
      );
      getTaxonomyMetrics().failures.add(1, {
        classifierVersion: TAXONOMY_CLASSIFIER_IDENTITY.version,
      });
      getTaxonomyMetrics().persistentRuns.add(1, { status: "FAILED" });
      throw error;
    }

    const status =
      result.resolution === "ABSTAINED" ? "ABSTAINED" : "COMPLETED";
    const finalMetadata: TaxonomyClassificationRunMetadata = {
      ...baseMetadata,
      resolution: result.resolution,
      candidateCount: result.candidates.length,
      ...(result.abstentionReason === undefined
        ? {}
        : { abstentionReason: result.abstentionReason }),
    };
    await transactions.run(async (tx) => {
      await runs.insertCandidates(
        tx,
        run.id,
        result.candidates.map((candidate) => ({
          nodeId: TaxonomyNodeIdSchema.parse(candidate.nodeId),
          rank: candidate.rank,
          confidence: candidate.confidence,
          matchTypes: candidate.matchTypes,
          rationaleSummary: candidate.rationaleSummary,
        })),
      );
      await runs.finishRun(tx, {
        tenantId: subject.tenantId,
        runId: run.id,
        status,
        costUsd: DETERMINISTIC_COST_USD,
        metadata: finalMetadata,
      });
    });
    getTaxonomyMetrics().persistentRuns.add(1, { status });
    observeClassification(
      {
        strategy,
        inputLength: command.text.length,
        inputHash: baseMetadata.inputHash ?? "",
        vocabularyCount: scope.vocabularyCodes.length,
        durationMs: Math.round(performance.now() - started),
        result,
      },
      logger,
    );

    const finished = await runs.findRun(sql, subject.tenantId, run.id);
    if (finished === null) {
      throw new TaxonomyClassificationRunNotFoundError();
    }
    return {
      run: finished,
      result,
      candidates: await runs.listCandidates(sql, run.id),
    };
  };
}

/** A company's run with its candidates; `company.view`. */
export function createGetCompanyClassificationRun(
  dependencies: ClassificationRunDependencies,
) {
  return async (
    query: GetClassificationRunQuery,
  ): Promise<{
    readonly run: TaxonomyClassificationRun;
    readonly candidates: readonly TaxonomyClassificationCandidateRecord[];
  }> => {
    const { run } = await authorizedCompanyRun(
      dependencies,
      query.actor,
      query.runId,
      COMPANY_VIEW,
    );
    return {
      run,
      candidates: await dependencies.runs.listCandidates(
        dependencies.sql,
        run.id,
      ),
    };
  };
}

export function createAcceptCompanyClassificationCandidate(
  dependencies: ClassificationRunDependencies,
) {
  const { sql, transactions, reference, assignments, runs, audit, outbox } =
    dependencies;

  return async (
    raw: DecideCompanyCandidateCommand,
  ): Promise<AcceptCompanyCandidateResult> => {
    const command = DecisionCommandSchema.parse(raw);
    const { actor } = command;
    const { run, subject, organisationId } = await authorizedCompanyRun(
      dependencies,
      actor,
      command.runId,
      COMPANY_EDIT,
    );
    const candidate = await runs.findCandidate(sql, run.id, command.nodeId);
    if (candidate === null) {
      throw new TaxonomyClassificationCandidateNotFoundError();
    }
    if (candidate.accepted !== null) {
      throw new TaxonomyClassificationCandidateDecidedError();
    }
    // Deprecated since the run: not selectable, however it was suggested.
    await requireSelectableNodes(reference, sql, [command.nodeId]);

    return transactions.run(async (tx) => {
      await assignments.lockSubject(tx, subject);
      const now = occurredNow();
      const decided = await runs.decideCandidate(tx, {
        runId: run.id,
        nodeId: command.nodeId,
        accepted: true,
        decidedByUserId: actor.userId,
        decidedAt: now,
      });
      if (!decided) {
        throw new TaxonomyClassificationCandidateDecidedError();
      }
      const current = await assignments.listCurrent(
        tx.sql,
        actor.tenantId,
        subject,
        candidate.vocabularyCode,
      );
      const existing = current.find((row) => row.nodeId === command.nodeId);
      let assignment: TaxonomyEntityAssignment;
      let assignmentCreated = false;
      if (existing !== undefined) {
        assignment = existing;
      } else {
        assignment = await assignments.insert(tx, {
          tenantId: actor.tenantId,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          nodeId: command.nodeId,
          // A human confirmed a deterministic suggestion: user_selected, never q_inferred.
          assignmentSource: "user_selected",
          confidence: null,
          rawSourceText: command.rawSourceText ?? null,
          sourceId: null,
          classificationRunId: run.id,
          confirmedByUserId: actor.userId,
          confirmedAt: now,
        });
        assignmentCreated = true;
        await recordCompanyAssignmentChange(
          tx,
          { audit, outbox },
          {
            actor,
            subject,
            organisationId,
            vocabularyCode: candidate.vocabularyCode,
            addedCount: 1,
            removedCount: 0,
            occurredAt: now,
            correlationId: command.correlationId,
            provenance: { classificationRunId: run.id },
          },
        );
      }
      const updated = await runs.findCandidate(tx.sql, run.id, command.nodeId);
      if (updated === null) {
        throw new TaxonomyClassificationCandidateNotFoundError();
      }
      return { candidate: updated, assignment, assignmentCreated };
    });
  };
}

export function createRejectCompanyClassificationCandidate(
  dependencies: ClassificationRunDependencies,
) {
  const { sql, transactions, runs } = dependencies;

  return async (
    raw: DecideCompanyCandidateCommand,
  ): Promise<TaxonomyClassificationCandidateRecord> => {
    const command = DecisionCommandSchema.parse(raw);
    const { run } = await authorizedCompanyRun(
      dependencies,
      command.actor,
      command.runId,
      COMPANY_EDIT,
    );
    const candidate = await runs.findCandidate(sql, run.id, command.nodeId);
    if (candidate === null) {
      throw new TaxonomyClassificationCandidateNotFoundError();
    }
    if (candidate.accepted !== null) {
      throw new TaxonomyClassificationCandidateDecidedError();
    }
    return transactions.run(async (tx) => {
      const decided = await runs.decideCandidate(tx, {
        runId: run.id,
        nodeId: command.nodeId,
        accepted: false,
        decidedByUserId: command.actor.userId,
        decidedAt: occurredNow(),
      });
      if (!decided) {
        throw new TaxonomyClassificationCandidateDecidedError();
      }
      const updated = await runs.findCandidate(tx.sql, run.id, command.nodeId);
      if (updated === null) {
        throw new TaxonomyClassificationCandidateNotFoundError();
      }
      return updated;
    });
  };
}
