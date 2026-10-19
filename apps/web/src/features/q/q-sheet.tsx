"use client";

import Link from "next/link";
import { useRef } from "react";

import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import {
  ICON_SIZE,
  ICON_STROKE,
  Mic,
  MicOff,
  Move,
  Square,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";
import { QComposer } from "@capital-q/ui/q-composer";
import { InlineNotice } from "@capital-q/ui/states";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ViewTransition } from "@/components/view-transition";

import { QAperture, QLumen } from "../q-aperture";
import { useDockMenu } from "../q-dock/use-dock-menu";
import { interceptTyped } from "./typed-intercept";
import { homeHref } from "./active-conversation";
import { failureMessage, recoveryHint } from "./conversation";
import { useAnchorQuestion } from "./follow-newest";
import { QAnswer } from "./q-answer";
import { QNow } from "./q-now";
import { QCanSee } from "./q-can-see";
import { viewingOf, type QMoment } from "./q-moment";
import { useQSession } from "./q-session";
import { readTypedDraft } from "./control/fast-navigation";
import { useT } from "@/features/i18n/language";

/**
 * Q beside the page: the dock's expanded view of the one conversation
 * store (ADR 0017 F1; spec §6.1, §6.4).
 *
 * The same conversation the Q page shows, about whatever this page is
 * looking at. "Open Q" carries it to the Q page with nothing read again:
 * the aperture here becomes the stage's, and a voice line stays open.
 */

export function QSheetConversation({
  connected,
  seed = null,
  moment = null,
  inline = false,
  placeholder,
}: {
  readonly connected: boolean;
  /**
   * Inside a page's own panel (Discover A's Ask Q over the dossier): the
   * conversation and its composer only -- the page pins the subject and
   * owns the way out, so the dock's header and footer are not repeated.
   */
  readonly inline?: boolean | undefined;
  /** The composer's words, when the host names the subject ("Ask about X…"). */
  readonly placeholder?: string | undefined;
  /** A draft question to open with; the person edits or sends it. */
  readonly seed?: string | null | undefined;
  /** Where in a pitch the person was when this opening happened. */
  readonly moment?: QMoment | null | undefined;
}) {
  const t = useT();
  const session = useQSession();
  const { q, turns, voice, subject, presence, spokenOnly } = session;
  const dockMenu = useDockMenu();

  const label = presence.label ?? "Ready";
  // What is being said now: the person's latest words (spoken or typed)
  // and Q's answer to them, when it has come.
  const lastPersonTurn = turns.findLast((turn) => turn.kind === "PERSON");
  const lastSpoken = spokenOnly.findLast((line) => line.role === "user");
  const lastPerson = lastSpoken?.text ?? lastPersonTurn?.text;
  const latestQ = turns.findLast((turn) => turn.kind === "Q");
  const latestAnswer =
    latestQ?.kind === "Q" &&
    turns.indexOf(latestQ) >
      turns.findLastIndex((turn) => turn.kind === "PERSON")
      ? latestQ
      : undefined;

  // Owner 2026-10-17: the question goes to the top and stays put while the
  // answer arrives beneath it; the panel never chases the newest line.
  const questionRef = useRef<HTMLParagraphElement>(null);
  useAnchorQuestion(
    questionRef,
    lastPersonTurn?.id ?? lastSpoken?.text ?? undefined,
  );

  return (
    <div className="flex min-h-full flex-col gap-4" data-q-sheet>
      {/* Q is listening: the edge light on the panel's side. */}
      <QLumen
        active={voice.active}
        input={voice.client.inputLevel}
        output={voice.client.outputLevel}
        side="right"
      />
      {inline ? null : (
        <div className="flex items-center gap-4">
          <ViewTransition name="q-aperture" share="cq-q-morph" default="none">
            <QAperture
              state={presence.state}
              size="panel"
              inputLevel={voice.client.inputLevel}
              outputLevel={voice.client.outputLevel}
            />
          </ViewTransition>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="cq-label text-(--cq-text-primary)" role="status">
              {label}
            </span>
            {/* Q room R1: what Q sees of the page behind the dock. */}
            <QCanSee />
          </div>
          {connected ? (
            <Tooltip content={t(voice.active ? "End voice" : "Talk with Q")}>
              <IconButton
                aria-label={t(voice.active ? "End voice" : "Talk with Q")}
                variant={voice.active ? "secondary" : "primary"}
                onClick={
                  voice.active
                    ? () => void voice.end()
                    : () => void session.talk()
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
                  "",
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
      )}

      {voice.notice !== null ? (
        <InlineNotice tone="warning" title={voice.notice}>
          <Button size="compact" variant="quiet" onClick={voice.clearNotice}>
            {t("Dismiss")}
          </Button>
        </InlineNotice>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {!inline &&
        turns.length === 0 &&
        spokenOnly.length === 0 &&
        !q.working ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {subject.kind === "NONE"
              ? "Ask Q anything about what you're looking at."
              : `Ask Q about ${subject.label ?? "this"} — what it says, what is missing, what to do next.`}
          </p>
        ) : null}
        {/* The current exchange, then the compact Board (spec §6.1): what
            Q is saying now in full, what it has produced as objects. The
            whole conversation is the Q page's Transcript. */}
        {lastPerson !== undefined ? (
          <p
            ref={questionRef}
            // Two lines: a long prepared question (Full assessment, Risks
            // and gaps) is the reader's, not the answer; it no longer
            // pushes the answer below the fold. The full words stay in the
            // title and the Q page's transcript.
            title={lastPerson}
            className="cq-body-sm self-end scroll-mt-3 bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-primary)"
            data-q-panel-person
          >
            {/* Clamped inside the padding: clamping the padded box itself
                shows half of the third line in its bottom padding. */}
            <span className="line-clamp-2">
              <span className="sr-only">{t("You:")} </span>
              {lastPerson}
            </span>
          </p>
        ) : null}
        {latestAnswer !== undefined ? (
          <div aria-live="polite">
            <QAnswer
              turn={latestAnswer}
              cardsInline
              onAsk={(question) => void q.ask(question)}
              onOpenArtifact={session.openArtifact}
            />
          </div>
        ) : null}
        {/* What waits on the person, decided here (QA 2026-10-01: in the
            dock a prepared change showed "Approval needed" with no card,
            so it could be approved only on the Q page or by typing). */}
        <QNow
          session={session}
          onAct={(text) => void q.ask(text)}
          quietWhenIdle
        />
        {/* The Board is the Q page's (Open Q): beside a page the panel holds
            the question, its answer and what waits on the person, nothing
            older (owner 2026-10-17: declutter the panel). */}
        {q.state.failure !== null ? (
          <InlineNotice tone="warning" title={t("Q couldn't finish that")}>
            {failureMessage(q.state.failure)} {recoveryHint(q.state.failure)}
          </InlineNotice>
        ) : null}
        {q.notice !== null && q.state.failure === null ? (
          <InlineNotice tone="warning" title={t("That didn't go through")}>
            {q.notice}
          </InlineNotice>
        ) : null}
      </div>

      <div
        // Sticks over the sheet's own bottom padding too (-bottom-4 with
        // that padding added back): stuck at bottom-0, a long answer showed
        // through the 16px strip beneath the composer.
        className="sticky -bottom-4 z-(--cq-z-sticky) flex flex-col gap-2 bg-(--cq-surface-raised) pt-2 pb-[calc(max(8px,var(--cq-safe-bottom))+1rem)]"
        // Latency: a record named as they type is resolved and its page
        // prefetched before Send (fast-navigation.ts).
        onInput={readTypedDraft}
      >
        <QComposer
          // A new draft is a new starting point, not an edit of the last.
          key={seed ?? ""}
          {...(seed === null ? {} : { initialValue: seed, autoFocus: true })}
          id="shell-q"
          contextScope={subject.scope}
          contextDetail={subject.kind === "NONE" ? undefined : subject.label}
          disabled={q.working}
          placeholder={
            voice.active ? t("Type instead") : (placeholder ?? t("Ask Q"))
          }
          {...(inline ? { showContext: false } : {})}
          {...(connected
            ? {
                // Only a connected line carries typed words (live
                // 2026-09-30); otherwise they are asked as a question.
                onSubmit:
                  voice.active && voice.client.connected
                    ? (text: string) => {
                        if (interceptTyped(text)) return;
                        voice.client.sendText(text);
                      }
                    : (text: string) =>
                        interceptTyped(text)
                          ? Promise.resolve()
                          : q.ask(
                              text,
                              moment === null
                                ? undefined
                                : { viewing: viewingOf(moment) },
                            ),
              }
            : {})}
        />
        {inline ? null : (
          <div className="flex items-center justify-between gap-2">
            <MenuRoot>
              <MenuTrigger>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 px-2 cq-caption text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
                  data-q-dock-menu
                >
                  <Move
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                  {t("Move Q")}
                </button>
              </MenuTrigger>
              <MenuContent>
                {dockMenu.items.map((item) => (
                  <MenuItem key={item.label} onClick={item.run}>
                    {item.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuRoot>
            <Link
              href={homeHref(q.conversationId)}
              className="inline-flex min-h-11 items-center px-2 cq-label text-(--cq-accent) underline-offset-2 hover:underline"
              data-q-open-page
            >
              {t("Open Q")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
