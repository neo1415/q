import { z } from "zod";

import {
  ResourceVersionSchema,
  UuidSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction } from "../define.js";

/**
 * P3 documents page (lead 2026-10-04): rename and delete one of the
 * organisation's own uploaded documents. Deleting is a soft archive in the
 * Evidence context (it can be undone, and a deleted deck stops being
 * downloadable by investors at once); the file and its versions are kept.
 * For Q both are CONSEQUENTIAL: prepared, then approved exactly.
 *
 * The port is structural so this package keeps its dependencies; each
 * composition adapts the Evidence service (which authorises, audits and
 * emits) to it.
 */

export type ManagedDocument = {
  readonly id: string;
  readonly title: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly version: number;
};

export type DocumentChangePort = {
  /** The actor's own organisation's document, or a not-found throw. */
  readonly getDocument: (query: {
    readonly actor: ActorContext;
    readonly documentId: string;
  }) => Promise<ManagedDocument>;
  readonly changeDocument: (command: {
    readonly actor: ActorContext;
    readonly documentId: string;
    readonly change:
      | { readonly kind: "RENAME"; readonly title: string }
      | { readonly kind: "ARCHIVE" }
      | { readonly kind: "RESTORE" };
    readonly expectedVersion?: number | undefined;
    readonly correlationId: CorrelationId;
  }) => Promise<ManagedDocument>;
};

async function own(
  port: DocumentChangePort | undefined,
  actor: ActorContext,
  documentId: string,
): Promise<ManagedDocument | null> {
  if (port === undefined) return null;
  return port.getDocument({ actor, documentId }).catch(() => null);
}

const NOT_THEIRS = "That isn't one of your documents.";

const RenameInput = z
  .object({
    documentId: UuidSchema,
    title: z.string().trim().min(1).max(200),
    expectedVersion: ResourceVersionSchema.optional(),
  })
  .strict();

const RenameTool = z
  .object({
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Which of their documents: its title as they said it."),
    title: z.string().trim().min(1).max(200).describe("The new name."),
  })
  .strict();

const respond = (out: ManagedDocument) => ({
  documentId: out.id,
  title: out.title,
  status: out.status,
  version: out.version,
});

export const RENAME_DOCUMENT = defineAppAction<
  z.infer<typeof RenameInput>,
  ManagedDocument,
  z.infer<typeof RenameTool>
>({
  name: "document.rename",
  short: "rename a document",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Renames one of their own uploaded documents, as the documents page does.",
  input: RenameInput,
  output: z.custom<ManagedDocument>(),
  authorize: async (ports, context, input) =>
    (await own(ports.documentChanges, context.actor, input.documentId)) === null
      ? { ok: false, reason: NOT_THEIRS }
      : { ok: true },
  run: async (ports, context, input) => {
    const port = ports.documentChanges;
    if (port === undefined) throw new Error("DOCUMENT_NOT_AVAILABLE");
    return port.changeDocument({
      actor: context.actor,
      documentId: input.documentId,
      change: { kind: "RENAME", title: input.title },
      expectedVersion: input.expectedVersion,
      correlationId: context.correlationId,
    });
  },
  targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
  card: (input) => ({
    summary: `Rename the document to "${input.title}"`,
    preview: "Only the name changes; the file stays as it is.",
  }),
  done: (out) => `Done. It's now called "${out.title}".`,
  http: {
    method: "PATCH",
    path: "/v1/documents/:documentId",
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      documentId: params["documentId"],
    }),
    respond,
  },
  tool: {
    name: "rename_document",
    description:
      "Renames one of the person's own uploaded documents, exactly as the documents page does. Prepared for their approval.",
    input: RenameTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    eval: {
      say: [
        "Rename {name} to Seed deck final.",
        "Call {name} Board pack Q3 instead.",
      ],
      names: "UPLOAD",
    },
    toCanonical: (input) =>
      Promise.resolve({ documentId: input.document, title: input.title }),
  },
});

const ArchiveInput = z
  .object({
    documentId: UuidSchema,
    archived: z.boolean(),
    expectedVersion: ResourceVersionSchema.optional(),
  })
  .strict();

const ArchiveTool = z
  .object({
    document: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Which of their documents: its title as they said it."),
    restore: z
      .boolean()
      .optional()
      .describe("True to bring back a document they deleted."),
  })
  .strict();

export const ARCHIVE_DOCUMENT = defineAppAction<
  z.infer<typeof ArchiveInput>,
  ManagedDocument,
  z.infer<typeof ArchiveTool>
>({
  name: "document.archive",
  short: "delete a document",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Deletes one of their own uploaded documents from the documents page, or brings it back; a deleted deck stops being downloadable by investors.",
  input: ArchiveInput,
  output: z.custom<ManagedDocument>(),
  authorize: async (ports, context, input) =>
    (await own(ports.documentChanges, context.actor, input.documentId)) === null
      ? { ok: false, reason: NOT_THEIRS }
      : { ok: true },
  run: async (ports, context, input) => {
    const port = ports.documentChanges;
    if (port === undefined) throw new Error("DOCUMENT_NOT_AVAILABLE");
    return port.changeDocument({
      actor: context.actor,
      documentId: input.documentId,
      change: { kind: input.archived ? "ARCHIVE" : "RESTORE" },
      expectedVersion: input.expectedVersion,
      correlationId: context.correlationId,
    });
  },
  targets: (input) => [{ kind: "DOCUMENT", documentId: input.documentId }],
  card: (input) =>
    input.archived
      ? {
          summary: "Delete this document",
          preview:
            "It leaves your documents and investors can no longer download it. You can bring it back.",
        }
      : {
          summary: "Bring this document back",
          preview:
            "It returns to your documents; who can download it stays private.",
        },
  done: (out) =>
    out.status === "ARCHIVED"
      ? `Deleted "${out.title}". You can bring it back.`
      : `"${out.title}" is back in your documents.`,
  http: {
    method: "POST",
    path: "/v1/documents/:documentId/archive",
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      documentId: params["documentId"],
    }),
    respond,
  },
  tool: {
    name: "delete_document",
    description:
      "Deletes one of the person's own uploaded documents (restore: true brings it back), exactly as the documents page does. Prepared for their approval.",
    input: ArchiveTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    eval: {
      say: ["Delete {name}.", "Bring {name} back to my documents."],
      names: "UPLOAD",
    },
    toCanonical: (input) =>
      Promise.resolve({
        documentId: input.document,
        archived: input.restore !== true,
      }),
  },
});

export const DOCUMENT_MANAGE_ACTIONS = [RENAME_DOCUMENT, ARCHIVE_DOCUMENT];
