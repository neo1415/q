"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Q_LANGUAGE_PREFERENCES,
  type QLanguagePreference,
} from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

import { setLanguageAction } from "./language-actions";

/**
 * Q's language (multilingual Q, Arabic first). Kept by Capital Q, so it
 * follows the person to every device. Each language is named in itself
 * (العربية, English), as people look for their own. Saving refreshes the
 * page so the interface turns right-to-left at once; Q's text answers use
 * it from the next message, and a voice line from the next one opened.
 */
const NAMES: Readonly<Record<QLanguagePreference, string>> = {
  AUTO: "Automatic",
  en: "English",
  ar: "العربية",
};

export function LanguageSetting({
  initial,
}: {
  readonly initial: QLanguagePreference;
}) {
  const t = useT();
  const router = useRouter();
  const [chosen, setChosen] = useState<QLanguagePreference>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: QLanguagePreference) => {
    if (next === chosen) return;
    const before = chosen;
    setChosen(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setLanguageAction(next);
      if (!result.ok) {
        setChosen(before);
        setMessage(t("Couldn't save that just now. Please try again."));
        return;
      }
      setMessage(t("Saved. Q uses this from your next message or call."));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("Q's language")}
        className="flex flex-wrap gap-1"
        data-language-setting
      >
        {Q_LANGUAGE_PREFERENCES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={chosen === choice}
            disabled={pending}
            lang={choice === "AUTO" ? undefined : choice}
            onClick={() => {
              choose(choice);
            }}
            className={
              chosen === choice
                ? "cq-appearance-option is-active"
                : "cq-appearance-option"
            }
          >
            {choice === "AUTO" ? t(NAMES.AUTO) : NAMES[choice]}
          </button>
        ))}
      </div>
      {chosen === "ar" ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Video rehearsals in Arabic depend on the face's voice; if it does not sound right, use a voice or text rehearsal.",
          )}
        </p>
      ) : null}
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
