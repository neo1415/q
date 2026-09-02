"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { MultiChoiceList } from "@capital-q/ui/choice-list";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { FileSelectionList } from "@capital-q/ui/file-selection-list";
import { ICON_SIZE, ICON_STROKE, Upload } from "@capital-q/ui/icons";

import { StepHeading, type StepProps } from "./step-props";

/**
 * F2. Multi-select what exists ("Nothing yet" is exclusive and fine), then a
 * native file picker for anything uploadable. Client-side checks are UX; the
 * evidence service decides what is accepted. No file leaves the browser
 * until a real upload session exists.
 */
export function AssetStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"asset_selection">) {
  const [assetTypes, setAssetTypes] = useState<readonly string[]>(
    step.response?.assetTypes ?? [],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadable = assetTypes.some(
    (value) =>
      step.assetTypes.find((option) => option.value === value)?.uploadable ===
      true,
  );
  const hasFailed = step.files.some((file) => file.state === "failed");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assetTypes.length === 0) {
      setError("Choose what you have, or “Nothing yet”.");
      return;
    }
    if (hasFailed) {
      setError(
        "Retry or remove the file that couldn't be read, or continue without it.",
      );
      return;
    }
    void actions.submit({
      kind: "asset_selection",
      assetTypes: [...assetTypes],
    });
  }

  function handleFiles(list: FileList | null) {
    if (list === null) {
      return;
    }
    for (const file of Array.from(list)) {
      void actions.attachFile({
        name: file.name,
        sizeBytes: file.size,
        type: file.type,
      });
    }
    if (fileInput.current !== null) {
      fileInput.current.value = "";
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help}>
        {step.privacyNote !== undefined ? (
          <div className="flex flex-col gap-2 pt-1">
            <ContextIndicator
              scope="organisation_private"
              detail="your company"
            />
            <p className="cq-caption text-(--cq-text-tertiary)">
              {step.privacyNote}
            </p>
          </div>
        ) : null}
      </StepHeading>

      <MultiChoiceList
        id={`${step.id}-types`}
        name="assets"
        legend="What do you already have?"
        legendHidden
        options={step.assetTypes}
        values={assetTypes}
        exclusiveValues={step.exclusiveValues}
        disabled={busy}
        error={error}
        onChange={(next) => {
          setAssetTypes(next);
          setError(undefined);
        }}
      />

      {uploadable ? (
        <section
          aria-labelledby="asset-files-heading"
          className="flex flex-col gap-3"
        >
          <h2
            id="asset-files-heading"
            className="cq-label text-(--cq-text-primary)"
          >
            Add the files you have
          </h2>
          <p className="cq-caption text-(--cq-text-secondary)">
            PDF, Word, PowerPoint or text. You can add more later.
          </p>
          <label className="sr-only" htmlFor="asset-file-input">
            Choose files
          </label>
          <input
            ref={fileInput}
            id="asset-file-input"
            type="file"
            multiple
            accept={step.acceptedExtensions.join(",")}
            disabled={busy}
            onChange={(event) => handleFiles(event.target.files)}
            className="sr-only"
          />
          <Button
            variant="secondary"
            size="large"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="w-full"
          >
            <Upload
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
            Choose files
          </Button>
          <FileSelectionList
            files={step.files}
            disabled={busy}
            onRemove={(id) => void actions.removeFile(id)}
            onRetry={(id) => void actions.retryFile(id)}
            onChooseAnother={() => fileInput.current?.click()}
          />
        </section>
      ) : null}
    </form>
  );
}
