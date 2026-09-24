"use client";

import { useEffect, useRef } from "react";

import { QMark } from "@capital-q/ui/q-mark";
import { InlineNotice } from "@capital-q/ui/states";

import {
  failureMessage,
  turnsFrom,
  workingLabel,
} from "@/features/q/conversation";
import { useQConversation } from "@/features/q/use-q-conversation";

/**
 * F8's first Company Intelligence, through the ordinary Q boundary
 * (CQ-C5-R2B §18).
 *
 * There is no onboarding analyst. This asks the same Q API the Home composer
 * asks, about the same company, and what answers is the same Company
 * Intelligence specialist behind the same Context Firewall, the same
 * reviewed provider ceiling and the same recommendation guard. Wiring a
 * second intelligence here would have produced a second set of answers
 * nobody could reconcile with the first.
 *
 * It asks once. A founder arriving at this screen has earned one reading;
 * re-asking on every render would spend a model call on a scroll.
 */

export function CompanyIntelligencePanel({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}) {
  const q = useQConversation({ companyId });
  const asked = useRef(false);
  const { ask } = q;

  useEffect(() => {
    if (asked.current) {
      return;
    }
    asked.current = true;
    void ask(
      `Give me a first reading of ${companyName}: what you understand about the business, what stands out, what needs attention, and what you still don't know.`,
    );
  }, [ask, companyName]);

  const turns = turnsFrom(q.state, q.pending);
  const answer = turns.filter((turn) => turn.kind === "Q").at(-1);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="q-first-reading">
      <h2 id="q-first-reading" className="cq-title-md text-(--cq-text-primary)">
        What Q makes of it so far
      </h2>

      {/*
        While Q reads, one status line says so; the reading itself arrives
        as open prose at reading measure, not in a box (doc 18 §§19, 102).
      */}
      {q.working ? (
        <p
          role="status"
          className="cq-status-line"
          data-q-first-reading-working
        >
          <QMark size="sm" state="WORKING" />
          {workingLabel(q.state)}
          <span aria-hidden="true" className="inline-flex gap-0.5">
            <span className="cq-working-dot">·</span>
            <span className="cq-working-dot">·</span>
            <span className="cq-working-dot">·</span>
          </span>
        </p>
      ) : null}

      {answer !== undefined ? (
        <div
          className="cq-prose cq-body cq-arrive whitespace-pre-wrap text-(--cq-text-primary)"
          data-q-first-reading-answer
        >
          {answer.text}
        </div>
      ) : null}

      {q.state.failure !== null ? (
        <InlineNotice tone="info" title="Q couldn't finish that reading">
          {failureMessage(q.state.failure)}
        </InlineNotice>
      ) : null}

      {q.notice !== null ? (
        <InlineNotice tone="info" title="Q couldn't finish that reading">
          {q.notice}
        </InlineNotice>
      ) : null}

      {/*
        Said once, plainly, beside the reading itself: everything above rests
        on what the founder supplied, and none of it has been checked against
        anything (§20).
      */}
      <p className="cq-status-line">
        Based on what you&apos;ve told Capital Q and the material you shared.
        Nothing here has been independently verified.
      </p>
      {/* The company this reading is about; never rendered, never guessed. */}
      <span hidden data-company-id={companyId} />
    </section>
  );
}
