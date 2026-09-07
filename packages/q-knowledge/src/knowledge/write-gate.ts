import type { CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { EvidenceRepositories } from "@capital-q/evidence";
import type {
  EvidenceItem,
  EvidenceSource,
} from "@capital-q/evidence/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { KnowledgeRepository } from "../infrastructure/postgres-knowledge-repository.js";
import {
  KnowledgeCandidateSchema,
  type KnowledgeCandidate,
  type KnowledgeWriteReason,
  type KnowledgeWriteResult,
} from "./contracts.js";
import {
  classifyConfidence,
  derivedKnowledgeSensitivity,
  derivedKnowledgeVisibility,
  evidenceStatusForSupport,
  knowledgeValuesAgree,
  sourceEnvironmentFor,
  truthClassForKnowledge,
} from "./policy.js";

/**
 * The Knowledge Write Gate (CQ-KNW-002 §8, §11, §24-§33).
 *
 * The pipeline below is the packet, and it is the only order this file can
 * express. There is no second path into `q_knowledge.objects`:
 *
 *   candidate → schema → subject → provenance identity → tenant/ownership →
 *   scope and visibility → truth class → evidence links → temporal validity
 *   → sensitivity → contradiction pre-check → confidence classification →
 *   persist | hold | reject
 *
 * Three properties matter more than the rest.
 *
 * A candidate cannot create authority by naming a thing. Claim, evidence and
 * source ids are looked up in the ACTOR's tenant and checked against the
 * candidate's subject; an id that does not resolve there is not a
 * permissions failure to be worked around, it is a candidate with no
 * provenance, and nothing is written.
 *
 * Visibility and sensitivity are derived from the inputs, not proposed. The
 * candidate type has no field for either. Visibility takes the NARROWEST
 * input scope and sensitivity the STRONGEST input class, so an understanding
 * drawn partly from founder-private material is founder-private material.
 *
 * Confidence is a category a named rule produced. The candidate has no field
 * for it, HIGH is reachable only from verified evidence, and no percentage
 * exists anywhere in the path.
 */

export type KnowledgeWriteGateDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly knowledge: KnowledgeRepository;
  readonly evidence: EvidenceRepositories;
  readonly logger?: Logger | undefined;
};

export type KnowledgeWriteCommand = {
  readonly actor: ActorContext;
  readonly candidate: KnowledgeCandidate;
  readonly correlationId: CorrelationId;
  /**
   * Whether a well-supported source assertion may become ACTIVE without a
   * person (§11). Deterministic platform facts may; anything a model
   * interpreted from prose should be reviewed, and the caller says which
   * this is. It can only ever make the gate stricter: `true` still has to
   * survive every check below.
   */
  readonly automatic?: boolean | undefined;
};

export type KnowledgeWriteGate = {
  readonly submit: (
    command: KnowledgeWriteCommand,
  ) => Promise<KnowledgeWriteResult>;
  /**
   * The revocation seam (§28, §33). Given evidence that is no longer valid,
   * finds the understandings resting on it and re-derives their confidence.
   * It does not delete knowledge and it does not recalculate anything
   * downstream of knowledge; it makes sure nothing keeps looking supported
   * after its support disappeared.
   */
  readonly reassessForWithdrawnEvidence: (input: {
    readonly actor: ActorContext;
    readonly evidenceItemIds: readonly string[];
    readonly reason: string;
  }) => Promise<readonly KnowledgeWriteResult[]>;
};

function refuse(
  knowledgeKey: string,
  reason: KnowledgeWriteReason,
): KnowledgeWriteResult {
  return {
    outcome: "REJECTED",
    reason,
    knowledgeKey,
    objectId: null,
    status: null,
    truthClass: null,
    evidenceStatus: null,
    confidenceClass: null,
    visibilityScope: null,
    sensitivityClass: null,
    revisionNumber: null,
    supportingSourceCount: 0,
  };
}

export function createKnowledgeWriteGate(
  dependencies: KnowledgeWriteGateDependencies,
): KnowledgeWriteGate {
  const { sql, transactions, knowledge, evidence, logger } = dependencies;
  const meter = getMeter("@capital-q/q-knowledge");
  const metrics = {
    candidates: meter.createCounter("q.knowledge.candidates"),
    accepted: meter.createCounter("q.knowledge.accepted"),
    revised: meter.createCounter("q.knowledge.revised"),
    held: meter.createCounter("q.knowledge.held"),
    duplicate: meter.createCounter("q.knowledge.duplicate"),
    rejected: meter.createCounter("q.knowledge.rejected"),
    reassessed: meter.createCounter("q.knowledge.reassessment_required"),
    latencyMs: meter.createHistogram("q.knowledge.write_latency_milliseconds"),
  };

  return {
    submit: async (command) => {
      const started = Date.now();
      const { actor, correlationId } = command;
      const parsed = KnowledgeCandidateSchema.safeParse(command.candidate);
      if (!parsed.success) {
        metrics.rejected.add(1, { reason: "CANDIDATE_INVALID" });
        return refuse("unknown", "CANDIDATE_INVALID");
      }
      const candidate = parsed.data;
      metrics.candidates.add(1, { type: candidate.knowledgeType });

      // ---- provenance identity, in the actor's tenant only ---------------
      // Every id is resolved here. A candidate naming another tenant's
      // evidence, or evidence about another subject, resolves to nothing:
      // the two are indistinguishable from outside, and both stop.
      const evidenceItems: EvidenceItem[] = [];
      for (const id of candidate.supportingEvidenceItemIds) {
        const item = await evidence.evidenceItems.findById(
          sql,
          actor.tenantId,
          id as never,
        );
        if (
          item === null ||
          item.subjectType !== candidate.subject.subjectType ||
          item.subjectId !== candidate.subject.subjectId
        ) {
          return finish(refuse(candidate.knowledgeKey, "PROVENANCE_NOT_FOUND"));
        }
        evidenceItems.push(item);
      }
      const sources: EvidenceSource[] = [];
      for (const id of candidate.supportingSourceIds) {
        const source = await evidence.sources.findById(
          sql,
          actor.tenantId,
          id as never,
        );
        if (
          source === null ||
          source.subjectType !== candidate.subject.subjectType ||
          source.subjectId !== candidate.subject.subjectId
        ) {
          return finish(refuse(candidate.knowledgeKey, "PROVENANCE_NOT_FOUND"));
        }
        sources.push(source);
      }
      for (const id of candidate.supportingClaimIds) {
        const claim = await evidence.claims.findById(
          sql,
          actor.tenantId,
          id as never,
        );
        if (
          claim === null ||
          claim.subjectType !== candidate.subject.subjectType ||
          claim.subjectId !== candidate.subject.subjectId
        ) {
          return finish(refuse(candidate.knowledgeKey, "PROVENANCE_NOT_FOUND"));
        }
      }

      // ---- no source, no entity knowledge (§32) ---------------------------
      if (evidenceItems.length === 0) {
        // The model may know what ARR means. It may not know THIS company's
        // ARR without something authorised standing behind it.
        return finish(refuse(candidate.knowledgeKey, "NO_SUPPORTING_EVIDENCE"));
      }

      // ---- inheritance, from the inputs and never from the candidate -----
      const inputScopes = [
        ...evidenceItems.map((item) => item.visibilityScope),
        ...sources.map((source) => source.visibilityScope),
      ];
      const inputSensitivities = [
        ...evidenceItems.map((item) => item.sensitivityClass),
        ...sources.map((source) => source.sensitivityClass),
      ];
      const visibilityScope = derivedKnowledgeVisibility(inputScopes);
      const sensitivityClass = derivedKnowledgeSensitivity(inputSensitivities);

      // ---- the three axes -------------------------------------------------
      const distinctSourceIds = new Set([
        ...sources.map((source) => source.id as string),
        ...evidenceItems.map((item) => item.sourceId as string),
      ]);
      const strongestInputStatus = evidenceItems.reduce<
        EvidenceItem["evidenceStatus"] | null
      >(
        (best, item) =>
          best === null || item.evidenceStatus === "MULTI_SOURCE_SUPPORTED"
            ? item.evidenceStatus
            : best,
        null,
      );
      const evidenceStatus = evidenceStatusForSupport({
        supportingEvidenceCount: evidenceItems.length,
        distinctSourceCount: distinctSourceIds.size,
        strongestInputStatus,
      });
      const truthClass = truthClassForKnowledge(
        candidate.truthClassProposal,
        evidenceItems.length,
      );

      // ---- contradiction pre-check (§29) ----------------------------------
      const active = await knowledge.findActiveByKey(
        sql,
        actor.tenantId,
        candidate.subject,
        candidate.knowledgeKey,
      );
      const agrees =
        active !== null &&
        knowledgeValuesAgree(active.structuredValue, candidate.structuredValue);
      const conflicts = active !== null && !agrees;

      const confidence = classifyConfidence({
        truthClass,
        evidenceStatus,
        distinctSourceCount: distinctSourceIds.size,
        hasContradictingEvidence: conflicts,
        supportWithdrawn: false,
      });

      // ---- automatic vs confirmed (§11) ------------------------------------
      // An inference is Q's own conclusion, so a person decides whether
      // Capital Q adopts it. A conflicting candidate is held because nothing
      // here is allowed to choose between two readings. Everything else
      // becomes ACTIVE only when the caller says the write is automatic.
      const holdReason: KnowledgeWriteReason | null = conflicts
        ? "CONFLICTS_WITH_ACTIVE"
        : truthClass === "Q_INFERENCE"
          ? "INFERENCE_NEEDS_CONFIRMATION"
          : command.automatic === true
            ? null
            : "INFERENCE_NEEDS_CONFIRMATION";

      const result = await transactions.run(async (tx) => {
        if (active !== null && agrees) {
          // The same understanding, said again. Link whatever new evidence
          // arrived with it and leave the object alone.
          for (const item of evidenceItems) {
            await knowledge.linkEvidence(tx, {
              tenantId: actor.tenantId,
              objectId: active.id,
              evidenceItemId: item.id,
              relationship: "SUPPORTS",
            });
          }
          for (const id of distinctSourceIds) {
            await knowledge.linkSource(tx, {
              tenantId: actor.tenantId,
              objectId: active.id,
              sourceId: id,
            });
          }
          const links = await knowledge.listSourceIds(
            tx.sql,
            actor.tenantId,
            active.id,
          );
          const restated = evidenceStatusForSupport({
            supportingEvidenceCount: evidenceItems.length,
            distinctSourceCount: links.length,
            strongestInputStatus,
          });
          if (restated === active.evidenceStatus) {
            return {
              outcome: "DUPLICATE" as const,
              reason: "UNCHANGED" as const,
              object: active,
              revisionNumber: active.currentRevisionNumber,
              sourceCount: links.length,
            };
          }
          // More independent support changes what Capital Q can honestly
          // say about how well evidenced this is, so it is a revision.
          const revised = await knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: active.id,
            statement: active.statement,
            structuredValue: active.structuredValue,
            truthClass: active.truthClass,
            evidenceStatus: restated,
            confidenceClass: classifyConfidence({
              truthClass: active.truthClass,
              evidenceStatus: restated,
              distinctSourceCount: links.length,
              hasContradictingEvidence: false,
              supportWithdrawn: false,
            }).confidenceClass,
            validFrom: active.validFrom,
            validTo: active.validTo,
            changeReason: "SUPPORT_CHANGED",
            createdByType: actor.actorType === "HUMAN" ? "USER" : "SYSTEM",
            createdById: actor.userId,
          });
          return {
            outcome: "REVISED" as const,
            reason: "SUPPORT_CHANGED" as const,
            object: revised,
            revisionNumber: revised.currentRevisionNumber,
            sourceCount: links.length,
          };
        }

        const created = await knowledge.insert(tx, {
          tenantId: actor.tenantId,
          subject: candidate.subject,
          knowledgeType: candidate.knowledgeType,
          knowledgeKey: candidate.knowledgeKey,
          statement: candidate.statement,
          structuredValue: candidate.structuredValue,
          truthClass,
          evidenceStatus,
          confidenceClass: confidence.confidenceClass,
          reliabilityClass:
            evidenceItems.find((item) => item.reliabilityClass !== null)
              ?.reliabilityClass ?? null,
          validFrom: candidate.validFrom,
          validTo: candidate.validTo,
          sourceEnvironment: sourceEnvironmentFor(
            sources.map((source) => source.sourceType),
          ),
          visibilityScope,
          sensitivityClass,
          status: holdReason === null ? "ACTIVE" : "CANDIDATE",
          holdReason,
          changeReason: candidate.reason,
          createdByType: actor.actorType === "HUMAN" ? "USER" : "SYSTEM",
          createdById: actor.userId,
        });
        for (const item of evidenceItems) {
          await knowledge.linkEvidence(tx, {
            tenantId: actor.tenantId,
            objectId: created.id,
            evidenceItemId: item.id,
            relationship: "SUPPORTS",
          });
        }
        for (const id of distinctSourceIds) {
          await knowledge.linkSource(tx, {
            tenantId: actor.tenantId,
            objectId: created.id,
            sourceId: id,
          });
        }
        for (const edge of candidate.lineage) {
          const parent = await knowledge.findById(
            tx.sql,
            actor.tenantId,
            edge.parentObjectId,
          );
          // Lineage to something this tenant does not have is not lineage.
          if (parent !== null) {
            await knowledge.linkLineage(tx, {
              tenantId: actor.tenantId,
              parentObjectId: parent.id,
              childObjectId: created.id,
              relationship: edge.relationship,
            });
          }
        }
        if (conflicts && active !== null) {
          // Both readings now exist. The existing understanding keeps its
          // value and its history; what changes is that Capital Q stops
          // claiming to be confident about it. Neither the larger number nor
          // the newer one was preferred, and CQ-KNW-003 resolves it.
          await knowledge.linkLineage(tx, {
            tenantId: actor.tenantId,
            parentObjectId: active.id,
            childObjectId: created.id,
            relationship: "reassesses",
          });
          if (active.confidenceClass !== "CONFLICTING_EVIDENCE") {
            await knowledge.revise(tx, {
              tenantId: actor.tenantId,
              objectId: active.id,
              statement: active.statement,
              structuredValue: active.structuredValue,
              truthClass: active.truthClass,
              evidenceStatus: active.evidenceStatus,
              confidenceClass: "CONFLICTING_EVIDENCE",
              validFrom: active.validFrom,
              validTo: active.validTo,
              changeReason: "CONFLICTING_CANDIDATE",
              createdByType: "SYSTEM",
              createdById: actor.userId,
              reassessmentReason: "CONFLICTING_CANDIDATE",
            });
          }
        }
        return {
          outcome:
            holdReason === null ? ("ACCEPTED" as const) : ("HELD" as const),
          reason: holdReason ?? ("RECORDED" as const),
          object: created,
          revisionNumber: created.currentRevisionNumber,
          sourceCount: distinctSourceIds.size,
        };
      });

      const outcome: KnowledgeWriteResult = {
        outcome: result.outcome,
        reason: result.reason,
        knowledgeKey: candidate.knowledgeKey,
        objectId: result.object.id,
        status: result.object.status,
        truthClass: result.object.truthClass,
        evidenceStatus: result.object.evidenceStatus,
        confidenceClass: result.object.confidenceClass,
        visibilityScope: result.object.visibilityScope,
        sensitivityClass: result.object.sensitivityClass,
        revisionNumber: result.revisionNumber,
        supportingSourceCount: result.sourceCount,
      };
      return finish(outcome);

      function finish(value: KnowledgeWriteResult): KnowledgeWriteResult {
        const labels = { outcome: value.outcome, reason: value.reason };
        switch (value.outcome) {
          case "ACCEPTED":
            metrics.accepted.add(1, labels);
            break;
          case "REVISED":
            metrics.revised.add(1, labels);
            break;
          case "HELD":
            metrics.held.add(1, labels);
            break;
          case "DUPLICATE":
            metrics.duplicate.add(1, labels);
            break;
          case "REJECTED":
            metrics.rejected.add(1, labels);
            break;
        }
        metrics.latencyMs.record(Date.now() - started, labels);
        // Keys, codes and classes. No statement, no structured value, no
        // excerpt: a knowledge log that quotes the understanding is the
        // understanding.
        logger?.info(
          {
            knowledgeKey: value.knowledgeKey,
            outcome: value.outcome,
            reason: value.reason,
            truthClass: value.truthClass,
            evidenceStatus: value.evidenceStatus,
            confidenceClass: value.confidenceClass,
            correlationId,
          },
          "knowledge write gate decided",
        );
        return value;
      }
    },

    reassessForWithdrawnEvidence: async ({
      actor,
      evidenceItemIds,
      reason,
    }) => {
      const dependents = await knowledge.listDependentsOfEvidence(
        sql,
        actor.tenantId,
        evidenceItemIds,
      );
      const withdrawn = new Set(evidenceItemIds);
      const results: KnowledgeWriteResult[] = [];
      for (const object of dependents) {
        const links = await knowledge.listEvidenceLinks(
          sql,
          actor.tenantId,
          object.id,
        );
        const remaining = links.filter(
          (link) =>
            link.relationship === "SUPPORTS" &&
            !withdrawn.has(link.evidenceItemId),
        );
        const sourceIds = await knowledge.listSourceIds(
          sql,
          actor.tenantId,
          object.id,
        );
        const evidenceStatus = evidenceStatusForSupport({
          supportingEvidenceCount: remaining.length,
          distinctSourceCount: remaining.length === 0 ? 0 : sourceIds.length,
          strongestInputStatus: object.evidenceStatus,
        });
        const confidence = classifyConfidence({
          truthClass: object.truthClass,
          evidenceStatus,
          distinctSourceCount: remaining.length === 0 ? 0 : sourceIds.length,
          hasContradictingEvidence: false,
          supportWithdrawn: remaining.length === 0,
        });
        const revised = await transactions.run((tx) =>
          knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: object.id,
            // The understanding is not rewritten. What changes is how well
            // Capital Q can say it is supported, which is the honest edit.
            statement: object.statement,
            structuredValue: object.structuredValue,
            truthClass: object.truthClass,
            evidenceStatus,
            confidenceClass: confidence.confidenceClass,
            validFrom: object.validFrom,
            validTo: object.validTo,
            changeReason: reason,
            createdByType: "SYSTEM",
            createdById: actor.userId,
            reassessmentReason: reason,
          }),
        );
        metrics.reassessed.add(1, { reason: confidence.reason });
        results.push({
          outcome: "REVISED",
          reason: "SUPPORT_CHANGED",
          knowledgeKey: revised.knowledgeKey,
          objectId: revised.id,
          status: revised.status,
          truthClass: revised.truthClass,
          evidenceStatus: revised.evidenceStatus,
          confidenceClass: revised.confidenceClass,
          visibilityScope: revised.visibilityScope,
          sensitivityClass: revised.sensitivityClass,
          revisionNumber: revised.currentRevisionNumber,
          supportingSourceCount: sourceIds.length,
        });
      }
      logger?.info(
        {
          withdrawn: evidenceItemIds.length,
          reassessed: results.length,
          reason,
        },
        "knowledge reassessed after evidence withdrawal",
      );
      return results;
    },
  };
}
