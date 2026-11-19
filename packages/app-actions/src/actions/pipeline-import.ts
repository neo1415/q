import { z } from "zod";

import {
  ApplyPipelineImportRequestSchema,
  COMPANY_PIPELINE_IMPORT_APPLY_PATH,
  COMPANY_PIPELINE_IMPORTS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  PIPELINE_IMPORT_APPLY_PATH,
  PIPELINE_IMPORTS_PATH,
  PipelineImportPreviewSchema,
  PipelineImportLinkSchema,
  PipelineImportMappingSchema,
  PipelineImportResultSchema,
  UuidSchema,
  type KnownErrorCode,
  type PipelineImportCounts,
  type PipelineImportPreview,
} from "@capital-q/contracts";
import type {
  PipelineImportApplied,
  PipelineImportOutcome,
} from "@capital-q/network";

import {
  defineAppAction,
  portMissing,
  refusal,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * CRM import (owner decision 106, 2026-11-18): the person brings the
 * pipeline they already keep (a CSV or XLSX they uploaded through the
 * documents path, so it was scanned) and Q arranges it as Capital Q's own
 * pipeline. Prepare -> Approve -> Execute:
 *
 *   prepare (INSTANT)      reads the file, maps its columns, matches each
 *                          row to the canonical counterpart and stages a
 *                          hashed proposal; nothing else changes.
 *   apply (CONSEQUENTIAL)  writes the person's own relationships, private
 *                          stage history, notes and next steps, only with
 *                          the exact proposal (hash, counts, file) they
 *                          approved, under one idempotency key.
 *
 * "Import my pipeline" to Q is the apply action's tool: Q prepares the
 * import from the named upload and puts the card in front of them.
 * Authorisation is the network service's (the pipeline's own listing
 * rule); a company id in a founder's path is input, never proof.
 */

const imports = (ports: AppActionPorts) =>
  ports.pipelineImport ?? portMissing("pipelineImport");

/** The service decides; a refusal there is the route's answer. */
const serviceDecides = () => Promise.resolve({ ok: true as const });

const problemOf = (
  out: PipelineImportOutcome<unknown>,
): { readonly code: KnownErrorCode; readonly detail: string } | null => {
  if (out.outcome === "OK") return null;
  switch (out.code) {
    case "NOT_FOUND":
      return { code: "RESOURCE_NOT_FOUND", detail: out.message };
    case "NOT_SCANNED":
      return { code: "UPLOAD_NOT_READY", detail: out.message };
    case "STALE":
      return { code: "RESOURCE_CONFLICT", detail: out.message };
    case "UNAVAILABLE":
      return { code: "NOT_IMPLEMENTED", detail: out.message };
    case "BLOCKED":
    case "UNSUPPORTED_TYPE":
    case "TOO_LARGE":
    case "EMPTY":
    case "NO_HEADER":
    case "TOO_MANY_ROWS":
    case "TOO_MANY_COLUMNS":
    case "UNREADABLE":
    case "NO_NAME_COLUMN":
    case "INVALID_MAPPING":
    case "INVALID_RESOLUTION":
      return { code: "VALIDATION_FAILED", detail: out.message };
  }
};

// --- prepare -------------------------------------------------------------

const Prepare = z
  .object({
    documentId: UuidSchema,
    /** The person's own column mapping (the import screen); absent: Q proposes. */
    mapping: PipelineImportMappingSchema.optional(),
    /** A founder's company: their side. Absent: an investor's. */
    companyId: UuidSchema.optional(),
  })
  .strict();
type PrepareInput = z.infer<typeof Prepare>;
type PrepareOut = PipelineImportOutcome<PipelineImportPreview>;

function prepareAction(path: string, company: boolean) {
  return defineAppAction<PrepareInput, PrepareOut>({
    name: company
      ? "crm.company_import.prepare"
      : "crm.investor_import.prepare",
    short: "read a pipeline file",
    area: "crm",
    classification: "INSTANT",
    does: company
      ? "Reads an uploaded CSV or Excel file of the investors their company is raising from, maps its columns and matches each row to an investor on Capital Q, for review; nothing is saved to the pipeline yet."
      : "Reads an uploaded CSV or Excel export of their firm's deal pipeline, maps its columns and matches each row to a company on Capital Q, for review; nothing is saved to the pipeline yet.",
    input: Prepare,
    output: z.custom<PrepareOut>(),
    authorize: serviceDecides,
    run: (ports, context, input) =>
      imports(ports).prepare(context.actor, {
        documentId: input.documentId,
        companyId: input.companyId,
        mapping: input.mapping,
        correlationId: context.correlationId,
      }),
    targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
    card: () => ({
      summary: "Read a pipeline file",
      preview: "Q reads the file and shows what it would import.",
    }),
    done: (out) =>
      out.outcome === "OK"
        ? `Read ${String(out.value.counts.rows)} rows from ${out.value.fileName}.`
        : out.message,
    succeeded: (out) => out.outcome === "OK",
    viaTool: "import_my_pipeline",
    http: {
      method: "POST",
      path,
      fromRequest: (params, body) => ({
        ...(typeof body === "object" && body !== null ? body : {}),
        ...(params["companyId"] === undefined
          ? {}
          : { companyId: params["companyId"] }),
      }),
      status: 201,
      problem: problemOf,
      respond: (out) =>
        out.outcome === "OK"
          ? PipelineImportPreviewSchema.parse(out.value)
          : undefined,
    },
  });
}

// --- apply ---------------------------------------------------------------

const Apply = z
  .object({
    importId: UuidSchema,
    /** The file the proposal was read from: the card's target. */
    documentId: UuidSchema,
    companyId: UuidSchema.optional(),
    /** For the card only; the service binds to the hash and counts. */
    fileName: z.string().min(1).max(255).optional(),
    idempotencyKey: z.string().min(8).max(200),
    request: ApplyPipelineImportRequestSchema,
  })
  .strict();
type ApplyInput = z.infer<typeof Apply>;
type ApplyOut = PipelineImportOutcome<PipelineImportApplied>;

const ApplyTool = z
  .object({
    file: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        "The uploaded pipeline file (CSV or Excel) as the person named it.",
      ),
  })
  .strict();

export function importCardPreview(
  counts: PipelineImportCounts,
  resolved: number,
): string {
  const parts = [
    `${String(counts.rows)} rows`,
    `${String(counts.matched)} matched to Capital Q`,
    `${String(counts.new)} kept private (not on Capital Q)`,
  ];
  const open = counts.ambiguous - resolved;
  if (open > 0) {
    parts.push(
      `${String(open)} could be more than one organisation and are skipped unless you choose on the import screen`,
    );
  }
  if (counts.invalid > 0) {
    parts.push(`${String(counts.invalid)} without a name are skipped`);
  }
  return `${parts.join(", ")}. Stages, notes and next steps stay private to your side; nothing is shared with anyone you track.`;
}

function applyAction(path: string, company: boolean) {
  return defineAppAction<ApplyInput, ApplyOut, z.infer<typeof ApplyTool>>({
    name: company ? "crm.company_import.apply" : "crm.investor_import.apply",
    short: "import my pipeline",
    area: "crm",
    classification: "CONSEQUENTIAL",
    does: company
      ? "Imports a reviewed pipeline file into their company's own investor relationships: matched investors join the pipeline with their stage, notes and next steps, private to the company; others stay a private list."
      : "Imports a reviewed pipeline file into their firm's own company relationships: matched companies join the pipeline with their stage, notes and next steps, private to the firm; others stay a private list.",
    input: Apply,
    output: z.custom<ApplyOut>(),
    authorize: serviceDecides,
    run: (ports, context, input) =>
      imports(ports).apply(context.actor, {
        importId: input.importId,
        documentId: input.documentId,
        companyId: input.companyId,
        request: input.request,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
        byQ: context.surface === "Q",
      }),
    targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
    card: (input) => ({
      summary:
        input.fileName === undefined
          ? "Import your pipeline file"
          : `Import ${input.fileName} into your pipeline`,
      preview: importCardPreview(
        input.request.counts,
        input.request.resolutions.filter(
          (resolution) => resolution.choice !== "SKIP",
        ).length,
      ),
    }),
    done: (out) =>
      out.outcome === "OK"
        ? `Imported: ${String(out.value.result.linked)} in your pipeline (${String(out.value.result.relationshipsCreated)} new), ${String(out.value.result.keptPrivate)} kept as a private list, ${String(out.value.result.tasks)} next steps on your board.`
        : out.message,
    succeeded: (out) => out.outcome === "OK",
    ...(company ? { viaTool: "import_my_pipeline" } : {}),
    http: {
      method: "POST",
      path,
      fromRequest: (params, body, headers) => {
        const fields =
          typeof body === "object" && body !== null
            ? (body as Record<string, unknown>)
            : {};
        const { documentId, fileName, ...request } = fields;
        return {
          importId: params["importId"],
          documentId,
          ...(fileName === undefined ? {} : { fileName }),
          ...(params["companyId"] === undefined
            ? {}
            : { companyId: params["companyId"] }),
          idempotencyKey: IdempotencyKeyHeaderSchema.safeParse(
            headers[IDEMPOTENCY_KEY_HEADER],
          ).data,
          request,
        };
      },
      idempotencyKeyOf: (input) => `crm-import:${input.idempotencyKey}`,
      problem: problemOf,
      respond: (out) =>
        out.outcome === "OK"
          ? {
              importId: out.value.importId,
              replayed: out.value.replayed,
              result: PipelineImportResultSchema.parse(out.value.result),
              relationships: out.value.relationships.map((link) =>
                PipelineImportLinkSchema.parse(link),
              ),
            }
          : undefined,
    },
    ...(company
      ? {}
      : {
          tool: {
            name: "import_my_pipeline",
            description:
              "Imports the person's existing CRM or pipeline file (a CSV or Excel they uploaded) into their Capital Q pipeline: Q reads it, matches each row to the company or investor on Capital Q, and prepares the import for their approval with the counts on the card. Nothing is saved until they approve; unmatched rows stay a private list.",
            input: ApplyTool,
            references: { file: "UPLOAD" },
            purposes: ["ACTION_PREPARATION", "GENERAL_QUESTION"],
            // Only on a turn about it (named, or the CRM in focus): an import
            // is rare and must never push a purpose's own tool past the
            // model's bound.
            offeredInArea: true,
            eval: {
              say: [
                "Import my pipeline from {name}.",
                "Here's my CRM export, {name} -- load it into my pipeline.",
              ],
              names: "UPLOAD",
              orSays:
                "isn't one of yours|safety check|CSV or an Excel|couldn't tell which column|not available",
            },
            toCanonical: async (tool, context, ports) => {
              const investor =
                (await ports.ownInvestorOrganisationId?.(context.actor)) ??
                null;
              const companyId =
                investor === null
                  ? ((await ports.ownCompanyId?.(context.actor)) ?? null)
                  : null;
              if (investor === null && companyId === null) {
                return refusal(
                  "Importing a pipeline needs your firm's or your company's profile first.",
                );
              }
              const prepared = await imports(ports).prepare(context.actor, {
                documentId: tool.file,
                companyId: companyId ?? undefined,
                correlationId: context.correlationId,
              });
              if (prepared.outcome !== "OK") return refusal(prepared.message);
              const preview = prepared.value;
              return {
                importId: preview.importId,
                documentId: tool.file,
                ...(companyId === null ? {} : { companyId }),
                fileName: preview.fileName,
                idempotencyKey: `q:${preview.importId}:${context.idempotencyKey}`,
                request: {
                  proposalHash: preview.proposalHash,
                  counts: preview.counts,
                  resolutions: [],
                },
              };
            },
          },
        }),
  });
}

export const PIPELINE_IMPORT_ACTIONS: readonly AnyAppAction[] = [
  prepareAction(PIPELINE_IMPORTS_PATH, false),
  prepareAction(COMPANY_PIPELINE_IMPORTS_PATH, true),
  applyAction(PIPELINE_IMPORT_APPLY_PATH, false),
  applyAction(COMPANY_PIPELINE_IMPORT_APPLY_PATH, true),
];
