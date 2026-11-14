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
  type ClaimProposalBlockedReason,
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
 *   2. A DOCUMENT evidence source for that version is registered (once;
 *      a retry reuses it), private to the organisation. It is provenance
 *      ("Capital Q read this version for figures"); it asserts nothing.
 *      Whether the reading FINISHED is the job's own record
 *      (`evidence.document_claim_readings`): a failed call is retried, at
 *      most READING_ATTEMPTS_MAX times, on the document's next wake or when
 *      the wake listener (re)connects; a policy refusal is final. A marker
 *      source with no reading row (versions marked before this record
 *      existed, A8 live 2026-11-14) is retried the same way. Cards are
 *      idempotent per version, metric, date and value, so a retry never
 *      files a second card for the same figure.
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
/** The provenance source: one DOCUMENT source per document version. */
export const DOCUMENT_CLAIMS_REFERENCE_PREFIX = "document-claims:";
/** Readings of one version before Q stops trying (each is up to 3 calls). */
export const READING_ATTEMPTS_MAX = 3;
/** A reading still marked READING this long after it began was cut short. */
const READING_STALE_MINUTES = 15;
/** Versions re-read per catch-up pass: never a burst of model calls. */
const CATCH_UP_MAX = 10;
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
  /** The version's provenance source from an earlier attempt, if any. */
  readonly markerSourceId?: string | null | undefined;
};

/** How a reading ended, for the job's own record. */
export type DocumentClaimReadingEnd =
  | { readonly status: "COMPLETED" }
  | {
      readonly status: "FAILED" | "BLOCKED";
      readonly errorCode: string;
    };

/**
 * The job's record per document version: begun (an attempt counted, or
 * null when it is finished, final, being read, or out of attempts), ended,
 * and which documents a catch-up should read again.
 */
export type DocumentClaimReadings = {
  readonly begin: (
    target: DocumentClaimTarget,
  ) => Promise<{ readonly attempt: number } | null>;
  readonly end: (
    target: DocumentClaimTarget,
    end: DocumentClaimReadingEnd,
  ) => Promise<void>;
  /** Document ids whose current version should be read again. Bounded. */
  readonly pending: (limit: number) => Promise<readonly string[]>;
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
  readonly readings: DocumentClaimReadings;
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
    // The job's record first: an attempt is counted before any model call,
    // and nothing is read that is finished, final, out of attempts or
    // being read by another process.
    const begun = await dependencies.readings.begin(target);
    if (begun === null) return { kind: "NOT_ELIGIBLE" };
    try {
      const outcome = await readGroups(target, actor, groups, begun.attempt);
      return outcome;
    } catch (error: unknown) {
      // Whatever broke, the reading did not finish: say so, so it is
      // retried (bounded) rather than left looking in progress.
      await dependencies.readings
        .end(target, { status: "FAILED", errorCode: "INTERNAL_ERROR" })
        .catch(() => undefined);
      throw error;
    }
  }

  async function readGroups(
    target: DocumentClaimTarget,
    actor: ActorContext,
    groups: readonly (readonly DocumentFigurePassage[])[],
    attempt: number,
  ): Promise<DocumentClaimOutcome> {
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    // One provenance source per version: a retry reuses the earlier one.
    const source =
      target.markerSourceId === undefined || target.markerSourceId === null
        ? await registerSource(target, actor, correlationId)
        : { id: target.markerSourceId };

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
          // Nothing proposed, and the document stays as private as it was.
          // A policy refusal is final; anything else is tried again.
          const final = error.reason === "PROVIDER_INELIGIBLE";
          const retry = !final && attempt < READING_ATTEMPTS_MAX;
          await dependencies.readings.end(target, {
            status: final ? "BLOCKED" : "FAILED",
            errorCode: error.reason,
          });
          // The real reason, said as it is: codes and field paths only.
          logger?.error(
            {
              documentVersionId: target.documentVersionId,
              reason: error.reason,
              failureClass: error.failureClass,
              refusals: error.refusals,
              attempt,
              retry,
              alert: "DOCUMENT_CLAIMS_BLOCKED",
            },
            `document figures not read: ${BLOCKED_WORDS[error.reason]}${retry ? "; it will be read again" : "; not retried"}`,
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
    return fileCards(target, actor, source.id, proposals);
  }

  async function registerSource(
    target: DocumentClaimTarget,
    actor: ActorContext,
    correlationId: ReturnType<typeof CorrelationIdSchema.parse>,
  ): Promise<{ readonly id: string }> {
    return dependencies.evidence.registerEvidenceSource({
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
  }

  async function fileCards(
    target: DocumentClaimTarget,
    actor: ActorContext,
    sourceId: string,
    proposals: readonly DocumentFigureProposal[],
  ): Promise<DocumentClaimOutcome> {
    const source = { id: sourceId };
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
    let unfiled = 0;
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
        unfiled += 1;
        logger?.warn(
          { err: error, documentVersionId: target.documentVersionId },
          "a document figure card was not proposed",
        );
      }
    }
    // A card that did not file is filed on the retry; those that did are
    // not filed twice (each card's run key is its version, metric, date
    // and value).
    await dependencies.readings.end(
      target,
      unfiled === 0
        ? { status: "COMPLETED" }
        : { status: "FAILED", errorCode: "CARD_NOT_FILED" },
    );
    // Counts only: no figure, no quote, no document text in a log line.
    logger?.info(
      {
        documentVersionId: target.documentVersionId,
        proposals: unique.size,
        cards,
        unfiled,
      },
      "q proposed figures from a founder's document",
    );
    return { kind: "PROPOSED", proposals: unique.size, cards };
  }

  async function onDocumentReady(
    documentId: string,
  ): Promise<DocumentClaimOutcome> {
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
  }

  return {
    onDocumentReady,
    /**
     * Reads again the versions whose reading did not finish (a failed
     * call, a reading cut short, a marker from before the job kept its own
     * record), one at a time and bounded. Run when the wake listener
     * (re)connects: wakes sent meanwhile were missed, and a deploy is when
     * a fixed reader should get its second chance. How many proposed.
     */
    retryPending: async (): Promise<number> => {
      const documentIds = await dependencies.readings.pending(CATCH_UP_MAX);
      let read = 0;
      for (const documentId of documentIds) {
        try {
          const outcome = await onDocumentReady(documentId);
          if (outcome.kind === "PROPOSED") read += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, documentId },
            "a document's figures were not read again",
          );
        }
      }
      return read;
    },
  };
}

const BLOCKED_WORDS: Readonly<Record<ClaimProposalBlockedReason, string>> = {
  PROVIDER_INELIGIBLE: "no provider may read material of this sensitivity",
  PROVIDER_UNAVAILABLE: "no provider could be reached",
  SCHEMA_REFUSED: "the answer did not fit the extraction schema",
  MODEL_FAILED: "the model gave no usable answer",
};

/**
 * The document this job reads: the company's current, processed,
 * unblocked pitch deck or company profile version, at a sensitivity a
 * reviewed provider may read, whose reading has not finished (nor been
 * refused by policy). The version's provenance source from an earlier
 * attempt rides along, so a retry reuses it.
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
          marker_source_id: string | null;
        }[]
      >`
        select d.tenant_id, d.company_id, d.owner_organisation_id,
               d.id as document_id, v.id as version_id, d.document_type,
               d.title, v.uploaded_by_user_id, d.sensitivity_class,
               (select s.id from evidence.sources s
                 where s.tenant_id = d.tenant_id
                   and s.subject_type = 'COMPANY'
                   and s.subject_id = d.company_id
                   and s.source_type = 'DOCUMENT'
                   and s.external_reference =
                       ${DOCUMENT_CLAIMS_REFERENCE_PREFIX} || v.id::text
                 order by s.created_at, s.id
                 limit 1) as marker_source_id
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
             select 1 from evidence.document_claim_readings r
              where r.document_version_id = v.id
                and r.tenant_id = d.tenant_id
                and r.status in ('COMPLETED', 'BLOCKED'))
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
      markerSourceId: row.marker_source_id,
    };
  };
}

/**
 * The job's own record per version (`evidence.document_claim_readings`,
 * server-only). `begin` is the gate: one statement counts the attempt and
 * claims the version, so two processes never read it at once, and a
 * finished, refused, in-progress or exhausted version is not read.
 */
export function documentClaimReadings(
  sql: DatabaseExecutor,
): DocumentClaimReadings {
  return {
    begin: async (target) => {
      const rows = await sql<{ attempts: number }[]>`
        insert into evidence.document_claim_readings as r
               (document_version_id, tenant_id, status, attempts)
        values (${target.documentVersionId}, ${target.tenantId}, 'READING', 1)
        on conflict (document_version_id) do update
           set status = 'READING',
               attempts = r.attempts + 1,
               error_code = null,
               updated_at = clock_timestamp()
         where r.tenant_id = excluded.tenant_id
           and r.attempts < ${READING_ATTEMPTS_MAX}
           and (r.status = 'FAILED'
                or (r.status = 'READING'
                    and r.updated_at < clock_timestamp()
                        - make_interval(mins => ${READING_STALE_MINUTES})))
        returning r.attempts`;
      const attempts = rows[0]?.attempts;
      return attempts === undefined ? null : { attempt: attempts };
    },
    end: async (target, end) => {
      await sql`
        update evidence.document_claim_readings
           set status = ${end.status},
               error_code = ${end.status === "COMPLETED" ? null : end.errorCode},
               updated_at = clock_timestamp()
         where document_version_id = ${target.documentVersionId}
           and tenant_id = ${target.tenantId}
           and status = 'READING'`;
    },
    pending: async (limit) => {
      // A failed or cut-short reading with attempts left, or a provenance
      // marker with no reading at all (marked before this record existed).
      // Never a version nobody has tried: a first reading waits for its
      // document's own wake.
      const rows = await sql<{ document_id: string }[]>`
        select d.id as document_id
          from evidence.documents d
          join evidence.document_versions v
            on v.id = d.current_version_id and v.tenant_id = d.tenant_id
          left join evidence.document_claim_readings r
            on r.document_version_id = v.id and r.tenant_id = d.tenant_id
         where d.document_type = any(${[...ELIGIBLE_TYPES]}::text[])
           and d.status = 'ACTIVE'
           and d.company_id is not null
           and v.processing_status = 'COMPLETED'
           and (
             (r.status = 'FAILED' and r.attempts < ${READING_ATTEMPTS_MAX})
             or (r.status = 'READING' and r.attempts < ${READING_ATTEMPTS_MAX}
                 and r.updated_at < clock_timestamp()
                     - make_interval(mins => ${READING_STALE_MINUTES}))
             or (r.document_version_id is null and exists (
                   select 1 from evidence.sources s
                    where s.tenant_id = d.tenant_id
                      and s.subject_type = 'COMPANY'
                      and s.subject_id = d.company_id
                      and s.source_type = 'DOCUMENT'
                      and s.external_reference =
                          ${DOCUMENT_CLAIMS_REFERENCE_PREFIX} || v.id::text)))
         order by v.id
         limit ${limit}`;
      return rows.map((row) => row.document_id);
    },
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
