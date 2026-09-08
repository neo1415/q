"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { Button } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import type { MaterialFileView } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";

/**
 * F2 — "What do you already have?" (CQ-Q-021 §3, §12, §14, §57).
 *
 * The screen this packet exists to make real. A founder hands Q what
 * already explains the business, and Q reads it — so they type less, not
 * more.
 *
 * Four things this component is careful about:
 *
 *   - It never claims work that did not happen. The state under each file
 *     is the real one: a file waiting in a queue says "waiting", and a file
 *     the parser could not read says so plainly instead of showing a
 *     spinner labelled "Q is thinking".
 *   - Drag and drop is an enhancement, never a requirement. The file
 *     picker is a real button, reachable by keyboard and usable on a phone
 *     where dropping a file is not a gesture that exists (§57, §87).
 *   - Skipping is a first-class path, worded as a choice rather than a
 *     concession. A founder with no documents is not behind (§3).
 *   - Privacy is stated in the open, not buried in a tooltip (§55).
 */

/**
 * The colour of a file's real state. Progress is never green: a document
 * still being read has not been read, and saying so in the same colour as
 * "ready" would be the small lie this screen exists to avoid.
 */
const STATE_TONE: Readonly<Record<MaterialFileView["state"], string>> = {
  uploading: "text-(--cq-text-secondary)",
  received: "text-(--cq-text-secondary)",
  reviewing: "text-(--cq-text-secondary)",
  ready: "text-(--cq-positive)",
  unreadable: "text-(--cq-warning)",
};

export function MaterialsStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"materials">): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(step.kinds[0]?.value ?? "OTHER");
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kindFieldId = useId();
  const dropId = useId();

  const remaining = step.maxFiles - step.files.length;
  const atCapacity = remaining <= 0;

  async function accept(files: readonly File[]): Promise<void> {
    setProblem(null);
    const admitted = files.slice(0, Math.max(remaining, 0));
    for (const file of admitted) {
      if (file.size > step.maxBytes) {
        // Said before anything is uploaded, in a unit a person reads.
        setProblem(
          `${file.name} is larger than ${String(Math.floor(step.maxBytes / 1_000_000))}MB. Try a smaller version, or continue without it.`,
        );
        continue;
      }
      if (
        step.acceptedMimeTypes.length > 0 &&
        !step.acceptedMimeTypes.includes(file.type)
      ) {
        setProblem(
          `We can't read ${file.name} yet. PDF, PowerPoint, Word and plain text work today.`,
        );
        continue;
      }
      const outcome = await actions.uploadMaterial({
        file,
        documentType: kind,
      });
      if (!outcome.ok) {
        setProblem(outcome.message);
      }
    }
  }

  function onPicked(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void accept(files);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    void accept([...event.dataTransfer.files]);
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        The privacy line lives in the step definition's own supporting text,
        so it is stated once and stays with the step it belongs to (§55).
      */}
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />

      <div className="flex flex-col gap-2">
        <label
          htmlFor={kindFieldId}
          className="cq-label text-(--cq-text-secondary)"
        >
          What is this?
        </label>
        <select
          id={kindFieldId}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
          disabled={busy || atCapacity}
          className="cq-body h-11 rounded-md border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary) disabled:opacity-50"
        >
          {step.kinds.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/*
        The drop zone is decoration around a real control. Everything it
        does, the button below does too, which is what keeps this usable
        with a keyboard and on a phone.
      */}
      <div
        className={[
          "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-(--cq-motion-fast)",
          dragging
            ? "border-(--cq-border-strong) bg-(--cq-surface-sunken)"
            : "border-(--cq-border) bg-(--cq-surface-raised)",
        ].join(" ")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={onDrop}
        aria-describedby={dropId}
      >
        <p id={dropId} className="cq-body-sm text-(--cq-text-secondary)">
          {atCapacity
            ? "That's enough for now \u2014 you can add more later."
            : "Drag a file here, or choose one."}
        </p>
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={busy || atCapacity}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept={step.acceptedExtensions.join(",")}
          onChange={onPicked}
          // Off-screen rather than display:none, so assistive technology
          // still reaches it through the label above.
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {problem !== null ? (
        <InlineNotice tone="warning">{problem}</InlineNotice>
      ) : null}

      {step.files.length > 0 ? (
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {step.files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="cq-body truncate text-(--cq-text-primary)">
                  {file.filename}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {file.kindLabel}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/*
                  A live region: a founder who cannot see the list still
                  learns when a document finishes being read.
                */}
                <span
                  className={`cq-caption ${STATE_TONE[file.state]}`}
                  role="status"
                >
                  {file.stateLabel}
                </span>
                {file.state === "unreadable" ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => {
                      void actions.removeMaterial(file.id);
                    }}
                    disabled={busy}
                  >
                    Remove and try another
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void actions.submit({
            kind: "materials",
            documentIds: step.files
              .filter((file) => file.state !== "unreadable")
              .map((file) => file.id),
          });
        }}
      />
    </div>
  );
}
