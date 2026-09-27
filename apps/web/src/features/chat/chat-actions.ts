"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ApiProblemError,
  blockChat,
  getChatAttachment,
  getChatThread,
  listDocuments,
  markChatRead,
  reportChat,
  sendChatMessage,
  unblockChat,
  unsendChatMessage,
  type ApiSession,
} from "@capital-q/api-client";
import {
  CHAT_REPORT_NOTE_MAX_LENGTH,
  ChatMessageBodySchema,
  ChatReportReasonCodeSchema,
  type ChatMessageDto,
  type ChatThreadDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Relationship chat, server side (R34). Server actions so the session token
 * never reaches the browser. The relationship id is input here, as it is
 * to the API: the API decides whether this person is a party. Every send
 * carries a fresh idempotency key made once per press, by the browser, so
 * a retry of the same press cannot post twice.
 */

export type ChatActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: "NOT_READY" | "CLOSED" | "REJECTED" | "NETWORK";
      readonly message: string;
    };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<ChatActionResult<T>> {
  const session = await apiSession();
  if (session === null) {
    return {
      ok: false,
      kind: "REJECTED",
      message: "Your session ended. Sign in again to continue.",
    };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status < 500) {
      const detail = error.problem?.detail;
      return {
        ok: false,
        kind:
          error.status === 409
            ? "CLOSED"
            : error.status === 422 && detail?.includes("being checked") === true
              ? "NOT_READY"
              : "REJECTED",
        message:
          error.status === 404
            ? "This conversation isn't available."
            : (detail ?? "That didn't send. Try again."),
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

export async function chatThreadAction(
  rawRelationshipId: string,
  rawAfter?: string | null,
): Promise<ChatActionResult<ChatThreadDto>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const after =
    rawAfter === null || rawAfter === undefined
      ? undefined
      : Id.parse(rawAfter);
  return run((session) => getChatThread(session, relationshipId, after));
}

const SendInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), body: ChatMessageBodySchema }),
  z.object({
    kind: z.literal("ATTACHMENT"),
    documentId: Id,
    body: ChatMessageBodySchema.optional(),
  }),
  z.object({
    kind: z.literal("VOICE_NOTE"),
    documentId: Id,
    durationMs: z.number().int().min(1).max(600_000),
  }),
]);

export async function sendChatMessageAction(
  rawRelationshipId: string,
  rawMessage: unknown,
  rawKey: string,
): Promise<ChatActionResult<ChatMessageDto>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const message = SendInput.parse(rawMessage);
  const key = Key.parse(rawKey);
  return run(
    async (session) =>
      (await sendChatMessage(session, relationshipId, message, `web:${key}`))
        .message,
  );
}

export async function markChatReadAction(
  rawRelationshipId: string,
  rawMessageId: string,
): Promise<ChatActionResult<null>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const messageId = Id.parse(rawMessageId);
  return run(async (session) => {
    await markChatRead(session, relationshipId, messageId);
    return null;
  });
}

export async function unsendChatMessageAction(
  rawRelationshipId: string,
  rawMessageId: string,
): Promise<ChatActionResult<null>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const messageId = Id.parse(rawMessageId);
  return run(async (session) => {
    await unsendChatMessage(
      session,
      relationshipId,
      messageId,
      `web:unsend:${randomUUID()}`,
    );
    return null;
  });
}

/** The person's own organisation's documents, to share one. */
export async function shareableDocumentsAction(): Promise<
  ChatActionResult<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly ready: boolean;
    }[]
  >
> {
  return run(async (session) =>
    (await listDocuments(session)).documents.slice(0, 50).map((document) => ({
      id: document.id,
      name: document.currentVersion?.originalFilename ?? document.title,
      ready: document.currentVersion?.malwareScanStatus === "CLEAN",
    })),
  );
}

/**
 * A one-minute signed read of a shared file or voice note. The browser
 * fetches the bytes from storage directly; the URL is used once and never
 * kept.
 */
export async function chatAttachmentAction(
  rawRelationshipId: string,
  rawMessageId: string,
): Promise<
  ChatActionResult<{ readonly url: string; readonly mimeType: string }>
> {
  const relationshipId = Id.parse(rawRelationshipId);
  const messageId = Id.parse(rawMessageId);
  return run(async (session) => {
    const access = await getChatAttachment(session, relationshipId, messageId);
    return { url: access.url, mimeType: access.mimeType };
  });
}

// --- Block and report (R34 safety) -------------------------------------------
// Each press carries a key made once by the browser, so a retry of the
// same press never writes twice.

export async function blockChatAction(
  rawRelationshipId: string,
  rawKey: string,
): Promise<ChatActionResult<null>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const key = Key.parse(rawKey);
  return run(async (session) => {
    await blockChat(session, relationshipId, `web:block:${key}`);
    return null;
  });
}

export async function unblockChatAction(
  rawRelationshipId: string,
  rawKey: string,
): Promise<ChatActionResult<null>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const key = Key.parse(rawKey);
  return run(async (session) => {
    await unblockChat(session, relationshipId, `web:unblock:${key}`);
    return null;
  });
}

const ReportInput = z
  .object({
    reasonCode: ChatReportReasonCodeSchema,
    messageId: Id.optional(),
    note: z.string().trim().max(CHAT_REPORT_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

export async function reportChatAction(
  rawRelationshipId: string,
  rawReport: unknown,
  rawKey: string,
): Promise<ChatActionResult<null>> {
  const relationshipId = Id.parse(rawRelationshipId);
  const report = ReportInput.parse(rawReport);
  const key = Key.parse(rawKey);
  const note =
    report.note === undefined || report.note.length === 0
      ? undefined
      : report.note;
  return run(async (session) => {
    await reportChat(
      session,
      relationshipId,
      {
        reasonCode: report.reasonCode,
        ...(report.messageId === undefined
          ? {}
          : { messageId: report.messageId }),
        ...(note === undefined ? {} : { note }),
      },
      `web:report:${key}`,
    );
    return null;
  });
}
