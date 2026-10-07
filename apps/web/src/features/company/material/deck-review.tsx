"use client";

import { useState, useTransition } from "react";

import {
  DECK_READ_AGAIN_MAX,
  DECK_SECTION_LABELS,
  type DeckExtractionDto,
  type DeckSectionCode,
  type DeckSectionReviewAction,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { readAgainAction, reviewSectionAction } from "./material-actions";

/**
 * F26: the founder checks Q's read of their deck one section at a time.
 * Each section can be confirmed, marked as wrong, or corrected in their own
 * words, so one bad section never holds the rest back; "Ask Q to read
 * again" appends a new reading (twice per version at most). Investors see
 * only what the founder confirmed or wrote.
 */

type State = "PENDING" | "CONFIRMED" | "DISMISSED" | "CORRECTED";

const STATE_WORDS: Readonly<Record<State, string>> = {
  PENDING: "Not checked yet",
  CONFIRMED: "Confirmed",
  DISMISSED: "Marked as wrong · investors see it as not known",
  CORRECTED: "Your words",
};

const STATUS_WORDS: Readonly<Record<string, string | null>> = {
  PRESENT: null,
  UNCLEAR: "Q couldn't read this clearly",
  CONTRADICTORY: "Q says the deck disagrees with itself here",
  NOT_IN_DECK: "Not in the deck",
};

export function DeckReadingReview({
  companyId,
  documentId,
  extraction,
}: {
  readonly companyId: string;
  readonly documentId: string;
  readonly extraction: DeckExtractionDto;
}) {
  const initial = new Map<DeckSectionCode, State>(
    (extraction.sectionStates ?? []).map((s) => [s.section, s.state]),
  );
  const [states, setStates] = useState(initial);
  const [editing, setEditing] = useState<DeckSectionCode | null>(null);
  const [words, setWords] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [left, setLeft] = useState(
    extraction.readAgain?.left ?? DECK_READ_AGAIN_MAX,
  );
  const [waiting, setWaiting] = useState(
    extraction.readAgain?.pending ?? false,
  );
  const [pending, start] = useTransition();
  const setAside = new Map(
    (extraction.setAside ?? []).map((s) => [s.section, s.figures]),
  );
  const shown = extraction.sections.filter(
    (s) => s.status !== "NOT_IN_DECK" || setAside.has(s.section),
  );
  const ids = {
    companyId,
    documentId,
    extractionId: extraction.extractionId,
  };

  const review = (
    section: DeckSectionCode,
    action: DeckSectionReviewAction,
    correction: string | null = null,
  ) =>
    start(async () => {
      const result = await reviewSectionAction({
        ...ids,
        section,
        action,
        correction,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(null);
      setEditing(null);
      setStates((was) =>
        new Map(was).set(
          section,
          action === "CONFIRM"
            ? "CONFIRMED"
            : action === "DISMISS"
              ? "DISMISSED"
              : "CORRECTED",
        ),
      );
    });

  const readAgain = () =>
    start(async () => {
      const result = await readAgainAction(ids);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setLeft(result.value.left);
      setWaiting(true);
      setMessage(
        "Q is reading your deck again. The new reading appears here in a few minutes; this one stays until then.",
      );
    });

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="check-read"
      data-deck-review
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="check-read" className="cq-title-sm text-(--cq-text-primary)">
          Check Q&rsquo;s read, section by section
        </h3>
        <span className="cq-caption text-(--cq-text-secondary)">
          Reading {extraction.readingNumber ?? 1} of version{" "}
          {extraction.versionNumber}
        </span>
      </div>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Confirm what&rsquo;s right, mark what&rsquo;s wrong, or say it in your
        own words. Investors see only the sections you confirm or write.
      </p>
      <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {shown.map((section) => {
          const state = states.get(section.section) ?? "PENDING";
          const status = STATUS_WORDS[section.status] ?? null;
          const figures = setAside.get(section.section);
          return (
            <li
              key={section.section}
              className="flex flex-col gap-2 py-3"
              data-review-section={section.section}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="cq-body text-(--cq-text-primary)">
                  {DECK_SECTION_LABELS[section.section]}
                </span>
                <span className="cq-caption text-(--cq-text-secondary)">
                  {STATE_WORDS[state]}
                </span>
              </div>
              {status === null ? null : (
                <p className="cq-caption text-(--cq-text-secondary)">
                  {status}
                </p>
              )}
              {section.summary === null ? null : (
                <p className="cq-body-sm text-(--cq-text-primary)">
                  {section.summary}
                </p>
              )}
              {figures === undefined ? null : (
                <p className="cq-caption text-(--cq-text-secondary)">
                  Set aside: Q cited {figures.join(", ")}, which isn&rsquo;t in
                  your deck&rsquo;s text.
                </p>
              )}
              {editing === section.section ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = words.trim();
                    if (text !== "") review(section.section, "CORRECT", text);
                  }}
                >
                  <label className="cq-caption text-(--cq-text-secondary)">
                    What your deck says, in your words
                    <textarea
                      className="cq-body-sm mt-1 min-h-20 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) p-2 text-(--cq-text-primary)"
                      maxLength={600}
                      value={words}
                      onChange={(event) => setWords(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={pending || words.trim() === ""}
                      className={buttonClassName(
                        "primary",
                        "compact",
                        "min-h-11",
                      )}
                    >
                      Save my words
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className={buttonClassName(
                        "quiet",
                        "compact",
                        "min-h-11",
                      )}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || state === "CONFIRMED"}
                    onClick={() => review(section.section, "CONFIRM")}
                    className={buttonClassName(
                      "secondary",
                      "compact",
                      "min-h-11",
                    )}
                  >
                    Looks right
                  </button>
                  <button
                    type="button"
                    disabled={pending || state === "DISMISSED"}
                    onClick={() => review(section.section, "DISMISS")}
                    className={buttonClassName("quiet", "compact", "min-h-11")}
                  >
                    This is wrong
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setWords(section.summary ?? "");
                      setEditing(section.section);
                    }}
                    className={buttonClassName("quiet", "compact", "min-h-11")}
                  >
                    Correct it
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || waiting || left === 0}
          onClick={readAgain}
          className={buttonClassName("secondary", "regular")}
        >
          Ask Q to read again
        </button>
        <span className="cq-caption text-(--cq-text-secondary)">
          {waiting
            ? "Reading again…"
            : left === 0
              ? "Q has read this version again twice. Upload a new version or correct a section yourself."
              : `${String(left)} left for this version`}
        </span>
      </div>
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </section>
  );
}
