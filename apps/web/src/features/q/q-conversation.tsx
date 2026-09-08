"use client";

import { useEffect, useRef } from "react";

import { describeQStreamTransport } from "@capital-q/api-client";
import { Button } from "@capital-q/ui/button";
import { QComposer } from "@capital-q/ui/q-composer";
import { QStateIndicator } from "@capital-q/ui/q-state";
import { InlineNotice } from "@capital-q/ui/states";

import { failureMessage, turnsFrom, workingLabel } from "./conversation";
import { useQConversation } from "./use-q-conversation";

/**
 * Q, in the browser (CQ-C5-R1 §13-§19).
 *
 * The composer that has been on Home since the design system landed, now
 * connected to the real thing: a real run, a real stream, a real answer,
 * and the same conversation for the next question.
 *
 * What is deliberately absent: a local reply of any kind. There is no
 * fixture, no canned response, no simulated typing and no fabricated
 * progress. When Q is not connected on this build the composer says exactly
 * that and sends nothing — which is what it did before, and is still better
 * than an answer nobody computed.
 *
 * This is not the dedicated Q workspace. No history sidebar, no saved
 * conversations, no evidence drill-down: those are their own work, and
 * shipping a shell of them here would make the product look further along
 * than it is.
 */

export type QConversationPanelProps = {
  /** False when this build has no Q API configured. */
  readonly connected: boolean;
  /**
   * The company these questions are about, when Capital Q knows of one.
   * Resolved on the server and passed down; the browser never chooses it,
   * and the Q API authorises it again regardless.
   */
  readonly companyId?: string | undefined;
};

export function QConversationPanel({
  connected,
  companyId,
}: QConversationPanelProps) {
  const q = useQConversation({ companyId });
  const turns = turnsFrom(q.state, q.pending);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Follow the answer as it arrives, and respect a reader who has asked
    // for less motion. `nearest` scrolls only when the end of the
    // conversation has actually gone out of view: `end` would pull the
    // composer off the screen after every turn.
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [turns.length, q.state.partial?.text]);

  const stage = workingLabel(q.state);

  return (
    <div className="flex flex-col gap-4">
      {turns.length > 0 ? (
        <ol className="flex flex-col gap-4" aria-live="polite">
          {turns.map((turn) => (
            <li
              key={turn.id}
              className={
                turn.kind === "PERSON"
                  ? "flex flex-col items-end gap-1"
                  : "flex flex-col gap-1"
              }
            >
              <span className="cq-label text-(--cq-text-tertiary)">
                {turn.kind === "PERSON" ? "You" : "Q"}
              </span>
              <p
                className={
                  turn.kind === "PERSON"
                    ? "cq-body max-w-(--cq-layout-narrow) rounded-lg bg-(--cq-surface-sunken) px-3 py-2 text-(--cq-text-primary)"
                    : "cq-body max-w-(--cq-layout-narrow) whitespace-pre-wrap text-(--cq-text-primary)"
                }
                data-unconfirmed={
                  turn.kind === "PERSON" && turn.unconfirmed
                    ? "true"
                    : undefined
                }
              >
                {turn.text}
              </p>
              {turn.kind === "Q" && turn.sourceCount > 0 ? (
                // A count, not a link. An evidence reference carries only
                // identifiers, and there is no seam yet that turns one into
                // something a person may safely see (§18).
                <span className="cq-caption text-(--cq-text-secondary)">
                  Based on {turn.sourceCount} recorded source
                  {turn.sourceCount === 1 ? "" : "s"}.
                </span>
              ) : null}
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      ) : null}

      {q.working ? (
        <div className="flex items-center justify-between gap-3">
          <QStateIndicator state="WORKING" detail={stage} />
          <Button
            variant="secondary"
            size="compact"
            onClick={() => void q.stop()}
          >
            Stop
          </Button>
        </div>
      ) : null}

      {q.transport === "RECONNECTING" ? (
        <InlineNotice tone="info" title={describeQStreamTransport(q.transport)}>
          Your conversation is saved. This is the connection, not the answer.
        </InlineNotice>
      ) : null}

      {q.state.failure !== null ? (
        <InlineNotice tone="warning" title="Q couldn't finish that">
          {failureMessage(q.state.failure)}
        </InlineNotice>
      ) : null}

      {q.notice !== null ? (
        <InlineNotice tone="warning" title="That didn't go through">
          {q.notice}
        </InlineNotice>
      ) : null}

      <QComposer
        id="home-q"
        contextScope="unset"
        disabled={q.working}
        {...(connected ? { onSubmit: q.ask } : {})}
      />
    </div>
  );
}
