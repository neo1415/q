"use client";

import { useState, type ReactNode } from "react";

import {
  isSafeSiteHref,
  type SiteLeafBlock,
  type SitePricingPlan,
} from "@capital-q/contracts";

import { newBlockId } from "./block-catalogue";
import { InlineText, RichTextEditable } from "./rich-text-editable";

/**
 * Inline editing of each block type (decision 107), laid out like the
 * block it becomes so editing feels like editing the page, not a form.
 * Settings that are not words (a heading's level, a callout's tone, a
 * plan's highlight) sit in the block's own toolbar or beside the words.
 */

type Edit<T extends SiteLeafBlock> = {
  readonly block: T;
  readonly onChange: (next: T) => void;
};

function Field({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="cq-caption text-(--cq-text-tertiary)">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="cq-caption text-(--cq-danger)" role="alert">
          {hint}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "cq-body-sm h-10 w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary)";

function HrefInput({
  value,
  onChange,
  label,
  allowEmpty = false,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly allowEmpty?: boolean;
}) {
  const bad = !(allowEmpty && value === "") && !isSafeSiteHref(value);
  return (
    <Field
      label={label}
      hint={
        bad
          ? "Use a site path (/pricing), #anchor, https:// or mailto:"
          : undefined
      }
    >
      <input
        className={inputClass}
        value={value}
        aria-invalid={bad}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder="/auth/sign-up"
      />
    </Field>
  );
}

function RemoveButton({
  onClick,
  label,
}: {
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="cq-cms-press inline-flex size-9 shrink-0 items-center justify-center rounded-(--cq-radius-sm) text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
    >
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function AddButton({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cq-cms-press cq-label inline-flex min-h-10 items-center gap-1.5 self-start rounded-(--cq-radius-md) px-2.5 text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
    >
      <span aria-hidden="true" className="text-base leading-none">
        +
      </span>
      {children}
    </button>
  );
}

const replaceAt = <T,>(list: readonly T[], index: number, value: T): T[] =>
  list.map((item, i) => (i === index ? value : item));
const removeAt = <T,>(list: readonly T[], index: number): T[] =>
  list.filter((_, i) => i !== index);

function HeadingEditor({
  block,
  onChange,
}: Edit<Extract<SiteLeafBlock, { type: "heading" }>>) {
  const size =
    block.level === 1
      ? "cq-title-xl"
      : block.level === 2
        ? "cq-title-lg"
        : "cq-title-sm";
  return (
    <InlineText
      value={block.text}
      onChange={(text) => onChange({ ...block, text })}
      placeholder="Heading"
      label={`Heading, level ${String(block.level)}`}
      className={size}
    />
  );
}

function PlanEditor({
  plan,
  currency,
  onChange,
  onRemove,
}: {
  readonly plan: SitePricingPlan;
  readonly currency: string;
  readonly onChange: (next: SitePricingPlan) => void;
  readonly onRemove: () => void;
}) {
  const price = (value: string | null) => value ?? "";
  const priceOk = (value: string) =>
    value === "" || /^\d{1,9}(?:\.\d{1,2})?$/u.test(value);
  return (
    <li
      className={`flex flex-col gap-3 rounded-(--cq-radius-lg) border bg-(--cq-surface) p-4 ${
        plan.highlight ? "border-(--cq-accent)" : "border-(--cq-border-subtle)"
      }`}
    >
      <div className="flex items-start gap-2">
        <InlineText
          value={plan.name}
          onChange={(name) => onChange({ ...plan, name })}
          placeholder="Plan name"
          label="Plan name"
          className="cq-title-sm"
        />
        <RemoveButton onClick={onRemove} label={`Remove plan ${plan.name}`} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field
          label={`A month (${currency})`}
          hint={
            priceOk(price(plan.monthly))
              ? undefined
              : "A number, like 29 or 29.50"
          }
        >
          <input
            inputMode="decimal"
            className={`${inputClass} cq-numeric`}
            value={price(plan.monthly)}
            onChange={(event) =>
              onChange({
                ...plan,
                monthly:
                  event.target.value.trim() === ""
                    ? null
                    : event.target.value.trim(),
              })
            }
          />
        </Field>
        <Field
          label={`A year (${currency})`}
          hint={priceOk(price(plan.annual)) ? undefined : "A number, like 290"}
        >
          <input
            inputMode="decimal"
            className={`${inputClass} cq-numeric`}
            value={price(plan.annual)}
            onChange={(event) =>
              onChange({
                ...plan,
                annual:
                  event.target.value.trim() === ""
                    ? null
                    : event.target.value.trim(),
              })
            }
          />
        </Field>
      </div>
      <Field label="After the price">
        <input
          className={inputClass}
          value={plan.priceNote}
          placeholder="per person"
          onChange={(event) =>
            onChange({ ...plan, priceNote: event.target.value })
          }
        />
      </Field>
      <InlineText
        value={plan.description}
        onChange={(description) => onChange({ ...plan, description })}
        placeholder="One line about who it is for"
        label="Plan description"
        className="cq-body-sm text-(--cq-text-secondary)"
      />
      <div className="flex flex-col gap-1.5">
        <span className="cq-caption text-(--cq-text-tertiary)">Perks</span>
        <ul className="flex flex-col gap-1">
          {plan.perks.map((perk, index) => (
            <li key={index} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-(--cq-positive)"
              />
              <InlineText
                value={perk}
                onChange={(next) =>
                  onChange({
                    ...plan,
                    perks: replaceAt(plan.perks, index, next),
                  })
                }
                placeholder="What this plan includes"
                label={`Perk ${String(index + 1)}`}
                className="cq-body-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onChange({
                      ...plan,
                      perks: [
                        ...plan.perks.slice(0, index + 1),
                        "",
                        ...plan.perks.slice(index + 1),
                      ],
                    });
                  }
                  if (
                    event.key === "Backspace" &&
                    perk === "" &&
                    plan.perks.length > 1
                  ) {
                    event.preventDefault();
                    onChange({ ...plan, perks: removeAt(plan.perks, index) });
                  }
                }}
              />
            </li>
          ))}
        </ul>
        <AddButton
          onClick={() => onChange({ ...plan, perks: [...plan.perks, ""] })}
        >
          Add a perk
        </AddButton>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Button">
          <input
            className={inputClass}
            value={plan.ctaLabel}
            onChange={(event) =>
              onChange({ ...plan, ctaLabel: event.target.value })
            }
          />
        </Field>
        <HrefInput
          label="Goes to"
          allowEmpty
          value={plan.ctaHref}
          onChange={(ctaHref) => onChange({ ...plan, ctaHref })}
        />
      </div>
      <label className="cq-body-sm flex min-h-11 items-center gap-2 text-(--cq-text-primary)">
        <input
          type="checkbox"
          className="size-4 accent-(--cq-accent)"
          checked={plan.highlight}
          onChange={(event) =>
            onChange({ ...plan, highlight: event.target.checked })
          }
        />
        Highlight this plan
      </label>
    </li>
  );
}

function ImageEditor({
  block,
  onChange,
  onUpload,
  imageSrc,
}: Edit<Extract<SiteLeafBlock, { type: "image" }>> & {
  readonly onUpload: (file: File) => Promise<string | null>;
  readonly imageSrc: (documentId: string) => string;
}) {
  const [state, setState] = useState<"idle" | "uploading" | "failed">("idle");
  return (
    <div className="flex flex-col gap-3">
      {block.documentId === null ? (
        <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border-strong) bg-(--cq-surface-subtle) px-4 text-center text-(--cq-text-secondary) hover:text-(--cq-text-primary)">
          <span className="cq-body-sm font-medium">
            {state === "uploading" ? "Uploading…" : "Choose a PNG or JPEG"}
          </span>
          <span className="cq-caption text-(--cq-text-tertiary)">
            It is scanned for malware first. It shows on the live page only once
            the scan is clean.
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              setState("uploading");
              void onUpload(file).then((documentId) => {
                if (documentId === null) setState("failed");
                else {
                  setState("idle");
                  onChange({
                    ...block,
                    documentId,
                    alt:
                      block.alt === ""
                        ? file.name.replace(/\.[^.]+$/u, "")
                        : block.alt,
                  });
                }
              });
            }}
          />
          {state === "failed" ? (
            <span role="alert" className="cq-caption text-(--cq-danger)">
              That upload didn&apos;t go through. Try another file.
            </span>
          ) : null}
        </label>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a one-minute signed link straight from storage */}
          <img
            src={imageSrc(block.documentId)}
            alt={block.alt}
            className="w-full rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle)"
          />
          <button
            type="button"
            onClick={() => onChange({ ...block, documentId: null })}
            className="cq-label absolute end-2 top-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary)"
          >
            Replace
          </button>
        </div>
      )}
      <Field label="Describe the image for people who can't see it">
        <input
          className={inputClass}
          value={block.alt}
          onChange={(event) => onChange({ ...block, alt: event.target.value })}
        />
      </Field>
      <InlineText
        value={block.caption}
        onChange={(caption) => onChange({ ...block, caption })}
        placeholder="Caption (optional)"
        label="Caption"
        className="cq-caption text-(--cq-text-tertiary)"
      />
    </div>
  );
}

export function LeafBlockEditor({
  block,
  onChange,
  onUpload,
  imageSrc,
}: {
  readonly block: SiteLeafBlock;
  readonly onChange: (next: SiteLeafBlock) => void;
  readonly onUpload: (file: File) => Promise<string | null>;
  readonly imageSrc: (documentId: string) => string;
}) {
  switch (block.type) {
    case "heading":
      return <HeadingEditor block={block} onChange={onChange} />;
    case "richText":
      return (
        <RichTextEditable
          value={block.content}
          onChange={(content) => onChange({ ...block, content })}
          placeholder="Write, or paste plain text…"
          label="Text"
          className="cq-body text-(--cq-text-primary)"
        />
      );
    case "image":
      return (
        <ImageEditor
          block={block}
          onChange={onChange}
          onUpload={onUpload}
          imageSrc={imageSrc}
        />
      );
    case "callout":
    case "summary": {
      const tone =
        block.type === "callout" && block.tone === "warning"
          ? "border-(--cq-warning) bg-(--cq-warning-soft)"
          : block.type === "callout" && block.tone === "info"
            ? "border-(--cq-accent) bg-(--cq-accent-soft)"
            : "border-(--cq-border-strong) bg-(--cq-surface-subtle)";
      return (
        <div
          className={`flex flex-col gap-2 rounded-(--cq-radius-md) border-s-2 px-5 py-4 ${tone}`}
        >
          <InlineText
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
            placeholder={
              block.type === "summary" ? "In short" : "Title (optional)"
            }
            label="Box title"
            className={block.type === "summary" ? "cq-title-sm" : "cq-label"}
          />
          <RichTextEditable
            value={block.content}
            onChange={(content) => onChange({ ...block, content })}
            placeholder="The points a reader should take away"
            label="Box text"
            className="cq-body-sm text-(--cq-text-secondary)"
          />
        </div>
      );
    }
    case "faq":
      return (
        <div className="flex flex-col gap-3">
          <InlineText
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
            placeholder="Group title (optional)"
            label="FAQ group title"
            className="cq-title-lg"
          />
          <ol className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {block.items.map((item, index) => (
              <li key={item.id} className="flex flex-col gap-2 py-4">
                <div className="flex items-start gap-2">
                  <InlineText
                    value={item.question}
                    onChange={(question) =>
                      onChange({
                        ...block,
                        items: replaceAt(block.items, index, {
                          ...item,
                          question,
                        }),
                      })
                    }
                    placeholder="Question"
                    label={`Question ${String(index + 1)}`}
                    className="cq-body font-medium"
                  />
                  <RemoveButton
                    onClick={() =>
                      onChange({
                        ...block,
                        items: removeAt(block.items, index),
                      })
                    }
                    label={`Remove question ${String(index + 1)}`}
                  />
                </div>
                <RichTextEditable
                  value={item.answer}
                  onChange={(answer) =>
                    onChange({
                      ...block,
                      items: replaceAt(block.items, index, { ...item, answer }),
                    })
                  }
                  placeholder="Answer"
                  label={`Answer ${String(index + 1)}`}
                  className="cq-body-sm text-(--cq-text-secondary)"
                />
              </li>
            ))}
          </ol>
          <AddButton
            onClick={() =>
              onChange({
                ...block,
                items: [
                  ...block.items,
                  {
                    id: newBlockId(),
                    question: "",
                    answer: [{ kind: "paragraph", spans: [] }],
                  },
                ],
              })
            }
          >
            Add a question
          </AddButton>
        </div>
      );
    case "pricing":
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <InlineText
              value={block.title}
              onChange={(title) => onChange({ ...block, title })}
              placeholder="For founders"
              label="Pricing table title"
              className="cq-title-lg min-w-48 flex-1"
            />
            <Field label="Currency">
              <input
                className={`${inputClass} w-24 uppercase`}
                maxLength={3}
                value={block.currency}
                onChange={(event) =>
                  onChange({
                    ...block,
                    currency: event.target.value.toUpperCase(),
                  })
                }
              />
            </Field>
            <label className="cq-body-sm flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-(--cq-accent)"
                checked={block.showIntervalToggle}
                onChange={(event) =>
                  onChange({
                    ...block,
                    showIntervalToggle: event.target.checked,
                  })
                }
              />
              Monthly and yearly switch
            </label>
          </div>
          <ul className="grid gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
            {block.plans.map((plan, index) => (
              <PlanEditor
                key={plan.id}
                plan={plan}
                currency={block.currency}
                onChange={(next) =>
                  onChange({
                    ...block,
                    plans: replaceAt(block.plans, index, next),
                  })
                }
                onRemove={() =>
                  onChange({ ...block, plans: removeAt(block.plans, index) })
                }
              />
            ))}
          </ul>
          {block.plans.length < 8 ? (
            <AddButton
              onClick={() =>
                onChange({
                  ...block,
                  plans: [
                    ...block.plans,
                    {
                      id: newBlockId(),
                      name: "",
                      description: "",
                      monthly: null,
                      annual: null,
                      priceNote: "",
                      perks: [""],
                      highlight: false,
                      ctaLabel: "Get started",
                      ctaHref: "/auth/sign-up",
                    },
                  ],
                })
              }
            >
              Add a plan
            </AddButton>
          ) : null}
        </div>
      );
    case "table": {
      const width = Math.max(
        block.header.length,
        ...block.rows.map((r) => r.length),
        1,
      );
      const cell = (
        value: string,
        onCell: (next: string) => void,
        label: string,
        strong = false,
      ) => (
        <input
          aria-label={label}
          value={value}
          onChange={(event) => onCell(event.target.value)}
          className={`cq-body-sm h-9 w-full min-w-24 border-0 border-b border-(--cq-border-subtle) bg-transparent px-1 text-(--cq-text-primary) focus:border-(--cq-accent) focus:outline-none ${strong ? "font-medium" : ""}`}
        />
      );
      return (
        <div className="flex flex-col gap-2">
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {Array.from({ length: width }, (_, c) => (
                    <th key={c} className="p-0 pe-2 text-start">
                      {cell(
                        block.header[c] ?? "",
                        (next) => {
                          const header = Array.from(
                            { length: width },
                            (_, i) => block.header[i] ?? "",
                          );
                          onChange({
                            ...block,
                            header: replaceAt(header, c, next),
                          });
                        },
                        `Column ${String(c + 1)} heading`,
                        true,
                      )}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {Array.from({ length: width }, (_, c) => (
                      <td key={c} className="p-0 pe-2">
                        {cell(
                          row[c] ?? "",
                          (next) => {
                            const full = Array.from(
                              { length: width },
                              (_, i) => row[i] ?? "",
                            );
                            onChange({
                              ...block,
                              rows: replaceAt(
                                block.rows,
                                r,
                                replaceAt(full, c, next),
                              ),
                            });
                          },
                          `Row ${String(r + 1)}, column ${String(c + 1)}`,
                        )}
                      </td>
                    ))}
                    <td>
                      <RemoveButton
                        onClick={() =>
                          onChange({ ...block, rows: removeAt(block.rows, r) })
                        }
                        label={`Remove row ${String(r + 1)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-1">
            <AddButton
              onClick={() =>
                onChange({
                  ...block,
                  rows: [
                    ...block.rows,
                    Array.from({ length: width }, () => ""),
                  ],
                })
              }
            >
              Add a row
            </AddButton>
            {width < 8 ? (
              <AddButton
                onClick={() =>
                  onChange({
                    ...block,
                    header: [
                      ...Array.from(
                        { length: width },
                        (_, i) => block.header[i] ?? "",
                      ),
                      "",
                    ],
                    rows: block.rows.map((row) => [
                      ...Array.from({ length: width }, (_, i) => row[i] ?? ""),
                      "",
                    ]),
                  })
                }
              >
                Add a column
              </AddButton>
            ) : null}
          </div>
          <InlineText
            value={block.caption}
            onChange={(caption) => onChange({ ...block, caption })}
            placeholder="Caption (optional)"
            label="Table caption"
            className="cq-caption text-(--cq-text-tertiary)"
          />
        </div>
      );
    }
    case "features":
      return (
        <div className="flex flex-col gap-3">
          <InlineText
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
            placeholder="Title (optional)"
            label="Feature list title"
            className="cq-title-lg"
          />
          <ul className="grid gap-x-6 gap-y-4 @2xl:grid-cols-2">
            {block.items.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-3"
              >
                <div className="flex items-start gap-2">
                  <InlineText
                    value={item.title}
                    onChange={(title) =>
                      onChange({
                        ...block,
                        items: replaceAt(block.items, index, {
                          ...item,
                          title,
                        }),
                      })
                    }
                    placeholder="Feature"
                    label={`Feature ${String(index + 1)}`}
                    className="cq-body font-medium"
                  />
                  <RemoveButton
                    onClick={() =>
                      onChange({
                        ...block,
                        items: removeAt(block.items, index),
                      })
                    }
                    label={`Remove feature ${String(index + 1)}`}
                  />
                </div>
                <InlineText
                  value={item.description}
                  onChange={(description) =>
                    onChange({
                      ...block,
                      items: replaceAt(block.items, index, {
                        ...item,
                        description,
                      }),
                    })
                  }
                  placeholder="One or two lines"
                  label={`Feature ${String(index + 1)} description`}
                  className="cq-body-sm text-(--cq-text-secondary)"
                />
              </li>
            ))}
          </ul>
          <AddButton
            onClick={() =>
              onChange({
                ...block,
                items: [
                  ...block.items,
                  { id: newBlockId(), title: "", description: "" },
                ],
              })
            }
          >
            Add a feature
          </AddButton>
        </div>
      );
    case "button":
      return (
        <div className="flex flex-wrap items-end gap-3">
          <span
            className={`inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-5 ${
              block.variant === "primary"
                ? "bg-(--cq-accent) text-(--cq-text-inverse)"
                : "border border-(--cq-border) bg-(--cq-surface) text-(--cq-text-primary)"
            }`}
          >
            <InlineText
              value={block.label}
              onChange={(label) => onChange({ ...block, label })}
              placeholder="Button label"
              label="Button label"
              className="cq-body-sm w-auto min-w-24 font-medium !text-inherit"
            />
          </span>
          <div className="min-w-56 flex-1">
            <HrefInput
              label="Goes to"
              value={block.href}
              onChange={(href) => onChange({ ...block, href })}
            />
          </div>
        </div>
      );
    case "divider":
      return <hr className="my-3 border-(--cq-border-subtle)" />;
    case "legalClause":
      return (
        <div className="flex flex-col gap-3">
          <InlineText
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
            placeholder="1. Clause title"
            label="Clause title"
            className="cq-title-md"
          />
          <RichTextEditable
            value={block.content}
            onChange={(content) => onChange({ ...block, content })}
            placeholder="The clause"
            label="Clause text"
            className="cq-body text-(--cq-text-secondary)"
          />
          {block.lawyerNote === null ? (
            <AddButton onClick={() => onChange({ ...block, lawyerNote: "" })}>
              Add a note for the lawyer
            </AddButton>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-(--cq-radius-md) border border-dashed border-(--cq-warning) bg-(--cq-warning-soft) px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="cq-label text-(--cq-text-primary)">
                  Lawyer note
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  Only editors see this. It never appears on the site.
                </span>
              </div>
              <textarea
                aria-label="Lawyer note"
                value={block.lawyerNote}
                rows={2}
                onChange={(event) =>
                  onChange({ ...block, lawyerNote: event.target.value })
                }
                className="cq-body-sm w-full resize-y rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface) p-2 text-(--cq-text-primary)"
              />
              <button
                type="button"
                onClick={() => onChange({ ...block, lawyerNote: null })}
                className="cq-label self-start rounded-(--cq-radius-sm) px-2 py-1.5 text-(--cq-text-secondary) hover:bg-(--cq-surface) hover:text-(--cq-text-primary)"
              >
                Mark resolved
              </button>
            </div>
          )}
        </div>
      );
  }
}
