"use client";

import { useState, type ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Pencil, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { LockedEdit, useGate } from "@/features/organisation/capabilities";

import { EditableProfile, type EditableProfileProps } from "./editable-profile";

/**
 * One profile section (About, Company, Mandate…): a clean read view with
 * an Edit control in the section's header; Edit reveals the per-field
 * editors, Done hides them again. Saving is still per field, through the
 * same write path Q's approved actions use.
 *
 * "brief" is the chosen design (2026-10-21, "One page, edit in place"):
 * the card says who can see it beside its title, and its fields are the
 * design's label-and-value rows.
 */
export function EditableSection({
  id,
  title,
  description,
  profile,
  children,
  variant = "default",
  visibility,
  intro,
  capability,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly profile: Omit<EditableProfileProps, "editable" | "variant">;
  /** Extra content under the fields (streamed answers, notes). */
  readonly children?: ReactNode | undefined;
  readonly variant?: "default" | "brief" | undefined;
  /** Who can see this section, in words (brief only). */
  readonly visibility?: ReactNode;
  /** One line under the title, above the fields (brief only). */
  readonly intro?: ReactNode;
  /**
   * The capability editing needs (from GET /v1/me/capabilities), so a
   * member sees "Admins only" where Edit would be. Presentation only: the
   * write path still authorises every save.
   */
  readonly capability?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const brief = variant === "brief";
  const gate = useGate(capability);
  return (
    <ProfileSectionShell
      id={id}
      title={title}
      description={description}
      variant={variant}
      visibility={visibility}
      action={
        !gate.allowed ? (
          <LockedEdit gate={gate} />
        ) : (
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          aria-pressed={editing}
          aria-label={editing ? `Done editing ${title}` : `Edit ${title}`}
          className={
            brief
              ? "inline-flex min-h-11 shrink-0 items-center rounded-(--cq-radius-md) px-2.5 text-[13px] font-medium text-(--cq-text-secondary) transition-colors hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-9"
              : buttonClassName("quiet", "regular", "shrink-0 gap-2")
          }
          data-section-edit={id}
        >
          {editing || brief ? null : (
            <Pencil
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          )}
          {editing ? "Done" : "Edit"}
        </button>
        )
      }
    >
      {intro === undefined ? null : (
        <p className="m-0 max-w-[68ch] text-sm leading-normal text-(--cq-text-secondary)">
          {intro}
        </p>
      )}
      <EditableProfile
        {...profile}
        editable={editing && gate.allowed}
        variant={variant}
      />
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
  variant = "default",
  visibility,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly variant?: "default" | "brief" | undefined;
  /** Who can see this section, in words (brief only). */
  readonly visibility?: ReactNode;
}) {
  if (variant === "brief") {
    return (
      <section
        id={id}
        aria-labelledby={`${id}-heading`}
        className="flex scroll-mt-4 flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
        data-profile-section={id}
      >
        <div className="flex min-h-9 items-center gap-2.5">
          <h2
            id={`${id}-heading`}
            className="m-0 flex-1 text-base font-semibold text-(--cq-text-primary)"
          >
            {title}
          </h2>
          {visibility ?? null}
          {action}
        </div>
        {description === undefined ? null : (
          <p className="m-0 max-w-[68ch] text-sm text-(--cq-text-secondary)">
            {description}
          </p>
        )}
        {children}
      </section>
    );
  }
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
