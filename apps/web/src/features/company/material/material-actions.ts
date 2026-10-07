"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  confirmDeckReading,
  decideDataRoomRequest,
  openCompanyDeck,
  openDataRoomDocument,
  readDeckAgain,
  requestDataRoomAccess,
  reviewDeckSection,
  setDataRoomLevel,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  DATA_ROOM_GRANT_DAYS,
  DataRoomLevelSchema,
  DeckSectionCodeSchema,
  DeckSectionReviewActionSchema,
  SetDataRoomLevelRequestSchema,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The profile's Data room and Pitch deck actions, server side (overnight
 * A3-A5). The access token never leaves the server; a file is only ever a
 * short-lived signed URL the browser follows straight to storage. Whether
 * the reader may do any of this is entirely the API's decision; a refusal
 * reads the same whatever its reason.
 */

const Id = z.string().uuid();

export type MaterialResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

async function session() {
  const { apiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  return apiBaseUrl === undefined || accessToken === null
    ? null
    : { baseUrl: apiBaseUrl, accessToken };
}

const failed = <T>(message: string): MaterialResult<T> => ({
  ok: false,
  message,
});

export type OpenedFile = {
  readonly url: string;
  readonly downloadable: boolean;
  readonly watermark: string | null;
};

export async function openDocumentAction(
  rawCompanyId: string,
  rawDocumentId: string,
): Promise<MaterialResult<OpenedFile>> {
  const companyId = Id.safeParse(rawCompanyId);
  const documentId = Id.safeParse(rawDocumentId);
  const api = await session();
  if (!companyId.success || !documentId.success || api === null)
    return failed("That couldn't be opened. Try again.");
  try {
    const link = await openDataRoomDocument(
      api,
      companyId.data,
      documentId.data,
    );
    return {
      ok: true,
      value: {
        url: link.url,
        downloadable: link.downloadable,
        watermark: link.watermark,
      },
    };
  } catch {
    return failed("That couldn't be opened. Try again.");
  }
}

export async function openDeckAction(
  rawCompanyId: string,
): Promise<MaterialResult<OpenedFile>> {
  const companyId = Id.safeParse(rawCompanyId);
  const api = await session();
  if (!companyId.success || api === null)
    return failed("The deck couldn't be opened. Try again.");
  try {
    const link = await openCompanyDeck(api, companyId.data);
    return {
      ok: true,
      value: {
        url: link.url,
        downloadable: link.downloadable,
        watermark: link.watermark,
      },
    };
  } catch {
    return failed("The deck couldn't be opened. Try again.");
  }
}

export async function requestAccessAction(input: {
  readonly companyId: string;
  readonly documentId: string | null;
  readonly note: string;
  readonly idempotencyKey: string;
}): Promise<MaterialResult> {
  const companyId = Id.safeParse(input.companyId);
  const documentId =
    input.documentId === null ? null : Id.safeParse(input.documentId);
  const note = input.note.trim().slice(0, 1000);
  const key = z.string().min(8).max(200).safeParse(input.idempotencyKey);
  const api = await session();
  if (
    !companyId.success ||
    (documentId !== null && !documentId.success) ||
    !key.success ||
    api === null
  ) {
    return failed("The request wasn't sent. Try again.");
  }
  try {
    await requestDataRoomAccess(
      api,
      companyId.data,
      {
        documentId: documentId === null ? null : (documentId.data ?? null),
        ...(note === "" ? {} : { note }),
      },
      key.data,
    );
    revalidatePath(`/company/${companyId.data}`);
    return { ok: true, value: undefined };
  } catch {
    return failed("The request wasn't sent. Try again.");
  }
}

export async function decideRequestAction(input: {
  readonly companyId: string;
  readonly requestId: string;
  readonly decision: "APPROVE" | "DECLINE";
  readonly days: number;
}): Promise<MaterialResult> {
  const requestId = Id.safeParse(input.requestId);
  const api = await session();
  if (!requestId.success || api === null)
    return failed("That didn't go through. Try again.");
  const days = (DATA_ROOM_GRANT_DAYS as readonly number[]).includes(input.days)
    ? input.days
    : 30;
  try {
    await decideDataRoomRequest(
      api,
      requestId.data,
      input.decision === "APPROVE"
        ? { decision: "APPROVE", days }
        : { decision: "DECLINE" },
    );
    revalidatePath(`/company/${input.companyId}`);
    return { ok: true, value: undefined };
  } catch {
    return failed("That didn't go through. Try again.");
  }
}

export async function setLevelAction(input: {
  readonly companyId: string;
  readonly documentId: string;
  readonly level: string;
  readonly version: number;
  /** F10: file it in a folder, and (optionally) as a checklist item. */
  readonly folderCode?: string | undefined;
  readonly checklistItemCode?: string | null | undefined;
}): Promise<MaterialResult> {
  const documentId = Id.safeParse(input.documentId);
  const level = DataRoomLevelSchema.safeParse(input.level);
  const filing = SetDataRoomLevelRequestSchema.pick({
    folderCode: true,
    checklistItemCode: true,
  }).safeParse({
    ...(input.folderCode === undefined ? {} : { folderCode: input.folderCode }),
    ...(input.checklistItemCode === undefined
      ? {}
      : { checklistItemCode: input.checklistItemCode }),
  });
  const api = await session();
  if (!documentId.success || !level.success || !filing.success || api === null)
    return failed("That didn't save. Try again.");
  try {
    await setDataRoomLevel(api, documentId.data, {
      level: level.data,
      expectedVersion: input.version,
      ...filing.data,
    });
    revalidatePath(`/company/${input.companyId}`);
    return { ok: true, value: undefined };
  } catch {
    return failed(
      "That didn't save. Someone may have changed it; refresh and try again.",
    );
  }
}

export async function confirmReadingAction(input: {
  readonly companyId: string;
  readonly documentId: string;
  readonly extractionId: string;
}): Promise<MaterialResult> {
  const ids = z
    .tuple([Id, Id, Id])
    .safeParse([input.companyId, input.documentId, input.extractionId]);
  const api = await session();
  if (!ids.success || api === null)
    return failed("That didn't go through. Try again.");
  try {
    await confirmDeckReading(api, ids.data[0], ids.data[1], ids.data[2]);
    revalidatePath(`/company/${ids.data[0]}`);
    return { ok: true, value: undefined };
  } catch {
    return failed(
      "That reading is out of date. Refresh to see Q's newest read.",
    );
  }
}

/** F26: confirm, mark as wrong, or correct one section of Q's read. */
export async function reviewSectionAction(input: {
  readonly companyId: string;
  readonly documentId: string;
  readonly extractionId: string;
  readonly section: string;
  readonly action: string;
  readonly correction: string | null;
}): Promise<MaterialResult> {
  const ids = z
    .tuple([Id, Id, Id])
    .safeParse([input.companyId, input.documentId, input.extractionId]);
  const section = DeckSectionCodeSchema.safeParse(input.section);
  const action = DeckSectionReviewActionSchema.safeParse(input.action);
  const correction =
    input.correction === null ? null : input.correction.trim().slice(0, 600);
  const api = await session();
  if (
    !ids.success ||
    !section.success ||
    !action.success ||
    api === null ||
    (action.data === "CORRECT") !== (correction !== null && correction !== "")
  )
    return failed("That didn't go through. Try again.");
  try {
    await reviewDeckSection(api, {
      companyId: ids.data[0],
      documentId: ids.data[1],
      extractionId: ids.data[2],
      section: section.data,
      action: action.data,
      correction: action.data === "CORRECT" ? correction : null,
    });
    revalidatePath(`/company/${ids.data[0]}`);
    return { ok: true, value: undefined };
  } catch {
    return failed(
      "That reading is out of date. Refresh to see Q's newest read.",
    );
  }
}

/** F26: ask Q to read the current deck version again (twice at most). */
export async function readAgainAction(input: {
  readonly companyId: string;
  readonly documentId: string;
  readonly extractionId: string;
}): Promise<MaterialResult<{ readonly left: number }>> {
  const ids = z
    .tuple([Id, Id, Id])
    .safeParse([input.companyId, input.documentId, input.extractionId]);
  const api = await session();
  if (!ids.success || api === null)
    return failed("That didn't go through. Try again.");
  try {
    const result = await readDeckAgain(
      api,
      ids.data[0],
      ids.data[1],
      ids.data[2],
    );
    revalidatePath(`/company/${ids.data[0]}`);
    return { ok: true, value: { left: result.left } };
  } catch {
    return failed(
      "Q has already read this version again twice, or the reading changed. Refresh, or correct the section yourself.",
    );
  }
}

/** A fresh key per press, minted server side. */
export async function newRequestKey(): Promise<string> {
  return Promise.resolve(`dr-${randomUUID()}`);
}
