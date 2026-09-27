"use client";

import { useRouter } from "next/navigation";
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button, buttonClassName } from "@capital-q/ui/button";
import { Input, Textarea } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";
import { cx } from "@capital-q/ui";

import { SourcesDisclosure } from "@/components/sources-disclosure";

import {
  saveCompanyFieldAction,
  saveInvestorFieldAction,
  savePersonFieldAction,
  type ProfileSaveResult,
} from "./profile-actions";
import {
  displayValue,
  normaliseDraft,
  type FieldSpec,
  type ProfileKind,
} from "./profile-fields";

/**
 * One editable profile (BIZ-002): the person's own, their company's or
 * their investor organisation's declared fields, each editable in place.
 *
 * A row reads as a statement, not a form: label, value, and a quiet line
 * saying where the value came from on ADR-001's axes. "Edit" turns that
 * one row into a field; Enter (or Save) sends it with the version this
 * page holds, Escape (or Cancel) puts it back. Nothing is shown as saved
 * until the server says it is -- a profile edit is a statement about the
 * company, so it is server-confirmed, never optimistic. Unknown reads as
 * "Not stated", never as blank or zero.
 */

export type EditableProfileProps = {
  readonly kind: ProfileKind;
  /** The company or investor organisation id; absent for the person's own profile. */
  readonly subjectId?: string | undefined;
  readonly fields: readonly FieldSpec<string>[];
  readonly values: Readonly<Record<string, string | null>>;
  readonly version: number;
  /**
   * How a declared value is described on the three axes, in words, e.g.
   * "Your statement · self-reported". The same for every declared field:
   * the profile holds what the person said, nothing more. Said once, one
   * tap away under "Sources", not beneath every value (R23; ADR 0018).
   */
  readonly provenance: string;
  /** False when the server says this person may view but not edit. */
  readonly editable?: boolean | undefined;
};

function save(
  kind: ProfileKind,
  subjectId: string | undefined,
  field: string,
  value: string | null,
  version: number,
): Promise<ProfileSaveResult> {
  switch (kind) {
    case "PERSON":
      return savePersonFieldAction(field, value, version);
    case "COMPANY":
      return saveCompanyFieldAction(subjectId ?? "", field, value, version);
    case "INVESTOR_ORGANISATION":
      return saveInvestorFieldAction(subjectId ?? "", field, value, version);
  }
}

export function EditableProfile({
  kind,
  subjectId,
  fields,
  values: initialValues,
  version: initialVersion,
  provenance,
  editable = true,
}: EditableProfileProps) {
  const [values, setValues] = useState(initialValues);
  const [version, setVersion] = useState(initialVersion);
  const [editing, setEditing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const router = useRouter();

  return (
    <div className="flex flex-col">
      {conflict === null ? null : (
        <div
          role="alert"
          data-profile-conflict
          className="mb-3 flex flex-col gap-3 border-l-2 border-(--cq-warning) py-1 pl-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="cq-body-sm text-(--cq-text-primary)">{conflict}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setConflict(null);
              router.refresh();
            }}
          >
            Reload
          </Button>
        </div>
      )}
      <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {fields.map((spec) => (
          <EditableRow
            key={spec.field}
            spec={spec}
            value={values[spec.field] ?? null}
            editable={editable}
            editing={editing === spec.field}
            onEdit={() => setEditing(spec.field)}
            onCancel={() => setEditing(null)}
            onSave={async (next) => {
              const result = await save(
                kind,
                subjectId,
                spec.field,
                next,
                version,
              );
              if (result.ok) {
                setValues((current) => ({
                  ...current,
                  [spec.field]: result.value,
                }));
                setVersion(result.version);
                setEditing(null);
                setAnnouncement(`${spec.label} saved.`);
                return null;
              }
              if (result.reason === "CONFLICT") {
                setEditing(null);
                setConflict(result.message);
                return null;
              }
              return result.message;
            }}
          />
        ))}
      </dl>
      <SourcesDisclosure>
        <p className="cq-caption text-(--cq-text-secondary)">
          {provenance}. Every value above is what was stated here; nothing in it
          is verified unless Capital Q says so.
        </p>
      </SourcesDisclosure>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function EditableRow({
  spec,
  value,
  editable,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  readonly spec: FieldSpec<string>;
  readonly value: string | null;
  readonly editable: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  /** Resolves to an error message to show, or null when handled. */
  readonly onSave: (value: string | null) => Promise<string | null>;
}) {
  const id = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const shown = displayValue(spec.input, value);

  const close = () => {
    onCancel();
    // Back to where the person was, so a keyboard user is not dropped at
    // the top of the page.
    requestAnimationFrame(() => editButton.current?.focus());
  };

  return (
    <div
      data-profile-field={spec.field}
      data-state={value === null ? "unknown" : "stated"}
      className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-6"
    >
      <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40 sm:pt-2.5">
        {spec.label}
      </dt>
      <dd className="min-w-0 flex-1">
        {editing ? (
          <FieldEditor
            id={id}
            spec={spec}
            value={value}
            onCancel={close}
            onSave={async (next) => {
              const message = await onSave(next);
              if (message === null) {
                requestAnimationFrame(() => editButton.current?.focus());
              }
              return message;
            }}
          />
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5 sm:pt-2">
              {shown === null ? (
                <p className="cq-body text-(--cq-text-tertiary)">Not stated</p>
              ) : spec.input.kind === "url" ? (
                <a
                  href={shown}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="cq-body break-all text-(--cq-text-primary) underline decoration-(--cq-border-strong) underline-offset-4 hover:decoration-(--cq-text-primary)"
                >
                  {shown}
                </a>
              ) : (
                <p
                  className={cx(
                    "cq-body break-words whitespace-pre-line text-(--cq-text-primary)",
                  )}
                >
                  {shown}
                </p>
              )}
            </div>
            {editable ? (
              <button
                ref={editButton}
                type="button"
                onClick={onEdit}
                aria-label={`${shown === null ? "Add" : "Edit"} ${spec.label.toLowerCase()}`}
                className={buttonClassName("quiet", "regular", "shrink-0")}
              >
                {shown === null ? "Add" : "Edit"}
              </button>
            ) : null}
          </div>
        )}
      </dd>
    </div>
  );
}

function FieldEditor({
  id,
  spec,
  value,
  onCancel,
  onSave,
}: {
  readonly id: string;
  readonly spec: FieldSpec<string>;
  readonly value: string | null;
  readonly onCancel: () => void;
  readonly onSave: (value: string | null) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pending) return;
    const normalised = normaliseDraft(spec, draft);
    if (!normalised.ok) {
      setError(normalised.message);
      return;
    }
    if (normalised.value === value) {
      onCancel();
      return;
    }
    setPending(true);
    setError(undefined);
    const message = await onSave(normalised.value);
    setPending(false);
    if (message !== null) setError(message);
  };

  const common = {
    id: `${id}-input`,
    label: spec.label,
    labelHidden: true,
    description: spec.hint,
    error,
    disabled: pending,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
      data-profile-editor={spec.field}
    >
      {spec.input.kind === "textarea" ? (
        <Textarea
          {...common}
          value={draft}
          rows={5}
          maxLength={spec.input.maxLength}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            common.onKeyDown(event);
            // Enter makes a new line in a description; Ctrl/Cmd+Enter saves.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      ) : spec.input.kind === "select" ? (
        <Select
          {...common}
          value={draft}
          autoFocus
          placeholder="Not stated"
          options={
            value !== null &&
            !spec.input.options.some((option) => option.value === value)
              ? [...spec.input.options, { value, label: value }]
              : spec.input.options
          }
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <Input
          {...common}
          // A website is a text field with the URL keyboard, not type="url":
          // the browser's own URL check refuses "northstar.example", which
          // the write path accepts and reads as https.
          type={spec.input.kind === "date" ? "date" : "text"}
          inputMode={spec.input.kind === "url" ? "url" : undefined}
          autoCapitalize={spec.input.kind === "url" ? "none" : undefined}
          spellCheck={spec.input.kind === "url" ? false : undefined}
          value={draft}
          maxLength={spec.input.kind === "text" ? spec.input.maxLength : 2048}
          autoFocus
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
