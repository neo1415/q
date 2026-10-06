"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";

import { saveFounderBackgroundAction } from "./founder-background-actions";

/**
 * F4: "Your background" under You and your team: the founder's title at
 * the company (e.g. "Co-founder & CEO"), previous roles and education, in
 * their own words. Declared by them; investors see it only as the
 * profile's visibility allows.
 */
export type FounderBackgroundValues = {
  readonly businessTitle: string;
  readonly previousRoles: string;
  readonly education: string;
  /** The founder profile's version; null before it exists. */
  readonly version: number | null;
};

const AREA =
  "min-h-24 w-full rounded-[10px] border border-(--cq-border-strong) bg-(--cq-surface) px-3 py-2 cq-body-sm text-(--cq-text-primary)";

export function FounderBackground({
  initial,
}: {
  readonly initial: FounderBackgroundValues;
}) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [title, setTitle] = useState(initial.businessTitle);
  const [roles, setRoles] = useState(initial.previousRoles);
  const [education, setEducation] = useState(initial.education);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const titleChanged = title.trim() !== saved.businessTitle;
  const summariesChanged =
    roles.trim() !== saved.previousRoles ||
    education.trim() !== saved.education;

  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Your background"
      data-founder-background
      onSubmit={(event) => {
        event.preventDefault();
        if (!titleChanged && !summariesChanged) {
          setMessage("Nothing changed.");
          return;
        }
        startTransition(async () => {
          const out = await saveFounderBackgroundAction({
            businessTitle: title,
            previousRoles: roles,
            education,
            titleChanged,
            summariesChanged,
            expectedVersion: saved.version,
          });
          if (!out.ok) {
            setMessage(out.message);
            return;
          }
          setSaved({
            businessTitle: title.trim(),
            previousRoles: roles.trim(),
            education: education.trim(),
            version: out.version,
          });
          setMessage("Saved.");
        });
      }}
    >
      <h3 className="cq-title-sm text-(--cq-text-primary)">Your background</h3>
      <Input
        id={`${id}-title`}
        label="Your title at the company"
        placeholder="Co-founder & CEO"
        maxLength={120}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <label
        htmlFor={`${id}-roles`}
        className="cq-label text-(--cq-text-primary)"
      >
        Previous roles
      </label>
      <textarea
        id={`${id}-roles`}
        className={AREA}
        maxLength={4000}
        placeholder="Head of payments at Paystack (2019–2023); product at Interswitch"
        value={roles}
        onChange={(event) => setRoles(event.target.value)}
      />
      <label
        htmlFor={`${id}-education`}
        className="cq-label text-(--cq-text-primary)"
      >
        Education and background
      </label>
      <textarea
        id={`${id}-education`}
        className={AREA}
        maxLength={4000}
        placeholder="BSc Computer Science, University of Lagos"
        value={education}
        onChange={(event) => setEducation(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save background
        </Button>
        {message === null ? null : (
          <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
