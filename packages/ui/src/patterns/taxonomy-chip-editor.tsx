"use client";

import { useState } from "react";

import { Button } from "../components/button.js";
import { ChoiceChip } from "../components/chip.js";
import { Input } from "../components/input.js";

/**
 * Human-readable classification chips the founder can confirm, remove or
 * add. Labels only: canonical taxonomy identifiers stay server-side and are
 * never invented here. Removed suggestions remain visible and re-selectable
 * so a stray tap is reversible.
 */
export type TaxonomyChipEditorProps = {
  readonly id: string;
  readonly legend: string;
  readonly description?: string | undefined;
  /** All candidate labels, suggested plus founder-added. */
  readonly options: readonly string[];
  /** The labels currently kept. */
  readonly selected: readonly string[];
  readonly onChange: (next: {
    readonly options: readonly string[];
    readonly selected: readonly string[];
  }) => void;
  readonly disabled?: boolean | undefined;
};

export function TaxonomyChipEditor({
  id,
  legend,
  description,
  options,
  selected,
  onChange,
  disabled = false,
}: TaxonomyChipEditorProps) {
  const [draft, setDraft] = useState("");

  function toggle(label: string) {
    onChange({
      options,
      selected: selected.includes(label)
        ? selected.filter((entry) => entry !== label)
        : [...selected, label],
    });
  }

  function add() {
    const label = draft.trim();
    if (label.length === 0) {
      return;
    }
    const exists = options.some(
      (entry) => entry.toLowerCase() === label.toLowerCase(),
    );
    onChange({
      options: exists ? options : [...options, label],
      selected: selected.includes(label) ? selected : [...selected, label],
    });
    setDraft("");
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="cq-label text-(--cq-text-primary)">{legend}</legend>
      {description !== undefined ? (
        <p className="cq-body-sm -mt-1 text-(--cq-text-secondary)">
          {description}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((label) => (
          <ChoiceChip
            key={label}
            selected={selected.includes(label)}
            disabled={disabled}
            onClick={() => toggle(label)}
          >
            {label}
          </ChoiceChip>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={`${id}-add`}
            label="Add a category"
            labelHidden
            placeholder="Add a category"
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button
          variant="secondary"
          onClick={add}
          disabled={disabled || draft.trim().length === 0}
        >
          Add
        </Button>
      </div>
    </fieldset>
  );
}
