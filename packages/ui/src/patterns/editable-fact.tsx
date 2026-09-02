"use client";

import { useId, useState } from "react";

import { Button } from "../components/button.js";
import { Input } from "../components/input.js";
import { cx } from "../primitives/class-names.js";
import { EvidenceStatus, type EvidenceKind } from "./evidence-status.js";

/**
 * One reviewed fact: label, current value, where it came from, and the
 * founder's verdict. Q's extraction is a suggestion until confirmed; editing
 * is inline and lightweight, and "mark missing" is a legitimate answer rather
 * than a forced value.
 */

export const FACT_VERDICTS = [
  "suggested",
  "confirmed",
  "edited",
  "missing",
] as const;
export type FactVerdict = (typeof FACT_VERDICTS)[number];

export type EditableFactProps = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly evidence: EvidenceKind;
  readonly evidenceDetail?: string | undefined;
  readonly verdict: FactVerdict;
  readonly onChange: (next: {
    readonly value: string;
    readonly verdict: FactVerdict;
  }) => void;
  readonly disabled?: boolean | undefined;
};

const verdictLabel: Record<FactVerdict, string | null> = {
  suggested: null,
  confirmed: "Confirmed",
  edited: "Edited by you",
  missing: "Marked as missing",
};

export function EditableFact({
  id,
  label,
  value,
  evidence,
  evidenceDetail,
  verdict,
  onChange,
  disabled = false,
}: EditableFactProps) {
  const inputId = `${useId()}-${id}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  function save() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      onChange({ value: "", verdict: "missing" });
    } else {
      onChange({
        value: trimmed,
        verdict: trimmed === value ? "confirmed" : "edited",
      });
    }
    setEditing(false);
  }

  return (
    <div
      data-fact={id}
      data-verdict={verdict}
      className="flex flex-col gap-2 py-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="cq-label text-(--cq-text-secondary)">{label}</p>
        <EvidenceStatus kind={evidence} detail={evidenceDetail} />
      </div>

      {editing ? (
        // Not a <form>: facts are edited inside the step's own form, and
        // nested forms are dropped by the HTML parser. Enter saves, Escape cancels.
        <div className="flex flex-col gap-3">
          <Input
            id={inputId}
            label={label}
            labelHidden
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
          <div className="flex gap-2">
            <Button variant="primary" size="compact" onClick={save}>
              Save
            </Button>
            <Button
              variant="quiet"
              size="compact"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={cx(
              "cq-body",
              verdict === "missing"
                ? "text-(--cq-text-tertiary) italic"
                : "text-(--cq-text-primary)",
            )}
          >
            {verdict === "missing" ? "Not known yet" : value}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {verdictLabel[verdict] !== null ? (
              <span className="cq-caption font-medium text-(--cq-text-secondary)">
                {verdictLabel[verdict]}
              </span>
            ) : null}
            {verdict !== "confirmed" && verdict !== "missing" ? (
              <Button
                variant="quiet"
                size="compact"
                disabled={disabled}
                onClick={() => onChange({ value, verdict: "confirmed" })}
              >
                Confirm
              </Button>
            ) : null}
            <Button
              variant="quiet"
              size="compact"
              disabled={disabled}
              onClick={startEditing}
            >
              {verdict === "missing" ? "Add" : "Edit"}
            </Button>
            {verdict !== "missing" ? (
              <Button
                variant="quiet"
                size="compact"
                disabled={disabled}
                onClick={() => onChange({ value: "", verdict: "missing" })}
              >
                Mark missing
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
