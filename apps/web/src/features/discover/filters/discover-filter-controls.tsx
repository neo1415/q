"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";
import { ChoiceChip } from "@capital-q/ui/chip";
import {
  ICON_SIZE,
  ICON_STROKE,
  SlidersHorizontal,
  X,
} from "@capital-q/ui/icons";
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";
import { SheetClose, SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import {
  activeDiscoverFilterCount,
  activeFilterChips,
  COUNTRY_FILTER_OPTIONS,
  NO_DISCOVER_FILTERS,
  RAISE_CURRENCIES,
  STAGE_FILTER_OPTIONS,
  toggleValue,
  type DiscoverFilters,
  type SectorOption,
} from "./discover-filters";
import { useT } from "@/features/i18n/language";

/**
 * Discover's filter controls (ux/discover-filters).
 *
 * A phone keeps the pitch clean: one compact button over the stage, with
 * the number of active filter groups on it, opens a sheet. A desktop gets
 * a row beside the panel: the same button, the two one-tap toggles, each
 * active value as a removable chip, and Clear all. Both edit the same
 * filters; the sheet edits a draft that applies on "Show companies", so a
 * half-made choice never reloads the feed.
 */

type ControlsProps = {
  readonly filters: DiscoverFilters;
  readonly sectors: readonly SectorOption[];
  readonly onChange: (next: DiscoverFilters) => void;
};

const AMOUNT = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

function FilterCountBadge({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="cq-caption cq-numeric inline-flex min-w-5 items-center justify-center rounded-full bg-(--cq-accent) px-1.5 text-(--cq-text-inverse)"
      aria-hidden="true"
    >
      {count}
    </span>
  );
}

function filterButtonLabel(count: number): string {
  return count === 0 ? "Filters" : `Filters, ${String(count)} active`;
}

/** The sheet, controlled; `trigger` decides how it is opened. */
export function DiscoverFilterSheet({
  filters,
  sectors,
  onChange,
  open,
  onOpenChange,
}: ControlsProps & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      {open ? (
        <FilterSheetBody
          // A fresh draft each time it opens.
          filters={filters}
          sectors={sectors}
          onApply={(next) => {
            onChange(next);
            onOpenChange(false);
          }}
        />
      ) : null}
    </SheetRoot>
  );
}

function FilterSheetBody({
  filters,
  sectors,
  onApply,
}: {
  readonly filters: DiscoverFilters;
  readonly sectors: readonly SectorOption[];
  readonly onApply: (next: DiscoverFilters) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<DiscoverFilters>(filters);
  const [min, setMin] = useState(filters.raise?.min ?? "");
  const [max, setMax] = useState(filters.raise?.max ?? "");
  const [currency, setCurrency] = useState<string>(
    filters.raise?.currency ?? "USD",
  );
  const minError =
    min.length > 0 && !AMOUNT.test(min)
      ? "Enter a whole amount, like 500000."
      : undefined;
  const maxError =
    max.length > 0 && !AMOUNT.test(max)
      ? "Enter a whole amount, like 2000000."
      : undefined;

  // Roots first, then any finer sector already chosen (Q may pick one).
  const shownSectors = sectors.filter(
    (s) => s.depth === 0 || draft.sectorNodeIds.includes(s.nodeId),
  );

  const apply = () => {
    if (minError !== undefined || maxError !== undefined) return;
    const bounded = min.length > 0 || max.length > 0;
    onApply({
      ...draft,
      raise: bounded
        ? {
            ...(min.length > 0 ? { min } : {}),
            ...(max.length > 0 ? { max } : {}),
            currency,
          }
        : null,
    });
  };

  return (
    <SheetContent
      side="side"
      title={t("Filter Discover")}
      description={t(
        "Narrows your recommendations. Q’s order is preserved unless you choose Unicorn Potential.",
      )}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            Unicorn Potential · Premium
          </legend>
          <p className="cq-caption text-(--cq-text-secondary)">
            Evidence-based growth characteristics, not a probability of becoming
            a unicorn. Only current, available assessments are included.
          </p>
          <Select
            id="unicorn-min"
            label="Minimum indicator score"
            value={draft.unicornPotentialMin ?? ""}
            options={[
              { value: "", label: "No minimum" },
              ...[0, 25, 50, 75].map((value) => ({
                value: String(value),
                label: `${value}/100 and above`,
              })),
            ]}
            onChange={(event) => {
              const value = event.target.value;
              setDraft({
                ...draft,
                unicornPotentialMin: value === "" ? undefined : Number(value),
              });
            }}
          />
          <ChoiceChip
            selected={draft.unicornPotentialSort === true}
            onClick={() =>
              setDraft({
                ...draft,
                unicornPotentialSort: draft.unicornPotentialSort !== true,
              })
            }
          >
            Sort by Unicorn Potential
          </ChoiceChip>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            {t("Sector")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {shownSectors.map((sector) => (
              <ChoiceChip
                key={sector.nodeId}
                selected={draft.sectorNodeIds.includes(sector.nodeId)}
                onClick={() =>
                  setDraft({
                    ...draft,
                    sectorNodeIds: toggleValue(
                      draft.sectorNodeIds,
                      sector.nodeId,
                    ),
                  })
                }
              >
                {sector.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            {t("Stage")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {STAGE_FILTER_OPTIONS.map((stage) => (
              <ChoiceChip
                key={stage.value}
                selected={draft.stageCodes.includes(stage.value)}
                onClick={() =>
                  setDraft({
                    ...draft,
                    stageCodes: toggleValue(draft.stageCodes, stage.value),
                  })
                }
              >
                {stage.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            {t("Country")}
          </legend>
          {/* Every country can be chosen; the chosen ones show as chips
              that remove themselves when pressed. */}
          {draft.countryCodes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {COUNTRY_FILTER_OPTIONS.filter((country) =>
                draft.countryCodes.includes(country.value),
              ).map((country) => (
                <ChoiceChip
                  key={country.value}
                  selected
                  onClick={() =>
                    setDraft({
                      ...draft,
                      countryCodes: toggleValue(
                        draft.countryCodes,
                        country.value,
                      ),
                    })
                  }
                >
                  {country.label}
                </ChoiceChip>
              ))}
            </div>
          ) : null}
          <Select
            id="discover-country-add"
            label={t("Add a country")}
            labelHidden
            placeholder={t("Add a country")}
            options={COUNTRY_FILTER_OPTIONS.filter(
              (country) => !draft.countryCodes.includes(country.value),
            )}
            value=""
            onChange={(event) => {
              const code = event.target.value;
              if (code.length === 0) return;
              setDraft({
                ...draft,
                countryCodes: toggleValue(draft.countryCodes, code),
              });
            }}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            {t("Raise size")}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="discover-raise-min"
              label={t("From")}
              inputMode="numeric"
              value={min}
              error={minError}
              onChange={(event) =>
                setMin(event.target.value.replace(/[,\s]/g, ""))
              }
            />
            <Input
              id="discover-raise-max"
              label={t("To")}
              inputMode="numeric"
              value={max}
              error={maxError}
              onChange={(event) =>
                setMax(event.target.value.replace(/[,\s]/g, ""))
              }
            />
          </div>
          <Select
            id="discover-raise-currency"
            label={t("Currency")}
            value={currency}
            options={RAISE_CURRENCIES.map((code) => ({
              value: code,
              label: code,
            }))}
            onChange={(event) => setCurrency(event.target.value)}
          />
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-(--cq-accent)"
              checked={draft.raiseDisclosedOnly}
              onChange={(event) =>
                setDraft({ ...draft, raiseDisclosedOnly: event.target.checked })
              }
            />
            <span className="cq-body-sm text-(--cq-text-primary)">
              {t("Only companies that shared their raise with me")}
            </span>
          </label>
          <p className="cq-caption text-(--cq-text-secondary)">
            {t(
              "Otherwise companies that haven't shared a raise stay in, marked “Raise not shared”.",
            )}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-2 text-(--cq-text-primary)">
            {t("Show only")}
          </legend>
          <div className="flex flex-wrap gap-2">
            <ChoiceChip
              selected={draft.verifiedOnly}
              onClick={() =>
                setDraft({ ...draft, verifiedOnly: !draft.verifiedOnly })
              }
            >
              {t("Verified")}
            </ChoiceChip>
            <ChoiceChip
              selected={draft.hasPitch}
              onClick={() => setDraft({ ...draft, hasPitch: !draft.hasPitch })}
            >
              {t("Has pitch video")}
            </ChoiceChip>
          </div>
        </fieldset>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 bg-(--cq-surface-raised) py-3">
          <Button
            variant="quiet"
            onClick={() => {
              setDraft(NO_DISCOVER_FILTERS);
              setMin("");
              setMax("");
            }}
          >
            {t("Clear all")}
          </Button>
          <div className="flex items-center gap-2">
            <SheetClose>
              <Button variant="secondary">{t("Cancel")}</Button>
            </SheetClose>
            <Button variant="primary" type="submit">
              {t("Show companies")}
            </Button>
          </div>
        </div>
      </form>
    </SheetContent>
  );
}

/** The phone's control: one button over the stage, clear of the pitch. */
export function DiscoverFilterButton({
  filters,
  onOpen,
}: {
  readonly filters: DiscoverFilters;
  readonly onOpen: () => void;
}) {
  const count = activeDiscoverFilterCount(filters);
  return (
    <button
      type="button"
      className="cq-feed-filter-button"
      onClick={onOpen}
      aria-label={filterButtonLabel(count)}
      data-active={count > 0 ? "" : undefined}
    >
      <SlidersHorizontal
        aria-hidden="true"
        size={ICON_SIZE.prominent}
        strokeWidth={ICON_STROKE}
      />
      <FilterCountBadge count={count} />
    </button>
  );
}

/** The desktop row: the button, the one-tap toggles, the active values. */
export function DiscoverFilterRow({
  filters,
  sectors,
  onChange,
  onOpen,
  className,
}: ControlsProps & {
  readonly onOpen: () => void;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const count = activeDiscoverFilterCount(filters);
  const chips = activeFilterChips(filters, sectors).filter(
    (chip) => chip.key !== "verified" && chip.key !== "pitch",
  );
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
      role="toolbar"
      aria-label={t("Discover filters")}
    >
      <Button
        variant="secondary"
        size="compact"
        onClick={onOpen}
        aria-label={filterButtonLabel(count)}
      >
        <SlidersHorizontal
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {t("Filters")}
        <FilterCountBadge count={count} />
      </Button>
      <ChoiceChip
        selected={filters.verifiedOnly}
        onClick={() =>
          onChange({ ...filters, verifiedOnly: !filters.verifiedOnly })
        }
      >
        {t("Verified")}
      </ChoiceChip>
      <ChoiceChip
        selected={filters.hasPitch}
        onClick={() => onChange({ ...filters, hasPitch: !filters.hasPitch })}
      >
        {t("Has pitch video")}
      </ChoiceChip>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="cq-label inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary) hover:border-(--cq-border-strong) lg:min-h-9"
          onClick={() => onChange(chip.without)}
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label}
          <X
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        </button>
      ))}
      {count === 0 ? null : (
        <Button
          variant="quiet"
          size="compact"
          onClick={() => onChange(NO_DISCOVER_FILTERS)}
        >
          {t("Clear all")}
        </Button>
      )}
    </div>
  );
}
