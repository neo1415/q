"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import type {
  GateqVoiceSessionDto,
  GateqVoiceStateDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  endVoiceAction,
  startVoiceAction,
  voiceStateAction,
} from "./apply-actions";
import {
  GATEQ_VOICE_PROBLEMS,
  useGateqVoiceLine,
  type GateqVoiceLineState,
} from "@/features/voice/provider/gateq-voice-line";
import { deviceLocale } from "@/features/voice/device-locale";
import { useT } from "@/features/i18n/language";

/**
 * "Talk with Q": the GateQ voice-only interview (directive 2026-11-14 item
 * 4). Offered only when the server says voice is on for this application
 * and its allowance has a session left; otherwise it says why, or nothing,
 * and typing carries on. The microphone is asked for only after the person
 * presses Start. While the line is open, what Q and the person say is
 * shown as captions; Mute and End are always reachable. Every spoken
 * answer is a turn in the same interview, so ending (or a failure) hands
 * back to typing with nothing lost: `onEnded` reads the transcript again.
 *
 * Nothing animates here: states are words, so reduced motion needs no
 * separate path and no audio plays until the person starts the line.
 */
export function GateqVoiceEntry({
  token,
  fund,
  onLiveChange,
  onEnded,
}: {
  readonly token: string;
  readonly fund: string;
  /** The line opened (true) or closed (false): hide or show typing. */
  readonly onLiveChange?: ((live: boolean) => void) | undefined;
  /** After the line closes: read the transcript back. */
  readonly onEnded: () => Promise<void>;
}) {
  const t = useT();
  const [offer, setOffer] = useState<GateqVoiceStateDto | null>(null);
  const [session, setSession] = useState<GateqVoiceSessionDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);
  const consentHintId = useId();
  const headingId = useId();
  const [pending, startTransition] = useTransition();
  const liveChange = useRef(onLiveChange);
  const ended = useRef(onEnded);
  useEffect(() => {
    liveChange.current = onLiveChange;
    ended.current = onEnded;
  });

  const close = async (why: string | null) => {
    line.stop();
    setSession(null);
    setMessage(why);
    const result = await endVoiceAction(token, true).catch(() => null);
    if (result?.ok === true) setOffer(result.state);
    await ended.current();
  };

  const line = useGateqVoiceLine({
    onProblem: (problem) => {
      void close(GATEQ_VOICE_PROBLEMS[problem]);
    },
  });

  useEffect(() => {
    let live = true;
    void voiceStateAction(token)
      .then((result) => {
        if (live && result.ok) setOffer(result.state);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  const open = session !== null && session.status === "LIVE";
  useEffect(() => {
    liveChange.current?.(open);
  }, [open]);

  // The session's hard stop: the line closes itself, typing takes over.
  const endsAt = session === null ? null : Date.parse(session.endsAt);
  useEffect(() => {
    if (endsAt === null) return;
    const timer = window.setTimeout(
      () => {
        void close(
          "That's the time for this voice session. Everything you said is saved; carry on by typing.",
        );
      },
      Math.max(0, endsAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
    // close is stable enough for a timer keyed by the session's end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  if (open) {
    return (
      <section
        aria-labelledby={headingId}
        className="gq-card flex flex-col gap-3 p-4"
        data-gateq-voice="live"
      >
        <h2 id={headingId} className="cq-label text-(--cq-text-primary)">
          {t("Voice interview with Q")}
        </h2>
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {t(stateWords(line.state))}
          {line.muted ? ` ${t("Your microphone is muted.")}` : ""}
        </p>
        <p className="cq-caption text-(--cq-text-tertiary)">
          {t(
            `Q is an AI interviewer. What you say is transcribed into this application; nothing reaches ${fund} until you review and submit.`,
          )}{" "}
          {t(
            `This voice session ends at ${new Date(session.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
          )}
        </p>
        <ol
          role="log"
          aria-live="polite"
          aria-label={t("Captions")}
          className="flex max-h-64 flex-col gap-1 overflow-y-auto"
        >
          {line.captions.map((caption) => (
            <li key={caption.id} className="cq-body-sm">
              <span className="font-medium">
                {caption.from === "Q" ? "Q" : t("You")}:
              </span>{" "}
              {caption.text}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            aria-pressed={line.muted}
            onClick={() => line.setMuted(!line.muted)}
          >
            {line.muted ? t("Unmute") : t("Mute")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void close(null);
            }}
          >
            {t("End and continue by typing")}
          </Button>
        </div>
      </section>
    );
  }

  if (offer === null) return null;
  if (!offer.available) {
    const why = message ?? whyNoVoice(offer);
    return why === null ? null : (
      <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
        {t(why)}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
      data-gateq-voice="offer"
    >
      <p className="cq-label text-(--cq-text-primary)">
        {t("Rather talk than type?")}
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t(
          "Talk with Q by voice only, no camera. Q asks, you answer out loud; every answer goes into this same interview for you to review.",
        )}
      </p>
      <label className="cq-body-sm flex min-h-11 cursor-pointer items-start gap-3 text-(--cq-text-secondary)">
        <input
          ref={consentRef}
          type="checkbox"
          checked={consented}
          onChange={(event) => {
            setConsented(event.target.checked);
            if (event.target.checked) setAskConsent(false);
          }}
          aria-invalid={askConsent ? true : undefined}
          aria-describedby={askConsent ? consentHintId : undefined}
          className="mt-1 size-4 accent-(--cq-accent)"
        />
        <span>
          {t(
            `I understand Q is an AI interviewer, my microphone is used only while the voice line is open, and what I say is transcribed into this application. Nothing reaches ${fund} until I review and submit.`,
          )}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (!consented) {
              setAskConsent(true);
              consentRef.current?.focus();
              return;
            }
            startTransition(async () => {
              setMessage(null);
              const result = await startVoiceAction(
                token,
                deviceLocale().locale,
              );
              if (!result.ok || result.state.line == null) {
                setMessage(
                  result.ok
                    ? "Voice isn't available right now. You can continue by typing."
                    : result.message,
                );
                setOffer((current) =>
                  current === null ? current : { ...current, available: false },
                );
                return;
              }
              setSession(result.state.session);
              const up = await line.start(result.state.line);
              if (!up) setSession(null);
            });
          }}
        >
          {pending ? t("Opening the voice line…") : t("Talk with Q")}
        </Button>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t(
            offer.remaining === 1
              ? "One voice session left for this application."
              : `${String(offer.remaining)} voice sessions left for this application.`,
          )}
        </span>
      </div>
      {askConsent ? (
        <p
          id={consentHintId}
          role="status"
          className="cq-body-sm text-(--cq-text-primary)"
        >
          {t("Tick the box above to start talking with Q.")}
        </p>
      ) : null}
      {message === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {t(message)}
        </p>
      )}
    </div>
  );
}

function stateWords(state: GateqVoiceLineState): string {
  switch (state) {
    case "CONNECTING":
      return "Connecting…";
    case "LISTENING":
      return "Listening.";
    case "THINKING":
      return "Q is thinking.";
    case "Q_SPEAKING":
      return "Q is speaking.";
    case "IDLE":
    case "ENDED":
    case "FAILED":
      return "The voice line is closed.";
  }
}

/** Plain words for why voice is not offered; null when there is nothing to say. */
export function whyNoVoice(state: GateqVoiceStateDto): string | null {
  switch (state.unavailableReason) {
    case "APPLICATION_SESSIONS_USED":
      return "You've used this application's voice sessions. Carry on by typing; everything you said is kept.";
    case "BUSY":
    case "PROVIDER_UNAVAILABLE":
      return "Voice isn't available right now. You can continue by typing.";
    case "NOT_OFFERED":
    case "SUBMITTED":
    case null:
      return null;
  }
}
