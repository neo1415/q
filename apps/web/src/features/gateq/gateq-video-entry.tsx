"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import type {
  ApplicationCoverageDto,
  GateqVideoSessionDto,
  GateqVideoStateDto,
  VideoAllowanceDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  endVideoAction,
  startVideoAction,
  videoStateAction,
} from "./apply-actions";
import {
  videoAllowanceLine,
  videoAllowanceUsedUp,
} from "@/features/video-room/video-allowance";

import { GateqVideoRoom } from "./gateq-video-room";
import { deviceLocale } from "@/features/voice/device-locale";
import { useT } from "@/features/i18n/language";

/**
 * The way into the GateQ video interview (C3). It appears only when the
 * server says video is offered for this application (switched on,
 * configured, allowance left) or a session is already live, in which case
 * it reopens that same session: a refresh never starts a second room or
 * restarts the clock. Typing is always the fallback and carries on the
 * same canonical interview.
 *
 * `aside` (default) is the offer beside a typed interview. `primary`
 * (owner, 2026-10-15) makes video the default way to do the interview:
 * the offer is the step's main action, and the caller is told when to show
 * typing instead (not offered, refused, cap reached, or the person's
 * choice) through `onUnavailable` / `onTypeInstead`.
 */
/** The device language does not change while the page is open. */
const noLanguageChanges = () => () => undefined;

export function GateqVideoEntry({
  token,
  fund,
  coverage,
  participantName,
  onEnded,
  variant = "aside",
  onUnavailable,
  onTypeInstead,
  onRoomChange,
}: {
  readonly token: string;
  readonly fund: string;
  readonly coverage: ApplicationCoverageDto | null;
  readonly participantName: string;
  /** After the room closes: refresh the transcript; `typed` false → review. */
  readonly onEnded: (typed: boolean) => Promise<void>;
  readonly variant?: "aside" | "primary";
  /** Video is not offered; `why` is what to tell the person, if known. */
  readonly onUnavailable?: ((why: string | null) => void) | undefined;
  /** The person chose to type (primary only). */
  readonly onTypeInstead?: (() => void) | undefined;
  /** The room opened (true) or closed (false). */
  readonly onRoomChange?: ((open: boolean) => void) | undefined;
}) {
  const t = useT();

  const primary = variant === "primary";
  const [checked, setChecked] = useState(false);
  const [available, setAvailable] = useState(false);
  const [allowance, setAllowance] = useState<VideoAllowanceDto | null>(null);
  const [session, setSession] = useState<GateqVideoSessionDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  // Lane ml: an Arabic device is told how an Arabic video room behaves.
  // Read after mount: the server has no device language.
  const arabic = useSyncExternalStore(
    noLanguageChanges,
    () => /^ar\b/iu.test(deviceLocale().locale ?? ""),
    () => false,
  );
  // Pressed Start before ticking consent: ask for it, beside the box.
  const [askConsent, setAskConsent] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);
  const consentHintId = useId();
  const [pending, startTransition] = useTransition();
  // Latest callbacks, so the state read runs once per token.
  const unavailable = useRef(onUnavailable);
  const roomChange = useRef(onRoomChange);
  useEffect(() => {
    unavailable.current = onUnavailable;
    roomChange.current = onRoomChange;
  });

  useEffect(() => {
    let live = true;
    void videoStateAction(token)
      .then((result) => {
        if (!live) return;
        setChecked(true);
        if (!result.ok) {
          unavailable.current?.(null);
          return;
        }
        setAvailable(result.state.available);
        setAllowance(result.state.allowance ?? null);
        // Recovery: a live session reopens in its room with its own clock.
        if (result.state.session?.status === "LIVE")
          setSession(result.state.session);
        else if (!result.state.available) {
          const why = whyNotOffered(result.state);
          setWhy(why);
          unavailable.current?.(why);
        }
      })
      .catch(() => {
        if (!live) return;
        setChecked(true);
        unavailable.current?.(null);
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Q is still joining: the server starts the clock when Q is in the room,
  // so re-read the session until it says when (bounded by its hard stop).
  const joining = session?.status === "LIVE" && session.liveAt === null;
  useEffect(() => {
    if (!joining) return;
    let live = true;
    const timer = window.setInterval(() => {
      void videoStateAction(token).then((result) => {
        if (!live || !result.ok) return;
        const next = result.state.session;
        if (next?.status === "LIVE" && next.liveAt !== null) setSession(next);
      });
    }, 3_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [joining, token]);

  const roomOpen = session !== null && session.status === "LIVE";
  useEffect(() => {
    roomChange.current?.(roomOpen);
  }, [roomOpen]);

  if (session !== null && session.status === "LIVE") {
    return (
      <GateqVideoRoom
        fund={fund}
        session={session}
        coverage={coverage}
        participantName={participantName}
        onEnd={async (typed) => {
          const result = await endVideoAction(token, typed);
          if (!result.ok) return { message: result.message };
          setSession(null);
          setAvailable(false);
          await onEnded(typed);
          return {};
        }}
      />
    );
  }
  if (primary && !checked) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <div className="gq-sk" style={{ width: "60%", height: 20 }} />
        <div className="gq-sk" style={{ width: "40%", height: 44 }} />
      </div>
    );
  }
  // Primary: the caller already shows typing, with the reason.
  if (primary && !available) return null;
  if (!available) {
    // Typing is never limited; say why video is not offered when we know.
    const said =
      message ??
      why ??
      (allowance?.remaining === 0
        ? `${videoAllowanceUsedUp(allowance)} You can carry on by typing.`
        : null);
    return said === null ? null : (
      <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
        {t(said)}
      </p>
    );
  }

  return (
    <div
      className={
        primary
          ? "gq-card flex flex-col gap-3 p-4"
          : "flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
      }
      data-gateq-video-entry={variant}
    >
      <p className="cq-label text-(--cq-text-primary)">
        {primary
          ? t("Talk it through with Q")
          : t("Prefer to talk it through?")}
      </p>
      {primary ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            `A short video conversation, the way you would pitch ${fund} in person. Q asks, you answer out loud; every answer is written into this application for you to review.`,
          )}
        </p>
      ) : null}
      {videoAllowanceLine(allowance) === null ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          {videoAllowanceLine(allowance)}
        </p>
      )}
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
            `I understand Q is an AI interviewer, my camera and microphone are used only while the video room is open, and what I say is transcribed into this application. Nothing reaches ${fund} until I review and submit.`,
          )}
        </span>
      </label>
      {arabic ? (
        <p
          lang="ar"
          dir="rtl"
          className="cq-body-sm text-(--cq-text-secondary)"
        >
          تجري المقابلة المرئية بالعربية، ويعتمد وضوحها على صوت الوجه المختار؛
          إن لم يبدُ مناسباً فيمكنك المتابعة بالكتابة.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={primary ? "primary" : "secondary"}
          // Never a greyed primary (live check 2026-10-16: it lost to
          // "Skip to review"). Without consent, pressing it asks for the
          // box above and moves focus there; nothing starts.
          disabled={pending}
          onClick={() => {
            if (!consented) {
              setAskConsent(true);
              consentRef.current?.focus();
              return;
            }
            startTransition(async () => {
              setMessage(null);
              const result = await startVideoAction(
                token,
                deviceLocale().locale,
              );
              if (!result.ok) {
                setMessage(result.message);
                setAvailable(false);
                onUnavailable?.(result.message);
                return;
              }
              if (result.state.session?.status === "LIVE")
                setSession(result.state.session);
              else {
                const why =
                  "Video isn't available right now. You can continue by typing.";
                setMessage(why);
                if (primary) {
                  setAvailable(false);
                  onUnavailable?.(why);
                }
              }
            });
          }}
        >
          {pending
            ? t("Opening the video room…")
            : primary
              ? t("Start the video interview")
              : t("Continue by video")}
        </Button>
        {primary && onTypeInstead !== undefined ? (
          <Button variant="quiet" disabled={pending} onClick={onTypeInstead}>
            {t("Type my answers instead")}
          </Button>
        ) : (
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t("Short sessions; typing stays available.")}
          </span>
        )}
      </div>
      {askConsent ? (
        <p
          id={consentHintId}
          role="status"
          className="cq-body-sm text-(--cq-text-primary)"
        >
          {t("Tick the box above to start the video interview.")}
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

/** Plain words for why video is not offered; null when there is nothing to say. */
export function whyNotOffered(state: GateqVideoStateDto): string | null {
  switch (state.unavailableReason) {
    case "APPLICATION_SESSIONS_USED": {
      const n = state.perApplication ?? 1;
      return `You’ve used ${n === 1 ? "this application’s video session" : `the ${String(n)} video sessions this application allows`}. Carry on by typing; everything you said is kept.`;
    }
    case "WEEKLY_ALLOWANCE_USED":
      return state.allowance === null || state.allowance === undefined
        ? "You’ve used this week’s video sessions. You can carry on by typing."
        : `${videoAllowanceUsedUp(state.allowance)} You can carry on by typing.`;
    case "SUBMITTED":
    case "NOT_OFFERED":
      return null;
    case null:
    case undefined:
      // An older API without a reason: the allowance is the one we can name.
      return state.allowance !== null &&
        state.allowance !== undefined &&
        state.allowance.remaining === 0
        ? `${videoAllowanceUsedUp(state.allowance)} You can carry on by typing.`
        : null;
  }
}
