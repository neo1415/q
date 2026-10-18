"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import type {
  ApplicationCoverageDto,
  ApplicationSummaryDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
} from "@capital-q/ui/icons";

import { ChatComposer, ChatTranscript } from "../apply-experience";
import {
  applicationTurnAction,
  coverageAction,
  openInterviewAction,
  transcriptAction,
} from "../apply-actions";
import { GateqVideoEntry } from "../gateq-video-entry";
import { readRecovery, amendRecovery } from "./session-recovery";
import {
  latestQuestion,
  linesFromTranscript,
  QUICK_REPLIES,
  type InterviewLine,
} from "./form-model";
import { useT } from "@/features/i18n/language";

/**
 * GateQ slice 1: the interview with Q, after the form and before the review.
 *
 * The server keeps every turn. On mount the transcript is read back, so
 * returning to this step (or resuming after a pause) shows exactly what was
 * said, never a copy this browser happened to remember. Each message gets
 * one client turn id, kept for its retry: the API answers a repeated id
 * with the first answer instead of running (and charging) a second turn.
 *
 * Video first (owner, 2026-10-15): when the server offers this applicant
 * a video interview (configured, within their weekly allowance and the
 * platform safeguard), the native video room is the default way to do this
 * step. Typing is the fallback when video is not offered, is refused or
 * the cap is reached, or the person prefers it; both feed the same
 * canonical interview, so the transcript below is the one record.
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
  gatewayPublicId,
  participantName = "",
  onFinish,
  onApplication,
  preview,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fund: string;
  readonly companyName: string;
  readonly sessionToken: string | null;
  readonly gatewayPublicId?: string | undefined;
  /** The applicant's contact name, shown to the interviewer in the room. */
  readonly participantName?: string | undefined;
  readonly onFinish: () => void;
  /** GATE-001's answer after each turn, for the rules card. */
  readonly onApplication?: (application: ApplicationSummaryDto) => void;
  readonly preview?: InterviewPreview | undefined;
}) {
  const t = useT();

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
  // VIDEO: "video" until the server says it is not offered or the person
  // chooses typing; the preview gallery and a missing token are typed.
  const [mode, setMode] = useState<"video" | "text">(
    preview !== undefined || sessionToken === null ? "text" : "video",
  );
  // Typing because the person chose it (video can be picked again).
  const [chose, setChose] = useState(false);
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [coverage, setCoverage] = useState<ApplicationCoverageDto | null>(null);

  // The room shows the same "what we have / still needed" as the review.
  useEffect(() => {
    if (!roomOpen || sessionToken === null || preview !== undefined) return;
    let current = true;
    void coverageAction(sessionToken)
      .then((result) => {
        if (current && result.ok) setCoverage(result.coverage);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [roomOpen, sessionToken, preview]);

  // Resume what the server recorded, every time this step mounts; on a
  // fresh interview the server asks Q's opening question first.
  useEffect(() => {
    if (preview !== undefined || sessionToken === null) return;
    let current = true;
    const held =
      gatewayPublicId === undefined
        ? null
        : (readRecovery(gatewayPublicId)?.pendingTurn ?? null);
    void (
      held === null
        ? openInterviewAction(sessionToken)
        : transcriptAction(sessionToken)
    )
      .then((result) => {
        if (!current) return;
        if (held !== null) setUnsent(held);
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        setLines(linesFromTranscript(result.turns));
        setLoaded(true);
        if (held !== null) {
          setUnsent(held);
          setProblem(
            "Your last answer needs confirmation. Retry to recover Q’s reply.",
          );
        }
      })
      .catch(() => {
        if (current)
          setProblem("The connection was interrupted. Please try again.");
      });
    return () => {
      current = false;
    };
  }, [sessionToken, preview, reads, gatewayPublicId]);

  const sendTurn = (turn: Turn) => {
    if (sessionToken === null) return;
    startTransition(async () => {
      setProblem(null);
      const result = await applicationTurnAction(
        sessionToken,
        turn.text,
        turn.id,
      ).catch(() => ({
        ok: false as const,
        message:
          "The connection was interrupted. Your answer is still here; please try again.",
      }));
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setUnsent(null);
      if (gatewayPublicId !== undefined)
        amendRecovery(gatewayPublicId, { pendingTurn: null });
      onApplication?.(result.application);
      const transcript = await transcriptAction(sessionToken).catch(() => ({
        ok: false as const,
        message: "Couldn't restore Q's reply. Please try again.",
      }));
      if (transcript.ok) setLines(linesFromTranscript(transcript.turns));
      else {
        setProblem(transcript.message);
        setLoaded(false);
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
    if (gatewayPublicId !== undefined)
      amendRecovery(gatewayPublicId, { pendingTurn: turn });
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
          {t("Interview paused")}
        </h1>
        <p className="cq-body gq-t2">
          {t(
            `Everything you've said is saved with your application. Pick up where you left off whenever you're ready; keep this page open, it holds your place. Nothing goes to ${fund} until you submit.`,
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={resume}>
            {t("Resume the interview")}
          </Button>
          <Button
            variant="quiet"
            onClick={onFinish}
            disabled={unsent !== null || !loaded}
          >
            {t("Review instead")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        {t("A few questions from Q")}
      </h1>
      <p className="cq-body gq-t2">
        {t(
          `Q is ${fund}'s analyst. It has your answers and asks what an investor would want to know about ${companyName || "your company"}.`,
        )}{" "}
        {mode === "video"
          ? t(
              "Talk it through on video, or type if you prefer; both go into the same interview. ",
            )
          : t("Fifteen minutes at most; stop whenever you like. ")}
        {t("“I don't know” is a fine answer.")}
      </p>

      {!loaded && problem === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="gq-sk" style={{ width: "70%", height: 20 }} />
          <div className="gq-sk" style={{ width: "50%", height: 20 }} />
        </div>
      ) : null}

      {mode === "video" && sessionToken !== null ? (
        <GateqVideoEntry
          token={sessionToken}
          fund={fund}
          coverage={coverage}
          participantName={participantName}
          variant="primary"
          onRoomChange={setRoomOpen}
          onUnavailable={(why) => {
            setVideoNote(why);
            setChose(false);
            setMode("text");
          }}
          onTypeInstead={() => {
            setChose(true);
            setMode("text");
          }}
          onEnded={async (typed) => {
            // The bridge kept every spoken turn; read them back first.
            const transcript = await transcriptAction(sessionToken).catch(
              () => null,
            );
            if (transcript?.ok === true)
              setLines(linesFromTranscript(transcript.turns));
            if (typed) {
              // Typing by choice: a second session can still be offered.
              setChose(true);
              setVideoNote(null);
              setMode("text");
            } else onFinish();
          }}
        />
      ) : null}

      {mode === "text" && videoNote !== null ? (
        <p role="status" className="cq-body-sm gq-t2">
          {t(videoNote)}
        </p>
      ) : null}

      {mode === "text" && chose ? (
        <p className="cq-body-sm gq-t2">
          <Button
            variant="quiet"
            size="compact"
            onClick={() => {
              setChose(false);
              setMode("video");
            }}
          >
            {t("Talk with Q on video instead")}
          </Button>
        </p>
      ) : null}

      {mode === "text" && loaded && lines.length === 0 ? (
        <p className="cq-body-sm gq-t2">
          {t(
            `Say hello, or start with what you most want ${fund} to know. Q takes it from there.`,
          )}
        </p>
      ) : null}

      <ChatTranscript
        lines={lines}
        thinking={pending}
        endRef={end}
        label={t("Interview with Q")}
      />

      {problem === null ? null : (
        <div className="gq-banner gq-banner-err" role="alert">
          <CircleAlert {...icon} />
          <span>
            <b>
              {waiting ? t("Not sent.") : t("Couldn't load the interview.")}
            </b>{" "}
            {t(problem)} {waiting ? t("Your message is still here. ") : ""}
            <Button
              size="compact"
              className="ms-1.5"
              onClick={retry}
              disabled={pending}
            >
              <RotateCw {...icon} />
              {t("Try again")}
            </Button>
          </span>
        </div>
      )}

      {mode === "video" ? null : (
        <div className="flex flex-col gap-2">
          {question === null ? null : (
            <p className="cq-caption gq-t2" id="gq-latest-question">
              <span className="font-medium">{t("Q asked:")}</span> {t(question)}
            </p>
          )}
          <ChatComposer
            inputRef={input}
            value={draft}
            onChange={setDraft}
            onSend={() => say(draft)}
            pending={pending || waiting || !loaded}
            label={question === null ? t("Your message") : t("Your answer")}
            placeholder={question === null ? t("Say hello") : t("Your answer")}
          />
          <div className="gq-opts" role="group" aria-label={t("Quick answers")}>
            <button
              type="button"
              className="gq-opt gq-skip"
              disabled={pending || waiting || !loaded || question === null}
              onClick={() => say(QUICK_REPLIES.UNKNOWN)}
            >
              {t("I don't know")}
            </button>
            <button
              type="button"
              className="gq-opt gq-skip"
              disabled={pending || waiting || !loaded || question === null}
              onClick={() => say(QUICK_REPLIES.DECLINED)}
            >
              {t("I'd rather not say")}
            </button>
          </div>
        </div>
      )}

      {roomOpen ? null : (
        <div className="gq-formbar">
          <Button
            variant="quiet"
            onClick={() => setPaused(true)}
            disabled={pending}
          >
            {t("Pause, come back later")}
          </Button>
          <Button
            // While the video interview is on offer and nothing is answered,
            // it is the step's primary; skipping is the way out, not the
            // weightiest button (live check 2026-10-16).
            variant={answered || mode === "text" ? "primary" : "secondary"}
            style={{ minWidth: 160 }}
            onClick={onFinish}
            disabled={pending || unsent !== null || !loaded}
          >
            {answered ? t("Finish and review") : t("Skip to review")}
          </Button>
        </div>
      )}
    </div>
  );
}
