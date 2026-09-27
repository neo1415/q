"use client";

import { useId, useState } from "react";

import {
  CHAT_REPORT_NOTE_MAX_LENGTH,
  CHAT_REPORT_REASONS,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { ICON_SIZE, MoreHorizontal } from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";

import {
  blockChatAction,
  reportChatAction,
  unblockChatAction,
} from "./chat-actions";

/**
 * Block and report on a relationship chat (R34 safety; doc 10).
 *
 * Both are the person's own explicit actions, each behind a confirmation:
 * Q never blocks or reports for anyone. A block stops messages both ways
 * until this side lifts it; the other side is only told it can't message
 * right now. A report goes to Capital Q's review and changes nothing on the
 * relationship.
 */

export type ChatSafetyDialog =
  | { readonly kind: "BLOCK" }
  | { readonly kind: "UNBLOCK" }
  | {
      readonly kind: "REPORT";
      /** A message of the other side's, or null for the conversation. */
      readonly messageId: string | null;
    };

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The chat's options menu: block or unblock, and report the conversation. */
export function ChatSafetyMenu({
  blockedByYourSide,
  onChoose,
}: {
  readonly blockedByYourSide: boolean;
  readonly onChoose: (dialog: ChatSafetyDialog) => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger>
        <Button variant="quiet" className="min-h-11 min-w-11" aria-label="Chat options">
          <MoreHorizontal size={ICON_SIZE.regular} aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {blockedByYourSide ? (
          <MenuItem onClick={() => onChoose({ kind: "UNBLOCK" })}>
            Unblock messages
          </MenuItem>
        ) : (
          <MenuItem onClick={() => onChoose({ kind: "BLOCK" })}>
            Block messages
          </MenuItem>
        )}
        <MenuItem onClick={() => onChoose({ kind: "REPORT", messageId: null })}>
          Report conversation
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

/** The confirmation for whichever safety action was chosen. */
export function ChatSafetyDialogs({
  relationshipId,
  counterpart,
  dialog,
  onClose,
  onDone,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly dialog: ChatSafetyDialog | null;
  readonly onClose: () => void;
  /** A plain one-line result for the panel, after the server confirmed. */
  readonly onDone: (notice: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // One key per opened dialog: a double press or a retry never writes twice.
  const [key, setKey] = useState(newKey);
  const noteId = useId();

  const close = () => {
    if (busy) return;
    setError(null);
    setReason(null);
    setNote("");
    setKey(newKey());
    onClose();
  };

  const run = async (
    work: () => Promise<{ ok: true } | { ok: false; message: string }>,
    done: string,
  ) => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReason(null);
    setNote("");
    setKey(newKey());
    onDone(done);
  };

  const open = dialog !== null;

  return (
    <DialogRoot open={open} onOpenChange={(next) => (next ? undefined : close())}>
      {dialog?.kind === "BLOCK" ? (
        <DialogContent
          title="Block messages?"
          description={`Neither of you can send messages until you unblock. Messages so far stay. ${counterpart} isn't told who blocked.`}
          actions={
            <>
              <Button variant="secondary" className="min-h-11" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => blockChatAction(relationshipId, key),
                    "Messages blocked.",
                  )
                }
              >
                {busy ? "Blocking…" : "Block messages"}
              </Button>
            </>
          }
        >
          {error === null ? null : <p role="alert">{error}</p>}
        </DialogContent>
      ) : dialog?.kind === "UNBLOCK" ? (
        <DialogContent
          title="Unblock messages?"
          description={`You and ${counterpart} can send messages again.`}
          actions={
            <>
              <Button variant="secondary" className="min-h-11" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => unblockChatAction(relationshipId, key),
                    "Messages unblocked.",
                  )
                }
              >
                {busy ? "Unblocking…" : "Unblock messages"}
              </Button>
            </>
          }
        >
          {error === null ? null : <p role="alert">{error}</p>}
        </DialogContent>
      ) : dialog?.kind === "REPORT" ? (
        <DialogContent
          title={dialog.messageId === null ? "Report conversation?" : "Report message?"}
          description={`Capital Q reviews every report. ${counterpart} isn't told who reported. Reporting doesn't block messages.`}
          actions={
            <>
              <Button variant="secondary" className="min-h-11" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={busy || reason === null}
                onClick={() => {
                  if (reason === null) return;
                  const trimmed = note.trim();
                  void run(
                    () =>
                      reportChatAction(
                        relationshipId,
                        {
                          reasonCode: reason,
                          ...(dialog.messageId === null
                            ? {}
                            : { messageId: dialog.messageId }),
                          ...(trimmed.length === 0 ? {} : { note: trimmed }),
                        },
                        key,
                      ),
                    "Report sent. Capital Q will review it.",
                  );
                }}
              >
                {busy ? "Sending…" : "Send report"}
              </Button>
            </>
          }
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="cq-body-sm mb-1 text-(--cq-text-secondary)">
              Why are you reporting this?
            </legend>
            {CHAT_REPORT_REASONS.map((option) => (
              <label
                key={option.code}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-(--cq-surface-subtle)"
              >
                <input
                  type="radio"
                  name="chat-report-reason"
                  value={option.code}
                  checked={reason === option.code}
                  onChange={() => setReason(option.code)}
                  className="size-4 accent-(--cq-accent)"
                />
                <span className="cq-body">{option.label}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor={noteId} className="cq-body-sm mt-3 block text-(--cq-text-secondary)">
            Add detail (optional)
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={CHAT_REPORT_NOTE_MAX_LENGTH}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            className="cq-body mt-1 min-h-11 w-full resize-y rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
          />
          {error === null ? null : (
            <p role="alert" className="mt-2">
              {error}
            </p>
          )}
        </DialogContent>
      ) : null}
    </DialogRoot>
  );
}
