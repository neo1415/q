"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  rehearsalSimulationLabel,
  type QRehearsalDto,
  type QRehearsalReviewDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CircleHelp,
  ICON_SIZE,
  Mic,
} from "@capital-q/ui/icons";

import { QRing } from "@/features/relationships/crm-kit";
import { WorkEmpty, workButton } from "@/features/work/work-b-kit";

import {
  DIMENSION_WORDS,
  OUTCOME_WORDS,
  RATING_WORDS,
  lengthWords,
} from "./meet";
import { addBoardItemAction } from "@/features/board/board-actions";

import {
  boardNotes,
  endMoments,
  momentTurn,
  type EndMoment,
} from "./review-moments";
import { outOfTen } from "./rehearsals-home";
import { ReviewRefresh } from "./review-refresh";
import { useT } from "@/features/i18n/language";

/**
 * The review after a rehearsal (REHEARSE; chosen design 2026-10-21,
 * "Feedback tied to the transcript", warm charcoal): said to be a
 * simulation first; the score computed from the ratings (never a model's
 * number) with its change since last time; then the transcript beside the
 * feedback, each note pointing at the line it is about. While Q writes,
 * or when there is nothing to review, the page says exactly that.
 */

const DIFFICULTY_WORDS = {
  GENTLE: "gentle difficulty",
  REALISTIC: "realistic difficulty",
  TOUGH: "tough difficulty",
} as const;

/**
 * "Up 0.8 since last time": both scores are code-computed, and written out
 * of 10 like the rehearsals list, so one rehearsal reads the same anywhere.
 */
export function progressWords(score: number, previous: number): string {
  const change = Math.round(score) - Math.round(previous);
  const before = outOfTen(previous);
  if (change === 0) return `Same as last time (${before})`;
  return change > 0
    ? `Up ${outOfTen(change)} since last time (${before})`
    : `Down ${outOfTen(-change)} since last time (${before})`;
}

export function lobbyHref(rehearsal: Pick<QRehearsalDto, "counterpart">) {
  const id = encodeURIComponent(rehearsal.counterpart.id);
  return rehearsal.counterpart.kind === "COMPANY"
    ? `/rehearsals/company/${id}`
    : `/rehearsals/investor/${id}`;
}

/** Ended before a word was answered: nothing to review, said plainly. */
function leftBeforeAnswering(rehearsal: QRehearsalDto): boolean {
  return (
    rehearsal.metrics.exchanges === 0 ||
    rehearsal.outcome === "LEFT_EARLY" ||
    rehearsal.outcome === "FOUNDER_ENDED"
  );
}

const card =
  "flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 sm:p-5";

function ScoreBlock({
  review,
  previous,
}: {
  readonly review: QRehearsalReviewDto;
  readonly previous: number | null;
}) {
  const t = useT();
  const score = review.score;
  return (
    <section
      className="grid gap-3 rounded-[14px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-7 md:p-[22px]"
      data-review-score
    >
      <div className="flex flex-col">
        {score === null ? (
          <span className="text-sm text-(--cq-text-tertiary)">
            {t("No score yet")}
          </span>
        ) : (
          <>
            <span className="text-[52px] leading-none font-semibold tracking-[-0.03em] text-(--cq-text-primary) tabular-nums">
              {outOfTen(score)}
              <small className="text-base font-normal tracking-normal text-(--cq-text-tertiary)">
                {" "}
                / 10
              </small>
            </span>
            <span className="mt-1 text-xs text-(--cq-text-tertiary)">
              {t("From the ratings")}
            </span>
            {previous === null ? null : (
              <span className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-secondary)">
                <span className="grid size-5 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-primary)">
                  {score >= previous ? (
                    <ArrowUp size={12} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={12} aria-hidden="true" />
                  )}
                </span>
                {t(progressWords(score, previous))}
              </span>
            )}
          </>
        )}
      </div>
      <p className="m-0 text-[17px] leading-[1.55] text-(--cq-text-primary)">
        {review.overall}
      </p>
    </section>
  );
}

function Writing() {
  const t = useT();
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-raised) px-[18px] py-4"
      data-review-writing
    >
      <QRing className="size-7 text-sm text-(--cq-accent)" />
      <div className="min-w-0 flex-1">
        <b className="text-(--cq-text-primary)">
          {t("Q is still writing the full review")}
        </b>
        <p className="m-0 text-xs text-(--cq-text-tertiary)">
          {t(
            "This page updates when it’s ready. Your transcript is already saved.",
          )}
        </p>
      </div>
      <ReviewRefresh />
    </div>
  );
}

/**
 * The end card (owner 2026-10-24): how long it ran, the review's three
 * strongest and three weakest moments with when they were said, and the
 * notes kept on their board in one step. Each moment opens its line.
 */
function EndCard({
  name,
  duration,
  strongest,
  weakest,
  onMoment,
}: {
  readonly name: string;
  readonly duration: string;
  readonly strongest: readonly EndMoment[];
  readonly weakest: readonly EndMoment[];
  readonly onMoment: (line: number) => void;
}) {
  const t = useT();
  // One key for this card: saving twice keeps one note.
  const [key] = useState(() => crypto.randomUUID());
  const [saved, setSaved] = useState<
    | { readonly state: "IDLE" | "SAVING" | "SAVED" }
    | { readonly state: "FAILED"; readonly message: string }
  >({ state: "IDLE" });
  const save = async () => {
    setSaved({ state: "SAVING" });
    const result = await addBoardItemAction({
      idempotencyKey: key,
      request: {
        kind: "NOTE",
        title: `Rehearsal with ${name}: notes`.slice(0, 300),
        notes: boardNotes({ name, duration, strongest, weakest }),
      },
    });
    setSaved(
      result.ok
        ? { state: "SAVED" }
        : { state: "FAILED", message: result.message },
    );
  };
  const list = (title: string, moments: readonly EndMoment[], id: string) =>
    moments.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <h3
          id={id}
          className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
        >
          {t(title)}
        </h3>
        <ol aria-labelledby={id} className="m-0 flex list-none flex-col p-0">
          {moments.map((one) => (
            <li key={one.moment}>
              <button
                type="button"
                disabled={one.line === null}
                onClick={() => {
                  if (one.line !== null) onMoment(one.line);
                }}
                className="flex min-h-11 w-full items-start gap-3 rounded-(--cq-radius-md) px-2 py-1.5 text-start text-[14.5px] text-(--cq-text-primary) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:hover:bg-transparent"
              >
                <span className="w-11 flex-none pt-px text-[13px] tabular-nums text-(--cq-text-tertiary)">
                  {one.at ?? "–"}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span>{one.moment}</span>
                  {one.why.length === 0 ? null : (
                    <span className="text-[13px] text-(--cq-text-secondary)">
                      {one.why}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  return (
    <section
      className={cx(card, "mt-4")}
      aria-labelledby="end-card"
      data-end-card
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="end-card"
          className="m-0 text-base font-semibold text-(--cq-text-primary)"
        >
          {t("How it went")}
        </h2>
        <span className="text-sm text-(--cq-text-secondary)">
          {t(`${duration} with ${name}`)}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {list("Strongest moments", strongest, "end-strongest")}
        {list("To work on", weakest, "end-weakest")}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {saved.state === "SAVED" ? (
          <span role="status" className="text-sm text-(--cq-text-secondary)">
            <Check size={14} aria-hidden="true" className="me-1 inline" />
            {t("Saved to your board.")}{" "}
            <Link href="/board" className="underline underline-offset-2">
              {t("Open board")}
            </Link>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saved.state === "SAVING"}
            className={workButton("secondary", "min-h-11")}
          >
            {t("Save notes to my board")}
          </button>
        )}
        {saved.state === "FAILED" ? (
          <span role="status" className="text-sm text-(--cq-text-secondary)">
            {saved.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function RehearsalReview({
  rehearsal,
  initialNote,
}: {
  readonly rehearsal: QRehearsalDto;
  /**
   * The "what to improve" note shown picked, its line lit (the design
   * review page); absent: none until the person picks one.
   */
  readonly initialNote?: number | undefined;
}) {
  const t = useT();
  const name = rehearsal.counterpart.name;
  const review = rehearsal.review;
  const improve = (review?.wentWrong ?? []).map((item) => ({
    ...item,
    line: momentTurn(item.moment, rehearsal.turns),
  }));
  const [picked, setPicked] = useState<number | null>(
    initialNote !== undefined && improve[initialNote] !== undefined
      ? initialNote
      : null,
  );
  const [lit, setLit] = useState<number | null>(
    initialNote === undefined ? null : (improve[initialNote]?.line ?? null),
  );
  const lines = useRef(new Map<number, HTMLLIElement>());

  const pick = (index: number, line: number | null) => {
    setPicked(index);
    setLit(line);
    if (line === null) return;
    const el = lines.current.get(line);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    el?.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
  };

  const meta = [
    rehearsal.outcome === null
      ? rehearsal.status === "ACTIVE"
        ? "Still open"
        : "Finished"
      : OUTCOME_WORDS[rehearsal.outcome],
    lengthWords(
      rehearsal.createdAt,
      rehearsal.endedAt,
      rehearsal.metrics.minutes,
    ),
    DIFFICULTY_WORDS[rehearsal.difficulty],
  ].join(", ");

  const nothing = review === null && leftBeforeAnswering(rehearsal);

  return (
    <article className="cq-charcoal flex flex-col" data-rehearsal-review>
      <Link
        href="/rehearsals"
        className="-mt-2.5 inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
      >
        <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
        {t("Rehearsals")}
      </Link>
      <header className="mb-[18px] flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-(--cq-text-tertiary)">
          <CircleHelp size={14} aria-hidden="true" />
          {t(rehearsalSimulationLabel(name))}
        </span>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.02em] text-(--cq-text-primary) md:text-[28px]">
          {t(`Your rehearsal with ${name}`)}
        </h1>
        <span className="text-sm text-(--cq-text-secondary)">{t(meta)}</span>
      </header>

      {nothing ? (
        <WorkEmpty
          title={t("Nothing to review yet")}
          icon={<Mic size={ICON_SIZE.prominent} aria-hidden="true" />}
          action={
            <Link href={lobbyHref(rehearsal)} className={workButton("primary")}>
              {t("Start again")}
            </Link>
          }
          data-review-state="nothing"
        >
          {t(
            "You left before answering anything, so there’s nothing to review yet.",
          )}
        </WorkEmpty>
      ) : review === null ? (
        <Writing />
      ) : review.provisional === true ? (
        <div className="flex flex-col gap-3.5">
          <Writing />
          <p className="m-0 text-[15px] text-(--cq-text-secondary)">
            {review.overall}
          </p>
        </div>
      ) : (
        <>
          <ScoreBlock review={review} previous={rehearsal.previousScore} />
          {review.wentRight.length + review.wentWrong.length === 0 ? null : (
            <EndCard
              name={name}
              duration={lengthWords(
                rehearsal.createdAt,
                rehearsal.endedAt,
                rehearsal.metrics.minutes,
              )}
              {...endMoments(review, rehearsal.turns, rehearsal.createdAt)}
              onMoment={(line) => {
                const index = improve.findIndex((item) => item.line === line);
                pick(index, line);
              }}
            />
          )}
        </>
      )}

      {nothing ? null : (
        <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className={cx(card, "gap-1")} aria-labelledby="transcript">
            <h2
              id="transcript"
              className="m-0 mb-2 text-[13px] font-medium text-(--cq-text-secondary)"
            >
              {t("Transcript")}
            </h2>
            {rehearsal.turns.length === 0 ? (
              <p className="m-0 text-sm text-(--cq-text-tertiary)">
                {t("Nothing was said in this rehearsal.")}
              </p>
            ) : (
              <ol aria-label={t("Transcript")} className="m-0 list-none p-0">
                {rehearsal.turns.map((turn, index) => (
                  <li
                    key={`${turn.at}-${String(index)}`}
                    ref={(el) => {
                      if (el === null) lines.current.delete(index);
                      else lines.current.set(index, el);
                    }}
                    data-line={index}
                    data-lit={lit === index ? "" : undefined}
                    className={cx(
                      "flex scroll-mt-28 flex-col gap-1 rounded-[10px] px-3 py-2.5 transition-[background-color] duration-300",
                      lit === index && "bg-(--cq-accent-soft)",
                    )}
                  >
                    <span className="text-xs font-medium text-(--cq-text-tertiary)">
                      {turn.from === "THEM" ? t(`${name} (Q)`) : t("You")}
                      {turn.sawScreen ? t(" · looking at your screen") : ""}
                    </span>
                    <p className="m-0 text-[14.5px] leading-normal text-(--cq-text-primary)">
                      {turn.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
            {improve.length === 0 ? null : (
              <div className="flex flex-col gap-2" data-review-feedback>
                <h2 className="m-0 text-base font-semibold text-(--cq-text-primary)">
                  {t("Feedback, tied to what you said")}
                </h2>
                {improve.map((item, index) => (
                  <button
                    key={item.moment}
                    type="button"
                    onClick={() => pick(index, item.line)}
                    aria-pressed={picked === index}
                    data-feedback-line={
                      item.line === null ? "none" : String(item.line)
                    }
                    className={cx(
                      "cq-crm-press flex w-full flex-col gap-1 rounded-(--cq-radius-lg) border bg-(--cq-surface-raised) p-3.5 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
                      picked === index
                        ? "border-(--cq-text-secondary) shadow-[0_0_0_3px_var(--cq-accent-soft)]"
                        : "border-(--cq-border-subtle) hover:border-(--cq-border)",
                    )}
                  >
                    <b className="text-sm text-(--cq-text-primary)">
                      {item.moment}
                    </b>
                    {item.why.length === 0 ? null : (
                      <span className="text-[13px] text-(--cq-text-secondary)">
                        {item.why}
                      </span>
                    )}
                    <span className="text-[13px] text-(--cq-text-secondary)">
                      <b className="text-(--cq-text-primary)">{t("Try:")} </b>
                      {item.better}
                    </span>
                    {picked === index && item.line === null ? (
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t("About the rehearsal as a whole, not one line.")}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}

            {review === null || review.wentRight.length === 0 ? null : (
              <section className={card} aria-labelledby="went-right">
                <h3
                  id="went-right"
                  className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
                >
                  {t("What went right")}
                </h3>
                <ul className="m-0 flex list-none flex-col p-0">
                  {review.wentRight.map((item, index) => (
                    <li
                      key={item.moment}
                      className={cx(
                        "flex items-start gap-2.5 py-3 text-[15px] text-(--cq-text-primary)",
                        index > 0 && "border-t border-(--cq-border-subtle)",
                      )}
                    >
                      <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)">
                        <Check size={12} strokeWidth={3} aria-hidden="true" />
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span>{item.moment}</span>
                        {item.why.length === 0 ? null : (
                          <span className="text-[13px] text-(--cq-text-secondary)">
                            {item.why}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {review === null || review.dimensions.length === 0 ? null : (
              <section className={card} aria-labelledby="breakdown">
                <h3
                  id="breakdown"
                  className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
                >
                  {t("Breakdown")}
                </h3>
                <dl className="m-0 flex flex-col gap-2.5">
                  {review.dimensions.map((dimension) => (
                    <div key={dimension.name} className="flex flex-col gap-0.5">
                      <dt className="text-sm text-(--cq-text-primary)">
                        {t(DIMENSION_WORDS[dimension.name])}:{" "}
                        <span className="text-(--cq-text-secondary)">
                          {t(RATING_WORDS[dimension.rating])}
                        </span>
                      </dt>
                      <dd className="m-0 text-[13px] text-(--cq-text-secondary)">
                        {dimension.note}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {review === null || review.tips.length === 0 ? null : (
              <section className={card} aria-labelledby="tips">
                <h3
                  id="tips"
                  className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
                >
                  {t(`Tips for meeting ${name}`)}
                </h3>
                <ul className="m-0 flex list-none flex-col p-0">
                  {review.tips.map((tip, index) => (
                    <li
                      key={tip}
                      className={cx(
                        "py-2.5 text-sm text-(--cq-text-primary)",
                        index > 0 && "border-t border-(--cq-border-subtle)",
                      )}
                    >
                      {tip}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(review?.presence ?? []).length === 0 ? null : (
              <section className={card} aria-labelledby="presence">
                <h3
                  id="presence"
                  className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
                >
                  {t("Presence")}
                </h3>
                <p className="m-0 text-xs text-(--cq-text-tertiary)">
                  {t(
                    "From what Q saw on your camera, with your permission. No images were kept.",
                  )}
                </p>
                {(review?.presence ?? []).map((item) => (
                  <div key={item.observation} className="flex flex-col gap-0.5">
                    <p className="m-0 text-sm text-(--cq-text-primary)">
                      {item.observation}
                    </p>
                    <p className="m-0 text-[13px] text-(--cq-text-secondary)">
                      {item.tip}
                    </p>
                  </div>
                ))}
              </section>
            )}

            {(review?.slides ?? []).length === 0 ? null : (
              <section className={card} aria-labelledby="screen">
                <h3
                  id="screen"
                  className="m-0 text-[13px] font-medium text-(--cq-text-secondary)"
                >
                  {t("Your screen")}
                </h3>
                <p className="m-0 text-xs text-(--cq-text-tertiary)">
                  {t(
                    "What Q saw on the screen you shared, and what to fix. No images were kept.",
                  )}
                </p>
                {(review?.slides ?? []).map((item) => (
                  <div key={item.shows} className="flex flex-col gap-0.5">
                    <p className="m-0 text-sm text-(--cq-text-primary)">
                      {item.shows}
                    </p>
                    {item.take.length === 0 ? null : (
                      <p className="m-0 text-[13px] text-(--cq-text-secondary)">
                        {item.take}
                      </p>
                    )}
                  </div>
                ))}
              </section>
            )}

            <Link
              href={lobbyHref(rehearsal)}
              className={workButton("primary", "w-full")}
              data-rehearse-again
            >
              {t("Rehearse again")}
            </Link>
          </aside>
        </div>
      )}
    </article>
  );
}
