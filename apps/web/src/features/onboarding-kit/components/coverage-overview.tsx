"use client";

import { useState } from "react";

import type {
  OnboardingCoverage,
  OnboardingCoverageField,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import {
  sourceWords,
  stateWords,
  summaryWords,
  visibleFields,
} from "../coverage";
import type { FormCoverage } from "../use-form-coverage";
import { useT } from "@/features/i18n/language";

/**
 * What the form knows, all of it, in one place (owner directive 2026-10-16:
 * completion status, saved progress, the same coverage as the conversation).
 *
 * Quiet by default: one line under the progress bar. Opened, it lists every
 * field on the person's path by phase, with its state in words, what is held,
 * where it came from, whether it is required, and a way to go to the screen
 * that asks it. A value Q only proposed is shown as waiting, with Confirm and
 * Not right; confirming goes through the ordinary suggestion resolution, so
 * the form never records anything by a path of its own.
 */
export function CoverageOverview({
  coverage,
  phases,
  busy,
  onOpen,
  onResolve,
}: {
  readonly coverage: OnboardingCoverage;
  readonly phases: readonly {
    readonly phaseKey: string;
    readonly label: string;
  }[];
  readonly busy: boolean;
  /** Opens the form screen that asks this field; undefined when it has none. */
  readonly onOpen: ((fieldKey: string) => void) | undefined;
  readonly onResolve: (
    suggestionId: string,
    resolution: "ACCEPT" | "REJECT",
  ) => Promise<boolean>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const fields = visibleFields(coverage);
  const known = new Set(phases.map((phase) => phase.phaseKey));
  const byPhase = [
    ...phases,
    // Fields no definition step holds (an optional upload such as the
    // investor's I.materials) are listed last, under their own heading.
    { phaseKey: "", label: "Materials" },
  ]
    .map((phase) => ({
      phase,
      fields: fields.filter((field) =>
        phase.phaseKey === ""
          ? field.phaseKey === null || !known.has(field.phaseKey)
          : field.phaseKey === phase.phaseKey,
      ),
    }))
    .filter((group) => group.fields.length > 0);

  return (
    <div className="flex items-center justify-between gap-2" data-coverage>
      <span
        className="cq-caption min-w-0 truncate text-(--cq-text-secondary)"
        data-coverage-summary
      >
        {summaryWords(coverage)}
      </span>
      <SheetRoot open={open} onOpenChange={setOpen}>
        <Button
          variant="quiet"
          size="compact"
          className="shrink-0 px-2"
          onClick={() => setOpen(true)}
          data-coverage-open
        >
          {t("What Q has")}
        </Button>
        <SheetContent
          side="side"
          title={t("What Q has so far")}
          description={t(
            "The same picture Q works from in conversation. Nothing waiting for your confirmation is saved.",
          )}
        >
          <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
            {byPhase.map(({ phase, fields: phaseFields }) => (
              <section
                key={phase.phaseKey}
                className="flex flex-col gap-2"
                aria-label={phase.label}
              >
                <h3 className="cq-label text-(--cq-text-primary)">
                  {phase.label}
                </h3>
                <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
                  {phaseFields.map((field) => (
                    <CoverageRow
                      key={field.fieldKey}
                      field={field}
                      busy={busy}
                      onOpen={
                        onOpen === undefined || phase.phaseKey === ""
                          ? undefined
                          : () => {
                              setOpen(false);
                              onOpen(field.fieldKey);
                            }
                      }
                      onResolve={onResolve}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </SheetContent>
      </SheetRoot>
    </div>
  );
}

function CoverageRow({
  field,
  busy,
  onOpen,
  onResolve,
}: {
  readonly field: OnboardingCoverageField;
  readonly busy: boolean;
  readonly onOpen: (() => void) | undefined;
  readonly onResolve: (
    suggestionId: string,
    resolution: "ACCEPT" | "REJECT",
  ) => Promise<boolean>;
}) {
  const t = useT();
  const [refused, setRefused] = useState(false);
  const proposal = field.proposals[0];
  const decide = async (resolution: "ACCEPT" | "REJECT") => {
    if (proposal === undefined) return;
    setRefused(!(await onResolve(proposal.suggestionId, resolution)));
  };
  return (
    <li
      className="flex flex-col gap-1.5 py-3"
      data-coverage-field={field.fieldKey}
      data-coverage-state={field.state}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {field.label}
        </span>
        <span className="cq-caption shrink-0 text-(--cq-text-tertiary)">
          {field.required ? "Required" : "Optional"}
        </span>
      </div>
      <span className="cq-body-sm text-(--cq-text-secondary)">
        {stateWords(field)}
      </span>
      {field.display !== null ? (
        <span className="cq-body-sm min-w-0 break-words [overflow-wrap:anywhere] text-(--cq-text-primary)">
          {field.display}
          {field.source === null ? null : (
            <span className="break-words text-(--cq-text-tertiary)">
              {" "}
              · from {sourceWords(field.source)}
            </span>
          )}
        </span>
      ) : null}
      {field.state === "CONTRADICTORY" && field.readings.length > 0 ? (
        <ul className="cq-body-sm list-disc ps-5 text-(--cq-text-secondary)">
          {field.readings.map((reading) => (
            <li key={reading}>{reading}</li>
          ))}
        </ul>
      ) : null}
      {field.state === "SUPPLIED_UNCONFIRMED" && proposal !== undefined ? (
        <div className="flex flex-col gap-2" data-coverage-proposal>
          <span className="cq-body-sm text-(--cq-text-primary)">
            {proposal.display}
            <span className="text-(--cq-text-tertiary)">
              {" "}
              · from {sourceWords(proposal.source)}
            </span>
          </span>
          {proposal.note === null ? null : (
            <span
              className="cq-caption text-(--cq-text-secondary)"
              data-coverage-proposal-note
            >
              {proposal.note}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="compact"
              variant="secondary"
              disabled={busy}
              onClick={() => void decide("ACCEPT")}
            >
              {t("Confirm")}
              <span className="sr-only"> {field.label}</span>
            </Button>
            <Button
              size="compact"
              variant="quiet"
              disabled={busy}
              onClick={() => void decide("REJECT")}
            >
              {t("Not right")}
              <span className="sr-only"> — {field.label}</span>
            </Button>
          </div>
        </div>
      ) : null}
      {refused ? (
        <span role="alert" className="cq-caption text-(--cq-danger)">
          {t("That wasn't recorded. Try again from the screen that asks it.")}
        </span>
      ) : null}
      {onOpen === undefined || field.state === "INAPPLICABLE" ? null : (
        <Button
          size="compact"
          variant="quiet"
          className="self-start px-0"
          disabled={busy}
          onClick={onOpen}
          data-coverage-go
        >
          {field.state === "MISSING" || field.state === "DEFERRABLE"
            ? "Answer"
            : "Review"}
          <span className="sr-only"> {field.label}</span>
        </Button>
      )}
    </li>
  );
}

/**
 * The coverage line in the form's header, in every state the read can be
 * in: a quiet line while it loads, the overview when it is ready, and on a
 * failed read the last good overview (if any) with a plain retry. Nothing
 * here blocks the form: answering never waits on coverage.
 */
export function FormCoverageArea({
  coverage,
  phases,
  busy,
  onOpen,
  onResolve,
}: {
  readonly coverage: FormCoverage & { readonly retry: () => void };
  readonly phases: readonly {
    readonly phaseKey: string;
    readonly label: string;
  }[];
  readonly busy: boolean;
  readonly onOpen: ((fieldKey: string) => void) | undefined;
  readonly onResolve: (
    suggestionId: string,
    resolution: "ACCEPT" | "REJECT",
  ) => Promise<boolean>;
}) {
  const t = useT();
  switch (coverage.status) {
    case "NONE":
      return null;
    case "LOADING":
      return (
        <span
          className="cq-caption text-(--cq-text-tertiary)"
          data-coverage-loading
        >
          {t("Checking what Q has…")}
        </span>
      );
    case "READY":
      return (
        <CoverageOverview
          coverage={coverage.coverage}
          phases={phases}
          busy={busy}
          onOpen={onOpen}
          onResolve={onResolve}
        />
      );
    case "ERROR":
      return (
        <div className="flex flex-col gap-1" data-coverage-error>
          {coverage.stale === null ? null : (
            <CoverageOverview
              coverage={coverage.stale}
              phases={phases}
              busy={busy}
              onOpen={onOpen}
              onResolve={onResolve}
            />
          )}
          <span className="cq-caption flex items-center gap-2 text-(--cq-text-secondary)">
            {coverage.stale === null
              ? "Couldn't load what Q has. Your answers are unaffected."
              : "This may be out of date."}
            <Button
              size="compact"
              variant="quiet"
              className="px-1"
              onClick={coverage.retry}
            >
              {t("Try again")}
            </Button>
          </span>
        </div>
      );
  }
}
