"use client";

import { useEffect, useState } from "react";

import { QComposer } from "@capital-q/ui/q-composer";

import { WorkingLine } from "@/components/working/working-line";
import {
  attachmentQuestion,
  attachToQ,
  bindAttachmentsTo,
  markAttachmentsSent,
  Q_ATTACH_ACCEPT,
  useQAttachments,
  type QAttachmentUpload,
} from "@/features/q/q-attachments";
import { currentScreen } from "@/features/q/screen";

const UPLOAD = "/dev/q-attach/upload";
const ASK = "/dev/q-attach/ask";

/** The fixture's upload: the bytes and their name, a document id back. */
const upload: QAttachmentUpload = async ({
  file,
  mimeType,
  idempotencyKey,
}) => {
  const response = await fetch(UPLOAD, {
    method: "POST",
    headers: {
      "content-type": mimeType,
      "x-file-name": encodeURIComponent(file.name),
      "idempotency-key": idempotencyKey,
    },
    body: file,
  });
  if (!response.ok) return { ok: false, message: "could not be uploaded" };
  const body = (await response.json()) as { documentId?: unknown };
  return typeof body.documentId === "string"
    ? { ok: true, documentId: body.documentId }
    : { ok: false, message: "could not be uploaded" };
};

type Turn = { readonly role: "you" | "q"; readonly text: string };

export function QAttachHarness() {
  const attached = useQAttachments();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [working, setWorking] = useState(false);
  const [conversation, setConversation] = useState(1);
  useEffect(() => {
    bindAttachmentsTo(`harness-${String(conversation)}`);
  }, [conversation]);

  const ask = async (typed: string) => {
    const question = attachmentQuestion(typed);
    if (question.length === 0) return;
    setTurns((current) => [...current, { role: "you", text: question }]);
    setWorking(true);
    try {
      // What the app sends: the question and the screen, ids and all.
      const response = await fetch(ASK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, screen: currentScreen("/home") }),
      });
      markAttachmentsSent();
      const body = (await response.json()) as { answer?: unknown };
      setTurns((current) => [
        ...current,
        {
          role: "q",
          text: typeof body.answer === "string" ? body.answer : "",
        },
      ]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col gap-4 bg-(--cq-surface) px-4 py-6 text-(--cq-text-primary)">
      <div className="flex items-center justify-between">
        <h1 className="cq-title">Q</h1>
        <button
          type="button"
          className="min-h-11 rounded-md px-3 cq-label text-(--cq-accent)"
          onClick={() => {
            setTurns([]);
            setConversation((current) => current + 1);
          }}
          data-new-chat
        >
          New chat
        </button>
      </div>
      <ol className="flex flex-1 flex-col gap-3" data-turns>
        {turns.map((turn, index) => (
          <li
            key={`${String(index)}-${turn.role}`}
            className={
              turn.role === "you"
                ? "cq-body self-end rounded-lg bg-(--cq-surface-sunken) px-3 py-2"
                : "cq-body self-start whitespace-pre-line"
            }
            data-turn={turn.role}
          >
            {turn.text}
          </li>
        ))}
        {working ? (
          <li>
            <WorkingLine label="Reading what you sent" active />
          </li>
        ) : null}
      </ol>
      <QComposer
        id="q-attach"
        showContext={false}
        placeholder="Message Q"
        disabled={working}
        onSubmit={ask}
        onAttach={(file) => attachToQ(file, undefined, upload)}
        attachLabel="Attach a document"
        attachAccept={Q_ATTACH_ACCEPT}
        attachments={attached.attachments}
        {...(attached.status === null
          ? {}
          : {
              attachmentStatus: <WorkingLine label={attached.status} active />,
            })}
      />
    </main>
  );
}
