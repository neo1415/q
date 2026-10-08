"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  answerInvestorQuestion,
  declineDocumentRequest,
  fulfilDocumentRequest,
  getDocumentAccess,
  getFolderAccess,
  getRequestInbox,
  revokeDocumentAccess,
  setFolderLevel,
  shareDocumentAccess,
  shareFolderAccess,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  AnswerQuestionSchema,
  DataRoomCodeSchema,
  DataRoomLevelSchema,
  DeclineDocumentRequestSchema,
  FulfilDocumentRequestSchema,
  GrantDocumentAccessSchema,
  type DocumentAccessDto,
  type FolderAccessDto,
  type RequestInboxDto,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Founder documents (2026-10-08), server side: the requests inbox, the
 * access editor and answers. The access token never leaves the server.
 * Whether the person may do any of this is the API's decision alone; a
 * refusal reads the same whatever its reason.
 */

export type RequestResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();

async function session() {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  return apiBaseUrl === undefined || accessToken === null
    ? null
    : { baseUrl: apiBaseUrl, accessToken };
}

const failed = <T>(message: string): RequestResult<T> => ({
  ok: false,
  message,
});

const done = () => {
  revalidatePath("/documents");
  return { ok: true as const, value: undefined };
};

export async function loadInboxAction(
  rawCompanyId: string,
): Promise<RequestResult<RequestInboxDto>> {
  const companyId = Id.safeParse(rawCompanyId);
  const api = await session();
  if (!companyId.success || api === null)
    return failed("Requests couldn't load. Try again in a moment.");
  try {
    return { ok: true, value: await getRequestInbox(api, companyId.data) };
  } catch {
    return failed("Requests couldn't load. Try again in a moment.");
  }
}

export async function fulfilRequestAction(
  rawRequestId: string,
  raw: unknown,
): Promise<RequestResult> {
  const requestId = Id.safeParse(rawRequestId);
  const body = FulfilDocumentRequestSchema.safeParse(raw);
  const api = await session();
  if (!requestId.success || !body.success || api === null)
    return failed("That wasn't shared. Try again.");
  try {
    await fulfilDocumentRequest(api, requestId.data, body.data);
    return done();
  } catch {
    return failed(
      "That wasn't shared. It may have been answered already; refresh and try again.",
    );
  }
}

export async function declineRequestAction(
  rawRequestId: string,
  raw: unknown,
): Promise<RequestResult> {
  const requestId = Id.safeParse(rawRequestId);
  const body = DeclineDocumentRequestSchema.safeParse(raw);
  const api = await session();
  if (!requestId.success || !body.success || api === null)
    return failed("That didn't go through. Try again.");
  try {
    await declineDocumentRequest(api, requestId.data, body.data);
    return done();
  } catch {
    return failed("That didn't go through. Try again.");
  }
}

export async function answerQuestionAction(
  rawQuestionId: string,
  raw: unknown,
  rawKey: string,
): Promise<RequestResult> {
  const questionId = Id.safeParse(rawQuestionId);
  const body = AnswerQuestionSchema.safeParse(raw);
  const key = Id.safeParse(rawKey);
  const api = await session();
  if (!questionId.success || !body.success || !key.success || api === null)
    return failed("Your answer wasn't sent. Try again.");
  try {
    await answerInvestorQuestion(api, questionId.data, body.data, key.data);
    return done();
  } catch {
    return failed("Your answer wasn't sent. Try again.");
  }
}

export async function newAnswerKey(): Promise<string> {
  return Promise.resolve(randomUUID());
}

export async function loadDocumentAccessAction(
  rawDocumentId: string,
): Promise<RequestResult<DocumentAccessDto>> {
  const documentId = Id.safeParse(rawDocumentId);
  const api = await session();
  if (!documentId.success || api === null)
    return failed("Access couldn't load. Try again.");
  try {
    return { ok: true, value: await getDocumentAccess(api, documentId.data) };
  } catch {
    return failed("Access couldn't load. Try again.");
  }
}

export async function loadFolderAccessAction(
  rawCompanyId: string,
  rawFolderCode: string,
): Promise<RequestResult<FolderAccessDto>> {
  const companyId = Id.safeParse(rawCompanyId);
  const folderCode = DataRoomCodeSchema.safeParse(rawFolderCode);
  const api = await session();
  if (!companyId.success || !folderCode.success || api === null)
    return failed("Access couldn't load. Try again.");
  try {
    return {
      ok: true,
      value: await getFolderAccess(api, companyId.data, folderCode.data),
    };
  } catch {
    return failed("Access couldn't load. Try again.");
  }
}

export async function shareDocumentAction(
  rawDocumentId: string,
  raw: unknown,
): Promise<RequestResult> {
  const documentId = Id.safeParse(rawDocumentId);
  const body = GrantDocumentAccessSchema.safeParse(raw);
  const api = await session();
  if (!documentId.success || !body.success || api === null)
    return failed("That wasn't shared. Try again.");
  try {
    await shareDocumentAccess(api, documentId.data, body.data);
    return done();
  } catch {
    return failed("That wasn't shared. Try again.");
  }
}

export async function shareFolderAction(
  rawCompanyId: string,
  rawFolderCode: string,
  raw: unknown,
): Promise<RequestResult> {
  const companyId = Id.safeParse(rawCompanyId);
  const folderCode = DataRoomCodeSchema.safeParse(rawFolderCode);
  const body = GrantDocumentAccessSchema.safeParse(raw);
  const api = await session();
  if (
    !companyId.success ||
    !folderCode.success ||
    !body.success ||
    api === null
  )
    return failed("That wasn't shared. Try again.");
  try {
    await shareFolderAccess(api, companyId.data, folderCode.data, body.data);
    return done();
  } catch {
    return failed("That wasn't shared. Try again.");
  }
}

export async function setFolderLevelAction(
  rawCompanyId: string,
  rawFolderCode: string,
  rawLevel: string,
): Promise<RequestResult> {
  const companyId = Id.safeParse(rawCompanyId);
  const folderCode = DataRoomCodeSchema.safeParse(rawFolderCode);
  const level = DataRoomLevelSchema.safeParse(rawLevel);
  const api = await session();
  if (
    !companyId.success ||
    !folderCode.success ||
    !level.success ||
    api === null
  )
    return failed("That didn't save. Try again.");
  try {
    await setFolderLevel(api, companyId.data, folderCode.data, level.data);
    return done();
  } catch {
    return failed("That didn't save. Try again.");
  }
}

export async function revokeAccessAction(
  rawPolicyId: string,
): Promise<RequestResult> {
  const policyId = Id.safeParse(rawPolicyId);
  const api = await session();
  if (!policyId.success || api === null)
    return failed("That didn't go through. Try again.");
  try {
    await revokeDocumentAccess(api, policyId.data);
    return done();
  } catch {
    return failed("That didn't go through. Try again.");
  }
}
