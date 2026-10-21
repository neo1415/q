"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ThesisReadingDto } from "@capital-q/contracts";

import { applySuggestionAction } from "@/features/assumptions/assumption-actions";
import { ProfileSectionShell } from "@/features/profile/editable-section";
import { VisibilityLabel } from "@/features/profile/visibility-label";
import { QLine } from "@/features/relationships/crm-kit";
import { accountButton, Pending } from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

/**
 * Q.02 "How Q reads your thesis" (chosen design "One page, edit in
 * place", 2026-10-21): Q's reading of the investor's saves and passes,
 * labelled as a reading, never a rule. What they declared decides the
 * feed; what they did and what Q reads from it are kept apart, one tap
 * away. A suggestion changes the mandate only when they approve it, which
 * is the approval of exactly that one change at the mandate version they
 * are looking at; "Leave it as a reading" just hides it here.
 */
export function ThesisSection({
  reading,
  investorOrganisationId,
}: {
  readonly reading: ThesisReadingDto;
  readonly investorOrganisationId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const suggestions = reading.suggestions.filter((s) => !hidden.includes(s.id));
  const decisions = reading.observed.saved + reading.observed.passed;

  const approve = (suggestionId: string) => {
    if (reading.mandateId === null || reading.mandateVersion === null) return;
    const mandateId = reading.mandateId;
    const expectedVersion = reading.mandateVersion;
    setBusy(suggestionId);
    start(async () => {
      const out = await applySuggestionAction({
        investorOrganisationId,
        mandateId,
        suggestionId,
        expectedVersion,
      });
      setBusy(null);
      setMessage(
        out.ok
          ? "Done. Your mandate is updated, and your feed follows it."
          : out.message,
      );
      if (out.ok) router.refresh();
    });
  };

  return (
    <ProfileSectionShell
      id="thesis"
      title={t("How Q reads your thesis")}
      variant="brief"
      visibility={<VisibilityLabel scope="private" side="firm" translate={t} />}
    >
      <div data-thesis>
        <QLine
          small={
            decisions === 0
              ? t("From your saves and passes, once there are some.")
              : t(
                  `From ${String(reading.observed.saved)} saves and ${String(reading.observed.passed)} passes. A reading, not a fact about your thesis.`,
                )
          }
        >
          {reading.inferred.length === 0
            ? t("Not enough saves and passes yet for Q to read anything.")
            : reading.inferred.join(" ")}{" "}
          {reading.inferred.length === 0
            ? null
            : t(
                "That is a reading, not a rule: it never changes your declared mandate.",
              )}
        </QLine>
      </div>
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex flex-col gap-2"
          data-thesis-suggestion={suggestion.id}
        >
          <p className="m-0 text-sm text-(--cq-text-primary)">
            <b className="font-medium">{suggestion.title}</b>{" "}
            <span className="text-(--cq-text-secondary)">
              {suggestion.because} {suggestion.effect}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className={accountButton("secondary", "sm")}
              disabled={busy !== null}
              aria-busy={busy === suggestion.id}
              onClick={() => approve(suggestion.id)}
              data-apply-suggestion={suggestion.id}
            >
              {busy === suggestion.id ? (
                <Pending>{t("Saving…")}</Pending>
              ) : (
                t("Approve this change")
              )}
            </button>
            <button
              type="button"
              className={accountButton("quiet", "sm")}
              onClick={() =>
                setHidden((current) => [...current, suggestion.id])
              }
            >
              {t("Leave it as a reading")}
            </button>
          </div>
        </div>
      ))}
      <details className="text-sm" data-thesis-detail>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] text-(--cq-text-secondary) hover:text-(--cq-text-primary)">
          {t("What this reading is from")}
        </summary>
        <div className="grid gap-4 pt-1 md:grid-cols-3">
          <div className="flex flex-col gap-1.5" data-thesis-declared>
            <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
              {t("What you declared")}
            </h3>
            {reading.declared.length === 0 ? (
              <p className="m-0 text-[13px] text-(--cq-text-tertiary)">
                {t(
                  "No active mandate yet. Your answers above become your rules.",
                )}
              </p>
            ) : (
              <dl className="m-0 flex flex-col">
                {reading.declared.map((rule) => (
                  <div
                    key={rule.label}
                    className="flex justify-between gap-3 border-t border-(--cq-border-subtle) py-1.5 first:border-t-0"
                  >
                    <dt className="text-[13px] text-(--cq-text-secondary)">
                      {rule.label}
                    </dt>
                    <dd className="m-0 text-end text-[13px] text-(--cq-text-primary)">
                      {rule.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="flex flex-col gap-1.5" data-thesis-observed>
            <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
              {t("What you did")}
            </h3>
            <p className="m-0 text-[13px] text-(--cq-text-primary)">
              Saved {String(reading.observed.saved)} · Passed{" "}
              {String(reading.observed.passed)}
            </p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {reading.observed.counts.slice(0, 6).map((count) => (
                <li
                  key={`${count.decision}-${count.dimension}-${count.value}`}
                  className="flex justify-between gap-2 text-xs text-(--cq-text-secondary)"
                >
                  <span className="truncate">
                    {count.decision === "SAVED" ? "Saved" : "Passed"} ·{" "}
                    {count.label}
                  </span>
                  <span>{String(count.count)}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-xs text-(--cq-text-tertiary)">
              {t("Saving isn’t interest, and viewing counts for nothing here.")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5" data-thesis-inferred>
            <h3 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-medium text-(--cq-text-secondary)">
              {t("What Q reads from it")}
              <span className="rounded-(--cq-radius-sm) border border-dashed border-(--cq-border) px-1.5 text-xs">
                {t("Q’s inference")}
              </span>
            </h3>
            {reading.inferred.length === 0 ? (
              <p className="m-0 text-[13px] text-(--cq-text-tertiary)">
                {t("Nothing yet.")}
              </p>
            ) : (
              reading.inferred.map((line) => (
                <p
                  key={line}
                  className="m-0 text-[13px] text-(--cq-text-primary)"
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </div>
      </details>
      {message === null ? null : (
        <p className="m-0 text-sm text-(--cq-text-secondary)" role="status">
          {t(message)}
        </p>
      )}
    </ProfileSectionShell>
  );
}
