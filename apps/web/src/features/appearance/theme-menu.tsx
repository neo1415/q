"use client";

import { IconButton } from "@capital-q/ui/button";
import {
  Check,
  ICON_SIZE,
  ICON_STROKE,
  Monitor,
  Moon,
  Sun,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";

import { isThemeChoice, type ThemeChoice } from "./theme";
import { useThemeChoice } from "./theme-toggle";

/**
 * The theme as one icon (R24): the icon of the current choice, opening a
 * small menu of Light, Dark and System. It replaces the three-segment
 * control in the chrome, which was always on screen for a choice made
 * once. The Settings page keeps the worded form.
 */

const OPTIONS: readonly {
  readonly value: ThemeChoice;
  readonly label: string;
}[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeMenu({
  align = "start",
}: {
  readonly align?: "start" | "center" | "end" | undefined;
}) {
  const [choice, choose] = useThemeChoice();
  const Icon = ICONS[choice];
  const current =
    OPTIONS.find((option) => option.value === choice)?.label ?? "System";
  return (
    <MenuRoot>
      <MenuTrigger>
        <IconButton
          aria-label={`Theme: ${current}`}
          className="size-11 text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          data-theme-menu
        >
          <Icon
            aria-hidden="true"
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
          />
        </IconButton>
      </MenuTrigger>
      <MenuContent align={align} className="min-w-40">
        <MenuRadioGroup
          label="Theme"
          value={choice}
          onValueChange={(next) => {
            if (isThemeChoice(next)) choose(next);
          }}
        >
          {OPTIONS.map((option) => {
            const OptionIcon = ICONS[option.value];
            return (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                indicator={
                  <Check
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                }
              >
                <OptionIcon
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                {option.label}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
