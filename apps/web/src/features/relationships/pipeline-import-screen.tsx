"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";

import {
  PIPELINE_IMPORT_FIELDS,
  type PipelineImportAppliedDto,
  type PipelineImportField,
  type PipelineImportPreview,
  type PipelineImportPreviewRow,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Badge } from "@capital-q/ui/badge";
import {
  ArrowUpRight,
  Check,
  FileSpreadsheet,
  ICON_SIZE,
  Lock,
  Upload,
} from "@capital-q/ui/icons";
import { Select } from "@capital-q/ui/select";
import { InlineNotice, Progress } from "@capital-q/ui/states";

import { useT } from "@/features/i18n/language";

import { crmButton, Segmented } from "./crm-kit";
import {
  assignColumn,
  FIELD_WORDS,
  fieldByColumn,
  groupRows,
  IMPORT_ACCEPT,
  IMPORT_STAGE_WORDS,
  importedCount,
  importFileProblem,
  invalidReason,
  linkHref,
  mappingReady,
  NOT_IMPORTED,
  resolutionsOf,
  sameMapping,
  type RowChoice,
} from "./pipeline-import-model";
import {
  PIPELINE_IMPORT_OPS,
  type PipelineImportOps,
} from "./pipeline-import-ops";
import { RecCard } from "./record-parts";

/**
 * Bring your pipeline (decision 106): the person uploads the CRM or
 * spreadsheet export they already keep, Q reads it, and they see exactly
 * what would happen before anything is written.
 *
 *   File      the upload goes through the documents path, so it is
 *             scanned; the screen waits while the scan runs.
 *   Columns   Q's proposed column mapping, each column a native select;
 *             a changed mapping is read again before it can be approved.
 *   Review    rows by how they matched: in Capital Q (matched), choose
 *             (more than one organisation fits), private (not on Capital
 *             Q: kept as the organisation's own prospect) and can't import.
 *   Done      the result counts and links to the relationships it filled.
 *
 * Approve applies the exact proposal hash and counts shown, under one key:
 * a retry continues the same import and duplicates nothing.
 */

type Step =
  | { readonly kind: "FILE"; readonly problem: string | null }
  | {
      readonly kind: "READING";
      readonly fileName: string;
      readonly phase: "UPLOADING" | "SCANNING" | "READING";
    }
  | {
      readonly kind: "REVIEW";
      readonly documentId: string;
      readonly preview: PipelineImportPreview;
    }
  | {
      readonly kind: "APPLYING";
      readonly documentId: string;
      readonly preview: PipelineImportPreview;
    }
  | {
      readonly kind: "DONE";
      readonly preview: PipelineImportPreview;
      readonly applied: PipelineImportAppliedDto;
    };

/** How long the screen waits for the safety check, asking every few seconds. */
const SCAN_TRIES = 40;
const SCAN_WAIT_MS = 3000;

type Group = "matched" | "ambiguous" | "new" | "invalid";

export function PipelineImportScreen({
  side,
  companyId,
  ops = PIPELINE_IMPORT_OPS,
  scanWaitMs = SCAN_WAIT_MS,
}: {
  readonly side: "INVESTOR" | "COMPANY";
  /** A founder's company: where the upload belongs. */
  readonly companyId?: string | undefined;
  /** Design review and tests only; the product uses the real ops. */
  readonly ops?: PipelineImportOps | undefined;
  readonly scanWaitMs?: number | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "FILE", problem: null });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    Partial<Record<PipelineImportField, string>>
  >({});
  const [choices, setChoices] = useState<Readonly<Record<number, RowChoice>>>(
    {},
  );
  const [group, setGroup] = useState<Group>("matched");
  const [pending, startPending] = useTransition();
  // One key per approval of one proposal: a retried press continues it.
  const applyKey = useRef<{ readonly hash: string; readonly key: string }>(
    null,
  );

  async function readFile(
    documentId: string,
    fileName: string,
    mapping?: PipelineImportPreview["mapping"],
  ): Promise<void> {
    for (let attempt = 0; attempt < SCAN_TRIES; attempt += 1) {
      const prepared = await ops.prepare({
        documentId,
        ...(mapping === undefined ? {} : { mapping }),
      });
      if (prepared.ok) {
        setDraft(prepared.value.mapping);
        setChoices({});
        setGroup(
          prepared.value.counts.ambiguous > 0
            ? "ambiguous"
            : prepared.value.counts.matched > 0
              ? "matched"
              : "new",
        );
        setStep({ kind: "REVIEW", documentId, preview: prepared.value });
        return;
      }
      if (prepared.retry !== true) {
        if (mapping === undefined) {
          setStep({ kind: "FILE", problem: prepared.message });
        } else {
          setError(prepared.message);
        }
        return;
      }
      if (mapping === undefined) {
        setStep({ kind: "READING", fileName, phase: "SCANNING" });
      }
      await new Promise((resolve) => setTimeout(resolve, scanWaitMs));
    }
    setStep({
      kind: "FILE",
      problem:
        "The safety check is taking longer than usual. Try again in a few minutes; the file is kept.",
    });
  }

  function choose(file: File | undefined) {
    if (file === undefined) return;
    const problem = importFileProblem(file);
    if (problem !== null) {
      setStep({ kind: "FILE", problem });
      return;
    }
    setError(null);
    setStep({ kind: "READING", fileName: file.name, phase: "UPLOADING" });
    startPending(async () => {
      const uploaded = await ops.upload(file, companyId);
      if (!uploaded.ok) {
        setStep({ kind: "FILE", problem: uploaded.message });
        return;
      }
      setStep({ kind: "READING", fileName: file.name, phase: "READING" });
      await readFile(uploaded.documentId, file.name);
    });
  }

  if (step.kind === "FILE" || step.kind === "READING") {
    return (
      <div className="cq-crm-swap flex flex-col gap-5" data-import-step="file">
        <Steps at={step.kind === "FILE" ? 0 : 1} />
        <FilePicker
          side={side}
          busy={step.kind === "READING"}
          problem={step.kind === "FILE" ? step.problem : null}
          onFile={choose}
        />
        {step.kind === "READING" ? (
          <div
            className="flex flex-col gap-2"
            role="status"
            data-import-reading={step.phase}
          >
            <Progress
              label={t(
                step.phase === "UPLOADING"
                  ? "Uploading your file"
                  : step.phase === "SCANNING"
                    ? "Checking the file for safety"
                    : "Q is reading your columns and matching each row",
              )}
            />
            <p className="cq-body-sm text-(--cq-text-tertiary)">
              {step.fileName}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (step.kind === "DONE") {
    return (
      <ImportDone
        side={side}
        preview={step.preview}
        applied={step.applied}
        onAnother={() => {
          applyKey.current = null;
          setStep({ kind: "FILE", problem: null });
        }}
      />
    );
  }

  const { preview, documentId } = step;
  const applying = step.kind === "APPLYING";
  const groups = groupRows(preview.rows);
  const columnField = fieldByColumn(draft as PipelineImportPreview["mapping"]);
  const changed = !sameMapping(draft, preview.mapping);
  const ready = mappingReady(draft);
  const resolutions = resolutionsOf(choices, preview);
  const will = importedCount(preview.counts, resolutions);
  const openChoices =
    preview.counts.ambiguous -
    resolutions.filter((one) => one.choice !== "SKIP").length;

  function readAgain() {
    if (!mappingReady(draft)) return;
    setError(null);
    const mapping = draft;
    startPending(async () => {
      await readFile(documentId, preview.fileName, mapping);
    });
  }

  function approve() {
    setError(null);
    const earlier = applyKey.current;
    const key =
      earlier !== null && earlier.hash === preview.proposalHash
        ? earlier.key
        : crypto.randomUUID();
    applyKey.current = { hash: preview.proposalHash, key };
    setStep({ kind: "APPLYING", documentId, preview });
    startPending(async () => {
      const applied = await ops.apply({
        importId: preview.importId,
        documentId,
        fileName: preview.fileName,
        proposalHash: preview.proposalHash,
        counts: preview.counts,
        resolutions,
        idempotencyKey: key,
      });
      if (applied.ok) {
        setStep({ kind: "DONE", preview, applied: applied.value });
        // The prospects list and the pipeline below read fresh.
        router.refresh();
      } else {
        setError(applied.message);
        setStep({ kind: "REVIEW", documentId, preview });
      }
    });
  }

  const shown: Record<Group, readonly PipelineImportPreviewRow[]> = groups;
  const hiddenRows =
    preview.counts.rows -
    (groups.matched.length +
      groups.ambiguous.length +
      groups.new.length +
      groups.invalid.length);

  return (
    <div
      className="cq-crm-swap flex flex-col gap-5"
      data-import-step={applying ? "applying" : "review"}
    >
      <Steps at={applying ? 3 : 2} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FileSpreadsheet
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="text-(--cq-text-tertiary)"
        />
        <span className="cq-body font-medium break-all text-(--cq-text-primary)">
          {preview.fileName}
        </span>
        <span className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
          {t(`${String(preview.counts.rows)} rows`)}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-import-counts>
        <Count label={t("In Capital Q")} value={preview.counts.matched} />
        <Count
          label={t("Choose")}
          value={preview.counts.ambiguous}
          attention={openChoices > 0}
        />
        <Count label={t("Kept private")} value={preview.counts.new} />
        <Count label={t("Can't import")} value={preview.counts.invalid} />
      </dl>

      <RecCard title={t("Columns")} id="import-columns" data-import-columns="">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {preview.mappingSource === "Q"
            ? t(
                "Q matched your columns to Capital Q's fields. Change any that look wrong.",
              )
            : preview.mappingSource === "PERSON"
              ? t("Read with the columns you chose.")
              : t("Matched by the column names. Change any that look wrong.")}
        </p>
        <ul className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {preview.columns.map((column, index) => (
            <li key={column}>
              <Select
                id={`import-column-${String(index)}`}
                label={column}
                value={columnField[column] ?? NOT_IMPORTED}
                disabled={applying || pending}
                onChange={(event) =>
                  setDraft(
                    assignColumn(
                      draft as PipelineImportPreview["mapping"],
                      column,
                      event.target.value as PipelineImportField | "",
                    ),
                  )
                }
                options={[
                  { value: NOT_IMPORTED, label: t("Not imported") },
                  ...PIPELINE_IMPORT_FIELDS.map((field) => ({
                    value: field,
                    label: t(FIELD_WORDS[field]),
                  })),
                ]}
              />
            </li>
          ))}
        </ul>
        {changed ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              className={crmButton("primary")}
              disabled={!ready || pending || applying}
              onClick={readAgain}
              data-import-read-again
            >
              {pending ? t("Reading…") : t("Read again with these columns")}
            </button>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {ready
                ? t("Your rows are matched again before you approve.")
                : side === "INVESTOR"
                  ? t("Choose the column that names each company.")
                  : t("Choose the column that names each investor.")}
            </p>
          </div>
        ) : null}
      </RecCard>

      <section
        aria-labelledby="import-rows"
        className="flex flex-col gap-3"
        data-import-rows
      >
        <h2
          id="import-rows"
          className="cq-body font-medium text-(--cq-text-primary)"
        >
          {t("Rows")}
        </h2>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented<Group>
            label={t("Rows by how they matched")}
            className="w-max whitespace-nowrap"
            value={group}
            onChange={setGroup}
            options={[
              {
                key: "matched",
                label: `${t("In Capital Q")} ${String(groups.matched.length)}`,
              },
              {
                key: "ambiguous",
                label: `${t("Choose")} ${String(groups.ambiguous.length)}`,
              },
              {
                key: "new",
                label: `${t("Kept private")} ${String(groups.new.length)}`,
              },
              {
                key: "invalid",
                label: `${t("Can't import")} ${String(groups.invalid.length)}`,
              },
            ]}
          />
        </div>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {group === "matched"
            ? side === "INVESTOR"
              ? t(
                  "These companies are on Capital Q. Each joins your pipeline with its stage, notes and next step, private to your firm.",
                )
              : t(
                  "These investors are on Capital Q. Each joins your pipeline with its stage, notes and next step, private to your company.",
                )
            : group === "ambiguous"
              ? t(
                  "More than one organisation fits these rows. Choose the right one, keep the row private, or skip it. A row left unchosen is skipped.",
                )
              : group === "new"
                ? t(
                    "Not on Capital Q yet. These stay a private list for your organisation; nothing is created or shared.",
                  )
                : t("These rows can't be imported.")}
        </p>
        <ImportRows
          side={side}
          rows={shown[group]}
          group={group}
          choices={choices}
          disabled={applying}
          onChoose={(rowNumber, choice) =>
            setChoices((current) => ({ ...current, [rowNumber]: choice }))
          }
        />
        {hiddenRows > 0 ? (
          <p className="cq-body-sm text-(--cq-text-tertiary)">
            {t(
              `The first rows are shown; all ${String(preview.counts.rows)} are imported.`,
            )}
          </p>
        ) : null}
      </section>

      {error === null ? null : (
        <InlineNotice tone="danger" className="cq-crm-swap">
          {t(error)}
        </InlineNotice>
      )}

      <div
        className="sticky bottom-0 z-[1] -mx-4 flex flex-col gap-3 border-t border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-4 sm:static sm:mx-0 sm:rounded-(--cq-radius-lg) sm:border sm:px-5"
        data-import-approve
      >
        {applying ? (
          <Progress
            label={t(`Importing ${String(preview.counts.rows)} rows`)}
          />
        ) : (
          <p className="cq-body-sm text-(--cq-text-primary)">
            {t(
              `${String(will.linked)} go into your pipeline and ${String(will.kept)} stay a private list.`,
            )}{" "}
            <span className="text-(--cq-text-secondary)">
              {t(
                "Stages, notes and next steps stay private to your side; nothing is shared with anyone you track.",
              )}
            </span>
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-tertiary)">
            <Lock size={ICON_SIZE.compact} aria-hidden="true" />
            {side === "INVESTOR"
              ? t("Only your firm sees this.")
              : t("Only your company sees this.")}
          </span>
          <button
            type="button"
            className={crmButton("primary", "sm:min-w-56")}
            disabled={applying || pending || changed}
            onClick={approve}
            data-import-approve-button
          >
            {applying ? t("Importing…") : t("Approve and import")}
          </button>
        </div>
        {changed ? (
          <p className="cq-caption text-(--cq-text-secondary)">
            {t("Read the file again with your columns before approving.")}
          </p>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {applying ? t(`Importing ${String(preview.counts.rows)} rows`) : ""}
      </span>
    </div>
  );
}

/** Where the person is: file, columns, review, done. */
function Steps({ at }: { readonly at: number }) {
  const t = useT();
  const steps = ["File", "Columns", "Review", "Import"];
  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1 cq-body-sm"
      aria-label={t("Import steps")}
    >
      {steps.map((label, index) => (
        <li
          key={label}
          className="inline-flex items-center gap-2"
          aria-current={index === at ? "step" : undefined}
        >
          <span
            className={cx(
              "inline-flex size-6 items-center justify-center rounded-full text-[12px] font-medium cq-numeric",
              index < at
                ? "bg-(--cq-positive-soft) text-(--cq-positive)"
                : index === at
                  ? "bg-(--cq-accent) text-(--cq-text-inverse)"
                  : "bg-(--cq-surface-strong) text-(--cq-text-tertiary)",
            )}
            aria-hidden="true"
          >
            {index < at ? <Check size={12} /> : index + 1}
          </span>
          <span
            className={
              index === at
                ? "font-medium text-(--cq-text-primary)"
                : "text-(--cq-text-secondary)"
            }
          >
            {t(label)}
          </span>
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="h-px w-4 bg-(--cq-border)" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function FilePicker({
  side,
  busy,
  problem,
  onFile,
}: {
  readonly side: "INVESTOR" | "COMPANY";
  readonly busy: boolean;
  readonly problem: string | null;
  readonly onFile: (file: File | undefined) => void;
}) {
  const t = useT();
  const input = useId();
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={input}
        className={cx(
          "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-(--cq-radius-lg) border border-dashed px-6 py-8 text-center transition-colors duration-(--cq-motion-fast)",
          over
            ? "border-(--cq-accent) bg-(--cq-accent-soft)"
            : "border-(--cq-border) bg-(--cq-surface-raised) hover:border-(--cq-text-tertiary)",
          busy && "pointer-events-none opacity-60",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onFile(event.dataTransfer.files[0]);
        }}
        data-import-drop
      >
        <Upload
          size={ICON_SIZE.prominent}
          aria-hidden="true"
          className="text-(--cq-text-tertiary)"
        />
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {t("Choose a CSV or Excel file")}
        </span>
        <span className="cq-body-sm max-w-md text-(--cq-text-secondary)">
          {side === "INVESTOR"
            ? t(
                "An export from Affinity, HubSpot, DealCloud, Airtable or your own spreadsheet. Q reads the columns and matches each company.",
              )
            : t(
                "An export from Foundersuite, Visible, HubSpot or your own investor tracker. Q reads the columns and matches each investor.",
              )}
        </span>
        <span className={crmButton("secondary")} aria-hidden="true">
          {t("Choose file")}
        </span>
        <input
          id={input}
          type="file"
          accept={IMPORT_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
          data-import-file
        />
      </label>
      {problem === null ? null : (
        <InlineNotice tone="warning">{t(problem)}</InlineNotice>
      )}
      <p className="cq-caption inline-flex items-center gap-1.5 text-(--cq-text-tertiary)">
        <Lock size={ICON_SIZE.compact} aria-hidden="true" />
        {t(
          "Nothing is imported until you approve. The file is checked for safety first.",
        )}
      </p>
    </div>
  );
}

function Count({
  label,
  value,
  attention = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly attention?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-0.5 rounded-(--cq-radius-md) border px-3 py-2.5",
        attention
          ? "border-(--cq-accent)/60 bg-(--cq-accent-soft)"
          : "border-(--cq-border-subtle) bg-(--cq-surface-raised)",
      )}
    >
      <dt className="cq-caption text-(--cq-text-secondary)">{label}</dt>
      <dd className="cq-numeric text-xl font-semibold text-(--cq-text-primary)">
        {value}
      </dd>
    </div>
  );
}

function ImportRows({
  side,
  rows,
  group,
  choices,
  disabled,
  onChoose,
}: {
  readonly side: "INVESTOR" | "COMPANY";
  readonly rows: readonly PipelineImportPreviewRow[];
  readonly group: Group;
  readonly choices: Readonly<Record<number, RowChoice>>;
  readonly disabled: boolean;
  readonly onChoose: (rowNumber: number, choice: RowChoice) => void;
}) {
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="cq-body-sm rounded-(--cq-radius-md) bg-(--cq-surface-strong) px-4 py-3 text-(--cq-text-secondary)">
        {t("No rows here.")}
      </p>
    );
  }
  return (
    <ul
      className="flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
      data-import-group={group}
    >
      {rows.map((row) => (
        <li
          key={row.rowNumber}
          className="flex flex-col gap-2 px-4 py-3"
          data-import-row={row.rowNumber}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="cq-body font-medium break-words text-(--cq-text-primary)">
              {row.name ?? t("No name")}
            </span>
            <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {t(`Row ${String(row.rowNumber)}`)}
            </span>
          </div>
          <RowFacts row={row} side={side} />
          {row.match === "AMBIGUOUS" ? (
            <fieldset className="flex flex-col gap-1" disabled={disabled}>
              <legend className="sr-only">
                {t(`Who is ${row.name ?? ""}?`)}
              </legend>
              {[
                ...row.candidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                })),
                {
                  value: "KEEP_PRIVATE",
                  label: t("Keep as a private prospect"),
                },
                { value: "SKIP", label: t("Skip this row") },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-(--cq-radius-md) px-2 hover:bg-(--cq-surface-subtle) has-[:checked]:bg-(--cq-accent-soft)"
                >
                  <input
                    type="radio"
                    name={`import-row-${String(row.rowNumber)}`}
                    value={option.value}
                    checked={choices[row.rowNumber] === option.value}
                    onChange={() => onChoose(row.rowNumber, option.value)}
                    className="size-5 accent-(--cq-accent)"
                  />
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {option.label}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RowFacts({
  row,
  side,
}: {
  readonly row: PipelineImportPreviewRow;
  readonly side: "INVESTOR" | "COMPANY";
}) {
  const t = useT();
  const facts: ReactNode[] = [];
  if (row.stageLabel !== null) {
    facts.push(
      <span key="stage" className="inline-flex items-center gap-1.5">
        <Badge tone="neutral">{row.stageLabel}</Badge>
        {row.stage !== null && row.stage !== "UNKNOWN" ? (
          <span className="text-(--cq-text-secondary)">
            {t(`Your stage: ${IMPORT_STAGE_WORDS[row.stage]}`)}
          </span>
        ) : (
          <span className="text-(--cq-text-tertiary)">
            {t("Kept in your words")}
          </span>
        )}
      </span>,
    );
  }
  if (row.match === "MATCHED" && row.matched !== null) {
    facts.push(
      <span
        key="match"
        className="inline-flex items-center gap-1 text-(--cq-text-secondary)"
      >
        <Check
          size={ICON_SIZE.compact}
          aria-hidden="true"
          className="text-(--cq-positive)"
        />
        {row.matched.name === row.name
          ? t("Matched on Capital Q")
          : t(`Matched to ${row.matched.name}`)}
      </span>,
    );
  }
  if (row.match === "NEW") {
    facts.push(
      <span
        key="new"
        className="inline-flex items-center gap-1 text-(--cq-text-secondary)"
      >
        <Lock size={ICON_SIZE.compact} aria-hidden="true" />
        {t("Private prospect")}
      </span>,
    );
  }
  if (row.match === "INVALID") {
    facts.push(
      <span key="invalid" className="text-(--cq-text-secondary)">
        {t(invalidReason(row, side))}
      </span>,
    );
  }
  if (facts.length === 0) return null;
  return (
    <div className="cq-body-sm flex flex-wrap items-center gap-x-4 gap-y-1">
      {facts}
    </div>
  );
}

function ImportDone({
  side,
  preview,
  applied,
  onAnother,
}: {
  readonly side: "INVESTOR" | "COMPANY";
  readonly preview: PipelineImportPreview;
  readonly applied: PipelineImportAppliedDto;
  readonly onAnother: () => void;
}) {
  const t = useT();
  const result = applied.result;
  const lines: readonly (readonly [string, number])[] = [
    ["In your pipeline", result.linked],
    ["New relationships", result.relationshipsCreated],
    ["Kept as private prospects", result.keptPrivate],
    ["Skipped", result.skipped],
    ["Stages recorded", result.stageEvents],
    ["Pipeline fields set", result.details ?? 0],
    ["Private notes", result.notes],
    ["Next steps on your board", result.tasks],
  ];
  return (
    <div className="cq-crm-swap flex flex-col gap-5" data-import-step="done">
      <Steps at={4} />
      <div className="flex items-start gap-3" role="status">
        <span className="mt-0.5 inline-flex size-8 flex-none items-center justify-center rounded-full bg-(--cq-positive-soft) text-(--cq-positive)">
          <Check size={ICON_SIZE.regular} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            {applied.replayed ? t("Already imported") : t("Imported")}
          </h2>
          <p className="cq-body-sm break-all text-(--cq-text-secondary)">
            {preview.fileName}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-import-result>
        {lines.map(([label, value]) => (
          <Count key={label} label={t(label)} value={value} />
        ))}
      </dl>
      {applied.relationships.length === 0 ? null : (
        <RecCard title={t("Relationships updated")} id="import-links">
          <ul
            className="flex flex-col divide-y divide-(--cq-border-subtle)"
            data-import-links
          >
            {applied.relationships.map((link) => (
              <li key={link.relationshipId}>
                <Link
                  href={linkHref(side, link.counterpartId)}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-(--cq-text-primary) hover:text-(--cq-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                >
                  <span className="cq-body-sm font-medium break-words">
                    {link.name}
                  </span>
                  <ArrowUpRight
                    size={ICON_SIZE.compact}
                    aria-hidden="true"
                    className="flex-none text-(--cq-text-tertiary)"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </RecCard>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/relationships" className={crmButton("primary")}>
          {t("Open your pipeline")}
        </Link>
        <Link
          href="/relationships/import#prospects"
          className={crmButton("secondary")}
        >
          {t("See private prospects")}
        </Link>
        <button
          type="button"
          className={crmButton("quiet")}
          onClick={onAnother}
        >
          {t("Import another file")}
        </button>
      </div>
    </div>
  );
}
