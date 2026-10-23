"use client";

import { useSyncExternalStore } from "react";

import type { QComposerAttachment } from "@capital-q/ui/q-composer";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "../onboarding-kit/material-actions";
import { setAttachedDocuments } from "./screen";

/**
 * Lane 8 (owner 2026-10-22): a document attached anywhere Q is (the Q
 * page, the dock on any page) is uploaded at once, read by the server the
 * moment it lands, and goes with the next question to Q, who answers from
 * it. One store for the tab, as the conversation is one store: the dock
 * and the Q page show the same attachments.
 *
 * Permission, then the bytes straight into private storage, then the
 * server checks what landed (QX-001 §5). A founder's file belongs to their
 * company; anyone else's to their organisation's own documents. Nothing
 * here is authority: the ids ride the screen context and the Q API reads
 * each one as the asker, or not at all.
 */

/** What the picker offers; the server's own allowlist and size limit decide. */
export const Q_ATTACH_ACCEPT =
  ".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg";

/** The server's limit (Evidence DOCUMENT_MAX_SIZE_BYTES), said before uploading. */
const MAX_BYTES = 50 * 1024 * 1024;

/** A browser often has no type for .md, or an unlisted one: named here. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/plain",
  markdown: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function mimeOf(file: { readonly name: string; readonly type: string }) {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return (
    (extension === undefined ? undefined : MIME_BY_EXTENSION[extension]) ??
    (file.type || "application/octet-stream")
  );
}

type Item = {
  readonly key: string;
  readonly name: string;
  readonly state: "uploading" | "ready" | "failed";
  readonly documentId: string | null;
  readonly note: string | null;
};

type Snapshot = {
  /** In the composer, not yet sent. */
  readonly items: readonly Item[];
  /** Sent in this conversation: read again for its follow-ups. */
  readonly sent: readonly {
    readonly documentId: string;
    readonly name: string;
  }[];
};

let snapshot: Snapshot = { items: [], sent: [] };
const listeners = new Set<() => void>();

function update(next: Snapshot): void {
  snapshot = next;
  setAttachedDocuments([
    ...next.sent.map((entry) => entry.documentId),
    ...next.items.flatMap((item) =>
      item.state === "ready" && item.documentId !== null
        ? [item.documentId]
        : [],
    ),
  ]);
  for (const listener of listeners) listener();
}

function patch(key: string, change: Partial<Item>): void {
  update({
    ...snapshot,
    items: snapshot.items.map((item) =>
      item.key === key ? { ...item, ...change } : item,
    ),
  });
}

/** Where an attached file goes; Evidence's own upload in the app. */
export type QAttachmentUpload = (input: {
  readonly file: File;
  readonly mimeType: string;
  /** One per file: a retried request is the same upload, never a second. */
  readonly idempotencyKey: string;
  readonly companyId?: string | undefined;
}) => Promise<
  | { readonly ok: true; readonly documentId: string }
  | { readonly ok: false; readonly message: string }
>;

/**
 * Permission, then the bytes straight into private storage, then the
 * server verifies what landed and queues it to be read.
 */
export const uploadThroughEvidence: QAttachmentUpload = async ({
  file,
  mimeType,
  idempotencyKey,
  companyId,
}) => {
  const target = await materialUploadTargetAction({
    ...(companyId === undefined ? {} : { companyId }),
    documentType: "UNCLASSIFIED",
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
    idempotencyKey,
  });
  if (!target.ok) return { ok: false, message: target.message };
  const put = await fetch(target.value.url, {
    method: target.value.method,
    headers: target.value.headers,
    body: file,
  });
  if (!put.ok) return { ok: false, message: "could not be uploaded" };
  const completed = await materialUploadCompleteAction(
    target.value.uploadSessionId,
    idempotencyKey,
  );
  return completed.ok
    ? { ok: true, documentId: completed.value.documentId }
    : { ok: false, message: completed.message };
};

/** Upload one file and mark it ready once the server has verified it. */
export async function attachToQ(
  file: File,
  companyId?: string,
  upload: QAttachmentUpload = uploadThroughEvidence,
): Promise<void> {
  const key = crypto.randomUUID();
  update({
    ...snapshot,
    items: [
      ...snapshot.items,
      {
        key,
        name: file.name,
        state: "uploading",
        documentId: null,
        note: null,
      },
    ],
  });
  const fail = (note: string) => patch(key, { state: "failed", note });
  if (file.size > MAX_BYTES) {
    fail("too large to read here (50 MB at most)");
    return;
  }
  try {
    const uploaded = await upload({
      file,
      mimeType: mimeOf(file),
      idempotencyKey: key,
      companyId,
    });
    if (uploaded.ok) {
      patch(key, { state: "ready", documentId: uploaded.documentId });
    } else {
      fail(uploaded.message);
    }
  } catch {
    fail("could not be uploaded");
  }
}

/**
 * What is sent when they press Send: their words, or with none, the
 * question an attached document asks by itself.
 */
export function attachmentQuestion(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > 0) return trimmed;
  const names = snapshot.items
    .filter((item) => item.state === "ready")
    .map((item) => item.name);
  if (names.length === 0) return "";
  const named =
    names.length === 1
      ? `"${names[0] ?? ""}"`
      : names.map((n) => `"${n}"`).join(", ");
  return `I've attached ${named}. Summarise it for me: what it is and its key points.`;
}

/** The question went: its ready documents stay with the conversation. */
export function markAttachmentsSent(): void {
  const ready = snapshot.items.flatMap((item) =>
    item.state === "ready" && item.documentId !== null
      ? [{ documentId: item.documentId, name: item.name }]
      : [],
  );
  if (ready.length === 0 && snapshot.items.length === 0) return;
  update({
    items: snapshot.items.filter((item) => item.state === "uploading"),
    sent: [
      ...snapshot.sent.filter(
        (entry) => !ready.some((r) => r.documentId === entry.documentId),
      ),
      ...ready,
    ].slice(-5),
  });
}

/** A new conversation starts with nothing attached. */
export function resetAttachments(): void {
  if (snapshot.items.length === 0 && snapshot.sent.length === 0) return;
  update({
    items: snapshot.items.filter((item) => item.state === "uploading"),
    sent: [],
  });
}

/**
 * Follow the conversation the surface is in: its first id adopts what was
 * sent; "New chat" or another conversation starts with nothing attached.
 */
let boundConversation: string | null = null;

export function bindAttachmentsTo(conversationId: string | null): void {
  if (boundConversation !== null && conversationId !== boundConversation) {
    resetAttachments();
  }
  boundConversation = conversationId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER: Snapshot = { items: [], sent: [] };

/** The composer's view: chips, whether Send may go, and the working line. */
export function useQAttachments(): {
  readonly attachments: readonly QComposerAttachment[];
  readonly status: string | null;
} {
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER,
  );
  const reading = current.items.find((item) => item.state === "uploading");
  return {
    attachments: current.items.map((item) => ({
      key: item.key,
      state: item.state,
      label:
        item.state === "uploading"
          ? `${item.name} · reading`
          : item.state === "failed"
            ? `${item.name} · ${item.note ?? "could not be attached"}`
            : item.name,
    })),
    status: reading === undefined ? null : `Reading ${reading.name}`,
  };
}
