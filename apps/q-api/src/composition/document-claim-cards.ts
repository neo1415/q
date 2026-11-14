import { randomUUID } from "node:crypto";

import { COMPANY_FIGURE_ACTION_TYPE } from "@capital-q/app-actions";
import {
  CorrelationIdSchema,
  QConversationIdSchema,
  type ModelSensitivity,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  ClaimProposalBlockedError,
  DOCUMENT_FIGURE_CLAIM_KEYS,
  documentFigureProposals,
  documentFigureWords,
  ExtractionPassageSchema,
  type ClaimProposerPort,
  type DocumentFigurePassage,
  type DocumentFigureProposal,
  type DocumentFigureSource,
  type EvidenceService,
  type StatedFigure,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import type { QActionService } from "@capital-q/q-actions";
import { selectReadingPassages } from "@capital-q/q-knowledge";
import {
  runRef,
  type QOrchestrationRuntime,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * A8: a founder's own document becomes PROPOSED figures, and each becomes
 * their claim only when they confirm its card.
 *
 * When the workers announce a document is read (`evidence.document.ready`,
 * the same wake D82 uses), this job, never a chat turn, reads the
 * company's current pitch deck (or company profile) version once:
 *
 *   1. The document's own passages (the chunks the pipeline stored), as
 *      the person who uploaded it, still a member of the owning
 *      organisation (a removed person is not acted for).
 *   2. A DOCUMENT evidence source for that version is registered, private
 *      to the organisation. It is provenance ("Capital Q read this
 *      version for figures") and the once-only marker; it asserts nothing.
 *   3. The registered CLAIM_EXTRACTION task through the Model Gateway (by
 *      task class, at the document's own sensitivity: nothing is relabelled
 *      to reach a provider). The text is data inside the untrusted frame.
 *   4. Code keeps only figures the document states on the closed metric
 *      list, quoted in its own words, in their own currency, not dated in
 *      the future; the page is the passage's where the quote was found.
 *   5. Each becomes one `company.figure.record` card in the founder's own
 *      Q conversation, with the document's provenance. Nothing is recorded
 *      until they approve exactly it; dismissing it records nothing.
 *
 * Investors never see a proposal (it is the founder's own card) nor a
 * confirmed figure (organisation_private). Financial documents keep their
 * own deterministic path (local figures), which never sends them to a
 * model (owner, 2026-10-28).
 */

export const DOCUMENT_CLAIMS_ORCHESTRATION_VERSION = "q-document-claims-v1";
/** The once-only marker: one DOCUMENT source per document version. */
export const DOCUMENT_CLAIMS_REFERENCE_PREFIX = "document-claims:";
/** Never a wall of cards from one document. */
export const DOCUMENT_CLAIM_CARDS_MAX = 8;
/** Model calls per document version, each over one passage. */
const PASSAGES_MAX = 3;
/** Under the extraction passage's own cap (8,000). */
const PASSAGE_CHARACTERS = 7_500;

const ELIGIBLE_TYPES = ["PITCH_DECK", "COMPANY_PROFILE"] as const;
const READABLE_SENSITIVITY: ReadonlySet<string> = new Set([
  "PUBLIC",
  "NETWORK_VISIBLE",
  "INTERNAL",
  "CONFIDENTIAL",
]);

export type DocumentClaimTarget = {
  readonly tenantId: string;
  readonly companyId: string;
  readonly organisationId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentType: string;
  readonly title: string;
  readonly uploadedByUserId: string;
  readonly sensitivityClass: ModelSensitivity;
};

export type DocumentClaimChunk = {
  readonly content: string;
  readonly chunkIndex: number;
  readonly role?: "LEAF" | "PARENT" | undefined;
  readonly locator: {
    readonly slide?: number | undefined;
    readonly pageStart?: number | undefined;
    readonly sheet?: string | undefined;
  };
};

export type DocumentClaimCard = {
  readonly payload: Record<string, unknown>;
  readonly words: string;
  readonly key: string;
};

export type DocumentClaimCardsDependencies = {
  /** The document's current version, if it is one this job reads. */
  readonly target: (documentId: string) => Promise<DocumentClaimTarget | null>;
  readonly actorFor: (
    userId: string,
    organisationId: string,
  ) => Promise<ActorContext | null>;
  readonly chunks: (
    target: DocumentClaimTarget,
  ) => Promise<readonly DocumentClaimChunk[]>;
  readonly evidence: Pick<EvidenceService, "registerEvidenceSource">;
  readonly proposer: ClaimProposerPort;
  /** The declared action's card input (null: it does not fit). */
  readonly cardInput: (
    actor: ActorContext,
    proposal: {
      readonly companyId: string;
      readonly figure: StatedFigure;
      readonly document: DocumentFigureSource;
    },
  ) => Promise<Record<string, unknown> | null>;
  readonly propose: (
    actor: ActorContext,
    card: DocumentClaimCard,
    conversationId: string | null,
  ) => Promise<{ readonly conversationId: string | null }>;
  readonly today?: (() => string) | undefined;
  readonly logger?: Logger | undefined;
};

export type DocumentClaimOutcome =
  | { readonly kind: "NOT_ELIGIBLE" }
  | { readonly kind: "NO_TEXT" }
  | { readonly kind: "BLOCKED"; readonly reason: string }
  | {
      readonly kind: "PROPOSED";
      readonly proposals: number;
      readonly cards: number;
    };

/** The page a chunk's text is on, when it has one. */
function pageOf(chunk: DocumentClaimChunk): number | null {
  return chunk.locator.slide ?? chunk.locator.pageStart ?? null;
}

/**
 * The document's passages, in order, at most PASSAGES_MAX groups of at
 * most PASSAGE_CHARACTERS each. Every page gets a share (the end of a deck,
 * where traction and the ask usually are, is read too).
 */
export function documentClaimPassages(chunks: readonly DocumentClaimChunk[]): {
  readonly groups: readonly (readonly DocumentFigurePassage[])[];
} {
  const selected = selectReadingPassages(
    chunks.map((chunk) => ({ ...chunk, role: chunk.role ?? "LEAF" })),
    { maxCharacters: PASSAGES_MAX * PASSAGE_CHARACTERS - 400 },
  ).passages;
  const groups: DocumentFigurePassage[][] = [];
  let current: DocumentFigurePassage[] = [];
  let size = 0;
  for (const chunk of selected) {
    const text = chunk.content.slice(0, PASSAGE_CHARACTERS - 100);
    if (size + text.length + 2 > PASSAGE_CHARACTERS && current.length > 0) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push({ text, page: pageOf(chunk) });
    size += text.length + 2;
  }
  if (current.length > 0) groups.push(current);
  return { groups: groups.slice(0, PASSAGES_MAX) };
}

export function createDocumentClaimCards(
  dependencies: DocumentClaimCardsDependencies,
) {
  const { logger } = dependencies;
  const today =
    dependencies.today ?? (() => new Date().toISOString().slice(0, 10));
  // One reading per version per process, however many wakes arrive.
  const inFlight = new Set<string>();

  async function read(
    target: DocumentClaimTarget,
  ): Promise<DocumentClaimOutcome> {
    const actor = await dependencies.actorFor(
      target.uploadedByUserId,
      target.organisationId,
    );
    if (actor === null || actor.tenantId !== target.tenantId) {
      return { kind: "NOT_ELIGIBLE" };
    }
    const { groups } = documentClaimPassages(await dependencies.chunks(target));
    if (groups.length === 0) return { kind: "NO_TEXT" };
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const source = await dependencies.evidence.registerEvidenceSource({
      actor,
      correlationId,
      input: {
        sourceType: "DOCUMENT",
        subject: { subjectType: "COMPANY", subjectId: target.companyId },
        title: target.title.slice(0, 200),
        externalReference: `${DOCUMENT_CLAIMS_REFERENCE_PREFIX}${target.documentVersionId}`,
        reliabilityClass: "PRIMARY_UNVERIFIED",
        visibilityScope: "organisation_private",
        sensitivityClass: target.sensitivityClass,
        metadata: {
          via: "document_claims",
          documentId: target.documentId,
          documentVersionId: target.documentVersionId,
          documentType: target.documentType,
        },
      },
    });

    const proposals: DocumentFigureProposal[] = [];
    for (const group of groups) {
      const passage = ExtractionPassageSchema.parse({
        sourceId: source.id,
        subject: { subjectType: "COMPANY", subjectId: target.companyId },
        locator: {
          kind: "document",
          documentVersionId: target.documentVersionId,
        },
        text: group
          .map((part) =>
            part.page === null
              ? part.text
              : `[Page ${String(part.page)}]\n${part.text}`,
          )
          .join("\n\n")
          .slice(0, 8_000),
        // Trusted words only: the title is the founder's, so it stays out.
        description:
          target.documentType === "PITCH_DECK"
            ? "The company's own pitch deck, uploaded by its founder."
            : "The company's own company profile, uploaded by its founder.",
      });
      let batch;
      try {
        batch = await dependencies.proposer.propose({
          passage,
          claimKeys: DOCUMENT_FIGURE_CLAIM_KEYS,
          actor,
        });
      } catch (error: unknown) {
        if (error instanceof ClaimProposalBlockedError) {
          // Policy or outage: nothing proposed, and the document stays as
          // private as it was. The source marks it read; say so loudly.
          logger?.error(
            {
              documentVersionId: target.documentVersionId,
              reason: error.reason,
              alert: "DOCUMENT_CLAIMS_BLOCKED",
            },
            "document figures not read: no eligible provider",
          );
          return { kind: "BLOCKED", reason: error.reason };
        }
        throw error;
      }
      proposals.push(
        ...documentFigureProposals({
          proposals: batch.proposals,
          passages: group,
          today: today(),
        }),
      );
    }

    // The same figure read in two passages is one card.
    const unique = new Map<string, DocumentFigureProposal>();
    for (const proposal of proposals) {
      const key = JSON.stringify([
        proposal.figure.metric,
        proposal.figure.asOf,
        proposal.figure.value,
      ]);
      if (!unique.has(key)) unique.set(key, proposal);
    }

    let conversationId: string | null = null;
    let cards = 0;
    for (const proposal of [...unique.values()].slice(
      0,
      DOCUMENT_CLAIM_CARDS_MAX,
    )) {
      const input = await dependencies.cardInput(actor, {
        companyId: target.companyId,
        figure: proposal.figure,
        document: {
          sourceId: source.id,
          documentId: target.documentId,
          documentVersionId: target.documentVersionId,
          page: proposal.page,
          title: target.title.slice(0, 200),
        },
      });
      if (input === null) continue;
      const value = JSON.stringify(proposal.figure.value);
      try {
        const filed = await dependencies.propose(
          actor,
          {
            payload: input,
            words: `From your document: ${documentFigureWords(proposal.figure, { title: target.title.slice(0, 200), page: proposal.page })}`,
            key: `doc-claim:${target.documentVersionId}:${proposal.figure.metric}:${proposal.figure.asOf ?? "undated"}:${value}`,
          },
          conversationId,
        );
        conversationId = filed.conversationId ?? conversationId;
        cards += 1;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, documentVersionId: target.documentVersionId },
          "a document figure card was not proposed",
        );
      }
    }
    // Counts only: no figure, no quote, no document text in a log line.
    logger?.info(
      {
        documentVersionId: target.documentVersionId,
        proposals: unique.size,
        cards,
      },
      "q proposed figures from a founder's document",
    );
    return { kind: "PROPOSED", proposals: unique.size, cards };
  }

  return {
    onDocumentReady: async (
      documentId: string,
    ): Promise<DocumentClaimOutcome> => {
      const target = await dependencies.target(documentId);
      if (target === null || inFlight.has(target.documentVersionId)) {
        return { kind: "NOT_ELIGIBLE" };
      }
      inFlight.add(target.documentVersionId);
      try {
        return await read(target);
      } finally {
        inFlight.delete(target.documentVersionId);
      }
    },
  };
}

/**
 * The document this job reads: the company's current, processed,
 * unblocked pitch deck or company profile version, at a sensitivity a
 * reviewed provider may read, not read for figures before.
 */
export function documentClaimTarget(sql: DatabaseExecutor) {
  return async (documentId: string): Promise<DocumentClaimTarget | null> => {
    const row = (
      await sql<
        {
          tenant_id: string;
          company_id: string;
          owner_organisation_id: string;
          document_id: string;
          version_id: string;
          document_type: string;
          title: string;
          uploaded_by_user_id: string;
          sensitivity_class: string;
        }[]
      >`
        select d.tenant_id, d.company_id, d.owner_organisation_id,
               d.id as document_id, v.id as version_id, d.document_type,
               d.title, v.uploaded_by_user_id, d.sensitivity_class
          from evidence.documents d
          join evidence.document_versions v
            on v.id = d.current_version_id and v.tenant_id = d.tenant_id
         where d.id = ${documentId}
           and d.document_type = any(${[...ELIGIBLE_TYPES]}::text[])
           and d.status = 'ACTIVE'
           and d.company_id is not null
           and v.processing_status = 'COMPLETED'
           and v.malware_scan_status <> 'BLOCKED'
           and not exists (
             select 1 from evidence.sources s
              where s.tenant_id = d.tenant_id
                and s.subject_type = 'COMPANY'
                and s.subject_id = d.company_id
                and s.external_reference =
                    ${DOCUMENT_CLAIMS_REFERENCE_PREFIX} || v.id::text)
         limit 1`
    )[0];
    if (row === undefined || !READABLE_SENSITIVITY.has(row.sensitivity_class)) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      companyId: row.company_id,
      organisationId: row.owner_organisation_id,
      documentId: row.document_id,
      documentVersionId: row.version_id,
      documentType: row.document_type,
      title: row.title,
      uploadedByUserId: row.uploaded_by_user_id,
      sensitivityClass: row.sensitivity_class as ModelSensitivity,
    };
  };
}

/**
 * Files one card in the founder's own Q conversation, as them: a run
 * begun under its own orchestration version (never resumed by the
 * conversational engine), its one proposal through the Approval Engine.
 * The run's idempotency key makes a repeated wake propose nothing new.
 */
export function documentClaimCardProposer(dependencies: {
  readonly runtime: Pick<QRuntimeService, "createRun">;
  readonly orchestration: Pick<
    QOrchestrationRuntime,
    "begin" | "advanceThrough" | "fail"
  >;
  readonly actions: Pick<QActionService, "propose">;
}): DocumentClaimCardsDependencies["propose"] {
  return async (actor, card, conversationId) => {
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const created = await dependencies.runtime.createRun({
      actor,
      input: {
        capability: "PREPARE_ACTION",
        message: { text: card.words.slice(0, 1_000) },
        modality: "TEXT",
        ...(conversationId === null
          ? {}
          : { conversationId: QConversationIdSchema.parse(conversationId) }),
      },
      idempotencyKey: card.key.slice(0, 255),
      correlationId,
    });
    if (!created.created) {
      return { conversationId: created.conversation.id };
    }
    const ref = runRef(created.run);
    await dependencies.orchestration.begin(
      ref,
      DOCUMENT_CLAIMS_ORCHESTRATION_VERSION,
    );
    await dependencies.orchestration.advanceThrough(ref, [
      "CONTEXT_RESOLUTION",
      "POLICY_CHECK",
      "PLANNING",
      "SYNTHESIS",
    ]);
    try {
      await dependencies.actions.propose({
        actor,
        runId: created.run.id,
        correlationId,
        actionType: COMPANY_FIGURE_ACTION_TYPE,
        payload: card.payload,
      });
    } catch (error: unknown) {
      await dependencies.orchestration
        .fail(ref, "INTERNAL_ERROR")
        .catch(() => undefined);
      throw error;
    }
    return { conversationId: created.conversation.id };
  };
}
