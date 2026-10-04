"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";

import type { QMeetingAssistantDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { QSwarm } from "@/features/q-swarm/q-swarm";

import {
  bringMeetingQAction,
  dismissMeetingQAction,
  readMeetingQAction,
} from "./meeting-q-actions";

/**
 * Q in a meeting, on the meeting itself (ADR 0027; founder direction
 * 2026-09-30): Q joins every call booked here under its own name; a
 * participant may decline recording, and that decline is itself on record.
 * Afterwards both sides read the same record -- who was there, what was
 * agreed, money mentioned, what to know, what to do next, and the full
 * transcript. One state at a time, never a paragraph of help.
 */

const FLAG_WORDS: Readonly<Record<string, string>> = {
  COMMITMENT: "Commitment",
  NUMBER: "Number",
  RISK: "Risk",
  QUESTION: "Open question",
  SIGNAL: "Signal",
};

const FIRMNESS_WORDS: Readonly<Record<string, string>> = {
  EXPLORATORY: "Exploring",
  SOFT: "Soft",
  FIRM: "Firm",
};

const SIDE_WORDS: Readonly<Record<string, string>> = {
  FOUNDER: "Founder side",
  INVESTOR: "Investor side",
};

function newKey(): string {
  return `web-q-meet-${crypto.randomUUID()}`;
}

export function MeetingQ({
  meetingId,
  ended,
}: {
  readonly meetingId: string;
  /** The call is over: its record can only be read. */
  readonly ended: boolean;
}) {
  const [state, setState] = useState<QMeetingAssistantDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void readMeetingQAction(meetingId).then((result) => {
      if (!live) return;
      if (result.ok) setState(result.value);
    });
    return () => {
      live = false;
    };
  }, [meetingId]);

  const act = (work: () => ReturnType<typeof readMeetingQAction>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await work();
      if (result.ok) setState(result.value);
      else setMessage(result.message);
    });

  if (state === null) return null;
  const status = state.status;

  if (status === "DONE") {
    return <MeetingRecord record={state} />;
  }

  if (status === "IN_CALL" || status === "COMPOSING") {
    return (
      <div className="flex items-center gap-2" data-meeting-q={status}>
        <QSwarm state="WORKING" pixels={32} />
        <span className="cq-caption text-(--cq-text-secondary)">
          {status === "IN_CALL"
            ? "Q is in the call, taking notes."
            : "Q is writing its notes. One moment."}
        </span>
      </div>
    );
  }

  if (status === "DECLINED" && state.declined !== null) {
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        data-meeting-q="DECLINED"
      >
        <span className="cq-caption text-(--cq-text-secondary)">
          {state.declined.byYou
            ? "You declined recording. Both sides and Capital Q can see that."
            : `${state.declined.byName ?? "A participant"} declined recording.`}
        </span>
        {state.declined.byYou && !ended ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => act(() => bringMeetingQAction(meetingId, newKey()))}
          >
            Let Q record
          </Button>
        ) : null}
      </div>
    );
  }

  if (status === "FAILED" && state.failure !== null) {
    // meet-47: never silent -- why Q has no record, and, while the call
    // is still on, a way to send it in again.
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        data-meeting-q="FAILED"
      >
        <span className="cq-caption text-(--cq-text-secondary)">
          {state.failure}
        </span>
        {ended ? null : (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => act(() => bringMeetingQAction(meetingId, newKey()))}
          >
            Send Q in again
          </Button>
        )}
      </div>
    );
  }

  if (ended) return null;

  // Q joins every call booked here (founder direction 2026-09-30).
  // Declining is each person's right, and it is recorded, never silent.
  return (
    <div className="flex flex-col items-start gap-1" data-meeting-q={status}>
      {state.failure === null ? null : (
        // A retry in progress (meet-47): said, not hidden.
        <span className="cq-caption text-(--cq-text-secondary)">
          {state.failure}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="cq-caption text-(--cq-text-secondary)">
          Q joins and keeps the record for both sides.
        </span>
        {confirming ? (
          <>
            <Button
              variant="quiet"
              size="compact"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                act(() => dismissMeetingQAction(meetingId));
              }}
            >
              Yes, decline
            </Button>
            <Button
              variant="quiet"
              size="compact"
              onClick={() => setConfirming(false)}
            >
              Keep Q
            </Button>
          </>
        ) : (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => setConfirming(true)}
          >
            Decline recording
          </Button>
        )}
      </div>
      {confirming ? (
        <span className="cq-caption text-(--cq-text-tertiary)">
          Q won&apos;t record this call. Everyone on it, and Capital Q, will see
          that you declined.
        </span>
      ) : null}
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}

function RecordSection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={label}>
      <h4 className="cq-label text-(--cq-text-primary)">{label}</h4>
      {children}
    </section>
  );
}

/**
 * The record both sides read. Money is shown as said, with its firmness
 * and the words behind it: a figure in a call is a signal, never committed
 * capital until someone confirms it (spec 6.6.14).
 */
function MeetingRecord({ record }: { readonly record: QMeetingAssistantDto }) {
  return (
    <details className="flex flex-col gap-2" data-meeting-q="DONE">
      <summary className="cq-label flex min-h-11 cursor-pointer items-center text-(--cq-text-primary)">
        Meeting record
      </summary>
      <div className="flex flex-col gap-4 pt-2">
        {record.summary === null ? null : (
          <p className="cq-body-sm line-clamp-4 whitespace-pre-line text-(--cq-text-secondary)">
            {record.summary}
          </p>
        )}
        {record.followUps.length === 0 ? null : (
          <RecordSection label="Next">
            <ul className="flex flex-col gap-1">
              {record.followUps.map((item) => (
                <li
                  key={item.text}
                  className="cq-body-sm text-(--cq-text-primary)"
                >
                  {item.text}
                  {item.owner === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {" "}
                      · {item.owner}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </RecordSection>
        )}
        {record.agreements.length === 0 ? null : (
          <RecordSection label="Agreed">
            <ul className="flex flex-col gap-1">
              {record.agreements.map((item) => (
                <li key={item} className="cq-body-sm text-(--cq-text-primary)">
                  {item}
                </li>
              ))}
            </ul>
          </RecordSection>
        )}
        {record.commitments.length === 0 ? null : (
          <RecordSection label="Money mentioned">
            <ul className="flex flex-col gap-2">
              {record.commitments.map((item) => (
                <li
                  key={`${item.party}:${item.amount}:${item.quote}`}
                  className="flex flex-col"
                >
                  <span className="cq-body-sm text-(--cq-text-primary)">
                    {item.party} · {item.amount} ·{" "}
                    {FIRMNESS_WORDS[item.firmness] ?? item.firmness}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    &ldquo;{item.quote}&rdquo;
                  </span>
                </li>
              ))}
            </ul>
            <p className="cq-caption text-(--cq-text-tertiary)">
              As said in the call; not a commitment until confirmed.
            </p>
          </RecordSection>
        )}
        {record.flags.length === 0 ? null : (
          <RecordSection label="Worth knowing">
            <ul className="flex flex-col gap-1.5">
              {record.flags.map((flag) => (
                <li
                  key={`${flag.kind}:${flag.text}`}
                  className="cq-body-sm text-(--cq-text-primary)"
                >
                  <span className="font-medium">
                    {FLAG_WORDS[flag.kind] ?? flag.kind}:
                  </span>{" "}
                  {flag.text}
                  {flag.speaker === null ? null : (
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {" "}
                      · {flag.speaker}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </RecordSection>
        )}
        {record.attendees.length === 0 ? null : (
          <RecordSection label="Who was there">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {record.attendees.map((person, index) => (
                <li
                  // Names can repeat across sides; the call's order is stable.
                  key={`${person.name}-${String(index)}`}
                  className="cq-body-sm flex items-center gap-1.5 text-(--cq-text-primary)"
                >
                  {/* A person's photo is theirs alone today: initials. */}
                  <EntityAvatar
                    kind="person"
                    name={person.name}
                    size="xs"
                    decorative
                  />
                  {person.side === null
                    ? person.name
                    : `${person.name} (${SIDE_WORDS[person.side] ?? person.side})`}
                </li>
              ))}
            </ul>
          </RecordSection>
        )}
        {record.transcript.length === 0 ? null : (
          <details>
            <summary className="cq-body-sm flex min-h-11 cursor-pointer items-center text-(--cq-text-secondary)">
              Full transcript · {record.transcript.length}{" "}
              {record.transcript.length === 1 ? "line" : "lines"}
            </summary>
            <ol className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pt-2">
              {record.transcript.map((line, index) => (
                <li
                  // Lines have no id; the call's own order is stable.
                  key={index}
                  className="cq-body-sm text-(--cq-text-primary)"
                >
                  {line.speaker === null ? null : (
                    <span className="cq-caption text-(--cq-text-tertiary)">
                      {line.speaker}:{" "}
                    </span>
                  )}
                  {line.text}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </details>
  );
}
