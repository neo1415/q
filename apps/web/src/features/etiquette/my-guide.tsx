"use client";

import { useState, useTransition } from "react";

import {
  PERSONAL_ETIQUETTE_TEXT_MAX,
  type MyEtiquetteGuideDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { removeMyGuideAction, saveMyGuideAction } from "./etiquette-actions";
import { EMPTY_DRAFT, GuideInput, type GuideDraft } from "./guide-input";

/**
 * How Q speaks for you (ADR 0050): the person's own guide to their tone,
 * formality, phrases to avoid, sign-off and what never to say. Private to
 * them. They can read it, replace it (each save is a new version) or remove
 * it. Q follows it whenever it writes or speaks for them, within the rules
 * nothing can change: it shapes wording, never what Q may do.
 */

const PLACEHOLDER = `For example:
- Formal with investors, first names with founders once they use mine.
- Never use exclamation marks or "hope this finds you well".
- Sign off "Kind regards, Ada".
- Never mention our other investors by name.`;

function savedOn(at: string): string {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MyGuide({
  initial,
}: {
  readonly initial: MyEtiquetteGuideDto;
}) {
  const [mine, setMine] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GuideDraft>(EMPTY_DRAFT);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const guide = mine.guide;
  const house =
    mine.house.source === "BUILT_IN"
      ? "Capital Q's house guide"
      : `your organisation's house guide, "${mine.house.title}"`;

  const startEditing = () => {
    setDraft(
      guide === null
        ? EMPTY_DRAFT
        : {
            sourceKind: guide.sourceKind,
            fileName: guide.fileName,
            mediaType: guide.mediaType,
            text: guide.text,
          },
    );
    setMessage(null);
    setEditing(true);
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveMyGuideAction(draft);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMine(result.mine);
      setEditing(false);
      setMessage("Saved. Q follows it from its next message for you.");
    });
  };

  const remove = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await removeMyGuideAction();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMine(result.mine);
      setEditing(false);
      setMessage(`Removed. Q follows ${house} alone.`);
    });
  };

  // A row of the Settings card's list: its term is read by screen readers.
  return (
    <div className="px-5 py-4">
      <dt className="sr-only">Your guide</dt>
      <dd className="flex flex-col gap-4">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Tell Q how you like to come across when it writes or speaks for you:
          your tone, how formal to be, phrases to avoid, your sign-off, and
          anything it must never say. Only you can see it. Q always follows{" "}
          {house} too, and yours wins on style. It shapes Q&apos;s wording; it
          never lets Q do or say anything it otherwise couldn&apos;t.
        </p>

        {editing ? (
          <div className="flex flex-col gap-3">
            <GuideInput
              label="Your guide"
              placeholder={PLACEHOLDER}
              maxCharacters={PERSONAL_ETIQUETTE_TEXT_MAX}
              draft={draft}
              onChange={setDraft}
              disabled={pending}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={save}
                disabled={pending || draft.text.trim().length === 0}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="quiet"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : guide === null ? (
          <div>
            <Button onClick={startEditing}>Write your guide</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="cq-caption text-(--cq-text-tertiary)">
              Version {guide.version} · saved {savedOn(guide.savedAt)}
              {guide.fileName === null ? "" : ` · from ${guide.fileName}`}
            </p>
            <div className="cq-body-sm max-h-64 overflow-y-auto rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-3 whitespace-pre-wrap text-(--cq-text-primary)">
              {guide.text}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={startEditing} disabled={pending}>
                Replace
              </Button>
              <Button variant="quiet" onClick={remove} disabled={pending}>
                {pending ? "Removing…" : "Remove"}
              </Button>
            </div>
          </div>
        )}

        {message === null ? null : (
          <p role="status" className="cq-caption text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </dd>
    </div>
  );
}
