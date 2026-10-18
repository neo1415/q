import { z } from "zod";

import {
  ResourceVersionSchema,
  UuidSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction } from "../define.js";

/**
 * P3 documents page (lead 2026-10-04): rename and archive one of the
 * organisation's own uploaded documents. The page's "Delete" is this soft
 * archive in the Evidence context: it can be undone, a deck archived stops
 * being downloadable by investors at once, and the file and its versions
 * are kept. RECOVERY-2026-10 (security fix 2): Q's tool says what it does
 * -- archive_document, not delete -- and there is no permanent delete of
 * an uploaded document anywhere in the product, so none is offered. For Q
 * both are CONSEQUENTIAL: prepared, then approved exactly, and the card
 * names the document by its own title (the exact target).
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

/** The card's exact target: the document's own title, read as the proposer. */
async function titleOf(
  ports: { readonly documentChanges?: DocumentChangePort | undefined },
  actor: ActorContext,
  documentId: string,
): Promise<string | null> {
  return (await own(ports.documentChanges, actor, documentId))?.title ?? null;
}

const quoted = (title: string | null | undefined) =>
  title === null || title === undefined ? "this document" : `"${title}"`;

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
  counterpartOf: (ports, actor, input) =>
    titleOf(ports, actor, input.documentId),
  card: (input, names) => ({
    summary: `Rename ${quoted(names?.counterpart)} to "${input.title}"`,
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
  short: "archive a document",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Archives one of their own uploaded documents (the documents page's Delete, which can be undone), or brings it back; an archived deck stops being downloadable by investors. The file is kept.",
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
  counterpartOf: (ports, actor, input) =>
    titleOf(ports, actor, input.documentId),
  card: (input, names) =>
    input.archived
      ? {
          summary: `Archive ${quoted(names?.counterpart)}`,
          preview:
            "It leaves your documents and investors can no longer download it. The file is kept and you can bring it back; nothing is permanently deleted.",
        }
      : {
          summary: `Bring back ${quoted(names?.counterpart)}`,
          preview:
            "It returns to your documents; who can download it stays private.",
        },
  done: (out) =>
    out.status === "ARCHIVED"
      ? `Archived "${out.title}". You can bring it back.`
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
    name: "archive_document",
    description:
      "Archives one of the person's own uploaded documents -- what the documents page's Delete does: it can be undone and the file is kept (restore: true brings it back). Never a permanent delete; there is none. Prepared for their approval, with the document named on the card.",
    input: ArchiveTool,
    references: { document: "UPLOAD" },
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    eval: {
      say: ["Archive {name}.", "Bring {name} back to my documents."],
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
