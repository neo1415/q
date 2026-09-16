"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  subscribeToTheme,
  THEME_CHOICES,
  type ThemeChoice,
} from "./theme";

/**
 * The appearance choice, as three buttons rather than a switch: a switch
 * has two states and there are three, and "follow my device" is the one
 * most people want and the one a two-state control cannot express.
 *
 * The stored choice lives outside React — the inline boot script has
 * already applied it to the document before this ever renders — so it is
 * read as an external store rather than copied into state by an effect.
 * The server snapshot is "system", which is what an unchosen document
 * looks like, so the first paint and the markup agree.
 */

const LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: "Device",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice>(
    subscribeToTheme,
    readStoredTheme,
    () => "system",
  );

  const choose = useCallback((next: ThemeChoice) => {
    applyTheme(next);
    storeTheme(next);
  }, []);

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="flex flex-wrap gap-1"
      data-appearance-toggle
    >
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={choice === option}
          onClick={() => {
            choose(option);
          }}
          className={
            choice === option
              ? "cq-appearance-option is-active"
              : "cq-appearance-option"
          }
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
