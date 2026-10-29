"use client";

import { useEffect, useId, useState, useTransition } from "react";

import type { QPlanBlock, QPlanStep, QPlanView } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, ICON_STROKE, ListChecks } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { decidePlanAction, readPlanAction } from "./plan-actions";
import { WorkInProgressCard } from "./work-canvas";
import { useWorkLive } from "./work-live";

/**
 * Situation-first planning (S5): the plan Q wrote for the person, as a
 * card on the Q page (the thread, the stage, the Board). Each step with
 * who does it, why (in the plan's own words, citing their situation by
 * code), when, and whether it will ask them before anything goes out.
 * Three affordances, nothing else:
 *
 *   Execute          prepares ONE approval card bound to this exact version
 *                    (its body hash); nothing runs until they approve it.
 *   Put on my board  their steps become board tasks (dated ones reminded);
 *                    Q's steps wait.
 *   Change it        their words, typed, become the next version, which
 *                    needs their OK again.
 *
 * Everything shown is read as the person from the Q API; the card keeps
 * nothing in the browser. Role names and reasoning are never shown.
 */

export type PlanCardBlock = QPlanBlock;

type Decision = Awaited<ReturnType<typeof decidePlanAction>>;

/** Who does a step, in plain words for the person. */
export function ownerWords(step: Pick<QPlanStep, "owner">): string {
  switch (step.owner) {
    case "Q":
      return "Q";
    case "YOU":
      return "You";
    case "TOGETHER":
      return "Q prepares, you finish";
  }
}

/** What a step will do before anything goes out, plainly. */
export function stepNote(
  step: Pick<QPlanStep, "needsApproval" | "owner">,
): string | null {
  if (step.needsApproval) return "Comes to you for approval first";
  if (step.owner === "YOU") return "On your board when you put it there";
  return null;
}

/**
 * Words written before plans kept their fact refs out of the text: a ref
 * such as "(F23)" is data, never something the person reads (live
 * 2026-10-29). The card shows the cited facts behind a "Why" instead.
 */
export function withoutFactRefs(text: string): string {
  return text
    .replace(
      /\s*[([]\s*(?:[FP][1-9]\d{0,3}\s*(?:[,;/]|and)?\s*)+[)\]]|\b[FP][1-9]\d{0,3}\b/gu,
      "",
    )
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

type CitedFact = NonNullable<QPlanView["facts"]>[number];

/** A cited fact as the person reads it: theirs, a reading, or on record. */
export function factNote(fact: Pick<CitedFact, "truthClass">): string | null {
  switch (fact.truthClass) {
    case "USER_CLAIM":
      return "Your own figure or words";
    case "Q_INFERENCE":
      return "Q's reading";
    case "ESTIMATE":
      return "An estimate";
    case "UNKNOWN":
      return "Not known";
    default:
      return null;
  }
}

/**
 * The work making the next version, followed in place (live 2026-10-29:
 * "Change it" showed v2 only after a reload). When it ends, the card reads
 * its own version again, so it says a newer one exists; the new version
 * arrives in the conversation as its own card.
 */
function ChangeFollow({
  jobId,
  onSettled,
}: {
  readonly jobId: string;
  readonly onSettled: () => void;
}) {
  const { live } = useWorkLive(jobId);
  const state = live?.state ?? null;
  useEffect(() => {
    if (state === "DONE" || state === "FAILED" || state === "STOPPED") {
      onSettled();
    }
    // onSettled reads the card's own state; only the job's end matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <WorkInProgressCard
      block={{ kind: "WORK_IN_PROGRESS", jobId, title: "Changing your plan" }}
    />
  );
}

export function PlanCard({ block }: { readonly block: PlanCardBlock }) {
  const t = useT();
  const noteId = useId();
  const [view, setView] = useState<QPlanView | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [version, setVersion] = useState(block.version);
  const [changeJob, setChangeJob] = useState<string | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    let live = true;
    void readPlanAction(block.planId, version).then((read) => {
      if (!live) return;
      if (read.ok) setView(read.view);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [block.planId, version, reads]);

  if (missing) return null;

  const decide = (request: Parameters<typeof decidePlanAction>[1]) => {
    startTransition(async () => {
      const decided: Decision = await decidePlanAction(block.planId, request);
      setMessage(decided.message);
      if (
        decided.outcome === "STALE" &&
        "version" in decided &&
        decided.version !== null
      ) {
        setVersion(decided.version);
      }
      if (decided.outcome === "CHANGING") {
        setChanging(false);
        setNote("");
        if ("jobId" in decided && decided.jobId !== null) {
          setChangeJob(decided.jobId);
        }
      }
      // Board and approval change what the card's lines say: read again.
      if (decided.outcome === "ON_BOARD" || decided.outcome === "FAILED") {
        setReads((count) => count + 1);
      }
    });
  };

  const plan = view?.plan ?? null;
  const reviewed = plan?.review?.fullyReviewed ?? block.reviewed;
  const current = view?.current ?? true;
  const facts = new Map((view?.facts ?? []).map((fact) => [fact.ref, fact]));
  const stillWanted = reviewed ? [] : (plan?.review?.openPoints ?? []);

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      aria-label={`${t("Plan")}: ${plan?.goal ?? block.title}`}
      data-q-result-card
      data-q-plan-card={block.planId}
      data-q-plan-version={plan?.version ?? block.version}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <ListChecks size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="cq-body m-0 font-medium text-(--cq-text-primary)">
            {plan?.goal ?? block.title}
          </p>
          <p
            className="cq-caption m-0 text-(--cq-text-secondary)"
            data-q-plan-reviewed={reviewed}
          >
            {reviewed
              ? t("Reviewed twice before you saw it")
              : t("A draft: not fully reviewed yet")}
            {plan === null
              ? null
              : ` · ${t(`Version ${String(plan.version)}`)}`}
          </p>
        </div>
      </header>

      {plan === null ? (
        <div
          className="flex flex-col gap-2"
          aria-hidden="true"
          data-q-plan-skeleton
        >
          <span className="cq-skeleton h-3 w-4/5 rounded-sm" />
          <span className="cq-skeleton h-3 w-3/5 rounded-sm" />
          <span className="cq-skeleton h-3 w-2/3 rounded-sm" />
        </div>
      ) : (
        <>
          <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
            {withoutFactRefs(plan.situationSummary)}
          </p>
          {stillWanted.length === 0 ? null : (
            <section className="flex flex-col gap-1" data-q-plan-wanted>
              <h4 className="cq-caption m-0 text-(--cq-text-tertiary)">
                {t("What the reviews still want")}
              </h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {stillWanted.slice(0, 5).map((point) => (
                  <li
                    key={point}
                    className="cq-body-sm text-(--cq-text-secondary)"
                  >
                    {withoutFactRefs(point)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ol
            className="m-0 flex list-none flex-col gap-2 p-0"
            aria-label={t("Steps")}
            data-q-plan-steps
          >
            {plan.steps.map((step, index) => {
              const noteText = stepNote(step);
              const cited = step.cites.flatMap((ref) => {
                const fact = facts.get(ref);
                return fact === undefined ? [] : [fact];
              });
              return (
                <li
                  key={step.key}
                  className="flex gap-3 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2"
                  data-q-plan-step={step.key}
                  data-q-plan-owner={step.owner}
                >
                  <span className="cq-caption cq-numeric w-5 shrink-0 pt-0.5 text-(--cq-text-tertiary)">
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      {withoutFactRefs(step.title)}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {withoutFactRefs(step.why)}
                    </span>
                    {cited.length === 0 ? null : (
                      <details className="cq-caption" data-q-plan-why>
                        <summary className="cursor-pointer text-(--cq-text-tertiary) underline-offset-2 hover:underline">
                          {t("Why")}
                        </summary>
                        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-(--cq-text-secondary)">
                          {cited.map((fact) => {
                            const kind = factNote(fact);
                            return (
                              <li key={fact.ref}>
                                {fact.statement}
                                {kind === null ? null : ` · ${t(kind)}`}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      {t(ownerWords(step))}
                      {step.due === null ? null : ` · ${t("By")} ${step.due}`}
                      {noteText === null ? null : ` · ${t(noteText)}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          {plan.openQuestions.length === 0 ? null : (
            <section className="flex flex-col gap-1" data-q-plan-open>
              <h4 className="cq-caption m-0 text-(--cq-text-tertiary)">
                {t("Not known yet")}
              </h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {plan.openQuestions.map((question) => (
                  <li
                    key={question}
                    className="cq-body-sm text-(--cq-text-secondary)"
                  >
                    {withoutFactRefs(question)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === null || view.lines.length === 0 ? null : (
            <ul
              className="m-0 flex list-none flex-col gap-1 border-t border-(--cq-border-subtle) p-0 pt-3"
              aria-label={t("Where it stands")}
              data-q-plan-lines
            >
              {view.lines.slice(-4).map((line) => (
                <li
                  key={`${line.at}:${line.text}`}
                  className="cq-caption text-(--cq-text-secondary)"
                >
                  {line.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!current ? (
        <p
          className="cq-body-sm m-0 text-(--cq-text-secondary)"
          data-q-plan-stale
        >
          {t("There is a newer version of this plan.")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2" data-q-plan-actions>
          <button
            type="button"
            className={buttonClassName("primary", "regular")}
            disabled={pending || view === null}
            onClick={() => {
              if (view === null) return;
              decide({
                affordance: "EXECUTE",
                version: view.plan.version,
                bodySha256: view.bodySha256,
              });
            }}
            data-q-plan-execute
          >
            {t("Execute")}
          </button>
          <button
            type="button"
            className={buttonClassName("secondary", "regular")}
            disabled={pending || view === null}
            onClick={() => {
              if (view === null) return;
              decide({
                affordance: "PUT_ON_BOARD",
                version: view.plan.version,
              });
            }}
            data-q-plan-board
          >
            {t("Put on my board")}
          </button>
          <button
            type="button"
            className={buttonClassName("secondary", "regular")}
            disabled={pending || view === null}
            aria-expanded={changing}
            aria-controls={noteId}
            onClick={() => setChanging((open) => !open)}
            data-q-plan-change
          >
            {t("Change it")}
          </button>
        </div>
      )}

      {changing && view !== null ? (
        <form
          id={noteId}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const words = note.trim();
            if (words.length === 0) return;
            decide({
              affordance: "CHANGE",
              version: view.plan.version,
              note: words.slice(0, 1_000),
            });
          }}
          data-q-plan-change-form
        >
          <label
            className="cq-caption text-(--cq-text-secondary)"
            htmlFor={`${noteId}-note`}
          >
            {t("What should change?")}
          </label>
          <textarea
            id={`${noteId}-note`}
            className="cq-body-sm min-h-20 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) p-2 text-(--cq-text-primary)"
            maxLength={1_000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div>
            <button
              type="submit"
              className={buttonClassName("primary", "regular")}
              disabled={pending || note.trim().length === 0}
            >
              {t("Send the change")}
            </button>
          </div>
        </form>
      ) : null}

      {changeJob === null ? null : (
        <ChangeFollow
          jobId={changeJob}
          onSettled={() => setReads((count) => count + 1)}
        />
      )}

      {message === null ? null : (
        <p
          className="cq-body-sm m-0 text-(--cq-text-primary)"
          role="status"
          aria-live="polite"
          data-q-plan-message
        >
          {message}
        </p>
      )}
    </section>
  );
}
