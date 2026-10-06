"use client";

import Link from "next/link";

import { ICON_SIZE, ICON_STROKE, Mic, MicOff } from "@capital-q/ui/icons";

import {
  setWakePausedByYou,
  useWakeStatus,
  type WakeStatus,
} from "./wake-status";

/**
 * D2 privacy: whenever "Hey Q" has the microphone, the shell says so in
 * words, beside the browser's own indicator. One tap pauses it for this
 * tab. Nothing shows while it is off, hidden or Q is already on a call.
 */

export function wakeIndicatorText(status: WakeStatus): string | null {
  switch (status.kind) {
    case "LISTENING":
      return "Listening for “Hey Q”";
    case "HEARING":
      return "Listening for “Hey Q” · checking";
    case "PAUSED":
      if (status.reason === "BY_YOU") return "“Hey Q” paused";
      if (status.reason === "BATTERY") return "“Hey Q” paused: low battery";
      return null;
    case "BLOCKED":
      return "“Hey Q” can’t use the microphone";
    case "OFF":
    case "UNAVAILABLE":
      return null;
  }
}

export function WakeIndicator() {
  const status = useWakeStatus();
  const text = wakeIndicatorText(status);
  if (text === null) return null;
  const live = status.kind === "LISTENING" || status.kind === "HEARING";
  const pausedByYou = status.kind === "PAUSED" && status.reason === "BY_YOU";
  const Icon = live ? Mic : MicOff;
  return (
    <div
      className="flex justify-end px-4 pt-2"
      data-wake-indicator={status.kind}
    >
      <div
        role="status"
        className="inline-flex items-center gap-2 rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-1 pr-1 pl-3 cq-caption text-(--cq-text-secondary)"
      >
        <Icon
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        <span>{text}</span>
        {live || pausedByYou ? (
          <button
            type="button"
            onClick={() => setWakePausedByYou(live)}
            className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {live ? "Pause" : "Resume"}
          </button>
        ) : (
          <Link
            href="/settings#q"
            className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          >
            Settings
          </Link>
        )}
      </div>
    </div>
  );
}
