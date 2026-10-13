"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import type { ApplicationSummaryDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
} from "@capital-q/ui/icons";

import { ChatComposer, ChatTranscript } from "../apply-experience";
import { applicationTurnAction, openInterviewAction } from "../apply-actions";
import {
  latestQuestion,
  linesFromTranscript,
  QUICK_REPLIES,
  type InterviewLine,
} from "./form-model";

/**
 * GateQ slice 1: the interview with Q, after the form and before the review.
 *
 * The server keeps every turn. On mount the transcript is read back, so
 * returning to this step (or resuming after a pause) shows exactly what was
 * said, never a copy this browser happened to remember. Each message gets
 * one client turn id, kept for its retry: the API answers a repeated id
 * with the first answer instead of running (and charging) a second turn.
 *
 * Nothing here submits. Finishing goes to the review, where Submit is.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

type Turn = { readonly id: string; readonly text: string };

function turnId(): string {
  return `turn-${crypto.randomUUID()}`;
}

/** For the development gallery and screenshot checks only. */
export type InterviewPreview = {
  readonly lines: readonly InterviewLine[];
  readonly paused?: boolean;
};

export function InterviewStep({
  headingRef,
  fund,
  companyName,
  sessionToken,
  onFinish,
  onApplication,
  preview,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fund: string;
  readonly companyName: string;
  readonly sessionToken: string | null;
  readonly onFinish: () => void;
  /** GATE-001's answer after each turn, for the rules card. */
  readonly onApplication?: (application: ApplicationSummaryDto) => void;
  readonly preview?: InterviewPreview | undefined;
}) {
  const [lines, setLines] = useState<readonly InterviewLine[]>(
    preview?.lines ?? [],
  );
  const [loaded, setLoaded] = useState(preview !== undefined);
  const [paused, setPaused] = useState(preview?.paused ?? false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The message on its way, or stuck waiting for its retry, with its id.
  const [unsent, setUnsent] = useState<Turn | null>(null);
  // Bumped to read the transcript again (a retry, a resume).
  const [reads, setReads] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Resume what the server recorded, every time this step mounts; on a
  // fresh interview the server asks Q's opening question first.
  useEffect(() => {
    if (preview !== undefined || sessionToken === null) return;
    let current = true;
    void openInterviewAction(sessionToken).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setLines(linesFromTranscript(result.turns));
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [sessionToken, preview, reads]);

  const sendTurn = (turn: Turn) => {
    if (sessionToken === null) return;
    startTransition(async () => {
      setProblem(null);
      const result = await applicationTurnAction(
        sessionToken,
        turn.text,
        turn.id,
      );
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setUnsent(null);
      onApplication?.(result.application);
      const reply = result.reply;
      if (reply !== null && reply !== "") {
        setLines((current) => [...current, { from: "Q", text: reply }]);
      }
      requestAnimationFrame(() =>
        end.current?.scrollIntoView({ block: "end" }),
      );
    });
  };

  const say = (raw: string) => {
    const text = raw.trim();
    if (text === "" || pending || sessionToken === null) return;
    // A message still waiting on its retry keeps its id; a new one gets one.
    if (unsent !== null) return;
    const turn = { id: turnId(), text };
    setUnsent(turn);
    setDraft("");
    setLines((current) => [...current, { from: "YOU", text }]);
    sendTurn(turn);
  };

  const retry = () => {
    setProblem(null);
    if (unsent !== null) sendTurn(unsent);
    else setReads((n) => n + 1);
  };

  const resume = () => {
    setPaused(false);
    setReads((n) => n + 1);
  };

  const question = latestQuestion(lines);
  const answered = lines.some((line) => line.from === "YOU");
  const waiting = unsent !== null && problem !== null;

  if (paused) {
    return (
      <div className="gq-card gq-result">
        <h1 ref={headingRef} tabIndex={-1} className="cq-title-md">
          Interview paused
        </h1>
        <p className="cq-body gq-t2">
          Everything you&apos;ve said is saved with your application. Pick up
          where you left off whenever you&apos;re ready; keep this page open, it
          holds your place. Nothing goes to {fund} until you submit.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={resume}>
            Resume the interview
          </Button>
          <Button variant="quiet" onClick={onFinish}>
            Review instead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        A few questions from Q
      </h1>
      <p className="cq-body gq-t2">
        Q is {fund}&apos;s analyst. It has your answers and asks what an
        investor would want to know about {companyName || "your company"}.
        Fifteen minutes at most; stop whenever you like. &ldquo;I don&apos;t
        know&rdquo; is a fine answer.
      </p>

      {!loaded && problem === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="gq-sk" style={{ width: "70%", height: 20 }} />
          <div className="gq-sk" style={{ width: "50%", height: 20 }} />
        </div>
      ) : null}

      {loaded && lines.length === 0 ? (
        <p className="cq-body-sm gq-t2">
          Say hello, or start with what you most want {fund} to know. Q takes it
          from there.
        </p>
      ) : null}

      <ChatTranscript
        lines={lines}
        thinking={pending}
        endRef={end}
        label="Interview with Q"
      />

      {problem === null ? null : (
        <div className="gq-banner gq-banner-err" role="alert">
          <CircleAlert {...icon} />
          <span>
            <b>{waiting ? "Not sent." : "Couldn't load the interview."}</b>{" "}
            {problem} {waiting ? "Your message is still here. " : ""}
            <Button
              size="compact"
              className="ml-1.5"
              onClick={retry}
              disabled={pending}
            >
              <RotateCw {...icon} />
              Try again
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {question === null ? null : (
          <p className="cq-caption gq-t2" id="gq-latest-question">
            <span className="font-medium">Q asked:</span> {question}
          </p>
        )}
        <ChatComposer
          inputRef={input}
          value={draft}
          onChange={setDraft}
          onSend={() => say(draft)}
          pending={pending || waiting || !loaded}
          label={question === null ? "Your message" : "Your answer"}
          placeholder={question === null ? "Say hello" : "Your answer"}
        />
        <div className="gq-opts" role="group" aria-label="Quick answers">
          <button
            type="button"
            className="gq-opt gq-skip"
            disabled={pending || waiting || !loaded || question === null}
            onClick={() => say(QUICK_REPLIES.UNKNOWN)}
          >
            I don&apos;t know
          </button>
          <button
            type="button"
            className="gq-opt gq-skip"
            disabled={pending || waiting || !loaded || question === null}
            onClick={() => say(QUICK_REPLIES.DECLINED)}
          >
            I&apos;d rather not say
          </button>
        </div>
      </div>

      <div className="gq-formbar">
        <Button
          variant="quiet"
          onClick={() => setPaused(true)}
          disabled={pending}
        >
          Pause, come back later
        </Button>
        <Button
          variant="primary"
          style={{ minWidth: 160 }}
          onClick={onFinish}
          disabled={pending}
        >
          {answered ? "Finish and review" : "Skip to review"}
        </Button>
      </div>
    </div>
  );
}
