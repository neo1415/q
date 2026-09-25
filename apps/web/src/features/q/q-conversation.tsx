"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { describeQStreamTransport } from "@capital-q/api-client";
import { Q_SPEECH_MAX_CHARS, type QVoiceChoice } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import {
  Download,
  History,
  ICON_SIZE,
  ICON_STROKE,
  Mic,
  MicOff,
  Square,
} from "@capital-q/ui/icons";
import { QComposer } from "@capital-q/ui/q-composer";
import type { ContextScope } from "@capital-q/ui/tokens";

import { ViewTransition } from "@/components/view-transition";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "../onboarding-kit/material-actions";
import { QAperture, QLumen } from "../q-aperture";
import { useQSpeech } from "../voice/use-q-speech";
import { ArtifactViewer } from "./artifact-viewer";
import {
  failureMessage,
  recoveryHint,
  workingLabel,
  type QTurn,
} from "./conversation";
import { QEvidence, splitBlocks } from "./q-evidence";
import { QHistorySheet } from "./q-history-sheet";
import { QResultBlocks } from "./q-result-blocks";
import { useQSession } from "./q-session";
import { QSurfaceToolsContext, type QSurfaceTools } from "./q-surface-tools";
import type { SpokenLine } from "./spoken";

/**
 * The Q page: talking with Q (founder direction, 2026-09-25; ADR 0017 F3).
 *
 * The page is the voice stage. Arriving, Q speaks first and then listens;
 * the aperture is the only light on a quiet field, and what is being said
 * is a caption beneath it -- Q's words large, the person's words smaller,
 * and the utterance still in progress as one line that updates in place.
 * Finished turns become a faded history above, never a chat log of
 * bubbles. Answers are spoken; their text is a short caption, and the
 * structure behind an answer (findings, what is still open, what Q needs
 * to know, the sources) sits behind one "Evidence" disclosure.
 *
 * Typing is a secondary control on the same stage: while the line is open
 * typed words go down it and are answered aloud; without it they are a
 * question like any other, and the answer is read out.
 *
 * Mic: Q starts the line on arrival only where this browser has already
 * granted the microphone -- the permission prompt itself is only ever the
 * answer to pressing Talk (doc 17 §54). The person's End is remembered for
 * this tab, so the page does not reopen a line they closed.
 *
 * The conversation is the one store's (features/q/q-session), so the dock
 * and the panel are the same conversation and nothing is read again.
 */

export type QSurfaceContext = {
  /** Which platform subject this surface's questions are about, if any. */
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  /** The visibility scope the cue shows. `unset` when nothing is known. */
  readonly scope: ContextScope;
  /** Plain name for the cue (a company, an investor organisation). */
  readonly label?: string | undefined;
  /** Contextual prompts offered before the first turn. */
  readonly suggestions: readonly string[];
};

export type QConversationPanelProps = {
  /** False when this build has no Q API configured. */
  readonly connected: boolean;
  readonly context: QSurfaceContext;
  /** The conversation the URL names, resolved on the server (QX-003A). */
  readonly conversationId?: string | null | undefined;
  /** Q's welcome, shown on the stage before the first turn (A, K). */
  readonly welcome?: ReactNode | undefined;
  /** The welcome as Q says it: the line Q opens with. */
  readonly welcomeLine?: string | undefined;
};

const COMPOSER_ID = "home-q";
const ENDED_KEY = "cq.q.voice-ended";
/** A caption is short: more than this is behind "Read all". */
const CAPTION_CHARS = 220;

const VOICE_LABELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "Female",
  MALE: "Male",
};

/** The conversation as plain text, for saving. */
function transcriptText(
  turns: readonly QTurn[],
  spoken: readonly SpokenLine[],
): string {
  const lines = turns.map((turn) =>
    turn.kind === "PERSON" ? `You: ${turn.text}` : `Q: ${turn.text}`,
  );
  for (const line of spoken) {
    lines.push(`${line.role === "user" ? "You" : "Q"}: ${line.text}`);
  }
  return lines.join("\n\n");
}

function endedThisTab(): boolean {
  try {
    return window.sessionStorage.getItem(ENDED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberEnded(ended: boolean): void {
  try {
    if (ended) window.sessionStorage.setItem(ENDED_KEY, "1");
    else window.sessionStorage.removeItem(ENDED_KEY);
  } catch {
    // Not remembered: the next visit simply offers the line again.
  }
}

/** Whether the microphone is already granted, without ever prompting. */
async function microphoneGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone",
    });
    return status.state === "granted";
  } catch {
    return false;
  }
}

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A line of the ambient transcript. */
type Line = {
  readonly id: string;
  readonly role: "person" | "q";
  readonly text: string;
  /** The Q turn behind it, when it is a stored answer. */
  readonly turn?: Extract<QTurn, { kind: "Q" }> | undefined;
};

/**
 * A notice on the stage: the stage's own surface and words, not the app's
 * tinted notice, whose light fill does not belong on the dark field.
 */
function StageNotice({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-1 rounded-md border border-(--cq-border) bg-(--cq-surface) px-4 py-3 text-left"
    >
      <span className="cq-label text-(--cq-text-primary)">{title}</span>
      <span className="cq-body-sm text-(--cq-text-secondary)">{children}</span>
    </div>
  );
}

function Caption({
  text,
  className,
}: {
  readonly text: string;
  readonly className: string;
}) {
  const [all, setAll] = useState(false);
  const long = text.length > CAPTION_CHARS;
  // A caption is a few lines; the rest is one press away.
  return (
    <div className="flex flex-col items-center gap-1">
      <p className={cx(className, long && !all ? "cq-q-caption-clamp" : "")}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className="cq-stage-quiet"
          aria-expanded={all}
          onClick={() => setAll((current) => !current)}
        >
          {all ? "Show less" : "Read all"}
        </button>
      ) : null}
    </div>
  );
}

export function QConversationPanel({
  connected,
  context,
  conversationId: openConversationId = null,
  welcome,
  welcomeLine,
}: QConversationPanelProps) {
  const session = useQSession();
  const { q, turns, voice, spoken, spokenOnly, presence, act } = session;
  const client = voice.client;

  // The page names the conversation (its URL); the store holds it, so
  // arriving from the dock in the same conversation reads nothing again
  // (ADR 0017 F1, spec §6.4). A bare /home is a new conversation.
  const openConversation = session.open;
  useEffect(() => {
    openConversation(openConversationId);
  }, [openConversation, openConversationId]);

  const openArtifact = session.artifactId;
  const showArtifact = session.openArtifact;
  const closeArtifact = session.closeArtifact;

  /**
   * Attaching a document to this conversation (QX-001 §5): permission,
   * then the bytes straight into private storage, then the server checks
   * what landed. Only for a founder with a company.
   */
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const attach = async (file: File) => {
    const companyId = context.companyId;
    if (companyId === undefined) return;
    setAttachments((current) => [...current, `${file.name} · uploading`]);
    const target = await materialUploadTargetAction({
      companyId,
      documentType: "UNCLASSIFIED",
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    const settle = (note: string) => {
      setAttachments((current) =>
        current.map((entry) =>
          entry === `${file.name} · uploading`
            ? `${file.name} · ${note}`
            : entry,
        ),
      );
    };
    if (!target.ok) {
      settle(target.message);
      return;
    }
    const put = await fetch(target.value.url, {
      method: target.value.method,
      headers: target.value.headers,
      body: file,
    });
    if (!put.ok) {
      settle("could not be uploaded");
      return;
    }
    const completed = await materialUploadCompleteAction(
      target.value.uploadSessionId,
    );
    settle(completed.ok ? "attached" : completed.message);
  };

  // --- Talking --------------------------------------------------------------

  const sessionTalk = session.talk;
  const talk = useCallback(async () => {
    rememberEnded(false);
    // Over a welcome still on screen, Q says that welcome and nothing
    // before it: one greeting, not the page's and then the call's.
    const greeting =
      welcomeLine !== undefined && turns.length === 0 && spoken.length === 0
        ? welcomeLine
        : undefined;
    await sessionTalk(greeting === undefined ? undefined : { greeting });
  }, [sessionTalk, welcomeLine, turns.length, spoken.length]);

  const endVoice = voice.end;
  const end = useCallback(() => {
    rememberEnded(true);
    void endVoice();
  }, [endVoice]);

  // Q speaks first: on arrival the line opens by itself where the
  // microphone is already this site's, and the person has not ended it in
  // this tab. Anywhere else the stage offers Talk, one press away.
  // Once per visit to the page: a ref, not state, so trying does not
  // re-run (and cancel) the attempt it is part of.
  const autoTried = useRef(false);
  const talkRef = useRef(talk);
  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);
  const voiceActive = voice.active;
  useEffect(() => {
    if (autoTried.current || !connected || voiceActive) return;
    let left = false;
    // A task later, so an effect React runs twice in development (and
    // cleans up in between) tries once, not never.
    const timer = window.setTimeout(() => {
      autoTried.current = true;
      void (async () => {
        if (endedThisTab()) return;
        if (!(await microphoneGranted()) || left) return;
        await talkRef.current();
      })();
    }, 0);
    return () => {
      // Left the page before the permission answer: no line opens.
      left = true;
      window.clearTimeout(timer);
    };
  }, [connected, voiceActive]);

  // An answer that arrived while the line was closed is read aloud all the
  // same (one-way speech, no microphone): answers on this page are heard.
  const speech = useQSpeech();
  const say = speech.say;
  const stopSpeech = speech.stop;
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (q.loading) {
      heard.current = null;
      return;
    }
    if (heard.current === null) {
      heard.current = new Set(turns.map((turn) => turn.id));
      return;
    }
    const latest = turns.findLast((turn) => turn.kind === "Q");
    if (
      latest === undefined ||
      latest.kind !== "Q" ||
      latest.streaming ||
      heard.current.has(latest.id)
    ) {
      return;
    }
    heard.current.add(latest.id);
    if (voice.active) return;
    void say(latest.text.slice(0, Q_SPEECH_MAX_CHARS), voice.voice);
  }, [turns, q.loading, voice.active, voice.voice, say]);
  useEffect(() => {
    if (voice.active) stopSpeech();
  }, [voice.active, stopSpeech]);

  // --- The ambient transcript --------------------------------------------------

  // The live line: what is being said right now, one line that grows in
  // place under its id, until the next one starts.
  const live = client.transcript.at(-1);
  const liveIsPerson =
    voice.active &&
    live !== undefined &&
    live.role === "user" &&
    (live.partial ||
      client.state === "USER_SPEAKING" ||
      client.state === "LISTENING" ||
      client.state === "THINKING");

  const stored: Line[] = turns.map((turn) =>
    turn.kind === "PERSON"
      ? { id: turn.id, role: "person", text: turn.text }
      : { id: turn.id, role: "q", text: turn.text, turn },
  );
  const lines: Line[] = [
    ...stored,
    ...spokenOnly.map((line): Line => ({
      id: line.id,
      role: line.role === "user" ? "person" : "q",
      text: line.text,
    })),
  ];
  // The current exchange: the person's latest words and, once it has
  // come, Q's answer to them. Everything before it is history. While the
  // person is speaking, their words are the live line, growing in place.
  const liveWords = liveIsPerson ? words(live.text) : null;
  const settledLines =
    liveWords === null
      ? lines
      : lines.filter(
          (line) => !(line.role === "person" && words(line.text) === liveWords),
        );
  const lastPersonAt = settledLines.findLastIndex(
    (line) => line.role === "person",
  );
  const lastQAt = settledLines.findLastIndex((line) => line.role === "q");
  const currentQ =
    liveIsPerson || lastQAt < lastPersonAt ? undefined : settledLines[lastQAt];
  const currentPerson = liveIsPerson
    ? { id: live.id, text: live.text }
    : lastPersonAt >= 0 && (currentQ === undefined || lastPersonAt < lastQAt)
      ? settledLines[lastPersonAt]
      : undefined;
  const firstCurrent = liveIsPerson
    ? settledLines.length
    : currentQ !== undefined
      ? lastPersonAt >= 0 && lastPersonAt < lastQAt
        ? lastPersonAt
        : lastQAt
      : lastPersonAt >= 0
        ? lastPersonAt
        : settledLines.length;
  const history = settledLines.slice(0, firstCurrent);

  // The newest words are where the eye is: the stage keeps its end in view.
  const bodyRef = useRef<HTMLDivElement>(null);
  const newest = `${String(lines.length)}:${live?.text ?? ""}:${currentQ?.text.length ?? 0}`;
  useEffect(() => {
    const body = bodyRef.current;
    if (body !== null) body.scrollTop = body.scrollHeight;
  }, [newest]);
  const historyRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = historyRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [history.length]);

  const stage = workingLabel(q.state);
  const showWelcome = welcome !== undefined && lines.length === 0 && !q.loading;
  const showSuggestions =
    welcome === undefined &&
    connected &&
    lines.length === 0 &&
    !q.working &&
    !q.loading &&
    q.state.failure === null;

  const stateLabel = voice.active
    ? client.muted
      ? "Muted"
      : (presence.label ?? "Listening")
    : (presence.label ?? (connected ? "Ready when you are" : "Q"));

  const [historyOpen, setHistoryOpen] = useState(false);
  const download =
    turns.length === 0 && spoken.length === 0
      ? undefined
      : () => {
          const blob = new Blob([transcriptText(turns, spoken)], {
            type: "text/plain;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "capital-q-conversation.txt";
          anchor.click();
          URL.revokeObjectURL(url);
        };

  // What the welcome's cards do, in this surface rather than elsewhere.
  const qAsk = q.ask;
  const tools = useMemo<QSurfaceTools>(
    () => ({
      ask: (prompt) => {
        void qAsk(prompt);
      },
      openArtifact: showArtifact,
    }),
    [qAsk, showArtifact],
  );

  const currentTurn = currentQ?.turn;
  const currentParts =
    currentTurn === undefined ? null : splitBlocks(currentTurn.blocks);

  return (
    <QSurfaceToolsContext.Provider value={tools}>
      <div
        className="cq-stage cq-q-home flex flex-col lg:flex-row"
        data-q-surface-split
      >
        <section
          aria-label="Q"
          className={cx(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            openArtifact === null ? "" : "hidden lg:flex",
          )}
          data-q-workspace
          data-q-stage={voice.active ? "voice" : "ready"}
          data-q-turns={String(turns.length)}
          data-q-voice={voice.active ? client.state : undefined}
        >
          <QLumen
            active={voice.active}
            input={client.inputLevel}
            output={client.outputLevel}
          />

          {/* The top line: history and the saved transcript, quiet. */}
          <div className="flex flex-none items-center justify-between gap-3 px-5 pt-4 sm:px-8">
            <span className="cq-label text-(--cq-text-secondary)">
              {context.label ?? "Q"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="cq-stage-quiet"
                onClick={() => setHistoryOpen(true)}
                data-q-control="history"
              >
                <History
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                Conversations
              </button>
              {download === undefined ? null : (
                <button
                  type="button"
                  className="cq-stage-quiet"
                  onClick={download}
                  aria-label="Save this conversation"
                  data-q-control="download"
                >
                  <Download
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                </button>
              )}
            </div>
          </div>
          <QHistorySheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            active={q.conversationId}
          />

          {/* The stage. The one part that grows, so it is the part that
              scrolls, between the top line and controls that never leave
              the screen. */}
          <div
            ref={bodyRef}
            className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
            data-q-voice-stage-body
          >
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 py-6">
              {history.length > 0 ? (
                <ol
                  ref={historyRef}
                  className="cq-q-history w-full"
                  aria-label="Earlier in this conversation"
                >
                  {history.map((line) => (
                    <li
                      key={line.id}
                      className={
                        line.role === "person"
                          ? "cq-q-history-person"
                          : "cq-q-history-q"
                      }
                      {...(line.turn === undefined
                        ? {}
                        : { "data-q-answer": "settled" })}
                    >
                      <span className="sr-only">
                        {line.role === "person" ? "You: " : "Q: "}
                      </span>
                      {line.text}
                      {line.turn === undefined ? null : (
                        <QEvidence
                          turn={line.turn}
                          onAsk={(question) => void q.ask(question)}
                          onOpenArtifact={showArtifact}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              ) : null}

              <ViewTransition
                name="q-aperture"
                share="cq-q-morph"
                default="none"
              >
                <QAperture
                  state={presence.state}
                  // Full size to begin with; smaller once there is a
                  // conversation to read beside it.
                  size={lines.length > 0 || liveIsPerson ? 120 : "stage"}
                  inputLevel={client.inputLevel}
                  outputLevel={client.outputLevel}
                />
              </ViewTransition>
              <div className="flex flex-col items-center gap-1" role="status">
                <span className="cq-label text-(--cq-text-primary)">
                  {stateLabel}
                </span>
                {!voice.active && q.working && stage !== undefined ? (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {stage}
                  </span>
                ) : null}
              </div>

              {showWelcome ? (
                <div
                  className="flex w-full flex-col items-center"
                  data-q-welcome-line
                >
                  {welcome}
                </div>
              ) : null}

              {/* What is being said: Q's words, then the person's. */}
              <div
                className="flex w-full flex-col items-center gap-3 text-center"
                aria-live="polite"
                data-q-captions
              >
                {currentPerson !== undefined ? (
                  <p
                    className="cq-body-lg text-balance text-(--cq-text-secondary)"
                    data-q-live-line={liveIsPerson ? "" : undefined}
                  >
                    “{currentPerson.text}”
                  </p>
                ) : null}
                {currentQ !== undefined ? (
                  <div
                    className="flex flex-col items-center gap-2"
                    {...(currentTurn === undefined
                      ? {}
                      : {
                          "data-q-answer": currentTurn.streaming
                            ? "streaming"
                            : "settled",
                        })}
                  >
                    <Caption
                      key={currentQ.id}
                      text={currentQ.text}
                      className="cq-q-caption cq-title-md text-balance text-(--cq-text-primary)"
                    />
                  </div>
                ) : null}
              </div>

              {currentTurn !== undefined && currentParts !== null ? (
                <div className="flex w-full flex-col items-center gap-3">
                  {currentParts.visible.length > 0 ? (
                    <div className="w-full max-w-(--cq-layout-narrow)">
                      <QResultBlocks
                        blocks={currentParts.visible}
                        onAsk={(question) => void q.ask(question)}
                        onOpenArtifact={showArtifact}
                      />
                    </div>
                  ) : null}
                  <QEvidence
                    turn={currentTurn}
                    onAsk={(question) => void q.ask(question)}
                    onOpenArtifact={showArtifact}
                  />
                </div>
              ) : null}

              {showSuggestions ? (
                <ul
                  aria-label="Suggested questions"
                  className="flex flex-wrap justify-center gap-2"
                  data-q-suggestions
                >
                  {context.suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        className="cq-stage-option"
                        onClick={() => {
                          if (voice.active) client.sendText(suggestion);
                          else void q.ask(suggestion);
                        }}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {voice.active &&
              voice.turn?.asking !== null &&
              voice.turn?.asking !== undefined &&
              voice.turn.asking.options.length > 0 ? (
                <div
                  className="flex flex-wrap justify-center gap-2"
                  role="group"
                  aria-label="Options"
                  data-q-stage-options
                >
                  {voice.turn.asking.options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="cq-stage-option"
                      title={option.description}
                      onClick={() => client.sendText(option.label)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {q.loading && lines.length === 0 ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Opening your conversation…
                </p>
              ) : null}

              {q.state.approval !== null
                ? (() => {
                    // What Q has prepared and is waiting on (CQ-Q-008). The
                    // server's own words for the exact payload the decision
                    // binds to; one yes applies it, one no leaves it.
                    const approval = q.state.approval;
                    const proposal = q.state.proposals.find(
                      (candidate) =>
                        candidate.proposalId === approval.proposalId,
                    );
                    return (
                      <div
                        className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-3 rounded-lg border border-(--cq-border) bg-(--cq-surface) p-4"
                        data-q-approval
                      >
                        <span className="cq-label text-(--cq-text-secondary)">
                          Needs you
                        </span>
                        <p className="cq-body font-medium text-(--cq-text-primary)">
                          {proposal?.summary ??
                            "Q has prepared something for you to approve."}
                        </p>
                        {proposal?.preview !== undefined ? (
                          <pre className="cq-body-sm whitespace-pre-wrap font-sans text-(--cq-text-secondary)">
                            {proposal.preview}
                          </pre>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="cq-stage-primary"
                            onClick={() => {
                              act();
                              void q.approve();
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="cq-stage-control"
                            onClick={() => void q.decline()}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    );
                  })()
                : null}

              {q.transport === "RECONNECTING" ? (
                <p className="cq-caption text-(--cq-text-secondary)">
                  {describeQStreamTransport(q.transport)} Your conversation is
                  saved.
                </p>
              ) : null}
              {q.state.failure !== null ? (
                <StageNotice title="Q couldn't finish that">
                  {failureMessage(q.state.failure)}{" "}
                  {recoveryHint(q.state.failure)}
                </StageNotice>
              ) : null}
              {q.notice !== null && q.state.failure === null ? (
                <StageNotice title="That didn't go through">
                  {q.notice}
                </StageNotice>
              ) : null}
              {voice.notice !== null ? (
                <div className="flex items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3">
                  <span className="cq-body text-(--cq-text-primary)">
                    {voice.notice}
                  </span>
                  <button
                    type="button"
                    className="cq-stage-quiet"
                    onClick={voice.clearNotice}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {speech.status === "blocked" ? (
                <button
                  type="button"
                  className="cq-stage-control"
                  onClick={speech.play}
                >
                  Play Q’s answer
                </button>
              ) : null}
            </div>
          </div>

          {/* The controls: always on screen. Talking is the way in; typing
              is beside it, on the same stage. */}
          <div
            className="flex flex-none flex-col items-center gap-3 border-t border-(--cq-border-subtle) px-5 pt-4 pb-5 sm:px-8"
            data-q-voice-stage-controls
          >
            <div className="flex flex-wrap items-center justify-center gap-2">
              {voice.active ? (
                <>
                  <button
                    type="button"
                    className={
                      client.muted
                        ? "cq-stage-control is-active"
                        : "cq-stage-control"
                    }
                    aria-pressed={client.muted}
                    disabled={!client.connected}
                    onClick={() => client.setMuted(!client.muted)}
                    data-q-control="mute"
                  >
                    {client.muted ? (
                      <MicOff size={ICON_SIZE.compact} aria-hidden="true" />
                    ) : (
                      <Mic size={ICON_SIZE.compact} aria-hidden="true" />
                    )}
                    {client.muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    className="cq-stage-primary inline-flex items-center gap-2"
                    onClick={end}
                    data-q-control="end"
                  >
                    <Square size={ICON_SIZE.compact} aria-hidden="true" />
                    End
                  </button>
                  <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label="Q's voice"
                  >
                    {(["FEMALE", "MALE"] as const).map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        className={
                          choice === voice.voice
                            ? "cq-stage-control is-active"
                            : "cq-stage-control"
                        }
                        aria-pressed={choice === voice.voice}
                        onClick={() => void voice.chooseVoice(choice)}
                      >
                        {VOICE_LABELS[choice]}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="cq-q-talk"
                  disabled={!connected}
                  onClick={() => void talk()}
                  data-q-control="talk"
                >
                  <Mic
                    size={ICON_SIZE.prominent}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {connected
                    ? "Talk with Q"
                    : "Q isn't connected on this build"}
                </button>
              )}
              {q.working ? (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => void q.stop()}
                >
                  Stop
                </Button>
              ) : null}
            </div>
            <div className="w-full max-w-2xl">
              <QComposer
                id={COMPOSER_ID}
                contextScope={context.scope}
                contextDetail={context.label}
                disabled={q.working && !voice.active}
                placeholder={
                  voice.active
                    ? "Type instead — Q hears this too"
                    : "Or type to Q"
                }
                attachments={attachments}
                {...(connected && context.companyId !== undefined
                  ? { onAttach: attach, attachLabel: "Attach a document" }
                  : {})}
                {...(connected
                  ? {
                      onSubmit: voice.active
                        ? (text: string) => {
                            client.sendText(text);
                          }
                        : q.ask,
                    }
                  : {})}
              />
            </div>
          </div>
        </section>

        {openArtifact === null ? null : (
          <div className="flex min-w-0 flex-1 flex-col p-4 lg:sticky lg:top-0 lg:max-h-dvh">
            <ArtifactViewer
              artifactId={openArtifact}
              onClose={closeArtifact}
              revision={
                turns.findLast(
                  (turn) =>
                    turn.kind === "Q" &&
                    turn.blocks.some(
                      (block) =>
                        block.kind === "ARTIFACT_REFERENCE" &&
                        block.artifactId === openArtifact,
                    ),
                )?.id
              }
            />
          </div>
        )}
      </div>
    </QSurfaceToolsContext.Provider>
  );
}
