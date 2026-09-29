"use client";

import { useRef, useState, useTransition } from "react";

import type {
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { QSwarm } from "@/features/q-swarm/q-swarm";

import {
  applicationTurnAction,
  startApplicationAction,
  submitApplicationAction,
} from "./apply-actions";

/**
 * Applying through a gateway (CQ-GATE-002): Q interviews the founder in a
 * chat, then they submit. One thing to do at a time: start, answer, send.
 * The application's session token lives only in this page's memory.
 */

type Line = { readonly from: "Q" | "YOU"; readonly text: string };

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function ApplyExperience({
  gateway,
  compact = false,
}: {
  readonly gateway: PublicGatewayDto;
  /** Inside someone else's page: no heading chrome. */
  readonly compact?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [application, setApplication] = useState<ApplicationSummaryDto | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  const scroll = () =>
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end" }));

  const start = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await startApplicationAction(gateway.publicId);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setToken(result.sessionToken);
      setApplication(result.application);
      setLines(
        result.reply === null ? [] : [{ from: "Q", text: result.reply }],
      );
      scroll();
    });

  const send = () => {
    const text = draft.trim();
    if (token === null || text === "") return;
    setDraft("");
    setLines((current) => [...current, { from: "YOU", text }]);
    scroll();
    startTransition(async () => {
      setMessage(null);
      const result = await applicationTurnAction(token, text, key("turn"));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setApplication(result.application);
      if (result.reply !== null) {
        const reply = result.reply;
        setLines((current) => [...current, { from: "Q", text: reply }]);
      }
      scroll();
    });
  };

  const submit = () =>
    startTransition(async () => {
      if (token === null) return;
      setMessage(null);
      const result = await submitApplicationAction(token, key("submit"));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setApplication(result.application);
    });

  const submitted = application?.status === "SUBMITTED";

  return (
    <section
      className="flex min-h-[32rem] flex-col gap-4"
      aria-label={gateway.title}
    >
      {compact ? null : (
        <header className="flex flex-col gap-1">
          <p className="cq-caption text-(--cq-text-secondary)">
            {gateway.organisationDisplayName}
          </p>
          <h1 className="cq-title-lg text-(--cq-text-primary)">
            {gateway.title}
          </h1>
          {gateway.description === null ? null : (
            <p className="cq-body text-(--cq-text-secondary)">
              {gateway.description}
            </p>
          )}
        </header>
      )}

      {!gateway.acceptingApplications ? (
        <p className="cq-body text-(--cq-text-secondary)">
          This gateway isn&apos;t taking applications right now.
        </p>
      ) : token === null ? (
        <div className="flex flex-col items-start gap-3">
          <Button onClick={start} disabled={pending}>
            {pending ? "Starting…" : "Start with Q"}
          </Button>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Q asks a few questions about your company. Takes about five minutes.
          </p>
        </div>
      ) : submitted ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="cq-title-sm text-(--cq-text-primary)">Sent.</p>
          <p className="cq-body text-(--cq-text-secondary)">
            {gateway.organisationDisplayName} has your application
            {application.reference === "" ? "" : ` (${application.reference})`}.
          </p>
        </div>
      ) : (
        <>
          <ol
            className="flex flex-1 flex-col gap-3 overflow-y-auto"
            aria-live="polite"
          >
            {lines.map((line, index) => (
              <li
                // The conversation only grows; its order is its identity.
                key={index}
                className={
                  line.from === "YOU"
                    ? "cq-body max-w-[85%] self-end rounded-2xl bg-(--cq-surface-raised) px-4 py-2 text-(--cq-text-primary)"
                    : "cq-body max-w-[85%] self-start whitespace-pre-line text-(--cq-text-primary)"
                }
              >
                {line.text}
              </li>
            ))}
            {pending ? (
              <li className="self-start">
                <QSwarm state="WORKING" pixels={28} />
              </li>
            ) : null}
            <div ref={end} />
          </ol>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={1}
              maxLength={2000}
              aria-label="Your answer"
              placeholder="Type your answer"
              className="cq-body min-h-11 flex-1 resize-none rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2.5 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            />
            <Button type="submit" disabled={pending || draft.trim() === ""}>
              Send
            </Button>
          </form>
          {application?.status === "READY_TO_SUBMIT" ? (
            <Button onClick={submit} disabled={pending}>
              Submit application
            </Button>
          ) : null}
        </>
      )}
      {message === null ? null : (
        <p className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
