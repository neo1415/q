"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import type { FounderOnboardingActions } from "../controller/use-founder-onboarding";
import type { MaterialFileView, StepViewOfKind } from "../models/presentation";

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

const STATE_TONE: Readonly<Record<MaterialFileView["state"], string>> = {
  uploading: "cq-material-file__state--busy",
  received: "cq-material-file__state--busy",
  reviewing: "cq-material-file__state--busy",
  ready: "cq-material-file__state--ready",
  unreadable: "cq-material-file__state--problem",
};

export function MaterialsStep(props: {
  readonly step: StepViewOfKind<"materials">;
  readonly formId: string;
  readonly busy: boolean;
  readonly actions: FounderOnboardingActions;
}): React.ReactElement {
  const { step, formId, busy, actions } = props;
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
    <div className="cq-materials">
      <p className="cq-materials__privacy">
        Private to your company unless you choose to share it. Uploading is not
        publishing.
      </p>

      <div className="cq-materials__kind">
        <label htmlFor={kindFieldId}>What is this?</label>
        <select
          id={kindFieldId}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
          disabled={busy || atCapacity}
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
        className={
          dragging
            ? "cq-materials__drop cq-materials__drop--over"
            : "cq-materials__drop"
        }
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
        <p id={dropId}>
          {atCapacity
            ? "That's enough for now — you can add more later."
            : "Drag a file here, or choose one."}
        </p>
        <button
          type="button"
          className="cq-materials__choose"
          onClick={() => inputRef.current?.click()}
          disabled={busy || atCapacity}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="cq-materials__input"
          accept={step.acceptedExtensions.join(",")}
          onChange={onPicked}
          // Off-screen rather than display:none, so assistive technology
          // still reaches it through the label above.
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {problem !== null ? (
        <p className="cq-materials__problem" role="status">
          {problem}
        </p>
      ) : null}

      {step.files.length > 0 ? (
        <ul className="cq-materials__list">
          {step.files.map((file) => (
            <li key={file.id} className="cq-material-file">
              <span className="cq-material-file__name">{file.filename}</span>
              <span className="cq-material-file__kind">{file.kindLabel}</span>
              {/*
                A live region: a founder who cannot see the list still
                learns when a document finishes being read.
              */}
              <span
                className={`cq-material-file__state ${STATE_TONE[file.state]}`}
                role="status"
              >
                {file.stateLabel}
              </span>
              {file.state === "unreadable" ? (
                <button
                  type="button"
                  className="cq-material-file__retry"
                  onClick={() => {
                    void actions.removeMaterial(file.id);
                  }}
                  disabled={busy}
                >
                  Remove and try another
                </button>
              ) : null}
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
