import type { CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { EvidenceRepositories } from "@capital-q/evidence";
import type {
  EvidenceItem,
  EvidenceSource,
} from "@capital-q/evidence/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { ContradictionRepository } from "../infrastructure/postgres-contradiction-repository.js";
import type { KnowledgeRepository } from "../infrastructure/postgres-knowledge-repository.js";
import {
  KnowledgeCandidateSchema,
  type KnowledgeCandidateInput,
  type KnowledgeSubjectRef,
  type KnowledgeWriteOutcome,
  type KnowledgeWriteReason,
  type KnowledgeWriteResult,
} from "./contracts.js";
import {
  classifyMateriality,
  compareKnowledge,
  type ComparableKnowledge,
} from "./compatibility.js";
import {
  classifyConfidence,
  derivedKnowledgeSensitivity,
  derivedKnowledgeVisibility,
  evidenceStatusForSupport,
  sourceEnvironmentFor,
  truthClassForKnowledge,
} from "./policy.js";
import {
  assessFreshness,
  KNOWLEDGE_FRESHNESS_POLICY_VERSION,
} from "./freshness.js";
import { isCorrectionOf, samePeriod } from "./temporal.js";

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
  readonly contradictions: ContradictionRepository;
  readonly evidence: EvidenceRepositories;
  readonly logger?: Logger | undefined;
};

export type KnowledgeWriteCommand = {
  readonly actor: ActorContext;
  readonly candidate: KnowledgeCandidateInput;
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
  /**
   * The freshness sweep (§21-§23, §29). Marks understandings that have
   * outlived the useful life their key's policy declares.
   *
   * It changes lifecycle, never content and never permission: the statement
   * stands, the value stands, the scope stands, and what changes is that
   * Capital Q stops offering a five-month-old balance as an answer to "how
   * much cash do you have". A key with no declared policy never ages here,
   * because a TTL nobody can defend is a fact nobody measured.
   */
  readonly reassessForFreshness: (input: {
    readonly actor: ActorContext;
    readonly subject: KnowledgeSubjectRef;
    readonly now?: Date | undefined;
  }) => Promise<readonly KnowledgeWriteResult[]>;
  /**
   * Settling a recorded disagreement (§17-§20).
   *
   * A person decides, never this code and never a model: choosing between
   * two readings of a company's own numbers is commercial authority, and
   * nothing about being newer, larger or better evidenced transfers it.
   * Every member survives the decision — the reading that was not chosen
   * becomes SUPERSEDED, which is a record of having been considered, not an
   * erasure.
   */
  readonly settleContradiction: (input: {
    readonly actor: ActorContext;
    readonly setId: string;
    readonly status: "RESOLVED" | "ACCEPTED_DIFFERENCE" | "SUPERSEDED";
    readonly reason: string;
    /** The reading that stands. Required to RESOLVE, absent otherwise. */
    readonly chosenObjectId?: string | undefined;
  }) => Promise<ContradictionSettlement>;
};

/** What settling a disagreement did. Codes and ids; never a value. */
export type ContradictionSettlement = {
  readonly outcome: "SETTLED" | "REFUSED";
  readonly reason:
    | "SETTLED"
    | "NOT_FOUND"
    | "NOT_A_HUMAN_DECISION"
    | "CHOICE_NOT_A_MEMBER"
    | "CHOICE_REQUIRED";
  readonly setId: string;
  readonly standingObjectId: string | null;
  readonly supersededObjectIds: readonly string[];
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
    contradictionSetId: null,
    comparison: null,
  };
}

export function createKnowledgeWriteGate(
  dependencies: KnowledgeWriteGateDependencies,
): KnowledgeWriteGate {
  const { sql, transactions, knowledge, contradictions, evidence, logger } =
    dependencies;
  const meter = getMeter("@capital-q/q-knowledge");
  const metrics = {
    candidates: meter.createCounter("q.knowledge.candidates"),
    accepted: meter.createCounter("q.knowledge.accepted"),
    revised: meter.createCounter("q.knowledge.revised"),
    held: meter.createCounter("q.knowledge.held"),
    duplicate: meter.createCounter("q.knowledge.duplicate"),
    rejected: meter.createCounter("q.knowledge.rejected"),
    reassessed: meter.createCounter("q.knowledge.reassessment_required"),
    contradictions: meter.createCounter("q.knowledge.contradictions_opened"),
    acceptedDifferences: meter.createCounter(
      "q.knowledge.accepted_differences",
    ),
    corrections: meter.createCounter("q.knowledge.corrections"),
    stale: meter.createCounter("q.knowledge.stale"),
    settled: meter.createCounter("q.knowledge.contradictions_settled"),
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

      // ---- comparison (§11-§14) -----------------------------------------
      // The question is never "is this number different". It is "is this the
      // same question, asked of the same period, measured the same way, and
      // still answered differently" — and only the last of those is a
      // disagreement. Everything before it is a series, a definition or a
      // projection, and calling any of them a contradiction would report a
      // company's own growth back to it as an inconsistency.
      const nowIso = new Date().toISOString();
      const proposed: ComparableKnowledge = {
        knowledgeKey: candidate.knowledgeKey,
        definitionQualifier: candidate.definitionQualifier,
        measurementBasis: candidate.measurementBasis,
        structuredValue: candidate.structuredValue,
        validFrom: candidate.validFrom,
        validTo: candidate.validTo,
        recordedAt: nowIso,
      };

      // The row the unique index protects: same metric, same definition,
      // same basis, same period. Anything else is a different slot and
      // coexists.
      const occupant = await knowledge.findActiveForPeriod(
        sql,
        actor.tenantId,
        candidate.subject,
        {
          knowledgeKey: candidate.knowledgeKey,
          definitionQualifier: candidate.definitionQualifier,
          measurementBasis: candidate.measurementBasis,
          validFrom: candidate.validFrom,
        },
      );
      const comparison =
        occupant === null
          ? null
          : compareKnowledge(proposed, {
              knowledgeKey: occupant.knowledgeKey,
              definitionQualifier: occupant.definitionQualifier,
              measurementBasis: occupant.measurementBasis,
              structuredValue: occupant.structuredValue,
              validFrom: occupant.validFrom,
              validTo: occupant.validTo,
              recordedAt: occupant.recordedAt,
            });

      // Nothing occupies this slot, but something else may already answer
      // this key for another period, definition or basis. That is not a
      // conflict and does not change what is written — it changes what the
      // caller is told, so "recorded beside the gross figure" does not read
      // as "recorded, and we ignored the other one".
      const siblings =
        occupant !== null
          ? []
          : (
              await knowledge.listSeries(
                sql,
                actor.tenantId,
                candidate.subject,
                candidate.knowledgeKey,
              )
            ).filter((existing) => existing.status === "ACTIVE");
      // A reading about the same period explains the difference precisely —
      // it is the definition or the basis, and saying "different period"
      // instead would name the wrong axis. Failing that, the most recent.
      const neighbour =
        siblings.find((existing) => samePeriod(proposed, existing)) ??
        siblings[0] ??
        null;
      const neighbourComparison =
        neighbour === null
          ? null
          : compareKnowledge(proposed, {
              knowledgeKey: neighbour.knowledgeKey,
              definitionQualifier: neighbour.definitionQualifier,
              measurementBasis: neighbour.measurementBasis,
              structuredValue: neighbour.structuredValue,
              validFrom: neighbour.validFrom,
              validTo: neighbour.validTo,
              recordedAt: neighbour.recordedAt,
            });
      const differenceReason: KnowledgeWriteReason | null =
        neighbourComparison?.verdict === "ACCEPTED_DIFFERENCE"
          ? "DIFFERENT_DEFINITION"
          : neighbourComparison?.verdict === "DIFFERENT_BASIS"
            ? "DIFFERENT_BASIS"
            : neighbourComparison?.verdict === "DIFFERENT_PERIOD"
              ? "DIFFERENT_PERIOD"
              : null;

      const conflicts = comparison?.verdict === "CONTRADICTION";
      const incomparable = comparison?.verdict === "INCOMPARABLE";
      const agrees = comparison?.verdict === "SAME";
      // A correction restates a period already recorded. It supersedes the
      // earlier reading rather than competing with it, and the earlier
      // reading survives as what the period looked like before.
      const corrects =
        occupant !== null &&
        (conflicts || incomparable) &&
        candidate.correctsEarlier === true &&
        isCorrectionOf(proposed, {
          validFrom: occupant.validFrom,
          validTo: occupant.validTo,
          recordedAt: occupant.recordedAt,
        });

      const confidence = classifyConfidence({
        truthClass,
        evidenceStatus,
        distinctSourceCount: distinctSourceIds.size,
        // A correction is not a disagreement: the subject said which reading
        // stands, so confidence is not reduced for having been told.
        hasContradictingEvidence: (conflicts || incomparable) && !corrects,
        supportWithdrawn: false,
      });

      // ---- automatic vs confirmed (§11) ------------------------------------
      // An inference is Q's own conclusion, so a person decides whether
      // Capital Q adopts it. A conflicting candidate is held because nothing
      // here is allowed to choose between two readings. Everything else
      // becomes ACTIVE only when the caller says the write is automatic.
      const holdReason: KnowledgeWriteReason | null =
        conflicts && !corrects
          ? "CONFLICTS_WITH_ACTIVE"
          : incomparable && !corrects
            ? "NOT_COMPARABLE"
            : truthClass === "Q_INFERENCE"
              ? "INFERENCE_NEEDS_CONFIRMATION"
              : command.automatic === true
                ? null
                : "INFERENCE_NEEDS_CONFIRMATION";

      const result = await transactions.run(async (tx) => {
        if (occupant !== null && agrees) {
          // The same understanding, said again. Link whatever new evidence
          // arrived with it and leave the object alone.
          for (const item of evidenceItems) {
            await knowledge.linkEvidence(tx, {
              tenantId: actor.tenantId,
              objectId: occupant.id,
              evidenceItemId: item.id,
              relationship: "SUPPORTS",
            });
          }
          for (const id of distinctSourceIds) {
            await knowledge.linkSource(tx, {
              tenantId: actor.tenantId,
              objectId: occupant.id,
              sourceId: id,
            });
          }
          const links = await knowledge.listSourceIds(
            tx.sql,
            actor.tenantId,
            occupant.id,
          );
          const restated = evidenceStatusForSupport({
            supportingEvidenceCount: evidenceItems.length,
            distinctSourceCount: links.length,
            strongestInputStatus,
          });
          if (restated === occupant.evidenceStatus) {
            return {
              outcome: "DUPLICATE" as const,
              reason: "UNCHANGED" as const,
              object: occupant,
              revisionNumber: occupant.currentRevisionNumber,
              sourceCount: links.length,
              contradictionSetId: null,
            };
          }
          // More independent support changes what Capital Q can honestly
          // say about how well evidenced this is, so it is a revision.
          const revised = await knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: occupant.id,
            statement: occupant.statement,
            structuredValue: occupant.structuredValue,
            truthClass: occupant.truthClass,
            evidenceStatus: restated,
            confidenceClass: classifyConfidence({
              truthClass: occupant.truthClass,
              evidenceStatus: restated,
              distinctSourceCount: links.length,
              hasContradictingEvidence: false,
              supportWithdrawn: false,
            }).confidenceClass,
            validFrom: occupant.validFrom,
            validTo: occupant.validTo,
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
            contradictionSetId: null,
          };
        }

        if (corrects && occupant !== null) {
          // Order matters: one ACTIVE row is permitted per period, and the
          // correction is about to take that slot. The earlier reading is
          // marked superseded rather than deleted — it is what the period
          // looked like before the correction, and a company that fixes a
          // typo must not lose the record of having fixed it.
          await knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: occupant.id,
            statement: occupant.statement,
            structuredValue: occupant.structuredValue,
            truthClass: occupant.truthClass,
            evidenceStatus: occupant.evidenceStatus,
            confidenceClass: occupant.confidenceClass,
            validFrom: occupant.validFrom,
            validTo: occupant.validTo,
            changeReason: "CORRECTED_BY_LATER_REVISION",
            createdByType: actor.actorType === "HUMAN" ? "USER" : "SYSTEM",
            createdById: actor.userId,
            status: "SUPERSEDED",
          });
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
          definitionQualifier: candidate.definitionQualifier,
          measurementBasis: candidate.measurementBasis,
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
        if (corrects && occupant !== null) {
          // The two are linked, so a correction can always be traced to what
          // it fixed and neither reading can be read without the other.
          await knowledge.linkLineage(tx, {
            tenantId: actor.tenantId,
            parentObjectId: occupant.id,
            childObjectId: created.id,
            relationship: "supersedes",
          });
          return {
            outcome: "CORRECTED" as const,
            reason: "CORRECTS_EARLIER_PERIOD" as const,
            object: created,
            revisionNumber: created.currentRevisionNumber,
            sourceCount: distinctSourceIds.size,
            contradictionSetId: null,
          };
        }

        if ((conflicts || incomparable) && occupant !== null) {
          // Both readings now exist and neither was chosen. The larger number
          // was not preferred and neither was the newer one; the disagreement
          // is recorded so a person can settle it, and the incumbent stops
          // claiming a confidence it no longer has.
          //
          // The set inherits its members' classification. "These two figures
          // conflict" can disclose as much as the figures do, so it is never
          // filed more openly than what it is about (§51).
          const set = await contradictions.openOrJoin(tx, {
            tenantId: actor.tenantId,
            subject: candidate.subject,
            knowledgeKey: candidate.knowledgeKey,
            definitionQualifier: candidate.definitionQualifier,
            measurementBasis: candidate.measurementBasis,
            contestedFrom: candidate.validFrom,
            conflictKind: comparison?.conflictKind ?? "VALUE_MISMATCH",
            materiality:
              comparison === null
                ? "UNDETERMINED"
                : classifyMateriality(comparison),
            visibilityScope: derivedKnowledgeVisibility([
              visibilityScope,
              occupant.visibilityScope,
            ]),
            sensitivityClass: derivedKnowledgeSensitivity([
              sensitivityClass,
              occupant.sensitivityClass,
            ]),
            incumbentObjectId: occupant.id,
            challengerObjectId: created.id,
          });
          await knowledge.linkLineage(tx, {
            tenantId: actor.tenantId,
            parentObjectId: occupant.id,
            childObjectId: created.id,
            relationship: "reassesses",
          });
          if (occupant.confidenceClass !== "CONFLICTING_EVIDENCE") {
            await knowledge.revise(tx, {
              tenantId: actor.tenantId,
              objectId: occupant.id,
              statement: occupant.statement,
              structuredValue: occupant.structuredValue,
              truthClass: occupant.truthClass,
              evidenceStatus: occupant.evidenceStatus,
              confidenceClass: "CONFLICTING_EVIDENCE",
              validFrom: occupant.validFrom,
              validTo: occupant.validTo,
              changeReason: "CONFLICTING_CANDIDATE",
              createdByType: "SYSTEM",
              createdById: actor.userId,
              status: "DISPUTED",
              reassessmentReason: "CONFLICTING_CANDIDATE",
            });
          }
          metrics.contradictions.add(1, {
            kind: comparison?.conflictKind ?? "VALUE_MISMATCH",
          });
          return {
            outcome: "HELD" as const,
            reason: holdReason ?? ("CONFLICTS_WITH_ACTIVE" as const),
            object: created,
            revisionNumber: created.currentRevisionNumber,
            sourceCount: distinctSourceIds.size,
            contradictionSetId: set.id,
          };
        }
        return {
          outcome: (holdReason !== null
            ? "HELD"
            : differenceReason !== null
              ? "ACCEPTED_DIFFERENCE"
              : "ACCEPTED") as KnowledgeWriteOutcome,
          reason: holdReason ?? differenceReason ?? ("RECORDED" as const),
          object: created,
          revisionNumber: created.currentRevisionNumber,
          sourceCount: distinctSourceIds.size,
          contradictionSetId: null,
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
        contradictionSetId: result.contradictionSetId,
        // The axis that decided, as a code. Never the value that differed:
        // "VALUE_MISMATCH" is safe to log, "2.4m versus 1.8m" is the figure.
        comparison: (comparison ?? neighbourComparison)?.reason ?? null,
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
          case "ACCEPTED_DIFFERENCE":
            metrics.acceptedDifferences.add(1, labels);
            break;
          case "CORRECTED":
            metrics.corrections.add(1, labels);
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
          contradictionSetId: null,
          comparison: null,
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

    reassessForFreshness: async ({ actor, subject, now }) => {
      const objects = await knowledge.listActiveForSubject(
        sql,
        actor.tenantId,
        subject,
      );
      const results: KnowledgeWriteResult[] = [];
      for (const object of objects) {
        const freshness = assessFreshness(
          {
            knowledgeKey: object.knowledgeKey,
            validFrom: object.validFrom,
            recordedAt: object.recordedAt,
            lastVerifiedAt: object.lastVerifiedAt,
          },
          now ?? new Date(),
        );
        if (!freshness.stale) {
          continue;
        }
        const revised = await transactions.run((tx) =>
          knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: object.id,
            // Unchanged. Age is not a correction, and rewriting the
            // statement would turn "we last checked in May" into "May was
            // wrong".
            statement: object.statement,
            structuredValue: object.structuredValue,
            truthClass: object.truthClass,
            evidenceStatus: object.evidenceStatus,
            confidenceClass: object.confidenceClass,
            validFrom: object.validFrom,
            validTo: object.validTo,
            changeReason: "EXCEEDED_USEFUL_LIFE",
            createdByType: "SYSTEM",
            createdById: actor.userId,
            status: "STALE",
            reassessmentReason: "EXCEEDED_USEFUL_LIFE",
          }),
        );
        metrics.stale.add(1, { key: object.knowledgeKey });
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
          supportingSourceCount: 0,
          contradictionSetId: null,
          comparison: null,
        });
      }
      logger?.info(
        {
          examined: objects.length,
          stale: results.length,
          policyVersion: KNOWLEDGE_FRESHNESS_POLICY_VERSION,
        },
        "knowledge freshness reassessed",
      );
      return results;
    },

    settleContradiction: async ({
      actor,
      setId,
      status,
      reason,
      chosenObjectId,
    }) => {
      const refused = (
        why: ContradictionSettlement["reason"],
      ): ContradictionSettlement => ({
        outcome: "REFUSED",
        reason: why,
        setId,
        standingObjectId: null,
        supersededObjectIds: [],
      });
      // Commercial authority (§18). A worker may open a disagreement; only a
      // person may say which reading of a company's numbers stands.
      if (actor.actorType !== "HUMAN") {
        return refused("NOT_A_HUMAN_DECISION");
      }
      if (status === "RESOLVED" && chosenObjectId === undefined) {
        return refused("CHOICE_REQUIRED");
      }
      const members = await contradictions.listMembers(
        sql,
        actor.tenantId,
        setId,
      );
      if (members.length === 0) {
        return refused("NOT_FOUND");
      }
      if (
        chosenObjectId !== undefined &&
        !members.some((member) => member.knowledgeObjectId === chosenObjectId)
      ) {
        return refused("CHOICE_NOT_A_MEMBER");
      }
      const objects = await contradictions.listMemberObjects(
        sql,
        actor.tenantId,
        setId,
      );
      const superseded: string[] = [];
      await transactions.run(async (tx) => {
        for (const object of objects) {
          const stands = object.id === chosenObjectId;
          // ACCEPTED_DIFFERENCE settles the argument without choosing:
          // both readings were legitimate and both stay as they are.
          if (status === "ACCEPTED_DIFFERENCE") {
            continue;
          }
          if (!stands) {
            superseded.push(object.id);
          }
          await knowledge.revise(tx, {
            tenantId: actor.tenantId,
            objectId: object.id,
            statement: object.statement,
            structuredValue: object.structuredValue,
            truthClass: object.truthClass,
            evidenceStatus: object.evidenceStatus,
            // The chosen reading is no longer contradicted; the other is
            // kept, and is not relabelled false for having lost.
            confidenceClass: stands
              ? classifyConfidence({
                  truthClass: object.truthClass,
                  evidenceStatus: object.evidenceStatus,
                  distinctSourceCount: 1,
                  hasContradictingEvidence: false,
                  supportWithdrawn: false,
                }).confidenceClass
              : object.confidenceClass,
            validFrom: object.validFrom,
            validTo: object.validTo,
            changeReason: reason,
            createdByType: "USER",
            createdById: actor.userId,
            status: stands ? "ACTIVE" : "SUPERSEDED",
          });
        }
        await contradictions.settle(tx, {
          tenantId: actor.tenantId,
          setId,
          status,
          reason,
        });
      });
      metrics.settled.add(1, { status });
      logger?.info(
        { setId, status, reason, members: objects.length },
        "contradiction settled",
      );
      return {
        outcome: "SETTLED",
        reason: "SETTLED",
        setId,
        standingObjectId: chosenObjectId ?? null,
        supersededObjectIds: superseded,
      };
    },
  };
}
