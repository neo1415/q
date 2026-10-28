"use client";

import { useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Textarea } from "@capital-q/ui/input";

import { readChatDraft, reviseChatDraftAction } from "./integration-actions";
import { useT } from "@/features/i18n/language";

/**
 * Edit the chat message Q drafted, on its approval card (live 2026-10-28:
 * the email was editable there, the chat reply was not). Exactly as the
 * email editor: saving is not approving; the server voids the old
 * approval (it bound the old words) and asks again for exactly these
 * words. The other side cannot change here.
 */
export function ChatDraftEditor({
  approvalId,
  onRevised,
}: {
  readonly approvalId: string;
  readonly onRevised: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<{ body: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () =>
    startTransition(async () => {
      const result = await readChatDraft(approvalId);
      if (result.ok) {
        setDraft({ body: result.value.body });
        setMessage(null);
      } else {
        setMessage(result.message);
      }
    });

  const save = () =>
    startTransition(async () => {
      if (draft === null) return;
      const result = await reviseChatDraftAction(approvalId, draft);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setDraft(null);
      onRevised();
    });

  if (draft === null) {
    return (
      <div className="flex flex-col gap-1" data-chat-draft="closed">
        <button
          type="button"
          className={buttonClassName("quiet", "compact", "self-start")}
          disabled={pending}
          onClick={open}
        >
          {t("Edit message")}
        </button>
        {message !== null ? (
          <p role="status" className="cq-caption text-(--cq-text-secondary)">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-chat-draft="open">
      <Textarea
        id={`chat-body-${approvalId}`}
        label={t("Message")}
        rows={6}
        value={draft.body}
        maxLength={4000}
        onChange={(event) => setDraft({ body: event.target.value })}
      />
      <p className="cq-caption text-(--cq-text-tertiary)">
        {t("Saving asks for your approval again, for exactly these words.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="cq-stage-primary"
          disabled={pending}
          onClick={save}
        >
          {t("Save changes")}
        </button>
        <button
          type="button"
          className="cq-stage-control"
          disabled={pending}
          onClick={() => setDraft(null)}
        >
          {t("Cancel")}
        </button>
      </div>
      {message !== null ? (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      ) : null}
    </div>
  );
}
