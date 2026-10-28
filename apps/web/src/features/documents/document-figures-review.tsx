"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  OnboardingSessionView,
  OnboardingSuggestionView,
} from "@capital-q/contracts";
import {
  formatLocalFigure,
  localFigureLabel,
  localFigureOf,
  type LocalFigureProvenance,
} from "@capital-q/founder-onboarding/local-figures/provenance";
import { Button } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";
import {
  onboardingCurrentAction,
  onboardingResolveSuggestionAction,
} from "@/features/onboarding-kit/api-actions";
import { LocalFigureNote } from "@/features/onboarding-conversation/local-figure-note";

/**
 * Owner decision 2026-10-28: the key figures Capital Q's code read from a
 * founder's highly confidential financial document, for them to confirm
 * where they work (the Documents page, the deck tab), after setup as much
 * as during it. Each is a pending suggestion on their own founder journey;
 * Keep, Change and Not this go through the same resolution as in setup, so
 * what they keep becomes their own claim through the same path. Nothing is
 * shown that is not theirs: the server returns their own session only.
 */

type Offer = {
  readonly suggestion: OnboardingSuggestionView;
  readonly figure: LocalFigureProvenance;
};

const DECIMAL = /^\d{1,13}(?:\.\d{1,4})?$/u;

function offersOf(view: OnboardingSessionView | null): readonly Offer[] {
  if (view === null) return [];
  return view.pendingSuggestions.flatMap((suggestion) => {
    const figure = localFigureOf(suggestion.sourceRefs);
    return figure === null ? [] : [{ suggestion, figure }];
  });
}

function shown(offer: Offer): { label: string; value: string } {
  const value = offer.suggestion.suggestedValue;
  if (value.type === "SINGLE_SELECT") {
    return {
      label: "Reporting currency",
      value: value.optionKey.toUpperCase(),
    };
  }
  return {
    label: localFigureLabel(offer.figure.measure),
    value:
      value.type === "RANGE"
        ? formatLocalFigure(offer.figure, value.value)
        : "",
  };
}

/** "Q3 management accounts" from the rationale the worker wrote, if any. */
function titleOf(offer: Offer, titles: ReadonlyMap<string, string>): string {
  const id = offer.figure.documentId;
  const known = id === null ? undefined : titles.get(id);
  if (known !== undefined) return known;
  const quoted = /“([^”]{1,80})”/u.exec(offer.suggestion.rationale ?? "");
  return quoted?.[1] ?? "your financial document";
}

export function DocumentFiguresReview({
  documents = [],
  documentId = null,
}: {
  /** Titles the page already holds, by document id. */
  readonly documents?: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  /** Only this document's figures; null for every document. */
  readonly documentId?: string | null;
}) {
  const t = useT();
  const [view, setView] = useState<OnboardingSessionView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    onboardingCurrentAction("founder")
      .then((result) => {
        if (live && result.ok) setView(result.value);
      })
      .catch(() => {
        // Nothing to review when the session cannot be read; the page
        // around this card still renders.
      });
    return () => {
      live = false;
    };
  }, []);

  const resolve = useCallback(
    async (
      offer: Offer,
      resolution: "ACCEPT" | "EDIT" | "REJECT",
      value?: string,
    ) => {
      if (view === null) return;
      setWorking(true);
      setNotice(null);
      const result = await onboardingResolveSuggestionAction({
        sessionId: view.session.id,
        suggestionId: offer.suggestion.id,
        resolution,
        ...(resolution === "EDIT" && value !== undefined
          ? { response: { type: "RANGE", value } }
          : {}),
        expectedSessionVersion: view.session.version,
        idempotencyKey: crypto.randomUUID(),
      });
      setWorking(false);
      if (result.ok) {
        setView(result.value);
        setEditing(null);
      } else {
        setNotice(result.message);
        // Moved on in another tab: show the latest.
        const latest = await onboardingCurrentAction("founder");
        if (latest.ok) setView(latest.value);
      }
    },
    [view],
  );

  const titles = new Map(documents.map((d) => [d.id, d.title]));
  const offers = offersOf(view).filter(
    (offer) => documentId === null || offer.figure.documentId === documentId,
  );
  if (offers.length === 0) return null;
  const byDocument = new Map<string, Offer[]>();
  for (const offer of offers) {
    const key = offer.figure.documentId ?? "";
    byDocument.set(key, [...(byDocument.get(key) ?? []), offer]);
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-(--cq-border) p-4"
      aria-label={t("Figures ready for your confirmation")}
      data-document-figures
    >
      {[...byDocument.entries()].map(([key, group]) => {
        const first = group[0];
        if (first === undefined) return null;
        const title = titleOf(first, titles);
        const count = group.filter(
          (offer) => offer.suggestion.suggestedValue.type === "RANGE",
        ).length;
        return (
          <div key={key} className="flex flex-col gap-3">
            <h3 className="cq-title-sm text-(--cq-text-primary)">
              {t(
                count === 1
                  ? `1 figure from ${title} is ready for your confirmation`
                  : `${String(count)} figures from ${title} are ready for your confirmation`,
              )}
            </h3>
            <LocalFigureNote figure={first.figure} />
            <ul className="flex flex-col gap-2">
              {group.map((offer) => {
                const { label, value } = shown(offer);
                const editable =
                  offer.suggestion.suggestedValue.type === "RANGE";
                return (
                  <li
                    key={offer.suggestion.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                    data-local-figure-offer={offer.figure.measure}
                  >
                    <span className="cq-body text-(--cq-text-primary)">
                      <span className="text-(--cq-text-secondary)">
                        {t(label)} ·{" "}
                      </span>
                      {value}
                    </span>
                    {editing === offer.suggestion.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const typed = draft.replace(/[,\s]/gu, "");
                          if (!DECIMAL.test(typed)) return;
                          void resolve(offer, "EDIT", typed);
                        }}
                      >
                        <input
                          inputMode="decimal"
                          aria-label={t(label)}
                          className="h-11 w-36 rounded-md border border-(--cq-border) bg-(--cq-surface) px-2"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                        <Button size="compact" type="submit" disabled={working}>
                          {t("Save")}
                        </Button>
                        <Button
                          size="compact"
                          variant="quiet"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          {t("Cancel")}
                        </Button>
                      </form>
                    ) : (
                      <span className="flex gap-1">
                        <Button
                          size="compact"
                          variant="secondary"
                          disabled={working}
                          onClick={() => void resolve(offer, "ACCEPT")}
                        >
                          {t("Keep")}
                        </Button>
                        {editable ? (
                          <Button
                            size="compact"
                            variant="quiet"
                            disabled={working}
                            onClick={() => {
                              setDraft(
                                offer.suggestion.suggestedValue.type === "RANGE"
                                  ? offer.suggestion.suggestedValue.value
                                  : "",
                              );
                              setEditing(offer.suggestion.id);
                            }}
                          >
                            {t("Change")}
                          </Button>
                        ) : null}
                        <Button
                          size="compact"
                          variant="quiet"
                          disabled={working}
                          onClick={() => void resolve(offer, "REJECT")}
                        >
                          {t("Not this")}
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {notice === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {notice}
        </p>
      )}
    </section>
  );
}
