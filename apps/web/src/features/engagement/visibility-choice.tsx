"use client";

import { useState, useTransition } from "react";

import {
  VIEWING_VISIBILITIES,
  type ViewingVisibility,
} from "@capital-q/contracts";

import { setViewingVisibilityAction } from "./visibility-actions";
import { useT } from "@/features/i18n/language";

const LABEL: Record<ViewingVisibility, string> = {
  FULL_IDENTITY: "My name and organisation",
  ORGANISATION_ONLY: "Only my organisation",
  ANONYMOUS: "Nothing identifying",
};

/**
 * The investor's own choice of what founders see when they view a company
 * (§6.7.13). Free, always: a person may always be more private.
 */
export function VisibilityChoice({
  current,
  allowed,
}: {
  readonly current: ViewingVisibility;
  readonly allowed: readonly ViewingVisibility[];
}) {
  const t = useT();
  const [value, setValue] = useState(current);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <fieldset className="flex flex-col gap-1" disabled={pending}>
      <legend className="cq-body font-medium text-(--cq-text-primary)">
        {t("When you view a company, founders see")}
      </legend>
      {VIEWING_VISIBILITIES.filter((level) => allowed.includes(level)).map(
        (level) => (
          <label
            key={level}
            className="cq-body flex min-h-11 items-center gap-3 text-(--cq-text-primary)"
          >
            <input
              type="radio"
              name="viewing-visibility"
              className="size-5"
              checked={value === level}
              onChange={() => {
                setValue(level);
                setMessage(null);
                start(async () => {
                  const result = await setViewingVisibilityAction(level);
                  setMessage(result.message);
                  if (!result.ok) setValue(current);
                });
              }}
            />
            {t(LABEL[level])}
          </label>
        ),
      )}
      <p
        className="cq-caption text-(--cq-text-secondary)"
        role="status"
        aria-live="polite"
      >
        {message === null ? null : t(message)}
      </p>
    </fieldset>
  );
}
