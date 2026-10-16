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

/** The surfaces that follow Arabic in full today (lane ml, 2026-10-16). */
export const ARABIC_NOW =
  "In Arabic: your conversation with Q (typed and spoken), voice calls, rehearsals, and onboarding's frame and confirmations.";
/** What does not, yet. */
export const STILL_ENGLISH =
  "Still in English: other pages (Discover, Explore, CRM, company profiles, documents, Results) and some onboarding questions.";
export const VIDEO_FALLBACK =
  "Video rehearsals in Arabic depend on the face's voice; if it does not sound right, use a voice or text rehearsal.";

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
        <div className="flex flex-col gap-1" data-language-coverage>
          {/* What is Arabic today, and what is not: said plainly, so the
              choice never promises more than the product does. */}
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(ARABIC_NOW)}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(STILL_ENGLISH)}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(VIDEO_FALLBACK)}
          </p>
        </div>
      ) : null}
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
