"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeQStreamTransport } from "@capital-q/api-client";
import { cx } from "@capital-q/ui";
import { QConversationIdSchema } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { QComposer } from "@capital-q/ui/q-composer";
import { InlineNotice } from "@capital-q/ui/states";
import type { ContextScope } from "@capital-q/ui/tokens";

import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "../onboarding-kit/material-actions";
import { presenceStateFromVoice, type QPresenceState } from "../q-presence";
import { destinationPath } from "../voice/destinations";
import { VOICE_STATE_LABELS } from "../voice/session";
import { useFollowTurn } from "../voice/use-follow-turn";
import { useVoiceInterview } from "../voice/use-voice-interview";
import { ArtifactViewer } from "./artifact-viewer";
import { QAnswer } from "./q-answer";
import { QHistorySheet } from "./q-history-sheet";
import { QStage } from "./q-stage";
import { spokenNotYetStored, type SpokenLine } from "./spoken";
import {
  failureMessage,
  recoveryHint,
  turnsFrom,
  workingLabel,
  type QTurn,
} from "./conversation";
import { Q_CONVERSATION_PARAM } from "./chats-list";
import {
  announceConversationsChanged,
  useQConversation,
} from "./use-q-conversation";

/**
 * Q, in the browser (CQ-C5-R1 §13-§19; CQ-PRE-REC-001 §12-§13), voice
 * first.
 *
 * The screen is Q: its presence at the top, alive to what is happening;
 * one word for what it is doing; the controls a hand needs; then the
 * conversation, and the composer docked beneath it. Talking happens in
 * place — the presence listens, thinks and speaks where it stands, and
 * the thread fills in beneath — rather than behind a modal, so typing and
 * speaking are visibly one conversation. The composer stays reachable,
 * sticky at the bottom of the workspace above the mobile navigation, so
 * a long answer never pushes the next question off the screen.
 *
 * What is deliberately absent: a local reply of any kind. There is no
 * fixture, no canned response, no simulated typing and no fabricated
 * progress. When Q is not connected on this build the composer says exactly
 * that and sends nothing.
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
  /**
   * The conversation the URL names, resolved on the server (QX-003A).
   *
   * Read here rather than with `useSearchParams` because reading it in
   * the browser remounted this component as the parameter resolved: the
   * instance that had hydrated the conversation was discarded and the
   * one left on screen had fetched nothing. The turns were restored
   * correctly and thrown away.
   */
  readonly conversationId?: string | null | undefined;
};

/** How long the settle after an answer, and the sweep of an action, are shown. */
const SUCCESS_MS = 900;
const ACTION_MS = 700;

const COMPOSER_ID = "home-q";

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

export function QConversationPanel({
  connected,
  context,
  conversationId: openConversationId = null,
}: QConversationPanelProps) {
  const router = useRouter();
  // Which conversation this surface is in comes from the URL (ADR 0012),
  // so a refresh, a link and the chats list all open the same thread. A
  // conversation the server names for the first time is written back to
  // the URL without a navigation, so nothing on screen is disturbed.
  const conversationParam = openConversationId;
  const onConversation = useCallback((conversationId: string) => {
    // Written back without a navigation, so naming a conversation for
    // the first time does not disturb anything on screen.
    const next = new URLSearchParams(window.location.search);
    next.set(Q_CONVERSATION_PARAM, conversationId);
    window.history.replaceState(null, "", `/home?${next.toString()}`);
  }, []);
  const q = useQConversation({
    companyId: context.companyId,
    investorOrganisationId: context.investorOrganisationId,
    conversationId: conversationParam,
    onConversation,
  });
  const turns = turnsFrom(q.state, q.pending);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * The document on screen beside Q, if any (QX-003E).
   *
   * Kept here rather than in a route so the conversation stays mounted
   * and reachable: "Edit with Q" is the next sentence in the same thread,
   * not a navigation away and back. Below the desktop breakpoint the
   * viewer takes the column instead, with its own way back.
   */
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const showArtifact = useCallback((artifactId: string) => {
    setOpenArtifact(artifactId);
  }, []);
  const closeArtifact = useCallback(() => {
    setOpenArtifact(null);
  }, []);

  // Voice (CQ-Q-VOICE-001): the same Q conversation, spoken. The credential
  // is bound on the server to this person, this subject and the
  // conversation this tab is already in; what is said either way is one
  // thread. Spoken lines are shown as they are transcribed.
  const [spoken, setSpoken] = useState<readonly SpokenLine[]>([]);

  /**
   * Attaching a document to this conversation (QX-001 §5).
   *
   * The same three-step Evidence upload onboarding uses: ask permission,
   * put the bytes straight into private storage from the browser, let the
   * server verify what actually landed. Nothing new, and the bytes never
   * pass through the application server.
   *
   * It appears only for a founder with a company, because that is the
   * only subject Evidence can own a document against today. An investor
   * sees no control rather than one that refuses — the packet's rule
   * about dead buttons, and the honest thing besides.
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
      // The bytes did not land; the session is left unfinished rather
      // than completed over nothing.
      settle("could not be uploaded");
      return;
    }
    const completed = await materialUploadCompleteAction(
      target.value.uploadSessionId,
    );
    settle(completed.ok ? "attached" : completed.message);
  };
  const voice = useVoiceInterview({
    onLine: (line) => {
      setSpoken((current) => [
        ...current,
        { id: line.id, role: line.role, text: line.text },
      ]);
    },
  });
  const talkWithQ = async () => {
    const conversationId = QConversationIdSchema.safeParse(
      q.conversationId ?? undefined,
    ).data;
    await voice.talk({
      thread: {
        ...(context.companyId !== undefined
          ? {
              subjects: [
                { kind: "COMPANY" as const, companyId: context.companyId },
              ],
            }
          : context.investorOrganisationId !== undefined
            ? {
                subjects: [
                  {
                    kind: "INVESTOR_ORGANISATION" as const,
                    investorOrganisationId: context.investorOrganisationId,
                  },
                ],
              }
            : {}),
        ...(conversationId === undefined ? {} : { conversationId }),
      },
      firstMessage: "I'm listening. What would you like to know?",
    });
  };

  // The spoken turns live in a conversation the server names; once it
  // does, the screen is in that conversation too, so a refresh and the
  // chats list find what was said aloud.
  const voiceConversationId = voice.turn?.conversationId;
  useEffect(() => {
    if (
      voiceConversationId !== undefined &&
      voiceConversationId !== conversationParam
    ) {
      onConversation(voiceConversationId);
      announceConversationsChanged();
      router.replace(
        `/home?${Q_CONVERSATION_PARAM}=${encodeURIComponent(voiceConversationId)}`,
      );
    }
  }, [voiceConversationId, conversationParam, onConversation, router]);

  /**
   * Two moments the presence shows and nothing else does: the settle
   * after an answer lands, and the sweep when Q acts on something —
   * follows a spoken "take me to…", or applies what was approved. Both
   * are brief and time out on their own.
   */
  const [settled, setSettled] = useState(false);
  const [acting, setActing] = useState(false);
  const wasWorking = useRef(false);
  useEffect(() => {
    const finished = wasWorking.current && !q.working;
    wasWorking.current = q.working;
    if (!finished || q.state.failure !== null) return;
    setSettled(true);
    const timer = window.setTimeout(() => setSettled(false), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [q.working, q.state.failure]);
  const act = useCallback(() => {
    setActing(true);
    window.setTimeout(() => setActing(false), ACTION_MS);
  }, []);

  // "Take me to my profile", said on Home: followed once Q has said so.
  const voiceEnd = voice.end;
  useFollowTurn(voice.turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void voiceEnd();
      return;
    }
    const path = destinationPath(followed.navigate);
    if (path !== null) {
      act();
      void voiceEnd();
      router.push(path);
    }
  });

  useEffect(() => {
    // Follow the answer as it arrives, and respect a reader who has asked
    // for less motion. `nearest` scrolls only when the end of the
    // conversation has actually gone out of view.
    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [turns.length, spoken.length, q.state.partial?.text]);

  // Spoken lines only until the same words are stored (see ./spoken).
  const spokenOnly = spokenNotYetStored(
    spoken,
    turns.map((turn) => turn.text),
  );

  const stage = workingLabel(q.state);
  // Suggestions are an on-ramp, not a feature: gone after the first turn.
  const showSuggestions =
    connected &&
    turns.length === 0 &&
    !q.working &&
    !q.loading &&
    q.state.failure === null;

  // What the presence shows, and the word beside it. Voice, while it is
  // on, is the truth; otherwise the run's own state.
  const presenceState: QPresenceState = voice.active
    ? presenceStateFromVoice(voice.client.state)
    : acting
      ? "ACTION"
      : q.working
        ? "THINKING"
        : settled
          ? "SUCCESS"
          : q.state.failure !== null
            ? "ERROR"
            : "IDLE";
  const presenceLabel = voice.active
    ? voice.client.muted
      ? "Muted"
      : VOICE_STATE_LABELS[voice.client.state]
    : q.working
      ? "Thinking"
      : q.state.failure !== null
        ? "Couldn't finish that"
        : settled
          ? "Done"
          : undefined;
  const presenceDetail = voice.active
    ? undefined
    : q.working
      ? stage
      : context.label;

  const [historyOpen, setHistoryOpen] = useState(false);
  const focusComposer = () => {
    const element = document.getElementById(COMPOSER_ID);
    if (element instanceof HTMLTextAreaElement) {
      element.focus();
      element.scrollIntoView({ block: "nearest" });
    }
  };
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

  return (
    <div
      className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6"
      data-q-surface-split
    >
      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col gap-4",
          // On a narrow screen the document takes the column rather than
          // squeezing beside the conversation; "Back to Q" brings this
          // back, and the conversation is never unmounted, so nothing it
          // was holding is lost.
          openArtifact === null ? "" : "hidden lg:flex",
        )}
        data-q-workspace
        // How many turns are on screen. A test hook rather than decoration:
        // "the conversation reopened" is otherwise only assertable by
        // counting rendered children, which changes whenever the answer
        // layout does.
        data-q-turns={String(turns.length)}
      >
        <QStage
          state={presenceState}
          inputLevel={voice.client.inputLevel}
          outputLevel={voice.client.outputLevel}
          label={presenceLabel}
          detail={presenceDetail}
          connected={connected}
          voiceActive={voice.active}
          muted={voice.client.muted}
          voice={voice.voice}
          voices={["FEMALE", "MALE"]}
          onTalk={() => void talkWithQ()}
          onEnd={() => void voice.end()}
          onMute={(muted) => voice.client.setMuted(muted)}
          onVolume={(volume) => voice.client.setVolume(volume)}
          onChooseVoice={(choice) => void voice.chooseVoice(choice)}
          onType={focusComposer}
          onHistory={() => setHistoryOpen(true)}
          onDownload={download}
          asking={voice.turn?.asking ?? null}
          onSay={(text) => voice.client.sendText(text)}
          className="py-2 sm:py-4"
        />
        <QHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          active={q.conversationId}
        />

        {voice.notice !== null ? (
          <InlineNotice tone="warning" title={voice.notice}>
            <Button size="compact" variant="quiet" onClick={voice.clearNotice}>
              Dismiss
            </Button>
          </InlineNotice>
        ) : null}

        {showSuggestions ? (
          <ul
            aria-label="Suggested questions"
            className="flex flex-wrap justify-center gap-2"
            data-q-suggestions
          >
            {context.suggestions.map((suggestion) => (
              <li key={suggestion}>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => void q.ask(suggestion)}
                >
                  {suggestion}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {spokenOnly.length > 0 ? (
          <ol className="flex flex-col gap-4" aria-label="Spoken">
            {spokenOnly.map((line) => (
              <li
                key={line.id}
                className={
                  line.role === "user"
                    ? "flex flex-col items-end gap-1"
                    : "flex flex-col gap-1"
                }
              >
                <span className="cq-label text-(--cq-text-tertiary)">
                  {line.role === "user" ? "You" : "Q"}
                </span>
                <p
                  className={
                    line.role === "user"
                      ? "cq-body max-w-(--cq-layout-narrow) rounded-lg bg-(--cq-surface-sunken) px-3 py-2 text-(--cq-text-primary)"
                      : "cq-body max-w-(--cq-layout-narrow) whitespace-pre-wrap text-(--cq-text-primary)"
                  }
                >
                  {line.text}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
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
                {turn.kind === "PERSON" ? (
                  <>
                    <span className="cq-label text-(--cq-text-tertiary)">
                      You
                    </span>
                    <p
                      className="cq-body max-w-(--cq-layout-narrow) rounded-lg bg-(--cq-surface-sunken) px-3 py-2 text-(--cq-text-primary)"
                      data-unconfirmed={turn.unconfirmed ? "true" : undefined}
                    >
                      {turn.text}
                    </p>
                  </>
                ) : (
                  <QAnswer
                    turn={turn}
                    onAsk={(question) => void q.ask(question)}
                    onOpenArtifact={showArtifact}
                  />
                )}
              </li>
            ))}
            <div ref={endRef} />
          </ol>
        ) : null}

        {q.loading && turns.length === 0 ? (
          <p className="cq-body-sm text-center text-(--cq-text-tertiary)">
            Opening your conversation…
          </p>
        ) : null}

        {q.working ? (
          <div className="flex items-center justify-end gap-3">
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
          <InlineNotice
            tone="info"
            title={describeQStreamTransport(q.transport)}
          >
            Your conversation is saved. This is the connection, not the answer.
          </InlineNotice>
        ) : null}

        {q.state.failure !== null ? (
          <InlineNotice tone="warning" title="Q couldn't finish that">
            {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
          </InlineNotice>
        ) : null}

        {q.state.approval !== null
          ? (() => {
              // What Q has prepared and is waiting on (CQ-Q-008, ADR 0011).
              // The summary and preview are the server's own words for the
              // exact payload the decision binds to; nothing here rewrites
              // them. One yes applies it; one no leaves everything as it was.
              const approval = q.state.approval;
              const proposal = q.state.proposals.find(
                (candidate) => candidate.proposalId === approval.proposalId,
              );
              return (
                <InlineNotice
                  tone="info"
                  title={
                    proposal?.summary ??
                    "Q has prepared something for you to approve."
                  }
                >
                  <div className="flex flex-col gap-3" data-q-approval>
                    {proposal?.preview !== undefined ? (
                      <pre className="cq-body whitespace-pre-wrap font-sans">
                        {proposal.preview}
                      </pre>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="compact"
                        onClick={() => {
                          act();
                          void q.approve();
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="compact"
                        variant="secondary"
                        onClick={() => void q.decline()}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </InlineNotice>
              );
            })()
          : null}

        {q.notice !== null && q.state.failure === null ? (
          <InlineNotice tone="warning" title="That didn't go through">
            {q.notice}
          </InlineNotice>
        ) : null}

        <div className="cq-q-composer-dock">
          <QComposer
            id={COMPOSER_ID}
            contextScope={context.scope}
            contextDetail={context.label}
            disabled={q.working}
            placeholder={
              voice.active ? "Type instead — Q hears this too" : "Or type to Q"
            }
            attachments={attachments}
            {...(connected && context.companyId !== undefined
              ? { onAttach: attach, attachLabel: "Attach a document" }
              : {})}
            {...(connected
              ? {
                  onSubmit: voice.active
                    ? (text: string) => {
                        voice.client.sendText(text);
                      }
                    : q.ask,
                }
              : {})}
          />
        </div>
      </div>

      {openArtifact === null ? null : (
        <div className="flex min-w-0 flex-1 flex-col lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)]">
          <ArtifactViewer artifactId={openArtifact} onClose={closeArtifact} />
        </div>
      )}
    </div>
  );
}
