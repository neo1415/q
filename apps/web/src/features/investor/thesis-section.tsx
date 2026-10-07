"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ThesisReadingDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { applySuggestionAction } from "@/features/assumptions/assumption-actions";

/**
 * Q.02 "How Q reads your thesis" (2026-10-07; design "thesis"): what the
 * investor declared (their rules, which decide the feed), what they did
 * (saves and passes, counted) and what Q reads from it (labelled Q's
 * inference), kept apart. A suggestion changes the mandate only when they
 * press its button, which is the approval of exactly that one change, at
 * the mandate version they are looking at; "Not now" just hides it here.
 */
export function ThesisSection({
  reading,
  investorOrganisationId,
}: {
  readonly reading: ThesisReadingDto;
  readonly investorOrganisationId: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suggestions = reading.suggestions.filter(
    (s) => !hidden.includes(s.id),
  );
  const savedCounts = reading.observed.counts.filter(
    (c) => c.decision === "SAVED",
  );
  const passedCounts = reading.observed.counts.filter(
    (c) => c.decision === "PASSED",
  );
  const widest = Math.max(1, ...reading.observed.counts.map((c) => c.count));

  const approve = (suggestionId: string) => {
    if (reading.mandateId === null || reading.mandateVersion === null) return;
    const mandateId = reading.mandateId;
    const expectedVersion = reading.mandateVersion;
    start(async () => {
      const out = await applySuggestionAction({
        investorOrganisationId,
        mandateId,
        suggestionId,
        expectedVersion,
      });
      setMessage(
        out.ok
          ? "Done. Your mandate is updated, and your feed follows it."
          : out.message,
      );
      if (out.ok) router.refresh();
    });
  };

  return (
    <section
      id="thesis"
      aria-labelledby="thesis-title"
      className="flex scroll-mt-6 flex-col gap-4"
      data-thesis
    >
      <div className="flex flex-col gap-1">
        <h2 id="thesis-title" className="cq-title-md text-(--cq-text-primary)">
          How Q reads your thesis
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          What you declared decides your feed. What you did and what Q reads
          from it are shown apart, and never change your rules unless you
          approve.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2" data-thesis-declared>
          <h3 className="cq-title-sm text-(--cq-text-primary)">
            What you declared
          </h3>
          {reading.declared.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              No active mandate yet. Your answers above become your rules.
            </p>
          ) : (
            <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {reading.declared.map((rule) => (
                <div
                  key={rule.label}
                  className="flex justify-between gap-3 py-2"
                >
                  <dt className="cq-body-sm text-(--cq-text-secondary)">
                    {rule.label}
                  </dt>
                  <dd className="cq-body-sm text-end text-(--cq-text-primary)">
                    {rule.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex flex-col gap-2" data-thesis-observed>
          <h3 className="cq-title-sm text-(--cq-text-primary)">What you did</h3>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Saved {String(reading.observed.saved)} · Passed{" "}
            {String(reading.observed.passed)}
          </p>
          <ul className="flex flex-col gap-1.5">
            {[...savedCounts.slice(0, 3), ...passedCounts.slice(0, 3)].map(
              (count) => (
                <li
                  key={`${count.decision}-${count.dimension}-${count.value}`}
                  className="cq-caption grid grid-cols-[minmax(0,7.5rem)_1fr_1.5rem] items-center gap-2 text-(--cq-text-secondary)"
                >
                  <span className="truncate">
                    {count.decision === "SAVED" ? "Saved" : "Passed"} ·{" "}
                    {count.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2 overflow-hidden rounded-full bg-(--cq-surface-subtle)"
                  >
                    <span
                      className="block h-full rounded-full bg-(--cq-border-strong)"
                      style={{ width: `${String((count.count / widest) * 100)}%` }}
                    />
                  </span>
                  <span className="text-end">{String(count.count)}</span>
                </li>
              ),
            )}
          </ul>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Saving isn&rsquo;t interest, and viewing counts for nothing here.
          </p>
        </div>
        <div className="flex flex-col gap-2" data-thesis-inferred>
          <h3 className="cq-title-sm flex flex-wrap items-center gap-2 text-(--cq-text-primary)">
            What Q reads from it
            <span className="cq-caption rounded-md border border-dashed border-(--cq-border) px-1.5 text-(--cq-text-secondary)">
              Q&rsquo;s inference
            </span>
          </h3>
          {reading.inferred.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Not enough saves and passes yet for Q to read anything.
            </p>
          ) : (
            reading.inferred.map((line) => (
              <p key={line} className="cq-body-sm text-(--cq-text-primary)">
                {line}
              </p>
            ))
          )}
          <p className="cq-caption text-(--cq-text-tertiary)">
            A reading of{" "}
            {String(reading.observed.saved + reading.observed.passed)}{" "}
            decisions, not a fact about your thesis.
          </p>
        </div>
      </div>
      {suggestions.length === 0 ? null : (
        <div className="flex flex-col gap-3" data-thesis-suggestions>
          <h3 className="cq-title-sm text-(--cq-text-primary)">Q suggests</h3>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="flex flex-col gap-2 rounded-xl border border-(--cq-accent) bg-(--cq-accent-soft) p-4"
            >
              <p className="cq-body font-medium text-(--cq-text-primary)">
                {suggestion.title}
              </p>
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {suggestion.because} {suggestion.effect}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() => approve(suggestion.id)}
                  data-apply-suggestion={suggestion.id}
                >
                  Approve this change
                </Button>
                <Button
                  variant="quiet"
                  onClick={() =>
                    setHidden((current) => [...current, suggestion.id])
                  }
                >
                  Not now
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
