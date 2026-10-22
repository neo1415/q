"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import { Check } from "@capital-q/ui/icons";

import {
  accountButton,
  Pending,
  useAccountToast,
} from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";
import { LockedEdit, useGate } from "@/features/organisation/capabilities";

import { reviseProfileAnswerAction } from "./answer-actions";
import { same, StepField, stepsOf } from "./answer-editor";
import type { AnswerLine, ProfileJourney } from "./profile-answers";
import { ProfileSectionShell } from "./editable-section";

/**
 * A profile section of setup answers, edited in place (chosen design "One
 * page, edit in place", 2026-10-21): the declared mandate (or a founder's
 * traction and raise) as label-and-value rows. Edit turns the rows into
 * the steps' own fields, and Save sends each changed answer as a revision
 * of the completed setup (ADR 0024), the same validated path as setup.
 * Nothing reads "saved" until the server has recorded it; what Discover
 * works from is the saved mandate, never what the person watches or saves.
 */

type Draft = Readonly<Record<string, OnboardingResponseValue | null>>;

export type AnswersKvEditable = {
  readonly stepKeys: readonly string[];
  readonly responses: Readonly<Record<string, OnboardingResponseValue>>;
  readonly labels: Readonly<Record<string, string>>;
};

export function AnswersKvSection({
  id,
  title,
  journey,
  lines,
  editable,
  setupHref,
  visibility,
  intro,
  saveLabel,
  savedToast,
  saveNote,
  emptyText,
  initiallyEditing = false,
  capability,
}: {
  readonly id: string;
  readonly title: string;
  readonly journey: ProfileJourney;
  readonly lines: readonly AnswerLine[];
  /** The steps edited in place, or null when setup is where they change. */
  readonly editable: AnswersKvEditable | null;
  /** Where these answers change when they cannot be edited here. */
  readonly setupHref: string;
  readonly visibility?: ReactNode;
  readonly intro?: ReactNode;
  readonly saveLabel: string;
  readonly savedToast: string;
  readonly saveNote?: string | undefined;
  readonly emptyText: string;
  /** Design review only (/dev/account-review): opens in its edit form. */
  readonly initiallyEditing?: boolean | undefined;
  /** The capability saving needs; without it, "Admins only" (the API still decides). */
  readonly capability?: string | undefined;
}) {
  const t = useT();
  const gate = useGate(capability);
  const toast = useAccountToast();
  const router = useRouter();
  const steps = useMemo(
    () =>
      (editable?.stepKeys ?? []).flatMap((key) => {
        const step = stepsOf(journey).find((s) => s.stepKey === key);
        return step === undefined ? [] : [step];
      }),
    [journey, editable],
  );
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState<Draft>(() =>
    initiallyEditing
      ? Object.fromEntries(
          steps.map((s) => [s.stepKey, editable?.responses[s.stepKey] ?? null]),
        )
      : {},
  );
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setDraft(
      Object.fromEntries(
        steps.map((s) => [s.stepKey, editable?.responses[s.stepKey] ?? null]),
      ),
    );
    setError(null);
    setPhase("idle");
    setEditing(true);
  };

  const save = async () => {
    const responses = editable?.responses ?? {};
    const changed = steps.filter(
      (s) =>
        draft[s.stepKey] !== null &&
        draft[s.stepKey] !== undefined &&
        !same(draft[s.stepKey], responses[s.stepKey]),
    );
    if (changed.length === 0) {
      setEditing(false);
      return;
    }
    setPhase("pending");
    setError(null);
    for (const step of changed) {
      const result = await reviseProfileAnswerAction({
        journey,
        stepKey: step.stepKey,
        value: draft[step.stepKey],
      });
      if (!result.ok) {
        setPhase("idle");
        setError(`${step.configuration.prompt}: ${result.message}`);
        router.refresh();
        return;
      }
    }
    setPhase("done");
    toast(t(savedToast));
    setTimeout(() => {
      setEditing(false);
      setPhase("idle");
      router.refresh();
    }, 900);
  };

  const shown = (line: AnswerLine) =>
    line.items !== undefined && line.items !== null && line.items.length > 0
      ? line.items.join(", ")
      : line.value;

  const action = !gate.allowed ? (
    <LockedEdit gate={gate} />
  ) : editable === null || steps.length === 0 ? (
      <Link
        href={setupHref}
        aria-label={`${t("Edit")} ${title.toLowerCase()}`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-(--cq-radius-md) px-2.5 text-[13px] font-medium text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) lg:min-h-9"
      >
        {t("Edit")}
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => (editing ? setEditing(false) : start())}
        aria-pressed={editing}
        disabled={phase === "pending"}
        className="inline-flex min-h-11 shrink-0 items-center rounded-(--cq-radius-md) px-2.5 text-[13px] font-medium text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) lg:min-h-9"
        data-section-edit={id}
      >
        {editing ? t("Cancel") : t("Edit")}
      </button>
    );

  return (
    <ProfileSectionShell
      id={id}
      title={title}
      variant="brief"
      visibility={visibility}
      action={action}
    >
      {intro === undefined ? null : (
        <p className="m-0 mb-0.5 max-w-[68ch] text-sm leading-normal text-(--cq-text-secondary)">
          {intro}
        </p>
      )}
      {editing && gate.allowed ? (
        <div className="flex flex-col" data-answers="editing">
          {error === null ? null : (
            <p
              role="alert"
              className="m-0 mb-2 text-sm text-(--cq-text-primary)"
            >
              {t("Not saved.")} {error}
            </p>
          )}
          {steps.map((step) => (
            <div
              key={step.stepKey}
              className="min-w-0 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
            >
              {/* The step's own field, with its own question as the label. */}
              <StepField
                step={step}
                value={draft[step.stepKey] ?? null}
                labels={editable?.labels ?? {}}
                onChange={(value) =>
                  setDraft((known) => ({ ...known, [step.stepKey]: value }))
                }
              />
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className={accountButton(phase === "done" ? "done" : "primary")}
              disabled={phase !== "idle"}
              aria-busy={phase === "pending"}
              onClick={() => void save()}
              data-answer-save
            >
              {phase === "pending" ? (
                <Pending>{t("Saving…")}</Pending>
              ) : phase === "done" ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  {t("Saved")}
                </>
              ) : (
                t(saveLabel)
              )}
            </button>
            {saveNote === undefined ? null : (
              <span className="text-xs text-(--cq-text-tertiary)">
                {t(saveNote)}
              </span>
            )}
          </div>
        </div>
      ) : lines.length === 0 ? (
        <p
          className="m-0 text-sm text-(--cq-text-secondary)"
          data-answers="none"
        >
          {t(emptyText)}
        </p>
      ) : (
        <dl className="m-0 flex flex-col" data-answers="read">
          {lines.map((line) => {
            const value = shown(line);
            return (
              <div
                key={line.stepKey}
                data-answer={line.stepKey}
                data-state={value === null ? "unknown" : "stated"}
                className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-0"
              >
                <dt className="text-[13px] text-(--cq-text-secondary)">
                  {t(line.title)}
                </dt>
                <dd className="m-0 min-w-0 text-sm break-words whitespace-pre-line text-(--cq-text-primary)">
                  {value ?? (
                    <span className="text-(--cq-text-tertiary)">
                      {t("Not added")}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </ProfileSectionShell>
  );
}
