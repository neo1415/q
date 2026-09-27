"use client";

import { useState, useTransition } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Input, Textarea } from "@capital-q/ui/input";

import { readEmailDraft, reviseEmailDraftAction } from "./integration-actions";

/**
 * Edit the email Q drafted (BIZ-007), on its approval card. Saving is not
 * approving: the server voids the old approval (it bound the old words)
 * and asks again for exactly these words. The recipient cannot change here.
 */
export function EmailDraftEditor({
  approvalId,
  onRevised,
}: {
  readonly approvalId: string;
  readonly onRevised: () => void;
}) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () =>
    startTransition(async () => {
      const result = await readEmailDraft(approvalId);
      if (result.ok) {
        setDraft({ subject: result.value.subject, body: result.value.body });
        setMessage(null);
      } else {
        setMessage(result.message);
      }
    });

  const save = () =>
    startTransition(async () => {
      if (draft === null) return;
      const result = await reviseEmailDraftAction(approvalId, draft);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setDraft(null);
      onRevised();
    });

  if (draft === null) {
    return (
      <div className="flex flex-col gap-1" data-email-draft="closed">
        <button
          type="button"
          className={buttonClassName("quiet", "compact", "self-start")}
          disabled={pending}
          onClick={open}
        >
          Edit email
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
    <div className="flex flex-col gap-2" data-email-draft="open">
      <Input
        id={`email-subject-${approvalId}`}
        label="Subject"
        value={draft.subject}
        maxLength={200}
        onChange={(event) =>
          setDraft({ ...draft, subject: event.target.value })
        }
      />
      <Textarea
        id={`email-body-${approvalId}`}
        label="Message"
        rows={8}
        value={draft.body}
        maxLength={10_000}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
      />
      <p className="cq-caption text-(--cq-text-tertiary)">
        Saving asks for your approval again, for exactly these words.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="cq-stage-primary"
          disabled={pending}
          onClick={save}
        >
          Save changes
        </button>
        <button
          type="button"
          className="cq-stage-control"
          disabled={pending}
          onClick={() => setDraft(null)}
        >
          Cancel
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
