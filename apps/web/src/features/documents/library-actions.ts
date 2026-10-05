"use server";

import { z } from "zod";

import {
  archiveDocument,
  getDocumentFile,
  listDocuments,
  listQArtifacts,
  renameDocument,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

import {
  fromArtifact,
  fromUpload,
  LIBRARY_PAGE,
  type LibraryPage,
} from "./library-model";

/**
 * The documents page's reads and writes (P3), server side: the session
 * token never leaves the server, and the APIs decide (their own
 * organisation's documents, document.manage, the version the page saw).
 * Each failure is one sentence the person can act on.
 */

export type LibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

async function sessions(): Promise<{
  readonly api: ApiSession | null;
  readonly q: ApiSession | null;
} | null> {
  const { apiBaseUrl, qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return null;
  return {
    api: apiBaseUrl === undefined ? null : { baseUrl: apiBaseUrl, accessToken },
    q: qApiBaseUrl === undefined ? null : { baseUrl: qApiBaseUrl, accessToken },
  };
}

const Cursors = z
  .object({
    /** Q's documents: older than this timestamp. Null: no more. */
    q: z.string().max(64).nullable().optional(),
    /** Uploaded documents: the API's opaque cursor. Null: no more. */
    uploads: z.string().max(200).nullable().optional(),
  })
  .strict();

/**
 * One page from each source still holding more (cursor pagination, never
 * offset). Absent cursor: the first page of that source; null: that source
 * is done and is not asked again.
 */
export async function loadLibraryPageAction(
  raw: z.input<typeof Cursors>,
): Promise<LibraryResult<LibraryPage>> {
  const cursors = Cursors.safeParse(raw);
  const current = await sessions();
  if (!cursors.success || current === null) {
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  const { q, uploads } = cursors.data;
  try {
    const [made, uploaded] = await Promise.all([
      q === null || current.q === null
        ? null
        : listQArtifacts(current.q, {
            limit: LIBRARY_PAGE,
            ...(q === undefined ? {} : { before: q }),
          }),
      uploads === null || current.api === null
        ? null
        : listDocuments(current.api, {
            limit: LIBRARY_PAGE,
            ...(uploads === undefined ? {} : { cursor: uploads }),
          }),
    ]);
    return {
      ok: true,
      value: {
        items: [
          ...(made?.items ?? []).map(fromArtifact),
          ...(uploaded?.documents ?? []).map(fromUpload),
        ],
        cursors: {
          q: made?.nextBefore ?? null,
          uploads: uploaded?.nextCursor ?? null,
        },
      },
    };
  } catch {
    return {
      ok: false,
      message: "Your documents didn't load. Who can see them hasn't changed.",
    };
  }
}

const Rename = z
  .object({
    documentId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export async function renameDocumentAction(
  raw: z.input<typeof Rename>,
): Promise<
  LibraryResult<{ readonly title: string; readonly version: number }>
> {
  const input = Rename.safeParse(raw);
  const current = await sessions();
  if (!input.success || current?.api == null) {
    return { ok: false, message: "That name didn't save. Try again." };
  }
  try {
    const out = await renameDocument(current.api, input.data.documentId, {
      title: input.data.title,
      expectedVersion: input.data.expectedVersion,
    });
    return { ok: true, value: { title: out.title, version: out.version } };
  } catch {
    return {
      ok: false,
      message:
        "That name didn't save. It may have changed: reload and try again.",
    };
  }
}

const Archive = z
  .object({ documentId: z.string().uuid(), archived: z.boolean() })
  .strict();

/** Delete (archive) or bring back; deleting can always be undone. */
export async function archiveDocumentAction(
  raw: z.input<typeof Archive>,
): Promise<LibraryResult<{ readonly version: number }>> {
  const input = Archive.safeParse(raw);
  const current = await sessions();
  if (!input.success || current?.api == null) {
    return { ok: false, message: "That didn't go through. Try again." };
  }
  try {
    const out = await archiveDocument(current.api, input.data.documentId, {
      archived: input.data.archived,
    });
    return { ok: true, value: { version: out.version } };
  } catch {
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

/** A short-lived link to their own file, opened by the browser at once. */
export async function documentFileAction(
  documentId: string,
): Promise<LibraryResult<{ readonly url: string; readonly scanned: boolean }>> {
  const id = z.string().uuid().safeParse(documentId);
  const current = await sessions();
  if (!id.success || current?.api == null) {
    return { ok: false, message: "That file isn't available." };
  }
  try {
    const link = await getDocumentFile(current.api, id.data);
    return { ok: true, value: { url: link.url, scanned: link.scanned } };
  } catch {
    return {
      ok: false,
      message: "That file isn't available yet. It may still be checked.",
    };
  }
}
