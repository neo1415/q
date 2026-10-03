import Link from "next/link";

import {
  rehearsalSimulationLabel,
  type QRehearsalDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import {
  DIMENSION_WORDS,
  MOOD_WORDS,
  OUTCOME_WORDS,
  RATING_WORDS,
  elapsedLabel,
  lengthWords,
} from "./meet";
import { ReviewRefresh } from "./review-refresh";

/**
 * The review after a rehearsal (REHEARSE): how it ended, a score computed
 * from the ratings (never a model's number), what went right, what went
 * wrong with a better answer, tips for this person, and the transcript.
 */

const DIFFICULTY_WORDS = {
  GENTLE: "Gentle",
  REALISTIC: "Realistic",
  TOUGH: "Tough",
} as const;

/** "Up 8 since last time": both scores are code-computed. */
export function progressWords(score: number, previous: number): string {
  const change = score - previous;
  if (change === 0) return `Same as last time (${String(previous)})`;
  return change > 0
    ? `Up ${String(change)} since last time (${String(previous)})`
    : `Down ${String(-change)} since last time (${String(previous)})`;
}

export function lobbyHref(rehearsal: Pick<QRehearsalDto, "counterpart">) {
  const id = encodeURIComponent(rehearsal.counterpart.id);
  return rehearsal.counterpart.kind === "COMPANY"
    ? `/rehearsals/company/${id}`
    : `/rehearsals/investor/${id}`;
}

export function RehearsalReview({
  rehearsal,
}: {
  readonly rehearsal: QRehearsalDto;
}) {
  const name = rehearsal.counterpart.name;
  const review = rehearsal.review;
  const length =
    rehearsal.endedAt === null
      ? null
      : elapsedLabel(
          Date.parse(rehearsal.createdAt),
          Date.parse(rehearsal.endedAt),
        );
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="cq-caption text-(--cq-text-tertiary)">
          {rehearsalSimulationLabel(name)}
        </p>
        <h1 className="cq-title-lg text-(--cq-text-primary)">
          Your rehearsal with {name}
        </h1>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {rehearsal.outcome === null
            ? "Still open"
            : OUTCOME_WORDS[rehearsal.outcome]}
          {length === null ? "" : ` · ${length}`}
          {` · ${DIFFICULTY_WORDS[rehearsal.difficulty]}`}
        </p>
      </header>

      {review === null ? (
        <p className="cq-body text-(--cq-text-secondary)">
          {rehearsal.outcome === "LEFT_EARLY" ||
          rehearsal.outcome === "FOUNDER_ENDED"
            ? "You left before answering anything, so there's nothing to review yet."
            : "Q couldn't write the review just now. Open this page again in a moment."}
        </p>
      ) : (
        <>
          {review.provisional === true ? (
            <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
              Q is still writing the full review; this page updates when
              it&rsquo;s ready.
              <ReviewRefresh />
            </p>
          ) : null}
          <section className="flex flex-col gap-3 md:flex-row md:items-start md:gap-8">
            {review.score === null ? null : (
              <div className="flex shrink-0 flex-col">
                <span className="cq-display text-(--cq-text-primary)">
                  {review.score}
                  <span className="cq-body text-(--cq-text-tertiary)">
                    {" "}
                    / 100
                  </span>
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  From the ratings below
                </span>
                {rehearsal.previousScore === null ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {progressWords(review.score, rehearsal.previousScore)}
                  </span>
                )}
              </div>
            )}
            <p className="cq-body-lg text-(--cq-text-primary)">
              {review.overall}
            </p>
          </section>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [
                "Your share of the talking",
                `${String(rehearsal.metrics.yourShareOfWords)}%`,
              ],
              [
                "Longest answer",
                `${String(rehearsal.metrics.longestAnswerWords)} words`,
              ],
              ["Your answers", String(rehearsal.metrics.exchanges)],
              [
                "Length",
                lengthWords(
                  rehearsal.createdAt,
                  rehearsal.endedAt,
                  rehearsal.metrics.minutes,
                ),
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="cq-caption text-(--cq-text-tertiary)">
                  {label}
                </dt>
                <dd className="cq-title-sm text-(--cq-text-primary)">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="flex flex-col gap-3">
            <h2 className="cq-title-sm text-(--cq-text-primary)">Breakdown</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              {review.dimensions.map((dimension) => (
                <div
                  key={dimension.name}
                  className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-3"
                >
                  <dt className="cq-label text-(--cq-text-primary)">
                    {DIMENSION_WORDS[dimension.name]}:{" "}
                    <span
                      className={
                        dimension.rating === "NEEDS_WORK"
                          ? "text-(--cq-warning)"
                          : "text-(--cq-text-secondary)"
                      }
                    >
                      {RATING_WORDS[dimension.rating]}
                    </span>
                  </dt>
                  <dd className="cq-body-sm text-(--cq-text-secondary)">
                    {dimension.note}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {review.wentRight.length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h2 className="cq-title-sm text-(--cq-text-primary)">
                What went right
              </h2>
              <ul className="flex flex-col gap-3">
                {review.wentRight.map((item) => (
                  <li key={item.moment} className="flex flex-col gap-0.5">
                    <q className="cq-body-sm text-(--cq-text-primary)">
                      {item.moment}
                    </q>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {item.why}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.wentWrong.length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h2 className="cq-title-sm text-(--cq-text-primary)">
                What to improve
              </h2>
              <ul className="flex flex-col gap-4">
                {review.wentWrong.map((item) => (
                  <li key={item.moment} className="flex flex-col gap-1">
                    <q className="cq-body-sm text-(--cq-text-primary)">
                      {item.moment}
                    </q>
                    <span className="cq-body-sm text-(--cq-text-secondary)">
                      {item.why}
                    </span>
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      <span className="cq-label">Try: </span>
                      {item.better}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.tips.length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h2 className="cq-title-sm text-(--cq-text-primary)">
                Tips for meeting {name}
              </h2>
              <ul className="cq-body-sm flex list-disc flex-col gap-1 pl-5 text-(--cq-text-secondary)">
                {review.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </section>
          )}

          {(review.presence ?? []).length === 0 ? null : (
            <section className="flex flex-col gap-3">
              <h2 className="cq-title-sm text-(--cq-text-primary)">Presence</h2>
              <p className="cq-caption text-(--cq-text-tertiary)">
                From what Q saw on your camera, with your permission. No images
                were kept.
              </p>
              <ul className="flex flex-col gap-3">
                {(review.presence ?? []).map((item) => (
                  <li key={item.observation} className="flex flex-col gap-1">
                    <p className="cq-body-sm text-(--cq-text-primary)">
                      {item.observation}
                    </p>
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      {item.tip}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={lobbyHref(rehearsal)}
          className={buttonClassName("primary")}
        >
          Rehearse again
        </Link>
        <Link href="/rehearsals" className={buttonClassName("secondary")}>
          All rehearsals
        </Link>
      </div>

      {/*
        A plain section, not <details>: a flex <details> rendered its items
        empty for the founder (live 2026-10-01, 21 blank lines).
      */}
      <section className="flex flex-col gap-2">
        <h2 className="cq-title-sm text-(--cq-text-primary)">
          Transcript ({rehearsal.turns.length} lines)
        </h2>
        <ol aria-label="Transcript" className="flex flex-col gap-3">
          {rehearsal.turns.map((turn, index) => (
            <li
              key={`${turn.at}-${String(index)}`}
              className="cq-body-sm text-(--cq-text-primary)"
            >
              <p className="cq-caption text-(--cq-text-tertiary)">
                {turn.from === "THEM" ? name : "You"}
                {turn.mood === null || turn.from !== "THEM"
                  ? ""
                  : ` · ${MOOD_WORDS[turn.mood] ?? turn.mood.toLowerCase()}`}
                {turn.sawScreen ? " · looking at your screen" : ""}
              </p>
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
