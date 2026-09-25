"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
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
import { homeHref } from "./active-conversation";
import { failureMessage, recoveryHint } from "./conversation";
import { QAnswer } from "./q-answer";
import { useQSession } from "./q-session";

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
}: {
  readonly connected: boolean;
  /** A draft question to open with; the person edits or sends it. */
  readonly seed?: string | null | undefined;
}) {
  const session = useQSession();
  const { q, turns, voice, subject, presence, spokenOnly } = session;
  const endRef = useRef<HTMLDivElement>(null);
  const dockMenu = useDockMenu();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, spokenOnly.length, q.state.partial?.text]);

  const label = presence.label ?? "Ready";

  return (
    <div className="flex min-h-full flex-col gap-4" data-q-sheet>
      {/* Q is listening: the edge light on the panel's side. */}
      <QLumen
        active={voice.active}
        input={voice.client.inputLevel}
        output={voice.client.outputLevel}
        side="right"
      />
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
        <div className="flex items-center justify-between gap-2">
          <MenuRoot>
            <MenuTrigger>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 cq-caption text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
                data-q-dock-menu
              >
                <Move
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                Move Q
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
            className="inline-flex min-h-11 items-center rounded-md px-2 cq-label text-(--cq-accent) underline-offset-2 hover:underline"
            data-q-open-page
          >
            Open Q
          </Link>
        </div>
      </div>
    </div>
  );
}
