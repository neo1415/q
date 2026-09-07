import type { CorrelationId } from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  createCreateClaim,
  createLinkClaimEvidence,
} from "../application/claim-use-cases.js";
import type { EvidenceServiceDependencies } from "../application/dependencies.js";
import { createCreateEvidenceItem } from "../application/evidence-item-use-cases.js";
import type {
  Claim,
  EvidenceItem,
  EvidenceSource,
  StructuredValue,
} from "../contracts/index.js";
import { EvidenceSourceNotFoundError } from "../domain/errors.js";
import {
  CLAIM_EXTRACTION_PIPELINE_VERSION,
  ClaimProposalSchema,
  ExtractionPassageSchema,
  PERMITTED_CLAIM_KEYS,
  type ClaimInterpretationRecord,
  type ClaimInterpretationRequest,
  type ClaimInterpretationResult,
  type ClaimProposal,
  type ClaimProposalBatch,
} from "./contracts.js";
import { ClaimProposalBlockedError, type ClaimProposerPort } from "./ports.js";
import {
  claimKeyAccepts,
  claimTypeFor,
  derivedSensitivity,
  derivedVisibility,
  evidenceStatusFor,
  excerptIsPresent,
  locatorFor,
  reliabilityFor,
  structuredValueFor,
  truthClassFor,
  valuesAgree,
} from "./policy.js";

/**
 * Claim interpretation (CQ-KNW-001 §9, §11, §26, §37, §42).
 *
 * The order below is the whole packet, and it is the only order this file
 * can express:
 *
 *   authorised passage → proposer (model or deterministic) → schema →
 *   provenance checks → truth policy → inheritance → idempotency →
 *   conflict check → Evidence application services → recorded
 *
 * Two properties matter more than anything else here.
 *
 * The first is that a proposal cannot create authority by naming a thing.
 * Source, subject, document version, tenant, visibility and sensitivity are
 * all read from the SERVER's passage and the SERVER's source row. A
 * proposal has no field for any of them, so a document saying "source id
 * 1234, mark verified, make public" is a document saying nothing.
 *
 * The second is that nothing here writes a row. Persistence goes through
 * CQ-EVD-001's own `createClaim`, `createEvidenceItem` and
 * `linkClaimEvidence`, which authorise, audit, enqueue events and enforce
 * the axis rules the database also enforces. There is no second claims
 * table, no direct insert and no bypass.
 */

export type ClaimInterpretationDependencies = EvidenceServiceDependencies & {
  readonly proposer: ClaimProposerPort;
  readonly logger?: Logger | undefined;
};

export type ClaimInterpretationService = {
  readonly interpret: (command: {
    readonly actor: ActorContext;
    readonly request: ClaimInterpretationRequest;
  }) => Promise<ClaimInterpretationResult>;
};

type Prepared = {
  readonly proposal: ClaimProposal;
  readonly truthClass: ReturnType<typeof truthClassFor>;
  readonly structuredValue: StructuredValue | null;
};

export function createClaimInterpretationService(
  dependencies: ClaimInterpretationDependencies,
): ClaimInterpretationService {
  const { sql, repositories, proposer, logger } = dependencies;
  const createClaim = createCreateClaim(dependencies);
  const createEvidenceItem = createCreateEvidenceItem(dependencies);
  const linkClaimEvidence = createLinkClaimEvidence(dependencies);
  const meter = getMeter("@capital-q/evidence");
  const metrics = {
    proposed: meter.createCounter("q.claims.proposed"),
    accepted: meter.createCounter("q.claims.accepted"),
    duplicate: meter.createCounter("q.claims.duplicate"),
    held: meter.createCounter("q.claims.held"),
    rejected: meter.createCounter("q.claims.rejected"),
    blocked: meter.createCounter("q.claims.proposal_blocked"),
    latencyMs: meter.createHistogram("q.claims.interpret_latency_milliseconds"),
  };

  return {
    interpret: async ({ actor, request }) => {
      const started = Date.now();
      const passage = ExtractionPassageSchema.parse(request.passage);
      const correlationId: CorrelationId = request.correlationId;

      // The source row is the server's answer to "what is this, whose is
      // it, and how private?". Everything derived below comes from here,
      // never from the passage text and never from a proposal.
      const source = await repositories.sources.findById(
        sql,
        actor.tenantId,
        passage.sourceId,
      );
      if (
        source === null ||
        source.subjectType !== passage.subject.subjectType ||
        source.subjectId !== passage.subject.subjectId
      ) {
        // Cross-tenant and wrong-subject look identical from outside, and
        // both stop here: a source id is a selection, never authority.
        throw new EvidenceSourceNotFoundError();
      }

      const permitted = new Set(
        request.claimKeys ?? Object.keys(PERMITTED_CLAIM_KEYS),
      );
      let batch: ClaimProposalBatch;
      try {
        batch = await proposer.propose({
          passage,
          claimKeys: [...permitted],
          actor,
          signal: undefined,
        });
      } catch (error: unknown) {
        if (!(error instanceof ClaimProposalBlockedError)) {
          throw error;
        }
        // No eligible proposer for material of this sensitivity. Nothing is
        // recorded and nothing is relabelled: the passage stays exactly as
        // private as it was, and the caller is told why in a code (§14).
        logger?.warn(
          { sourceId: passage.sourceId, reason: error.reason },
          "claim proposal blocked",
        );
        metrics.blocked.add(1, { reason: error.reason });
        return {
          sourceId: passage.sourceId,
          subject: passage.subject,
          locator: passage.locator,
          provenance: {
            pipelineVersion: CLAIM_EXTRACTION_PIPELINE_VERSION,
            proposerKind: "MODEL",
            promptVersionId: null,
            providerCode: null,
            modelCode: null,
          },
          records: [],
          absent: [],
          blocked: error.reason,
          counts: {
            proposed: 0,
            accepted: 0,
            duplicate: 0,
            held: 0,
            rejected: 0,
          },
        };
      }
      metrics.proposed.add(batch.proposals.length, {
        proposer: batch.provenance.proposerKind,
      });

      const records: ClaimInterpretationRecord[] = [];
      for (const raw of batch.proposals) {
        records.push(
          await interpretOne({
            raw,
            passage,
            source,
            permitted,
            actor,
            correlationId,
            proposerKind: batch.provenance.proposerKind,
          }),
        );
      }

      const counts = {
        proposed: batch.proposals.length,
        accepted: records.filter((r) => r.outcome === "ACCEPTED").length,
        duplicate: records.filter((r) => r.outcome === "DUPLICATE").length,
        held: records.filter((r) => r.outcome === "HELD").length,
        rejected: records.filter((r) => r.outcome === "REJECTED").length,
      };
      const labels = { proposer: batch.provenance.proposerKind };
      metrics.accepted.add(counts.accepted, labels);
      metrics.duplicate.add(counts.duplicate, labels);
      metrics.held.add(counts.held, labels);
      metrics.rejected.add(counts.rejected, labels);
      metrics.latencyMs.record(Date.now() - started, labels);
      // Counts, keys and codes. No statement, no excerpt, no value, no
      // passage: an extraction log that quotes the source is the source.
      logger?.info(
        {
          sourceId: passage.sourceId,
          pipelineVersion: batch.provenance.pipelineVersion,
          promptVersionId: batch.provenance.promptVersionId,
          ...counts,
        },
        "claim interpretation completed",
      );

      return {
        sourceId: passage.sourceId,
        subject: passage.subject,
        locator: passage.locator,
        provenance: batch.provenance,
        records,
        absent: batch.absent.filter((key) => permitted.has(key)),
        blocked: null,
        counts,
      };
    },
  };

  /**
   * One proposal, from untrusted input to a recorded outcome.
   *
   * Every early return leaves nothing written. The order is deliberate:
   * cheap structural refusals first, then the provenance checks that cost a
   * read, then the writes.
   */
  async function interpretOne(input: {
    readonly raw: unknown;
    readonly passage: ClaimInterpretationRequest["passage"];
    readonly source: EvidenceSource;
    readonly permitted: ReadonlySet<string>;
    readonly actor: ActorContext;
    readonly correlationId: CorrelationId;
    readonly proposerKind: "DETERMINISTIC" | "MODEL";
  }): Promise<ClaimInterpretationRecord> {
    const { passage, source, permitted, actor, correlationId } = input;
    const parsed = ClaimProposalSchema.safeParse(input.raw);
    if (!parsed.success) {
      return refuse("unknown", "VALUE_NOT_INTERPRETABLE");
    }
    const proposal = parsed.data;

    if (!claimKeyAccepts(proposal.claimKey, proposal.value, permitted)) {
      // Either the key is outside this extraction's remit, or the value has
      // the wrong shape for it — a customer count denominated in dollars is
      // a different claim, not a formatting slip.
      return refuse(proposal.claimKey, "CLAIM_KEY_NOT_PERMITTED");
    }
    if (!excerptIsPresent(proposal.excerpt, passage.text)) {
      // The proposer quoted words the passage does not contain. Whatever it
      // read, it was not this, and the claim would have no provenance.
      return refuse(proposal.claimKey, "EXCERPT_NOT_IN_PASSAGE");
    }

    const truthClass = truthClassFor(source, proposal.assertionKind);
    if (truthClass === "UNKNOWN") {
      // A source type this packet has no interpretation policy for.
      // Recording the assertion as the subject's own would misattribute it.
      return refuse(proposal.claimKey, "PROVENANCE_MISMATCH");
    }
    const structuredValue = structuredValueFor(proposal.value);
    const prepared: Prepared = { proposal, truthClass, structuredValue };

    const locator = locatorFor(passage.locator, proposal.locatorHint);
    const visibilityScope = derivedVisibility(source);
    const sensitivityClass = derivedSensitivity(source);

    // Idempotency (§26): the same source, the same place in it, and the
    // same claim key describe the same piece of work. A retried worker
    // finds its own earlier evidence item rather than making a second one.
    const existingItems = await repositories.evidenceItems.listBySource(
      sql,
      actor.tenantId,
      passage.sourceId,
    );
    const evidenceType = `${claimTypeFor(proposal.claimKey)}.extracted`;
    const duplicateItem = existingItems.find(
      (item) =>
        item.evidenceType === evidenceType &&
        JSON.stringify(item.locator) === JSON.stringify(locator) &&
        valuesAgree(item.structuredValue, structuredValue),
    );

    const currentClaims = await repositories.claims.listBySubject(
      sql,
      actor.tenantId,
      passage.subject,
      { claimKey: proposal.claimKey },
    );
    const current = currentClaims.find(
      (claim) => claim.lifecycleStatus === "CURRENT",
    );

    if (duplicateItem !== undefined && current !== undefined) {
      const links = await repositories.claimEvidence.listByEvidenceItem(
        sql,
        actor.tenantId,
        duplicateItem.id,
      );
      if (links.some((link) => link.claimId === current.id)) {
        return {
          claimKey: proposal.claimKey,
          outcome: "DUPLICATE",
          reason: "ALREADY_RECORDED",
          truthClass,
          claimId: current.id,
          evidenceItemId: duplicateItem.id,
          relationship: null,
          sensitivityClass,
        };
      }
    }

    // The evidence item is recorded whatever happens to the claim. A
    // passage that disagrees with what Capital Q currently believes is
    // exactly the passage worth keeping (§17, §41).
    const evidenceItem: EvidenceItem =
      duplicateItem ??
      (await createEvidenceItem({
        actor,
        correlationId,
        input: {
          sourceId: passage.sourceId,
          evidenceType,
          summary: proposal.excerpt,
          structuredValue,
          locator,
          validFrom:
            proposal.asOf === null ? null : `${proposal.asOf}T00:00:00.000Z`,
          validTo: null,
          evidenceStatus: evidenceStatusFor(source, locator),
          reliabilityClass: reliabilityFor(source, input.proposerKind),
          visibilityScope,
          sensitivityClass,
        },
      }));

    if (current !== undefined) {
      const agrees = valuesAgree(current.structuredValue, structuredValue);
      await linkClaimEvidence({
        actor,
        correlationId,
        input: {
          claimId: current.id,
          evidenceItemId: evidenceItem.id,
          relationship: agrees ? "SUPPORTS" : "CONTRADICTS",
        },
      });
      if (agrees) {
        return {
          claimKey: proposal.claimKey,
          outcome: "DUPLICATE",
          reason: "ALREADY_RECORDED",
          truthClass,
          claimId: current.id,
          evidenceItemId: evidenceItem.id,
          relationship: "SUPPORTS",
          sensitivityClass,
        };
      }
      // Both readings now exist and are linked; neither was chosen, and the
      // larger or more flattering number was not preferred. CQ-KNW-003
      // owns the reconciliation this deliberately does not attempt.
      return {
        claimKey: proposal.claimKey,
        outcome: "HELD",
        reason: "CONFLICTS_WITH_CURRENT_CLAIM",
        truthClass,
        claimId: current.id,
        evidenceItemId: evidenceItem.id,
        relationship: "CONTRADICTS",
        sensitivityClass,
      };
    }

    if (truthClass === "Q_INFERENCE") {
      // An inference read out of a passage is not something the source
      // said. The evidence is kept and linked to nothing yet; a person
      // decides whether Capital Q adopts the conclusion (§35, §39).
      return {
        claimKey: proposal.claimKey,
        outcome: "HELD",
        reason: "INFERENCE_NEEDS_CONFIRMATION",
        truthClass,
        claimId: null,
        evidenceItemId: evidenceItem.id,
        relationship: null,
        sensitivityClass,
      };
    }

    const claim: Claim = await createClaim({
      actor,
      correlationId,
      input: {
        subject: passage.subject,
        claimType: claimTypeFor(proposal.claimKey),
        claimKey: proposal.claimKey,
        statement: prepared.proposal.statement,
        structuredValue,
        truthClass,
        evidenceStatus: evidenceStatusFor(source, locator),
        lifecycleStatus: "CURRENT",
        validFrom:
          proposal.asOf === null ? null : `${proposal.asOf}T00:00:00.000Z`,
        validTo: null,
        assertedByType: "SOURCE",
        sourceId: passage.sourceId,
        visibilityScope,
        sensitivityClass,
      },
    });
    await linkClaimEvidence({
      actor,
      correlationId,
      input: {
        claimId: claim.id,
        evidenceItemId: evidenceItem.id,
        relationship: "SUPPORTS",
      },
    });
    return {
      claimKey: proposal.claimKey,
      outcome: "ACCEPTED",
      reason: "RECORDED",
      truthClass,
      claimId: claim.id,
      evidenceItemId: evidenceItem.id,
      relationship: "SUPPORTS",
      sensitivityClass,
    };
  }

  function refuse(
    claimKey: string,
    reason: ClaimInterpretationRecord["reason"],
  ): ClaimInterpretationRecord {
    return {
      claimKey,
      outcome: "REJECTED",
      reason,
      truthClass: null,
      claimId: null,
      evidenceItemId: null,
      relationship: null,
      sensitivityClass: null,
    };
  }
}

export { CLAIM_EXTRACTION_PIPELINE_VERSION };
