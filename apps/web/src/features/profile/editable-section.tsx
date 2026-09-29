"use client";

import { useState, type ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Pencil, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { EditableProfile, type EditableProfileProps } from "./editable-profile";

/**
 * One profile section (About, Company, Mandate…) the LinkedIn way: a clean
 * read view with an Edit control in the section's header; Edit reveals the
 * per-field editors, Done hides them again. Saving is still per field,
 * through the same write path Q's approved actions use.
 */
export function EditableSection({
  id,
  title,
  description,
  profile,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly profile: Omit<EditableProfileProps, "editable">;
  /** Extra content under the fields (streamed answers, notes). */
  readonly children?: ReactNode | undefined;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <ProfileSectionShell
      id={id}
      title={title}
      description={description}
      action={
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          aria-pressed={editing}
          aria-label={editing ? `Done editing ${title}` : `Edit ${title}`}
          className={buttonClassName("quiet", "regular", "shrink-0 gap-2")}
          data-section-edit={id}
        >
          {editing ? null : (
            <Pencil
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          )}
          {editing ? "Done" : "Edit"}
        </button>
      }
    >
      <EditableProfile {...profile} editable={editing} />
      {children}
    </ProfileSectionShell>
  );
}

/** The section frame: a heading row with one action, then content. */
export function ProfileSectionShell({
  id,
  title,
  description,
  action,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      // One card per section (founder design 2026-09-28), the same frame
      // as the mandate cards and the Signals rail.
      className="flex scroll-mt-4 flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4 sm:p-5"
      data-profile-section={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={`${id}-heading`}
            className="cq-title-md text-(--cq-text-primary)"
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
