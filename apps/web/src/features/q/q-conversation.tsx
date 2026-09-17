"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { describeQStreamTransport } from "@capital-q/api-client";
import { QConversationIdSchema } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { QComposer } from "@capital-q/ui/q-composer";
import { QStateIndicator } from "@capital-q/ui/q-state";
import { InlineNotice } from "@capital-q/ui/states";
import type { ContextScope } from "@capital-q/ui/tokens";

import { destinationPath } from "../voice/destinations";
import { useFollowTurn } from "../voice/use-follow-turn";
import { useVoiceInterview } from "../voice/use-voice-interview";
import { VoiceStage } from "../voice/voice-stage";
import { QAnswer } from "./q-answer";
import {
  failureMessage,
  recoveryHint,
  turnsFrom,
  workingLabel,
} from "./conversation";
import { useQConversation } from "./use-q-conversation";

type SpokenLine = {
  readonly id: string;
  readonly role: "user" | "q";
  readonly text: string;
};

/**
 * Q, in the browser (CQ-C5-R1 §13-§19; CQ-PRE-REC-001 §12-§13).
 *
 * The composer connected to the real thing: a real run, a real stream, a
 * real answer, and the same conversation for the next question. The
 * conversation is the primary surface: before the first turn a few
 * contextual suggestions sit above the composer; after it they recede, and
 * the thread takes the space. The composer stays reachable — sticky at the
 * bottom of the workspace, above the mobile navigation — so a long answer
 * never pushes the next question off the screen.
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
};

export function QConversationPanel({
  connected,
  context,
}: QConversationPanelProps) {
  const q = useQConversation({
    companyId: context.companyId,
    investorOrganisationId: context.investorOrganisationId,
  });
  const turns = turnsFrom(q.state, q.pending);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Voice (CQ-Q-VOICE-001): the same Q conversation, spoken. The credential
  // is bound on the server to this person, this subject and the
  // conversation this tab is already in; what is said either way is one
  // thread. Spoken lines are shown as they are transcribed.
  const [spoken, setSpoken] = useState<readonly SpokenLine[]>([]);
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

  // "Take me to my profile", said on Home: followed once Q has said so.
  const voiceEnd = voice.end;
  useFollowTurn(voice.turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void voiceEnd();
      return;
    }
    const path = destinationPath(followed.navigate);
    if (path !== null) {
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

  /**
   * A spoken line is shown only until the same words arrive as a stored
   * turn. Every voice turn becomes a stored turn, so without this each
   * thing the person said appeared twice: once from the transcript as
   * they said it, once from the conversation when it was recorded.
   */
  // Compared as words, not characters: the recogniser's transcript and
  // the recorded turn differ in punctuation, casing and spacing, and a
  // person's sentence shown twice for that was the most-noticed thing on
  // this screen (2026-09-17).
  const asWords = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const storedText = new Set(turns.map((turn) => asWords(turn.text)));
  const seenSpoken = new Set<string>();
  const spokenOnly = spoken.filter((line) => {
    const words = asWords(line.text);
    if (words.length === 0 || storedText.has(words)) {
      return false;
    }
    // The same words twice from the transcript itself is one line.
    const key = `${line.role}:${words}`;
    if (seenSpoken.has(key)) {
      return false;
    }
    seenSpoken.add(key);
    return true;
  });

  const stage = workingLabel(q.state);
  // Suggestions are an on-ramp, not a feature: gone after the first turn.
  const showSuggestions =
    connected && turns.length === 0 && !q.working && q.state.failure === null;

  return (
    <div className="flex flex-col gap-4" data-q-workspace>
      {voice.active ? (
        // Talking with Q on Home is the same stage as the interview: the
        // screen is Q, wherever the conversation started.
        <VoiceStage
          client={voice.client}
          voice={voice.voice}
          voices={["FEMALE", "MALE"]}
          onChooseVoice={(choice) => void voice.chooseVoice(choice)}
          onEnd={() => void voice.end()}
          notice={voice.notice}
          onDismissNotice={voice.clearNotice}
          asking={voice.turn?.asking ?? null}
          onSay={(text) => voice.client.sendText(text)}
          onUseForm={undefined}
          progress={[]}
        />
      ) : null}
      {!voice.active && voice.notice !== null ? (
        <InlineNotice tone="warning" title={voice.notice}>
          <Button size="compact" variant="quiet" onClick={voice.clearNotice}>
            Dismiss
          </Button>
        </InlineNotice>
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
                <QAnswer turn={turn} />
              )}
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
          {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
        </InlineNotice>
      ) : null}

      {q.notice !== null && q.state.failure === null ? (
        <InlineNotice tone="warning" title="That didn't go through">
          {q.notice}
        </InlineNotice>
      ) : null}

      {showSuggestions ? (
        <ul
          aria-label="Suggested questions"
          className="flex flex-wrap gap-2"
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

      <div className="cq-q-composer-dock">
        <QComposer
          id="home-q"
          contextScope={context.scope}
          contextDetail={context.label}
          disabled={q.working}
          onVoice={
            connected && !voice.active ? () => void talkWithQ() : undefined
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
      </div>
    </div>
  );
}
