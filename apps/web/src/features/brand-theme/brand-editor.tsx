"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { Button } from "@capital-q/ui/button";

import { ResultLine, useConsoleAction } from "@/features/admin/console-ui";

import { setBrandColourAction } from "./brand-actions";
import {
  AA,
  DEFAULT_BRAND_HEX,
  PREVIEW_SURFACES,
  brandPalette,
  brandStyleSheet,
  normaliseHex,
  type ThemePalette,
} from "./brand-colour";
import { BRAND_PRESETS } from "./brand-presets";

/**
 * The console's brand colour control: quick picks, a colour picker and a
 * hex field, a live preview on paper and on the dark canvas, and the
 * contrast each reaches. While the admin edits, this page itself takes on
 * the draft colour, so they see it on real chrome before saving. Saving
 * and resetting go through the console's step-up guard; the API decides.
 */
export function BrandEditor({
  saved,
}: {
  /** The platform colour now, or null for Capital Q's own. */
  readonly saved: string | null;
}) {
  const [draft, setDraft] = useState(saved ?? DEFAULT_BRAND_HEX);
  const [typed, setTyped] = useState(saved ?? DEFAULT_BRAND_HEX);
  const { perform, pending, result } = useConsoleAction();

  const palette = useMemo(() => brandPalette(draft), [draft]);
  const liveCss = useMemo(
    () => (palette === null ? "" : brandStyleSheet(palette)),
    [palette],
  );
  const typedValid = normaliseHex(typed) !== null;
  const current = saved ?? DEFAULT_BRAND_HEX;
  const changed = draft !== current;

  const choose = (hex: string) => {
    const normal = normaliseHex(hex);
    if (normal === null) return;
    setDraft(normal);
    setTyped(normal);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Live preview on this page (validated hex only; see brandStyleSheet). */}
      {liveCss === "" ? null : (
        <style
          data-cq-brand-draft
          dangerouslySetInnerHTML={{ __html: liveCss }}
        />
      )}
      <div className="cq-panel flex flex-col gap-6 p-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="cq-label pb-3 text-(--cq-text-secondary)">
            Quick picks
          </legend>
          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((preset) => {
              const on = preset.hex === draft;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  aria-label={preset.name}
                  aria-pressed={on}
                  title={preset.name}
                  onClick={() => choose(preset.hex)}
                  className="size-11 rounded-(--cq-radius-md) border border-(--cq-border) outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-(--cq-text-primary) aria-pressed:outline-solid"
                  style={{ backgroundColor: preset.hex }}
                />
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="brand-hex"
            className="cq-label text-(--cq-text-secondary)"
          >
            Your colour
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a colour"
              value={draft}
              onChange={(event) => choose(event.target.value)}
              className="size-11 shrink-0 cursor-pointer rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) p-1"
            />
            <input
              id="brand-hex"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              value={typed}
              aria-invalid={typedValid ? undefined : true}
              aria-describedby="brand-hex-help"
              onChange={(event) => {
                setTyped(event.target.value);
                const normal = normaliseHex(event.target.value);
                if (
                  normal !== null &&
                  event.target.value.replace("#", "").length === 6
                ) {
                  setDraft(normal);
                }
              }}
              onBlur={() => {
                if (typedValid) choose(typed);
              }}
              className="cq-body cq-numeric h-11 w-36 rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary) aria-invalid:border-(--cq-danger)"
            />
          </div>
          <p
            id="brand-hex-help"
            className="cq-caption text-(--cq-text-tertiary)"
          >
            {typedValid
              ? "A hex colour, like #0f766e."
              : "Use a hex colour, like #0f766e."}
          </p>
        </div>

        {palette === null ? null : <AdjustNote palette={palette} />}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="large"
            disabled={pending || !changed}
            onClick={() => perform(() => setBrandColourAction(draft))}
          >
            {pending ? "Saving…" : "Save brand colour"}
          </Button>
          <Button
            variant="secondary"
            size="large"
            disabled={pending || saved === null}
            onClick={() =>
              perform(
                () => setBrandColourAction(null),
                () => choose(DEFAULT_BRAND_HEX),
              )
            }
          >
            Reset to Capital Q blue
          </Button>
        </div>
        <ResultLine result={result} />
      </div>

      {palette === null ? null : (
        <div className="flex flex-col gap-3" aria-label="Preview">
          <Preview mode="light" theme={palette.light} />
          <Preview mode="dark" theme={palette.dark} />
        </div>
      )}
    </div>
  );
}

function AdjustNote({
  palette,
}: {
  readonly palette: NonNullable<ReturnType<typeof brandPalette>>;
}) {
  const light = palette.light.adjusted;
  const dark = palette.dark.adjusted;
  if (!light && !dark) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Used exactly as picked in light and dark.
      </p>
    );
  }
  const where =
    light && dark
      ? "in both themes"
      : light
        ? "on light backgrounds (darker)"
        : "in dark mode (lighter)";
  return (
    <p className="cq-body-sm rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-4 py-3 text-(--cq-text-secondary)">
      Adjusted slightly {where} so text on it stays readable.
    </p>
  );
}

function ratio(value: number): string {
  return `${value.toFixed(1)}:1`;
}

function Preview({
  mode,
  theme,
}: {
  readonly mode: "light" | "dark";
  readonly theme: ThemePalette;
}) {
  const surface = PREVIEW_SURFACES[mode];
  const pass = theme.fillContrast >= AA && theme.textContrast >= AA;
  return (
    <figure
      className="flex flex-col gap-3 rounded-(--cq-radius-lg) border p-4"
      style={
        {
          backgroundColor: surface.canvas,
          borderColor: surface.border,
          color: surface.text,
        } satisfies CSSProperties
      }
    >
      <figcaption className="cq-label" style={{ color: surface.muted }}>
        {mode === "light" ? "Light" : "Dark"}
      </figcaption>
      <div
        className="cq-body-sm flex min-h-11 items-center gap-3 rounded-(--cq-radius-md) px-3"
        style={{ backgroundColor: theme.soft }}
      >
        <span
          aria-hidden="true"
          className="h-5 w-0.5 rounded-full"
          style={{ backgroundColor: theme.accent }}
        />
        Discover
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="cq-body-sm inline-flex h-11 items-center rounded-md px-4 font-medium"
          style={{ backgroundColor: theme.accent, color: surface.inverse }}
        >
          Express interest
        </span>
        <span
          className="cq-body-sm font-medium underline underline-offset-4"
          style={{ color: theme.accent }}
        >
          Open profile
        </span>
      </div>
      <p className="cq-caption cq-numeric" style={{ color: surface.muted }}>
        Button text {ratio(theme.fillContrast)} · Link text{" "}
        {ratio(theme.textContrast)} · {pass ? "Passes AA" : "Below AA"}
      </p>
    </figure>
  );
}
