"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import {
  draftPassNote,
  type PassReasonListDto,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";

import {
  passAction,
  passReasonsAction,
  pauseAction,
  resumeAction,
} from "./outcome-actions";
import { RecordSheet } from "./record-parts";
import { useT } from "@/features/i18n/language";

/**
 * The record's Decision (record option 3): keep going, pause, or not
 * proceeding for now, as three plain choices. Pausing is quiet -- nothing
 * is sent to them. Not proceeding opens a draft note to edit; nothing is
 * sent until the person approves that exact text, under a key made for
 * exactly that text (an edit makes a new key, so a retried press records
 * once and an edited one is a new approval). Every change is
 * server-confirmed and the page re-read. Not proceeding is neutral, never
 * red.
 */

type Choice = "KEEP" | "PAUSE" | "PASS";

const newKey = () => `web-pass-${crypto.randomUUID()}`;

export function DecisionChoice({
  relationshipId,
  state,
  counterpart,
}: {
  readonly relationshipId: string;
  readonly state: RelationshipStateV2;
  readonly counterpart: string;
}) {
  const t = useT();
  const router = useRouter();
  const current: Choice = state === "PAUSED" ? "PAUSE" : "KEEP";
  const [shown, setShown] = useState<Choice>(current);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passing, setPassing] = useState(false);

  const options: readonly {
    readonly choice: Choice;
    readonly title: string;
    readonly sub: string;
  }[] = [
    {
      choice: "KEEP",
      title: "Keep going",
      sub:
        state === "IN_DILIGENCE"
          ? "Continue diligence"
          : state === "PAUSED"
            ? "Pick it up again"
            : "Carry on as you are",
    },
    { choice: "PAUSE", title: "Pause for now", sub: "Nothing is sent to them" },
    {
      choice: "PASS",
      title: "Not proceeding for now",
      sub: "A respectful note for you to review first",
    },
  ];

  const choose = (choice: Choice) => {
    setError(null);
    if (choice === "PASS") {
      setShown("PASS");
      setPassing(true);
      return;
    }
    if (choice === current) {
      setShown(choice);
      return;
    }
    setShown(choice);
    setBusy(choice);
    const work = choice === "PAUSE" ? pauseAction : resumeAction;
    void work(relationshipId).then((result) => {
      setBusy(null);
      if (result.ok) router.refresh();
      else {
        setShown(current);
        setError(result.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label={t("Decision")}
        className="flex flex-col gap-2"
        data-decision-choice={current}
      >
        {options.map((option) => {
          const on = shown === option.choice;
          return (
            <button
              key={option.choice}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy !== null}
              onClick={() => choose(option.choice)}
              className={cx(
                "flex min-h-[52px] items-center gap-3 rounded-(--cq-radius-lg) border px-3.5 py-2.5 text-start transition-[border-color,background-color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-70",
                on
                  ? "border-[var(--cq-tile,var(--cq-text-primary))] bg-(--cq-surface) shadow-[0_0_0_1px_var(--cq-tile,var(--cq-text-primary))]"
                  : "border-(--cq-border) bg-(--cq-surface-raised) hover:border-(--cq-border-strong)",
              )}
              data-choice={option.choice}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "grid size-[18px] flex-none place-items-center rounded-full border-[1.5px]",
                  on
                    ? "border-[var(--cq-tile,var(--cq-text-primary))]"
                    : "border-(--cq-border)",
                )}
              >
                {on ? (
                  <span className="size-2 rounded-full bg-[var(--cq-tile,var(--cq-text-primary))]" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="cq-body-sm font-semibold text-(--cq-text-primary)">
                  {busy === option.choice
                    ? t(option.choice === "PAUSE" ? "Pausing…" : "Resuming…")
                    : t(option.title)}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {t(option.sub)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {t(error)}
        </p>
      )}
      <NotProceedingSheet
        open={passing}
        relationshipId={relationshipId}
        counterpart={counterpart}
        onClose={(recorded) => {
          setPassing(false);
          if (recorded) router.refresh();
          else setShown(current);
        }}
      />
    </div>
  );
}

function NotProceedingSheet({
  open,
  relationshipId,
  counterpart,
  onClose,
}: {
  readonly open: boolean;
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly onClose: (recorded: boolean) => void;
}) {
  const t = useT();
  const noteId = useId();
  const [reasons, setReasons] = useState<PassReasonListDto["items"]>([]);
  const [reason, setReason] = useState<string | null>(null);
  // The draft is kept while the sheet is closed ("Keep as draft").
  const [note, setNote] = useState(() =>
    draftPassNote({ companyName: counterpart, reasonCode: null }),
  );
  const [edited, setEdited] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || reasons.length > 0) return;
    void passReasonsAction()
      .then((result) => {
        if (result.ok) setReasons(result.value.items);
      })
      .catch(() => undefined);
  }, [open, reasons.length]);

  const trimmed = note.trim();
  const approve = () => {
    setBusy(true);
    setError(null);
    void passAction(
      relationshipId,
      {
        reasonCode: reason,
        note: trimmed.length === 0 ? null : trimmed,
        // The note is what they read; with no note nothing is shared.
        shareWithFounder: trimmed.length > 0,
      },
      key,
    ).then((result) => {
      setBusy(false);
      if (result.ok) onClose(true);
      else setError(result.message);
    });
  };

  return (
    <RecordSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose(false);
      }}
      title={t("Not proceeding for now")}
      description={t(`${counterpart} will see a short, respectful note`)}
      charcoal
    >
      <div className="flex flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4">
        <label
          htmlFor={noteId}
          className="cq-body-sm font-medium text-(--cq-text-secondary)"
        >
          {t("Draft note, for you to edit")}
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={1000}
          rows={5}
          onChange={(event) => {
            setNote(event.target.value);
            setEdited(true);
            setKey(newKey());
          }}
          className="cq-body min-h-28 w-full resize-y rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface-raised) px-3 py-2.5 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        />
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t("Nothing is sent until you approve this exact text.")}
        </span>
      </div>
      {reasons.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="cq-body-sm mb-1 font-medium text-(--cq-text-secondary)">
            {t("Reason (optional)")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {reasons.map((option) => {
              const on = reason === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? null : option.code;
                    setReason(next);
                    setKey(newKey());
                    // A draft nobody has touched follows the reason.
                    if (!edited) {
                      setNote(
                        draftPassNote({
                          companyName: counterpart,
                          reasonCode: next,
                        }),
                      );
                    }
                  }}
                  className={cx(
                    "cq-body-sm inline-flex min-h-11 items-center rounded-full border px-3.5 font-medium transition-colors duration-(--cq-motion-fast)",
                    on
                      ? "border-transparent bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                      : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:border-(--cq-border-strong)",
                  )}
                >
                  {t(option.label)}
                </button>
              );
            })}
          </div>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(
              "Stays with your organisation unless you send the note; then they see it with the note.",
            )}
          </span>
        </fieldset>
      )}
      {error === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
          {t(error)}
        </p>
      )}
      <Button variant="primary" disabled={busy} onClick={approve}>
        {busy
          ? t("Sending…")
          : trimmed.length === 0
            ? t("Record as not proceeding")
            : t("Approve and send")}
      </Button>
      <Button variant="quiet" disabled={busy} onClick={() => onClose(false)}>
        {t("Keep as draft")}
      </Button>
    </RecordSheet>
  );
}
