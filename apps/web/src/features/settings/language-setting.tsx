"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";

import {
  QLanguagePreferenceSchema,
  type QLanguagePreference,
} from "@capital-q/contracts";
import {
  languageChannels,
  languageInfo,
  languageNameIn,
  offeredLanguages,
  voiceLineAvailable,
  type LanguageInfo,
} from "@capital-q/q-core/language";
import { fieldControlClassName } from "@capital-q/ui/input";

import {
  announceLanguage,
  LANGUAGE_EVENT,
  useT,
  useUiLanguage,
} from "@/features/i18n/language";
import { hasHandCatalogue } from "@/features/i18n/messages";

import { setLanguageAction } from "./language-actions";

/**
 * Q's language (owner directive 2026-10-16: any language, and switch
 * between any two). Kept by Capital Q, so it follows the person to every
 * device. Every language the runtime can name and script is offered, each
 * named in itself (Kiswahili, العربية, français), as people look for their
 * own; the search also matches the English name and the name in the
 * screen's current language. Saving switches the screens at once (no
 * reload); Q's text answers use it from the next message, and a voice line
 * from the next one opened.
 *
 * Under the choice, what the language gets today, said plainly so the
 * choice never promises more than the product does: hand-translated or
 * machine-translated screens, Q's replies, and per channel (voice, video)
 * whether the providers Capital Q uses support it (q-core capability
 * table, from their own documentation).
 */

/** How many results the list shows before the search narrows it. */
const SHOWN = 12;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function matches(
  info: LanguageInfo,
  query: string,
  readerLanguage: string,
): boolean {
  if (query === "") return true;
  const wanted = fold(query);
  return [
    info.nativeName,
    info.englishName,
    languageNameIn(info.tag, readerLanguage) ?? "",
    info.tag,
  ].some((name) => fold(name).includes(wanted));
}

export function LanguageSetting({
  initial,
}: {
  readonly initial: QLanguagePreference;
}) {
  const t = useT();
  const readerLanguage = useUiLanguage();
  const [chosen, setChosen] = useState<QLanguagePreference>(initial);
  // Told to Q while Settings is open: the choice shown follows it.
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = QLanguagePreferenceSchema.safeParse(
        (event as CustomEvent<unknown>).detail,
      );
      if (detail.success) setChosen(detail.data);
    };
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, onChange);
    };
  }, []);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const searchId = useId();
  const listId = useId();

  const all = offeredLanguages();
  const results = useMemo(
    () => all.filter((info) => matches(info, query.trim(), readerLanguage)),
    [all, query, readerLanguage],
  );

  const choose = (next: QLanguagePreference) => {
    if (next === chosen) return;
    const before = chosen;
    setChosen(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setLanguageAction(next);
      if (!result.ok) {
        setChosen(before);
        setMessage("Couldn't save that just now. Please try again.");
        return;
      }
      // Said in the language at render: the choice just switched it.
      setMessage("Saved. Q uses this from your next message or call.");
      // Every provider switches at once and the server words refresh.
      announceLanguage(result.language);
    });
  };

  const current = chosen === "AUTO" ? null : languageInfo(chosen);
  const shown = query.trim() === "" ? results.slice(0, SHOWN) : results;
  // The chosen language stays in view, first, whatever the search shows.
  const list =
    current !== null && !shown.some((info) => info.tag === current.tag)
      ? [current, ...shown]
      : shown;

  return (
    <div className="flex flex-col gap-3" data-language-setting>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="cq-label text-(--cq-text-primary)">
          {t("Search languages")}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-controls={listId}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className={`${fieldControlClassName} h-11 cq-body`}
          data-language-search
        />
      </div>
      <div
        id={listId}
        role="group"
        aria-label={t("Q's language")}
        className="flex max-h-72 flex-wrap gap-1 overflow-y-auto"
      >
        <button
          type="button"
          aria-pressed={chosen === "AUTO"}
          disabled={pending}
          onClick={() => {
            choose("AUTO");
          }}
          className={
            chosen === "AUTO"
              ? "cq-appearance-option is-active"
              : "cq-appearance-option"
          }
          title={t("Follows your device's language")}
        >
          {t("Automatic")}
        </button>
        {list.map((info) => (
          <button
            key={info.tag}
            type="button"
            aria-pressed={chosen === info.tag}
            disabled={pending}
            lang={info.tag}
            dir={info.direction}
            onClick={() => {
              choose(info.tag);
            }}
            className={
              chosen === info.tag
                ? "cq-appearance-option is-active"
                : "cq-appearance-option"
            }
            data-language-option={info.tag}
          >
            {info.nativeName}
          </button>
        ))}
        {shown.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t("No language matches that.")}
          </p>
        ) : null}
      </div>
      {current === null || current.primary === "en" ? null : (
        <LanguageCoverage language={current} />
      )}
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {t(message)}
        </p>
      )}
    </div>
  );
}

/** What the chosen language gets today, channel by channel. */
function LanguageCoverage({ language }: { readonly language: LanguageInfo }) {
  const t = useT();
  const channels = languageChannels(language.tag);
  const rows: readonly (readonly [string, string])[] = [
    [
      t("Screens"),
      hasHandCatalogue(language.tag)
        ? t("Translated by hand")
        : t(
            "Translated by Q, automatically; anything not translated yet shows in English for a moment",
          ),
    ],
    [t("Q's replies"), t("Written and spoken in this language")],
    [
      t("Voice conversations"),
      voiceLineAvailable(language.tag)
        ? t("Available")
        : t("Not available in this language yet: type to Q instead"),
    ],
    [
      t("Video rehearsals and interviews"),
      channels.video !== null
        ? t("Available")
        : t(
            "Not available in this language yet: rehearsals continue by voice, interviews run in English",
          ),
    ],
  ];
  return (
    <dl className="flex flex-col gap-1" data-language-coverage>
      {rows.map(([term, value]) => (
        <div key={term} className="flex flex-wrap gap-x-2">
          <dt className="cq-body-sm text-(--cq-text-primary)">{term}</dt>
          <dd className="cq-body-sm text-(--cq-text-secondary)">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
