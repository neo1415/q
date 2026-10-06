"use client";

import { useId, useState, useSyncExternalStore } from "react";

import { WAKE_PHRASES } from "./phrases";
import { wakeSupported } from "./support";
import { storeWakePreference, useWakePreference } from "./wake-preference";
import { setWakePausedByYou, useWakeStatus } from "./wake-status";

/**
 * Settings → Q → "Say 'Hey Q' to start" (D2). Off by default. Turning it
 * on asks for the microphone first, from the tap itself (Safari needs the
 * gesture), and only then remembers the choice; a refusal leaves it off
 * and says how to allow it. Turning it off stops listening at once.
 */

type Notice = "BLOCKED" | "NO_MICROPHONE" | null;

const NOTICE_TEXT: Readonly<Record<Exclude<Notice, null>, string>> = {
  BLOCKED:
    "The microphone is blocked for Capital Q. Allow it in your browser’s site settings, then turn this on again.",
  NO_MICROPHONE: "No microphone was found on this device.",
};

function noSubscription(): () => void {
  return () => undefined;
}

const PHRASES = WAKE_PHRASES.map((phrase) => `“${phrase.label}”`);
const PHRASE_LIST = `${PHRASES.slice(0, -1).join(", ")} or ${PHRASES.at(-1) ?? ""}`;

export function WakeSetting() {
  const id = useId();
  const on = useWakePreference();
  const status = useWakeStatus();
  const supported = useSyncExternalStore(
    noSubscription,
    wakeSupported,
    () => true,
  );
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const turnOn = async () => {
    setAsking(true);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Only the permission was wanted here; the listener opens its own.
      for (const track of stream.getTracks()) track.stop();
      setWakePausedByYou(false);
      storeWakePreference(true);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setNotice(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? "NO_MICROPHONE"
          : "BLOCKED",
      );
    } finally {
      setAsking(false);
    }
  };

  const shown: Notice =
    notice ?? (on && status.kind === "BLOCKED" ? "BLOCKED" : null);

  return (
    <div className="flex flex-col gap-1.5" data-wake-setting>
      <div className="flex items-center justify-between gap-3">
        <span
          id={`${id}-label`}
          className="cq-body-sm text-(--cq-text-primary)"
        >
          Say “Hey Q” to start
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          disabled={!supported || asking}
          onClick={() => {
            if (on) storeWakePreference(false);
            else void turnOn();
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60"
          data-wake-toggle
        >
          <span
            aria-hidden="true"
            className="cq-switch"
            data-on={on ? "" : undefined}
          />
        </button>
      </div>
      <p id={`${id}-help`} className="cq-caption text-(--cq-text-secondary)">
        {supported
          ? `Say ${PHRASE_LIST} to open Q while Capital Q is open on screen. Off by default. It pauses when the tab is hidden, on low battery and while Q is on a call, and the top of the page shows whenever it is listening. Quiet sounds never leave this device. When speech starts, a few seconds may go to your browser’s speech service (Google in Chrome, Apple in Safari) to catch the words; Capital Q never receives or keeps that audio.`
          : "This browser can’t listen for “Hey Q”. Chrome, Edge and Safari can. The Q button and Ctrl/Cmd+K always open Q."}
      </p>
      {shown === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-primary)">
          {NOTICE_TEXT[shown]}
        </p>
      )}
    </div>
  );
}
