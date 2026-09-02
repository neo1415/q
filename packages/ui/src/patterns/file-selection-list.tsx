import { Button } from "../components/button.js";
import { Progress } from "../components/states.js";
import {
  CircleAlert,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
} from "../icons/index.js";
import { cx } from "../primitives/class-names.js";

/**
 * Selected files and their journey: selected → uploading → uploaded →
 * processing → ready, or failed with calm recovery. No preview, no viewer:
 * name, type, size, status and actions only. Client-side state is UX; the
 * server decides what is accepted.
 */

export const UPLOAD_STATES = [
  "selected",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

export type FileSelection = {
  readonly id: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: string;
  readonly state: UploadState;
  readonly failureReason?: string | undefined;
  /** 0–100 while uploading, when known. */
  readonly progress?: number | undefined;
};

const stateLabel: Record<UploadState, string> = {
  selected: "Selected",
  uploading: "Uploading",
  uploaded: "Uploaded",
  processing: "Reading",
  ready: "Ready",
  failed: "Couldn't read this file",
};

export function uploadStateLabel(state: UploadState): string {
  return stateLabel[state];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileSelectionListProps = {
  readonly files: readonly FileSelection[];
  readonly onRemove: (id: string) => void;
  readonly onRetry: (id: string) => void;
  readonly onChooseAnother?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
};

export function FileSelectionList({
  files,
  onRemove,
  onRetry,
  onChooseAnother,
  disabled = false,
  className,
}: FileSelectionListProps) {
  if (files.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Selected files"
      className={cx(
        "flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)",
        className,
      )}
    >
      {files.map((file) => {
        const failed = file.state === "failed";
        return (
          <li
            key={file.id}
            data-upload-state={file.state}
            className="flex flex-col gap-2 py-3"
          >
            <div className="flex items-start gap-3">
              {failed ? (
                <CircleAlert
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                  className="mt-0.5 shrink-0 text-(--cq-danger)"
                />
              ) : (
                <FileText
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                  className="mt-0.5 shrink-0 text-(--cq-text-tertiary)"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="cq-body-sm truncate font-medium text-(--cq-text-primary)">
                  {file.name}
                </p>
                <p className="cq-caption text-(--cq-text-secondary)">
                  {file.kind} · {formatFileSize(file.sizeBytes)} ·{" "}
                  <span role="status">{stateLabel[file.state]}</span>
                </p>
                {failed && file.failureReason !== undefined ? (
                  <p className="cq-caption text-(--cq-text-secondary)">
                    {file.failureReason}
                  </p>
                ) : null}
              </div>
              <Button
                variant="quiet"
                size="compact"
                disabled={disabled}
                onClick={() => onRemove(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                Remove
              </Button>
            </div>
            {file.state === "uploading" ? (
              <Progress
                label={`Uploading ${file.name}`}
                value={file.progress}
              />
            ) : null}
            {failed ? (
              <div className="flex flex-wrap gap-2 pl-8">
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={disabled}
                  onClick={() => onRetry(file.id)}
                >
                  Try again
                </Button>
                {onChooseAnother !== undefined ? (
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={disabled}
                    onClick={onChooseAnother}
                  >
                    Choose another
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={disabled}
                  onClick={() => onRemove(file.id)}
                >
                  Continue without it
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
