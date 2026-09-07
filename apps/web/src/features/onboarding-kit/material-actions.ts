"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ApiProblemError,
  completeDocumentUploadSession,
  createDocumentUploadSession,
  listDocuments,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import { DocumentTypeSchema } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

import type { ActionResult } from "./api-actions";
import type { MaterialFileView, MaterialState } from "./materials";

/**
 * Document upload for a document-gathering onboarding step (CQ-Q-021 §10,
 * §11, §14, §15).
 *
 * The only place a browser reaches the Evidence upload API, and it does so
 * the way every other Capital Q surface does: server-to-server, with the
 * HttpOnly session's token, never from the browser and never with a token
 * the browser has seen.
 *
 * The sequence is the real one and nothing about it is simulated:
 *
 *   ask permission → receive a short-lived signed target → the browser PUTs
 *   the bytes straight to private storage → the server verifies what landed
 *   and freezes an immutable version → a processing job is queued
 *
 * "Uploaded" therefore means a version exists and is queued. It does not
 * mean the file has been scanned, read or understood, and nothing here
 * reports that it has (§11).
 */

const UploadInput = z.object({
  companyId: z.string().uuid(),
  documentType: DocumentTypeSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(129),
  sizeBytes: z.number().int().min(1),
});

/** What the browser needs to put the bytes somewhere it is allowed to. */
export type MaterialUploadTarget = {
  readonly uploadSessionId: string;
  readonly documentId: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
};

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<ActionResult<T>> {
  const token = await getSessionAccessToken();
  if (token === null) {
    return {
      ok: false,
      kind: "REJECTED",
      message: "Please sign in again to continue.",
    };
  }
  const config = loadWebServerConfig();
  try {
    return {
      ok: true,
      value: await work({
        baseUrl: config.apiBaseUrl ?? "",
        accessToken: token,
      }),
    };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      // The API's own problem detail is written for a person. A parser
      // message, a MIME code or a storage key never reaches here (§15).
      return {
        ok: false,
        kind: error.status === 409 ? "CONFLICT" : "REJECTED",
        message:
          error.status === 413
            ? "That file is too large to upload here."
            : error.status === 415
              ? "We can't read that kind of file yet. PDF, PowerPoint, Word and plain text work today."
              : "We couldn't accept that file. Try again, or continue without it.",
      };
    }
    return {
      ok: false,
      kind: "NETWORK",
      message:
        "We couldn't reach Capital Q. Check your connection and try again.",
    };
  }
}

/** Step one: ask, and get somewhere to put it. */
export async function materialUploadTargetAction(
  raw: unknown,
): Promise<ActionResult<MaterialUploadTarget>> {
  const input = UploadInput.parse(raw);
  return run(async (session) => {
    const created = await createDocumentUploadSession(
      session,
      {
        companyId: input.companyId,
        documentType: input.documentType,
        title: input.filename.replace(/\.[^.]+$/, "").slice(0, 200),
        filename: input.filename,
        declaredMimeType: input.mimeType,
        declaredSizeBytes: input.sizeBytes,
      },
      randomUUID(),
    );
    if (created.upload === null) {
      // The API declined to issue a target. Treated as a refusal, not as a
      // success with nowhere to put the bytes.
      throw new ApiProblemError(
        "no upload target",
        409,
        "UPLOAD_TARGET_UNAVAILABLE",
      );
    }
    return {
      uploadSessionId: created.uploadSession.id,
      documentId: created.document.id,
      url: created.upload.url,
      method: created.upload.method,
      headers: created.upload.headers,
    };
  });
}

/** Step three: the server verifies what actually landed. */
export async function materialUploadCompleteAction(
  rawUploadSessionId: string,
): Promise<ActionResult<{ readonly documentId: string }>> {
  const uploadSessionId = z.string().uuid().parse(rawUploadSessionId);
  return run(async (session) => {
    const completed = await completeDocumentUploadSession(
      session,
      uploadSessionId,
      {},
      randomUUID(),
    );
    return { documentId: completed.document.id };
  });
}

/**
 * What a founder sees under each file.
 *
 * Derived from the version's own processing state, and deliberately plain.
 * A file waiting in a queue says it is waiting; it does not say "Q is
 * thinking about your deck", because that would be a claim about work that
 * has not started (§14, §56).
 */
function stateOf(document: {
  readonly currentVersion: {
    readonly processingStatus: string;
    readonly textExtractionStatus: string;
    readonly malwareScanStatus: string;
  } | null;
}): { readonly state: MaterialState; readonly label: string } {
  const version = document.currentVersion;
  if (version === null) {
    return { state: "uploading", label: "Uploading" };
  }
  if (version.processingStatus === "FAILED") {
    return { state: "unreadable", label: "We couldn't read this file" };
  }
  if (version.malwareScanStatus === "BLOCKED") {
    // Honest, and does not accuse the founder of anything: the file was not
    // shown to be safe, which is not the same as being dangerous.
    return {
      state: "unreadable",
      label: "We couldn't check this file, so we haven't opened it",
    };
  }
  if (version.textExtractionStatus === "COMPLETED") {
    return { state: "ready", label: "Read" };
  }
  switch (version.processingStatus) {
    case "NOT_STARTED":
      return { state: "received", label: "Received" };
    case "QUEUED":
      return { state: "received", label: "Waiting to be read" };
    case "PROCESSING":
      return { state: "reviewing", label: "Being read" };
    default:
      return { state: "received", label: "Received" };
  }
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  PITCH_DECK: "Pitch deck",
  FINANCIAL_MODEL: "Financial model",
  MANAGEMENT_ACCOUNTS: "Management accounts",
  COMPANY_PROFILE: "Company profile",
  OTHER: "Other material",
  UNCLASSIFIED: "Document",
};

/**
 * The company's documents and where each one really is.
 *
 * Read fresh on every load, which is what makes refresh and resume work
 * (§16, §17): the browser remembers nothing, so there is nothing for it to
 * remember wrongly.
 */
export async function materialListAction(
  rawCompanyId: string,
): Promise<ActionResult<readonly MaterialFileView[]>> {
  const companyId = z.string().uuid().parse(rawCompanyId);
  return run(async (session) => {
    const listed = await listDocuments(session, { companyId });
    return listed.documents.map((document): MaterialFileView => {
      const { state, label } = stateOf(document);
      return {
        id: document.id,
        filename: document.currentVersion?.originalFilename ?? document.title,
        kindLabel: TYPE_LABELS[document.documentType] ?? "Document",
        state,
        stateLabel: label,
      };
    });
  });
}
