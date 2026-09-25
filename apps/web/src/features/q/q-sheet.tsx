"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { QConversationIdSchema } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import {
  ICON_SIZE,
  ICON_STROKE,
  Mic,
  MicOff,
  Square,
} from "@capital-q/ui/icons";
import { QComposer } from "@capital-q/ui/q-composer";
import { InlineNotice } from "@capital-q/ui/states";
import { Tooltip } from "@capital-q/ui/tooltip";

import { presenceStateFromVoice, type QPresenceState } from "../q-presence";
import { QPresence } from "../q-presence";
import { upsertLine, VOICE_STATE_LABELS } from "../voice/session";
import { useVoiceInterview } from "../voice/use-voice-interview";
import {
  readActiveConversation,
  rememberActiveConversation,
  type QSurfaceKey,
} from "./active-conversation";
import { Q_CONVERSATION_PARAM } from "./chats-list";
import { failureMessage, recoveryHint, turnsFrom } from "./conversation";
import { QAnswer } from "./q-answer";
import type { QSubject } from "./q-subject";
import { spokenNotYetStored, type SpokenLine } from "./spoken";
import { useQConversation } from "./use-q-conversation";

/**
 * Q from anywhere: the same conversation runtime as Home, in a sheet,
 * about whatever the page is looking at.
 *
 * The subject is the page's declaration or the person's own, handed in
 * by the shell; it is an input the Q API resolves and authorises again,
 * never a grant. The conversation the server names is kept only while
 * the sheet is open, and "Open in Home" carries it to the full surface
 * — one thread, wherever it was started. Voice and typing share it here
 * exactly as they do on Home.
 */

/** One thread per subject the sheet is about; the person's own when none. */
function sheetSurface(subject: QSubject): QSurfaceKey {
  switch (subject.kind) {
    case "COMPANY":
      return `sheet:company:${subject.companyId}`;
    case "INVESTOR_ORGANISATION":
      return `sheet:investor:${subject.investorOrganisationId}`;
    case "NONE":
      return "sheet:none";
  }
}

export function QSheetConversation({
  subject,
  connected,
  onActivity,
  seed = null,
}: {
  readonly subject: QSubject;
  readonly connected: boolean;
  /** What Q is doing, for the presence in the chrome. */
  readonly onActivity?: ((state: QPresenceState) => void) | undefined;
  /** A draft question to open with; the person edits or sends it. */
  readonly seed?: string | null | undefined;
}) {
  const companyId = subject.kind === "COMPANY" ? subject.companyId : undefined;
  const investorOrganisationId =
    subject.kind === "INVESTOR_ORGANISATION"
      ? subject.investorOrganisationId
      : undefined;
  // The sheet's thread about this subject, for this tab: closing the sheet
  // or reloading the page used to drop it, so the next "Ask Q" about the
  // same company started a new chat. The sheet is only ever mounted by a
  // press in the browser, so reading the pointer while initialising state
  // cannot disagree with a server render.
  const surface = sheetSurface(subject);
  const [conversationId, setConversationId] = useState<string | null>(() =>
    readActiveConversation(surface),
  );
  // A different subject is a different thread; adjusted during render, as
  // React asks, so no effect writes one subject's thread under another's.
  const [surfaceFor, setSurfaceFor] = useState(surface);
  if (surfaceFor !== surface) {
    setSurfaceFor(surface);
    setConversationId(readActiveConversation(surface));
  }
  const q = useQConversation({
    companyId,
    investorOrganisationId,
    conversationId,
    onConversation: setConversationId,
  });
  const activeConversation = q.conversationId;
  const settledOpen = !q.loading;
  useEffect(() => {
    if (!settledOpen) return;
    if (activeConversation !== null && activeConversation === conversationId) {
      rememberActiveConversation(surface, activeConversation);
    } else if (activeConversation === null && conversationId !== null) {
      // Asked to open one and it did not: the Q API refused it. Forgotten,
      // so the next "Ask Q" here starts clean instead of failing again.
      rememberActiveConversation(surface, null);
    }
  }, [surface, activeConversation, conversationId, settledOpen]);
  const turns = turnsFrom(q.state, q.pending);
  const endRef = useRef<HTMLDivElement>(null);

  const [spoken, setSpoken] = useState<readonly SpokenLine[]>([]);
  const voice = useVoiceInterview({
    onLine: (line) => {
      setSpoken((current) =>
        upsertLine(current, { id: line.id, role: line.role, text: line.text }),
      );
    },
  });
  // The spoken turns live in a conversation the server names; once it
  // does, this sheet is in that conversation too. Adjusted during render,
  // as React asks, so the hook below sees it on the same pass.
  const voiceConversationId = voice.turn?.conversationId;
  if (
    voiceConversationId !== undefined &&
    voiceConversationId !== conversationId
  ) {
    setConversationId(voiceConversationId);
  }
  // The line ends with the sheet; a microphone left open behind a closed
  // panel is exactly the thing a person would not expect.
  const endVoice = voice.end;
  useEffect(() => () => void endVoice(), [endVoice]);

  const talk = async () => {
    const named = QConversationIdSchema.safeParse(
      q.conversationId ?? undefined,
    ).data;
    await voice.talk({
      thread: {
        ...(companyId !== undefined
          ? { subjects: [{ kind: "COMPANY" as const, companyId }] }
          : investorOrganisationId !== undefined
            ? {
                subjects: [
                  {
                    kind: "INVESTOR_ORGANISATION" as const,
                    investorOrganisationId,
                  },
                ],
              }
            : {}),
        ...(named === undefined ? {} : { conversationId: named }),
      },
      firstMessage: "I'm listening. What would you like to know?",
    });
  };

  const presenceState: QPresenceState = voice.active
    ? presenceStateFromVoice(voice.client.state)
    : q.working
      ? "THINKING"
      : q.state.failure !== null
        ? "ERROR"
        : "IDLE";
  useEffect(() => {
    onActivity?.(presenceState);
  }, [presenceState, onActivity]);
  const presenceLabel = voice.active
    ? voice.client.muted
      ? "Muted"
      : VOICE_STATE_LABELS[voice.client.state]
    : q.working
      ? "Thinking"
      : q.state.failure !== null
        ? "Couldn't finish that"
        : "Ready";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, spoken.length, q.state.partial?.text]);

  const spokenOnly = spokenNotYetStored(
    spoken,
    turns.map((turn) => turn.text),
  );
  const openInHome =
    q.conversationId === null
      ? "/home"
      : `/home?${Q_CONVERSATION_PARAM}=${encodeURIComponent(q.conversationId)}`;

  return (
    <div className="flex min-h-full flex-col gap-4" data-q-sheet>
      <div className="flex items-center gap-4">
        <QPresence
          state={presenceState}
          size="md"
          inputLevel={voice.client.inputLevel}
          outputLevel={voice.client.outputLevel}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="cq-label text-(--cq-text-primary)" role="status">
            {presenceLabel}
          </span>
          <ContextIndicator
            scope={subject.scope}
            detail={subject.kind === "NONE" ? undefined : subject.label}
          />
        </div>
        {connected ? (
          <Tooltip content={voice.active ? "End voice" : "Talk with Q"}>
            <IconButton
              aria-label={voice.active ? "End voice" : "Talk with Q"}
              variant={voice.active ? "secondary" : "primary"}
              className="rounded-full"
              onClick={
                voice.active ? () => void voice.end() : () => void talk()
              }
              data-q-control={voice.active ? "end" : "talk"}
            >
              {voice.active ? (
                <Square aria-hidden="true" size={ICON_SIZE.prominent} />
              ) : (
                <Mic
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              )}
            </IconButton>
          </Tooltip>
        ) : null}
        {voice.active ? (
          <Tooltip
            content={
              voice.client.muted ? "Unmute microphone" : "Mute microphone"
            }
          >
            <IconButton
              aria-label={
                voice.client.muted ? "Unmute microphone" : "Mute microphone"
              }
              variant="quiet"
              className={cx(
                "rounded-full",
                voice.client.muted ? "bg-(--cq-accent-soft)" : "",
              )}
              aria-pressed={voice.client.muted}
              onClick={() => voice.client.setMuted(!voice.client.muted)}
              data-q-control="mute"
            >
              {voice.client.muted ? (
                <MicOff aria-hidden="true" size={ICON_SIZE.prominent} />
              ) : (
                <Mic
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              )}
            </IconButton>
          </Tooltip>
        ) : null}
      </div>

      {voice.notice !== null ? (
        <InlineNotice tone="warning" title={voice.notice}>
          <Button size="compact" variant="quiet" onClick={voice.clearNotice}>
            Dismiss
          </Button>
        </InlineNotice>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {turns.length === 0 && spokenOnly.length === 0 && !q.working ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {subject.kind === "NONE"
              ? "Ask Q anything about what you're looking at."
              : `Ask Q about ${subject.label ?? "this"} — what it says, what is missing, what to do next.`}
          </p>
        ) : null}
        {spokenOnly.length > 0 ? (
          <ol className="flex flex-col gap-3" aria-label="Spoken">
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
                      ? "cq-body-sm rounded-lg bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-primary)"
                      : "cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)"
                  }
                >
                  {line.text}
                </p>
              </li>
            ))}
          </ol>
        ) : null}
        {turns.length > 0 ? (
          <ol className="flex flex-col gap-3" aria-live="polite">
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
                    <p className="cq-body-sm rounded-lg bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-primary)">
                      {turn.text}
                    </p>
                  </>
                ) : (
                  <QAnswer
                    turn={turn}
                    onAsk={(question) => void q.ask(question)}
                  />
                )}
              </li>
            ))}
            <div ref={endRef} />
          </ol>
        ) : null}
        {q.state.failure !== null ? (
          <InlineNotice tone="warning" title="Q couldn't finish that">
            {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
          </InlineNotice>
        ) : null}
        {q.notice !== null && q.state.failure === null ? (
          <InlineNotice tone="warning" title="That didn't go through">
            {q.notice}
          </InlineNotice>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2 bg-(--cq-surface-raised) pt-2">
        <QComposer
          // A new draft is a new starting point, not an edit of the last.
          key={seed ?? ""}
          {...(seed === null ? {} : { initialValue: seed, autoFocus: true })}
          id="shell-q"
          contextScope={subject.scope}
          contextDetail={subject.kind === "NONE" ? undefined : subject.label}
          disabled={q.working}
          placeholder={
            voice.active ? "Type instead — Q hears this too" : "Ask Q"
          }
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
        <div className="flex justify-end">
          <Link
            href={openInHome}
            className="cq-caption text-(--cq-text-secondary) underline-offset-2 hover:underline"
          >
            Open in Home
          </Link>
        </div>
      </div>
    </div>
  );
}
