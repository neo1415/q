"use client";

import { useCallback, useSyncExternalStore } from "react";

import { cx } from "@capital-q/ui";
import {
  ICON_SIZE,
  ICON_STROKE,
  Monitor,
  Moon,
  Sun,
} from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  subscribeToTheme,
  THEME_DISPLAY_ORDER,
  type ThemeChoice,
} from "./theme";

/**
 * The appearance choice, as three buttons rather than a switch: a switch
 * has two states and there are three, and "follow my device" is the one
 * most people want and the one a two-state control cannot express.
 *
 * Two presentations of the one control. `icons` is the compact segmented
 * form the chrome carries (sidebar footer, account menu, auth header) so
 * the choice is visible without opening Settings (ADR 0017 F4); `labels`
 * is the worded form on Profile.
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

/** The icon form's accessible names: what the icon alone cannot say. */
const NAMES: Readonly<Record<ThemeChoice, string>> = {
  system: "Match device",
  light: "Light",
  dark: "Dark",
};

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function useThemeChoice(): readonly [ThemeChoice, (next: ThemeChoice) => void] {
  const choice = useSyncExternalStore<ThemeChoice>(
    subscribeToTheme,
    readStoredTheme,
    () => "system",
  );
  const choose = useCallback((next: ThemeChoice) => {
    applyTheme(next);
    storeTheme(next);
  }, []);
  return [choice, choose];
}

export function ThemeToggle({
  display = "labels",
  size = "regular",
  className,
}: {
  readonly display?: "labels" | "icons" | undefined;
  /** `touch` keeps each segment a 44 px target (the mobile account menu). */
  readonly size?: "regular" | "touch" | undefined;
  readonly className?: string | undefined;
}) {
  const [choice, choose] = useThemeChoice();

  if (display === "labels") {
    return (
      <div
        role="group"
        aria-label="Appearance"
        className={cx("flex flex-wrap gap-1", className)}
        data-appearance-toggle
      >
        {THEME_DISPLAY_ORDER.map((option) => (
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

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cx(
        "cq-theme-switch",
        size === "touch" ? "is-touch" : "",
        className,
      )}
      data-theme-switch
    >
      {THEME_DISPLAY_ORDER.map((option) => {
        const Icon = ICONS[option];
        const active = choice === option;
        return (
          <Tooltip key={option} content={NAMES[option]}>
            <button
              type="button"
              aria-label={NAMES[option]}
              aria-pressed={active}
              data-theme-option={option}
              onClick={() => {
                choose(option);
              }}
              className={cx(
                "cq-theme-switch-option",
                active ? "is-active" : "",
              )}
            >
              <Icon
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
