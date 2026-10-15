import { z } from "zod";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
} from "../contracts/index.js";
import { type GateQApplicationDocumentStatus } from "./gateq-application-evidence.js";

/**
 * The port GateQ intake uses to read and freeze an application's own
 * documents (ADR 0067 §4–§5). Server-side only, and trusted: the caller
 * must already have authorised the guest (`intake.authorise`) and passes
 * the tenant and application it derived from that credential, never ids a
 * request supplied.
 *
 * Extracted text is **data, never instructions**. Excerpts are bounded,
 * labelled with their document, version and page, and withheld entirely
 * when the extraction's instruction-risk scan flagged the document. Only
 * READY documents are returned; UPLOADING, PROCESSING, BLOCKED and FAILED
 * material never leaves Evidence.
 */

export type GateQApplicationDocumentRef = {
  readonly tenantId: string;
  readonly applicationId: string;
};

export type GateQReadyApplicationDocument = {
  readonly documentId: string;
  readonly versionId: string;
  readonly title: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly pageCount: number | null;
  /** NOT_SCANNED is the interim policy's record (ADR 0042), never "clean". */
  readonly malwareStatus: "CLEAN" | "NOT_SCANNED";
  /** True when extraction found instruction-like text; excerpts withheld. */
  readonly instructionRisk: boolean;
  /** Untrusted document content, page-labelled and bounded. */
  readonly excerpts: readonly {
    readonly page: number;
    readonly text: string;
  }[];
  /** True when text beyond the bound (or withheld text) exists. */
  readonly truncated: boolean;
};

export type GateQSelectedApplicationDocument = {
  readonly documentId: string;
  readonly versionId: string;
  readonly sha256: string;
};
/** Trusted server-only object identity, never a browser/model DTO. */
export type GateQFrozenApplicationDocumentObject =
  GateQSelectedApplicationDocument & {
    readonly object: { readonly bucket: string; readonly key: string };
    readonly fileName: string;
    readonly contentType: string;
    readonly byteSize: number;
    /** Investor downloads exist only for a CLEAN scan (lead decision 2026-10-15). */
    readonly malwareStatus: "CLEAN";
  };
export class GateQApplicationDocumentSelectionError extends Error {
  constructor() {
    super("Review the document selection again.");
    this.name = "GateQApplicationDocumentSelectionError";
  }
}
export type GateQFrozenApplicationDocument = {
  readonly documentId: string;
  readonly versionId: string;
  readonly title: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly frozenAt: string;
};

export type GateQApplicationDocumentFreeze = {
  /** Exactly what is disclosed with the submission, by version. */
  readonly documents: readonly GateQFrozenApplicationDocument[];
  /** Compatibility field, empty after successful all-or-nothing selection.
   * Unselected draft identities never enter a submitted result. */
  readonly notReady: readonly {
    readonly documentId: string;
    readonly status: Exclude<GateQApplicationDocumentStatus, "READY">;
  }[];
  /** True when an earlier freeze already existed and was returned as is. */
  readonly deduplicated: boolean;
};

export type GateQApplicationDocumentPort = {
  readonly readyDocuments: (
    input: GateQApplicationDocumentRef & {
      readonly maxCharsPerDocument?: number | undefined;
    },
  ) => Promise<readonly GateQReadyApplicationDocument[]>;
  /**
   * Freeze only the explicitly reviewed document/version/hash selection.
   * An explicit [] discloses no documents; there is no freeze-all default.
   * A changed/not-ready/foreign tuple refuses all. Call inside Submit. Call inside the Submit transaction, after the application
   * row is locked and before it is marked SUBMITTED, so a concurrent
   * upload or removal (which takes the same row lock) cannot interleave.
   * Idempotent: a second call returns the first freeze unchanged.
   */
  readonly freezeForSubmission: (
    tx: TransactionContext,
    input: GateQApplicationDocumentRef & {
      readonly selectedDocuments: readonly GateQSelectedApplicationDocument[];
    },
  ) => Promise<GateQApplicationDocumentFreeze>;
  /** These reads require a SUBMITTED application. Root must authorize the
   * current investor/gateway before calling; an input id is never proof. */
  readonly readFrozenDocument: (
    input: GateQApplicationDocumentRef &
      GateQSelectedApplicationDocument & {
        readonly maxCharsPerDocument?: number | undefined;
      },
  ) => Promise<GateQReadyApplicationDocument | null>;
  /** Resolve private storage ONLY for the exact submitted version/hash.
   * Root then reuses PrivateDocumentDownloadAuthorizer and the existing
   * short TTL. Never pass this object into a model or public response. */
  readonly frozenDocumentObject: (
    input: GateQApplicationDocumentRef & GateQSelectedApplicationDocument,
  ) => Promise<GateQFrozenApplicationDocumentObject | null>;
  /** The frozen disclosure, for the dossier and the investor's reads. */
  readonly frozenDocuments: (
    input: GateQApplicationDocumentRef,
  ) => Promise<readonly GateQFrozenApplicationDocument[]>;
};

const RefSchema = z
  .object({ tenantId: TenantIdSchema, applicationId: z.string().uuid() })
  .strict();
const SelectedSchema = z
  .object({
    documentId: DocumentIdSchema,
    versionId: DocumentVersionIdSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const DEFAULT_CHARS = 6_000;
const MAX_CHARS = 20_000;
const MAX_PAGES = 60;

const ReadyRow = z.object({
  document_id: DocumentIdSchema,
  version_id: DocumentVersionIdSchema,
  title: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size_bytes: z.coerce.number(),
  malware_scan_status: z.enum(["CLEAN", "NOT_SCANNED"]),
  extraction_id: z.string().uuid(),
  page_count: z.number().int().nullable(),
  instruction_risk_signals: z.number().int(),
});
const FrozenRow = z.object({
  document_id: DocumentIdSchema,
  document_version_id: DocumentVersionIdSchema,
  title: z.string(),
  mime_type: z.string(),
  sha256: z.string(),
  frozen_at: z.coerce.date(),
});

function frozen(row: unknown): GateQFrozenApplicationDocument {
  const r = FrozenRow.parse(row);
  return {
    documentId: r.document_id,
    versionId: r.document_version_id,
    title: r.title,
    contentType: r.mime_type,
    sha256: r.sha256,
    frozenAt: r.frozen_at.toISOString(),
  };
}

// Control characters other than tab/newline are stripped: the text is
// rendered as data, and nothing in it should be able to fake a boundary.
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function createGateQApplicationDocumentPort(deps: {
  readonly sql: DatabaseExecutor;
  /** Upper bound on documents returned for one application. */
  readonly maxDocuments?: number | undefined;
}): GateQApplicationDocumentPort {
  const maxDocuments = deps.maxDocuments ?? 20;
  if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1)
    throw new Error("maxDocuments must be a positive integer");

  const readyRows = (
    executor: DatabaseExecutor,
    ref: GateQApplicationDocumentRef,
    documentIds: readonly string[] | null = null,
    // Investor disclosure accepts only a CLEAN scan; the founder's own
    // interview may still read a NOT_SCANNED version (never shared).
    disclosable = false,
  ) =>
    executor`
      select d.id as document_id,v.id as version_id,d.title,v.original_filename,v.mime_type,v.sha256,v.size_bytes,
      v.malware_scan_status,x.id as extraction_id,x.page_count,x.instruction_risk_signals
      from evidence.documents d join evidence.document_versions v on v.id=d.current_version_id and v.tenant_id=d.tenant_id
      join lateral (select id,page_count,instruction_risk_signals from evidence.document_extractions e
        where e.document_version_id=v.id and e.tenant_id=d.tenant_id order by e.created_at desc limit 1) x on true
      where d.tenant_id=${ref.tenantId} and d.owner_kind='GATEQ_APPLICATION' and d.gateq_application_id=${ref.applicationId}
      and d.status='ACTIVE' and d.custody_cleanup_started_at is null
      and (${documentIds === null} or d.id=any(${executor.array([...(documentIds ?? [])])}::uuid[]))
      and v.processing_status='COMPLETED' and v.text_extraction_status='COMPLETED'
      and (v.malware_scan_status='CLEAN' or (${!disclosable} and v.malware_scan_status='NOT_SCANNED'))
      order by d.created_at,d.id limit ${maxDocuments}`;

  const frozenFor = (
    executor: DatabaseExecutor,
    ref: GateQApplicationDocumentRef,
    submittedOnly = false,
  ) =>
    executor`
      select g.document_id,g.document_version_id,v.original_filename as title,v.mime_type,g.sha256,g.frozen_at
      from evidence.gateq_application_document_disclosures g
      join gateq.applications a on a.id=g.application_id and a.tenant_id=g.tenant_id
      join evidence.documents d on d.id=g.document_id and d.tenant_id=g.tenant_id
      join evidence.document_versions v on v.id=g.document_version_id and v.tenant_id=g.tenant_id
      where g.tenant_id=${ref.tenantId} and g.application_id=${ref.applicationId}
      and (${!submittedOnly} or a.status='SUBMITTED')
      order by g.frozen_at,g.document_id`;

  const submittedVersion = (
    input: GateQApplicationDocumentRef & GateQSelectedApplicationDocument,
  ) => {
    const ref = RefSchema.parse({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
    });
    const selected = SelectedSchema.parse({
      documentId: input.documentId,
      versionId: input.versionId,
      sha256: input.sha256,
    });
    return deps.sql`
      select d.id as document_id,v.id as version_id,v.original_filename as title,v.original_filename,v.mime_type,v.sha256,v.size_bytes,
        v.storage_bucket,v.storage_key,v.malware_scan_status,x.id as extraction_id,x.page_count,x.instruction_risk_signals
      from evidence.gateq_application_document_disclosures g
      join gateq.applications a on a.id=g.application_id and a.tenant_id=g.tenant_id
      join evidence.documents d on d.id=g.document_id and d.tenant_id=g.tenant_id and d.gateq_application_id=g.application_id
      join evidence.document_versions v on v.id=g.document_version_id and v.tenant_id=g.tenant_id and v.document_id=d.id
      join lateral (select id,page_count,instruction_risk_signals from evidence.document_extractions e
        where e.document_version_id=v.id and e.tenant_id=g.tenant_id order by e.created_at desc limit 1) x on true
      where g.tenant_id=${ref.tenantId} and g.application_id=${ref.applicationId} and a.status='SUBMITTED'
        and g.document_id=${selected.documentId} and g.document_version_id=${selected.versionId} and g.sha256=${selected.sha256} and v.sha256=g.sha256
        and d.owner_kind='GATEQ_APPLICATION' and d.status='ACTIVE' and d.custody_cleanup_started_at is null
        and v.processing_status='COMPLETED' and v.text_extraction_status='COMPLETED' and v.malware_scan_status='CLEAN'`;
  };
  const withExcerpts = async (
    ref: GateQApplicationDocumentRef,
    rows: readonly unknown[],
    budget: number,
  ): Promise<readonly GateQReadyApplicationDocument[]> => {
    const result: GateQReadyApplicationDocument[] = [];
    for (const r of rows.map((row) => ReadyRow.parse(row))) {
      const instructionRisk = r.instruction_risk_signals > 0;
      const excerpts: { page: number; text: string }[] = [];
      let truncated = instructionRisk;
      if (!instructionRisk) {
        const pages = z
          .array(
            z.object({
              page_number: z.number().int().positive(),
              text: z.string(),
              full_length: z.coerce.number(),
            }),
          )
          .parse(
            await deps.sql`
              select page_number,left(text,${budget}) as text,char_length(text) as full_length
              from evidence.document_pages where tenant_id=${ref.tenantId} and document_version_id=${r.version_id}
              and extraction_id=${r.extraction_id} order by page_number limit ${MAX_PAGES + 1}`,
          );
        let remaining = budget;
        for (const [index, page] of pages.entries()) {
          if (index >= MAX_PAGES || remaining <= 0) {
            truncated = true;
            break;
          }
          const text = clean(page.text).slice(0, remaining);
          if (text.length < page.full_length) truncated = true;
          remaining -= text.length;
          if (text.trim() !== "")
            excerpts.push({ page: page.page_number, text });
        }
      }
      result.push({
        documentId: r.document_id,
        versionId: r.version_id,
        title: r.title,
        fileName: r.original_filename,
        contentType: r.mime_type,
        sha256: r.sha256,
        byteSize: r.size_bytes,
        pageCount: r.page_count,
        malwareStatus: r.malware_scan_status,
        instructionRisk,
        excerpts,
        truncated,
      });
    }
    return result;
  };

  return {
    readyDocuments: async (input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      const budget = z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .parse(input.maxCharsPerDocument ?? DEFAULT_CHARS);
      const rows = (await readyRows(deps.sql, ref)).map((row) =>
        ReadyRow.parse(row),
      );
      return withExcerpts(ref, rows, budget);
    },

    freezeForSubmission: async (tx, input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      const selected = z
        .array(SelectedSchema)
        .max(maxDocuments)
        .parse(input.selectedDocuments);
      if (new Set(selected.map((d) => d.documentId)).size !== selected.length)
        throw new GateQApplicationDocumentSelectionError();
      const locked = await tx.sql`
        select id,status from gateq.applications where id=${ref.applicationId} and tenant_id=${ref.tenantId} for update`;
      if (locked.length !== 1)
        throw new GateQApplicationDocumentSelectionError();
      const application = z.object({ status: z.string() }).parse(locked[0]);
      const existing = (await frozenFor(tx.sql, ref)).map(frozen);
      if (existing.length > 0 || application.status === "SUBMITTED") {
        if (
          selected.length !== existing.length ||
          selected.some(
            (d) =>
              !existing.some(
                (f) =>
                  f.documentId === d.documentId &&
                  f.versionId === d.versionId &&
                  f.sha256 === d.sha256,
              ),
          )
        )
          throw new GateQApplicationDocumentSelectionError();
        return { documents: existing, notReady: [], deduplicated: true };
      }
      if (!["IN_PROGRESS", "READY_TO_SUBMIT"].includes(application.status))
        throw new GateQApplicationDocumentSelectionError();
      const selectedReady =
        selected.length === 0
          ? []
          : (
              await readyRows(
                tx.sql,
                ref,
                selected.map((d) => d.documentId),
                true,
              )
            ).map((row) => ReadyRow.parse(row));
      if (
        selectedReady.length !== selected.length ||
        selected.some(
          (d) =>
            !selectedReady.some(
              (r) =>
                r.document_id === d.documentId &&
                r.version_id === d.versionId &&
                r.sha256 === d.sha256,
            ),
        )
      )
        throw new GateQApplicationDocumentSelectionError();
      for (const r of selectedReady) {
        // The trigger re-derives ownership and readiness from the parents.
        await tx.sql`
          insert into evidence.gateq_application_document_disclosures (tenant_id,application_id,document_id,document_version_id,sha256)
          values (${ref.tenantId},${ref.applicationId},${r.document_id},${r.version_id},${r.sha256})
          on conflict (application_id,document_id) do nothing`;
      }
      return {
        documents: (await frozenFor(tx.sql, ref)).map(frozen),
        notReady: [],
        deduplicated: false,
      };
    },

    readFrozenDocument: async (input) => {
      const rows = await submittedVersion(input);
      if (rows.length !== 1) return null;
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      const budget = z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .parse(input.maxCharsPerDocument ?? DEFAULT_CHARS);
      return (await withExcerpts(ref, rows, budget))[0] ?? null;
    },
    frozenDocumentObject: async (input) => {
      const rows = await submittedVersion(input);
      if (rows.length !== 1) return null;
      const r = ReadyRow.extend({
        storage_bucket: z.string().min(1),
        storage_key: z.string().min(1),
      }).parse(rows[0]);
      // Defence in depth beside the query: no unscanned bytes to investors.
      if (r.malware_scan_status !== "CLEAN") return null;
      return {
        documentId: r.document_id,
        versionId: r.version_id,
        sha256: r.sha256,
        object: { bucket: r.storage_bucket, key: r.storage_key },
        fileName: r.original_filename,
        contentType: r.mime_type,
        byteSize: r.size_bytes,
        malwareStatus: "CLEAN",
      };
    },
    frozenDocuments: async (input) => {
      const ref = RefSchema.parse({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      return (await frozenFor(deps.sql, ref, true)).map(frozen);
    },
  };
}
