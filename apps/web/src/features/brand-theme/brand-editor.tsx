"use client";

import { useMemo, useState, type CSSProperties } from "react";

import type { BrandPresetKey } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { ResultLine, useConsoleAction } from "@/features/admin/console-ui";

import { setBrandThemeAction } from "./brand-actions";
import { brandPalette, normaliseHex } from "./brand-colour";
import { composeBrandStyle } from "./brand-compose";
import {
  ACCENT_PICKS,
  BRAND_THEME_PRESET_LIST,
  brandPreset,
  checkContrast,
  contrastPairs,
  type BrandPreset,
  type PresetMode,
} from "./brand-presets";

/**
 * The console's brand control (K3; design B's brand board): pick a theme
 * -- black and gold, or Capital Q blue -- and, if wanted, your own accent
 * on top. While the admin edits, this page itself takes on the draft, so
 * they see it on real chrome before saving; the contrast table shows that
 * every pair still reads. Saving and resetting go through the console's
 * step-up guard; the API decides.
 */
export function BrandEditor({
  savedPreset,
  savedHex,
}: {
  readonly savedPreset: BrandPresetKey;
  /** The colour on top of the preset, or null for the preset's own. */
  readonly savedHex: string | null;
}) {
  const [preset, setPreset] = useState<BrandPresetKey>(savedPreset);
  const [accent, setAccent] = useState<string | null>(savedHex);
  const [typed, setTyped] = useState(savedHex ?? "");
  const { perform, pending, result } = useConsoleAction();

  const liveCss = useMemo(
    () => composeBrandStyle({ presetKey: preset, primaryHex: accent }) ?? "",
    [preset, accent],
  );
  const typedValid = typed === "" || normaliseHex(typed) !== null;
  const changed = preset !== savedPreset || accent !== savedHex;
  const chosen = brandPreset(preset);

  const chooseAccent = (hex: string | null) => {
    const normal = hex === null ? null : normaliseHex(hex);
    if (hex !== null && normal === null) return;
    setAccent(normal);
    setTyped(normal ?? "");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      {/* Live preview on this page (validated hex only; see brand-presets). */}
      {liveCss === "" ? null : (
        <style
          data-cq-brand-draft
          dangerouslySetInnerHTML={{ __html: liveCss }}
        />
      )}
      <div className="cq-panel flex flex-col gap-6 p-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="cq-label pb-1 text-(--cq-text-primary)">
            Theme
          </legend>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            A theme sets the page, the menu bar, the buttons and Q&apos;s light
            together. Your own colour can still go on top.
          </p>
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2"
            role="group"
            aria-label="Theme"
          >
            {BRAND_THEME_PRESET_LIST.map((item) => (
              <PresetButton
                key={item.key}
                preset={item}
                on={item.key === preset}
                onPick={() => setPreset(item.key)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="cq-label pb-1 text-(--cq-text-primary)">
            Your own accent (optional)
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={accent === null}
              onClick={() => chooseAccent(null)}
              className="cq-body-sm min-h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary) aria-pressed:border-2 aria-pressed:border-(--cq-accent)"
            >
              The theme&apos;s own
            </button>
            {ACCENT_PICKS.map((pick) => (
              <button
                key={pick.hex}
                type="button"
                aria-label={pick.name}
                aria-pressed={pick.hex === accent}
                title={pick.name}
                onClick={() => chooseAccent(pick.hex)}
                className="size-11 rounded-(--cq-radius-md) border border-(--cq-border) outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-(--cq-text-primary) aria-pressed:outline-solid"
                style={{ backgroundColor: pick.hex }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a colour"
              value={accent ?? chosen.swatch[1]}
              onChange={(event) => chooseAccent(event.target.value)}
              className="size-11 shrink-0 cursor-pointer rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) p-1"
            />
            <input
              id="brand-hex"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              value={typed}
              placeholder="#rrggbb"
              aria-label="Accent colour as hex"
              aria-invalid={typedValid ? undefined : true}
              aria-describedby="brand-hex-help"
              onChange={(event) => {
                setTyped(event.target.value);
                const normal = normaliseHex(event.target.value);
                if (
                  normal !== null &&
                  event.target.value.replace("#", "").length === 6
                ) {
                  setAccent(normal);
                }
              }}
              onBlur={() => {
                if (typed === "") chooseAccent(null);
                else if (typedValid) chooseAccent(typed);
              }}
              className="cq-body cq-numeric h-11 w-36 rounded-md border border-(--cq-border-strong) bg-(--cq-surface) px-3 text-(--cq-text-primary) aria-invalid:border-(--cq-danger)"
            />
          </div>
          <p
            id="brand-hex-help"
            className="cq-caption text-(--cq-text-tertiary)"
          >
            {typedValid
              ? accent === null
                ? `Using ${chosen.name.toLowerCase()}'s own accent.`
                : "Adjusted where needed so text on it stays readable."
              : "Use a hex colour, like #0f766e."}
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="large"
            disabled={pending || !changed}
            onClick={() =>
              perform(() =>
                setBrandThemeAction({ presetKey: preset, primaryHex: accent }),
              )
            }
          >
            {pending ? "Saving…" : `Use ${chosen.name.toLowerCase()}`}
          </Button>
          <Button
            variant="secondary"
            size="large"
            disabled={pending}
            onClick={() =>
              perform(
                () => setBrandThemeAction(null),
                () => {
                  setPreset("black_gold");
                  chooseAccent(null);
                },
              )
            }
          >
            Reset to black and gold
          </Button>
          <span className="cq-caption text-(--cq-text-secondary)">
            Everyone in your firm sees it from their next page.
          </span>
        </div>
        <ResultLine result={result} />
      </div>

      <ContrastPanel preset={chosen} accent={accent} />
    </div>
  );
}

function PresetButton({
  preset,
  on,
  onPick,
}: {
  readonly preset: BrandPreset;
  readonly on: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      data-brand-preset={preset.key}
      className="grid min-h-14 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-left aria-pressed:border-2 aria-pressed:border-(--cq-accent)"
    >
      <span
        aria-hidden="true"
        className="grid size-10 grid-cols-2 overflow-hidden rounded-(--cq-radius-sm) border border-(--cq-border)"
      >
        <span style={{ backgroundColor: preset.swatch[0] }} />
        <span style={{ backgroundColor: preset.swatch[1] }} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="cq-body-sm font-medium text-(--cq-text-primary)">
          {preset.name}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">
          {preset.description}
        </span>
      </span>
    </button>
  );
}

/**
 * Design B's contrast table, for the chosen theme in both modes. The
 * accent rows use the colour on top when one is chosen (as adjusted).
 */
function ContrastPanel({
  preset,
  accent,
}: {
  readonly preset: BrandPreset;
  readonly accent: string | null;
}) {
  const palette = preset.palette;
  const custom = accent === null ? null : brandPalette(accent);
  const modes = (["light", "dark"] as const).flatMap((theme) => {
    if (palette === null) return [];
    const base: PresetMode = palette[theme];
    const mode: PresetMode =
      custom === null
        ? base
        : {
            ...base,
            accent: custom[theme].accent,
            "accent-hover": custom[theme].hover,
            "accent-soft": custom[theme].soft,
          };
    return [
      {
        theme,
        rows: checkContrast(
          contrastPairs(mode, palette.chrome, {
            canvas: palette.stage.canvas,
            qLight: palette.stage.qLight,
          }),
        ),
      },
    ];
  });
  return (
    <section
      className="cq-panel flex flex-col gap-3 p-5"
      aria-labelledby="brand-contrast"
    >
      <h3 id="brand-contrast" className="cq-label text-(--cq-text-primary)">
        Contrast
      </h3>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Every pair is checked against WCAG AA. Gold is a fill or a deep bronze
        for text, never pale gold text on white.
      </p>
      {palette === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Capital Q blue is the product&apos;s classic look; its pairs are
          checked in the design tokens.
        </p>
      ) : (
        modes.map(({ theme, rows }) => (
          <table key={theme} className="cq-body-sm w-full border-collapse">
            <caption className="cq-caption pb-1 text-left text-(--cq-text-secondary)">
              {theme === "light" ? "Light" : "Dark"}
            </caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Pair</th>
                <th scope="col">Sample</th>
                <th scope="col">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.name}
                  className="border-b border-(--cq-border-subtle)"
                >
                  <td className="py-1.5 pr-2 text-(--cq-text-primary)">
                    {row.name}
                  </td>
                  <td className="py-1.5">
                    <span
                      className="inline-grid h-6 w-11 place-items-center rounded-(--cq-radius-xs) font-semibold"
                      style={
                        {
                          color: row.fg.slice(0, 7),
                          backgroundColor: row.bg.slice(0, 7),
                        } satisfies CSSProperties
                      }
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                  </td>
                  <td className="cq-numeric py-1.5 text-right whitespace-nowrap text-(--cq-text-secondary)">
                    {row.ratio.toFixed(1)}:1 · {row.passes ? "Passes" : "Below"}{" "}
                    {row.need}:1
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))
      )}
    </section>
  );
}
