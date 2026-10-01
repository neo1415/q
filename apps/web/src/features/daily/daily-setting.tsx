"use client";

import { useState, useTransition } from "react";

import {
  Q_DAILY_FREQUENCIES,
  Q_DAILY_OPTIONAL_SECTIONS,
  type QDailyFrequency,
  type QDailyOptionalSection,
  type QDailyPreferences,
} from "@capital-q/contracts";

import { formatDayTime } from "@/components/date-format";

import { setDailyPreferencesAction } from "./daily-actions";

/**
 * Settings → The Q Daily (DAILY spec §3): how often (weekly by default,
 * daily, or off), whether it is emailed, and which sections it carries.
 * Each choice saves at once and shows what it means; a failed save puts
 * the earlier choice back and says so.
 */

const FREQUENCY: Readonly<Record<QDailyFrequency, string>> = {
  WEEKLY: "Weekly",
  DAILY: "Daily",
  OFF: "Off",
};

const SECTION: Readonly<Record<QDailyOptionalSection, string>> = {
  YOUR_SECTOR: "Your sector",
  YOUR_MARKET: "Your market",
  DEALS: "Deals and rounds",
  PEOPLE: "People you know",
  Q_TAKE: "Q's take",
};

function meaning(preferences: QDailyPreferences): string {
  if (preferences.frequency === "OFF") {
    return "No editions are prepared or emailed.";
  }
  const when =
    preferences.frequency === "DAILY"
      ? "Every morning"
      : "Every Monday morning";
  const where = preferences.email
    ? "by email and in The Q Daily"
    : "in The Q Daily only";
  const next =
    preferences.nextDueAt === null
      ? ""
      : ` Next: ${formatDayTime(preferences.nextDueAt)}.`;
  return `${when}, ${where}.${next}`;
}

export function DailySetting({
  initial,
}: {
  readonly initial: QDailyPreferences;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (
    next: QDailyPreferences,
    patch: Parameters<typeof setDailyPreferencesAction>[0],
  ) => {
    const before = preferences;
    setPreferences(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setDailyPreferencesAction(patch);
      if (result.ok) {
        setPreferences(result.preferences);
      } else {
        setPreferences(before);
        setMessage(result.message);
      }
    });
  };

  const off = preferences.frequency === "OFF";

  return (
    <div className="flex flex-col gap-4" data-daily-setting>
      <div className="flex flex-col gap-2">
        <div
          role="group"
          aria-label="How often"
          className="flex flex-wrap gap-1"
        >
          {Q_DAILY_FREQUENCIES.map((frequency) => (
            <button
              key={frequency}
              type="button"
              aria-pressed={preferences.frequency === frequency}
              disabled={pending}
              onClick={() => {
                save({ ...preferences, frequency }, { frequency });
              }}
              className={
                preferences.frequency === frequency
                  ? "cq-appearance-option is-active"
                  : "cq-appearance-option"
              }
            >
              {FREQUENCY[frequency]}
            </button>
          ))}
        </div>
        <p className="cq-caption text-(--cq-text-secondary)" data-daily-meaning>
          {meaning(preferences)}
        </p>
      </div>

      {off ? null : (
        <>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={preferences.email}
              disabled={pending}
              onChange={(event) => {
                const email = event.currentTarget.checked;
                save({ ...preferences, email }, { email });
              }}
              className="size-5 accent-(--cq-accent)"
            />
            <span className="cq-body-sm text-(--cq-text-primary)">
              Email me each edition
            </span>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="cq-caption pb-1 text-(--cq-text-secondary)">
              Sections (the lead story is always included)
            </legend>
            <div className="flex flex-wrap gap-1">
              {Q_DAILY_OPTIONAL_SECTIONS.map((section) => {
                const on = preferences.sections.includes(section);
                return (
                  <button
                    key={section}
                    type="button"
                    aria-pressed={on}
                    disabled={pending}
                    onClick={() => {
                      const sections = on
                        ? preferences.sections.filter(
                            (code) => code !== section,
                          )
                        : Q_DAILY_OPTIONAL_SECTIONS.filter(
                            (code) =>
                              code === section ||
                              preferences.sections.includes(code),
                          );
                      save({ ...preferences, sections }, { sections });
                    }}
                    className={
                      on
                        ? "cq-appearance-option is-active"
                        : "cq-appearance-option"
                    }
                  >
                    {SECTION[section]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      {message === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
