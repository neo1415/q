"use client";

import { useCallback, useMemo, useState } from "react";

import {
  ArrivalBriefing,
  heardOnLine,
} from "@/features/briefing/arrival-briefing";
import type { ArrivalData } from "@/features/briefing/arrival";
import type {
  ArrivalDecision,
  ArrivalDecisionResult,
} from "@/features/briefing/arrival-actions";

/** Fictional people and companies only. */
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture(state: "quiet" | "cards", timeZone: string): ArrivalData {
  if (state === "quiet") {
    return {
      firstName: "Zino",
      timeZone,
      activity: {},
      hoursAway: 3,
      cards: [],
    };
  }
  return {
    firstName: "Zino",
    timeZone,
    activity: {
      sent: { n: 2, names: ["Nimbus Grid", "Portside"] },
      booked: { n: 1, names: ["Clearwater Assurance"] },
      replies: { n: 1, names: ["Halyard Security"] },
    },
    hoursAway: 5,
    cards: [
      {
        key: uuid(1),
        kind: "APPROVAL",
        approvalId: uuid(1),
        draftId: null,
        relationshipId: uuid(101),
        counterpart: "Halyard Security",
        named: null,
        title: "Reply ready to send",
        summary: "Reply to Halyard Security",
        message:
          "Happy to. Tuesday 10:00 or Thursday 15:00 both work for me. I'll bring the pilot numbers.",
        theySaid:
          "Thanks, this is helpful. Could we find 30 minutes next week to walk through the pilot numbers?",
        reason: null,
        canDecide: true,
        at: "2026-10-08T11:00:00.000Z",
      },
      {
        key: uuid(2),
        kind: "HELD",
        approvalId: null,
        draftId: uuid(2),
        relationshipId: uuid(102),
        counterpart: "Arcwell Bio",
        named: null,
        title: "Q held a message",
        summary: "It repeats what you said last week.",
        message: "Hi Ama, following up on the deck I sent. Any thoughts?",
        theySaid: null,
        reason: "It repeats what you said last week.",
        canDecide: true,
        at: "2026-10-08T10:00:00.000Z",
      },
      {
        key: uuid(3),
        kind: "APPROVAL",
        approvalId: uuid(3),
        draftId: null,
        relationshipId: uuid(103),
        counterpart: "Tensorgate",
        named: null,
        title: "Reply ready to send",
        summary: "Reply to Tensorgate",
        message:
          "Thanks for the update. Send the data room link when it's ready.",
        theySaid: "We closed two new pilots this month.",
        reason: null,
        canDecide: true,
        at: "2026-10-08T09:00:00.000Z",
      },
    ],
  };
}

export function BriefingHarness({
  state,
  at,
  timeZone,
  fail,
}: {
  readonly state: "quiet" | "cards";
  readonly at: string;
  readonly timeZone: string;
  readonly fail: boolean;
}) {
  const [log, setLog] = useState<readonly ArrivalDecision[]>([]);
  const [voice, setVoice] = useState<string>("");
  const [said, setSaid] = useState("");
  const data = useMemo(() => fixture(state, timeZone), [state, timeZone]);
  const load = useCallback(() => Promise.resolve(data), [data]);
  const decide = useCallback(
    (decision: ArrivalDecision): Promise<ArrivalDecisionResult> => {
      setLog((was) => [...was, decision]);
      return Promise.resolve(
        fail && decision.kind === "APPROVE"
          ? {
              ok: false,
              message:
                "It changed since you saw it. Here's the current version.",
              changed: true,
            }
          : { ok: true },
      );
    },
    [fail],
  );
  const now = useCallback(() => new Date(at), [at]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-8 bg-(--cq-canvas) px-4 py-10">
      <ArrivalBriefing
        variant="page"
        load={load}
        decide={decide}
        now={now}
        fallback={
          <h1 className="cq-title-lg text-center" data-harness-fallback>
            Welcome back, Zino.
          </h1>
        }
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void heardOnLine(said).then((output) => setVoice(output ?? "null"));
          setSaid("");
        }}
      >
        <label className="sr-only" htmlFor="harness-say">
          Say
        </label>
        <input
          id="harness-say"
          value={said}
          onChange={(event) => setSaid(event.target.value)}
          className="flex-1 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3"
          data-harness-say
        />
        <button type="submit" className="min-h-11 px-3" data-harness-say-send>
          Say
        </button>
      </form>
      <pre className="cq-caption whitespace-pre-wrap" data-harness-voice>
        {voice}
      </pre>
      <pre className="cq-caption whitespace-pre-wrap" data-harness-log>
        {JSON.stringify(log)}
      </pre>
    </main>
  );
}
