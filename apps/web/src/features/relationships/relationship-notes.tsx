"use client";

import { useId, useState, useTransition } from "react";

import type {
  RelationshipNote,
  RelationshipNoteList,
} from "@capital-q/contracts";
import { RELATIONSHIP_NOTE_MAX_LENGTH } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { ICON_SIZE, Lock } from "@capital-q/ui/icons";

import { addRelationshipNoteAction } from "./relationship-notes-actions";
import type { Read } from "./record-workspace";
import { since } from "./relationships-view";
import { useT } from "@/features/i18n/language";

/** The counter shows only near the limit: a quiet field until it matters. */
const COUNTER_FROM = RELATIONSHIP_NOTE_MAX_LENGTH - 400;

/**
 * Private notes on one relationship record (CRM S3). Only the person's own
 * side reads them (the firm, or the company), never the counterpart, and
 * Q does not use them. Saving is server-confirmed: a note shows once
 * Capital Q has it. A correction is a new note; the one it replaces leaves
 * the list but stays in history.
 */
export function RelationshipNotes({
  relationshipId,
  side,
  read,
  now,
}: {
  readonly relationshipId: string;
  readonly side: "INVESTOR" | "COMPANY";
  readonly read: Read<RelationshipNoteList>;
  readonly now: number;
}) {
  const t = useT();

  const field = useId();
  const [notes, setNotes] = useState<readonly RelationshipNote[]>(
    read.kind === "READ" ? read.value.items : [],
  );
  const [draft, setDraft] = useState("");
  const [correcting, setCorrecting] = useState<RelationshipNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const who = side === "INVESTOR" ? "your firm" : "your company";

  if (read.kind === "UNAVAILABLE") {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-state="unavailable"
      >
        {t("Your notes couldn't be read just now. They are unchanged.")}
      </p>
    );
  }

  const save = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    setError(null);
    const replaced = correcting;
    startSaving(async () => {
      const result = await addRelationshipNoteAction({
        relationshipId,
        noteId: crypto.randomUUID(),
        body,
        ...(replaced === null ? {} : { supersedesNoteId: replaced.id }),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotes((current) => [
        result.note,
        ...current.filter((note) => note.id !== replaced?.id),
      ]);
      setDraft("");
      setCorrecting(null);
    });
  };

  return (
    <div className="flex flex-col gap-3" data-relationship-notes>
      <p className="cq-caption flex items-start gap-1.5 text-(--cq-text-tertiary)">
        <Lock
          size={ICON_SIZE.compact}
          aria-hidden="true"
          className="mt-px flex-none"
        />
        {t(`Only ${who} sees these. Never shared with them, never used by Q.`)}
      </p>
      {notes.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" data-state="empty">
          {t("No notes yet.")}
        </p>
      ) : (
        <ul aria-label={t("Notes")} className="flex flex-col gap-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="cq-swap flex flex-col gap-0.5 rounded-(--cq-radius-lg) bg-(--cq-surface) px-3 py-2.5"
            >
              <p className="cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)">
                {note.body}
              </p>
              <div className="cq-caption flex flex-wrap items-center gap-x-2 text-(--cq-text-tertiary)">
                <span>
                  {note.authoredByMe
                    ? t("You")
                    : t(note.authorName ?? t("A colleague"))}
                  {", "}
                  <time dateTime={note.createdAt} className="cq-numeric">
                    {t(since(note.createdAt, now))}
                  </time>
                </span>
                {note.supersedesNoteId === null ? null : (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{t("corrected")}</span>
                  </>
                )}
                {note.authoredByMe ? (
                  <button
                    type="button"
                    className="ms-auto inline-flex min-h-11 items-center px-1 text-(--cq-text-secondary) underline-offset-2 hover:text-(--cq-text-primary) hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                    onClick={() => {
                      setCorrecting(note);
                      setDraft(note.body);
                      setError(null);
                    }}
                  >
                    {t("Correct")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label htmlFor={field} className="sr-only">
          {correcting === null ? t("Add a note") : t("Correct this note")}
        </label>
        <textarea
          id={field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={RELATIONSHIP_NOTE_MAX_LENGTH}
          rows={3}
          className="cq-body-sm min-h-[84px] w-full resize-y rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2.5 text-(--cq-text-primary) transition-[border-color,box-shadow] duration-(--cq-motion-fast) placeholder:text-(--cq-text-tertiary) focus-visible:border-(--cq-text-secondary) focus-visible:shadow-[0_0_0_3px_var(--cq-accent-soft)] focus-visible:outline-none"
          placeholder={
            correcting === null ? t("Add a note") : t("Correct this note")
          }
          aria-describedby={error === null ? undefined : `${field}-error`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            // Save turns primary once there is something to save.
            variant={draft.trim().length === 0 ? "secondary" : "primary"}
            className="self-start"
            disabled={saving || draft.trim().length === 0}
          >
            {saving
              ? t("Saving…")
              : correcting === null
                ? t("Save note")
                : t("Save correction")}
          </Button>
          {correcting === null ? null : (
            <Button
              type="button"
              variant="quiet"
              disabled={saving}
              onClick={() => {
                setCorrecting(null);
                setDraft("");
              }}
            >
              {t("Cancel")}
            </Button>
          )}
          {draft.length >= COUNTER_FROM ? (
            <span className="cq-caption cq-numeric ms-auto text-(--cq-text-tertiary)">
              {RELATIONSHIP_NOTE_MAX_LENGTH - draft.length} {t("left")}
            </span>
          ) : null}
        </div>
        {error === null ? null : (
          <p
            id={`${field}-error`}
            role="alert"
            className="cq-body-sm text-(--cq-text-primary)"
          >
            {t(error)}
          </p>
        )}
      </form>
    </div>
  );
}
