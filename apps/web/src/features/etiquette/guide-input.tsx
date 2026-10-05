"use client";

import { useId, useRef, useState } from "react";

import type { EtiquetteMediaType } from "@capital-q/contracts";

import { extractGuideText } from "./extract-text";

/**
 * Paste a guide, or choose a file and its text is read here, in this
 * browser (ADR 0050). The text stays editable; once edited, it counts as
 * pasted. Only text is ever sent.
 */

export type GuideDraft = {
  readonly sourceKind: "PASTE" | "FILE";
  readonly fileName: string | null;
  readonly mediaType: EtiquetteMediaType | null;
  readonly text: string;
};

export const EMPTY_DRAFT: GuideDraft = {
  sourceKind: "PASTE",
  fileName: null,
  mediaType: null,
  text: "",
};

const ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export function GuideInput({
  label,
  placeholder,
  maxCharacters,
  draft,
  onChange,
  disabled = false,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly maxCharacters: number;
  readonly draft: GuideDraft;
  readonly onChange: (next: GuideDraft) => void;
  readonly disabled?: boolean | undefined;
}) {
  const textId = useId();
  const fileId = useId();
  const statusId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (file === undefined) return;
    setProblem(null);
    setReading(true);
    const extracted = await extractGuideText(file, maxCharacters);
    setReading(false);
    if (fileRef.current !== null) fileRef.current.value = "";
    if (!extracted.ok) {
      setProblem(extracted.message);
      return;
    }
    onChange({
      sourceKind: "FILE",
      fileName: extracted.fileName,
      mediaType: extracted.mediaType,
      text: extracted.text,
    });
  };

  const count = draft.text.length;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={textId} className="cq-body-sm text-(--cq-text-secondary)">
        {label}
      </label>
      <textarea
        id={textId}
        value={draft.text}
        onChange={(event) =>
          onChange({ ...EMPTY_DRAFT, text: event.target.value })
        }
        rows={8}
        maxLength={maxCharacters}
        disabled={disabled || reading}
        aria-describedby={statusId}
        placeholder={placeholder}
        className="cq-body w-full resize-y rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label
          htmlFor={fileId}
          className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center rounded-md border border-(--cq-border) bg-(--cq-surface) px-4 font-medium text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--cq-focus-ring)"
        >
          {reading ? "Reading the file…" : "Upload a file"}
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept={ACCEPT}
            disabled={disabled || reading}
            className="sr-only"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
        <p id={statusId} className="cq-caption text-(--cq-text-tertiary)">
          {draft.sourceKind === "FILE" && draft.fileName !== null
            ? `From ${draft.fileName} · `
            : "PDF, Word, text or Markdown, read on this device · "}
          {count.toLocaleString("en-GB")} of{" "}
          {maxCharacters.toLocaleString("en-GB")} characters
        </p>
      </div>
      {problem === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-secondary)">
          {problem}
        </p>
      )}
    </div>
  );
}
