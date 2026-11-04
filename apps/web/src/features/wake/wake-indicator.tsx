"use client";

import Link from "next/link";

import { ICON_SIZE, ICON_STROKE, Mic, MicOff } from "@capital-q/ui/icons";

import { storeWakePreference } from "./wake-preference";
import {
  setWakePausedByYou,
  useWakeProcessing,
  useWakeStatus,
  type WakeProcessing,
  type WakeStatus,
} from "./wake-status";
import { useT } from "@/features/i18n/language";

/**
 * D2 privacy: whenever "Hey Q" has the microphone, the shell says so in
 * words, beside the browser's own indicator, and says where the words are
 * recognised: on this device, or by the browser's speech service. One tap
 * pauses it for this tab; "Turn off" is always there while it is on.
 * Nothing shows while it is off, hidden or Q is already on a call. No
 * motion: the words change, nothing pulses, so reduced motion needs no
 * special case.
 */

export function wakeIndicatorText(
  status: WakeStatus,
  processing: WakeProcessing | null = null,
): string | null {
  switch (status.kind) {
    case "LISTENING":
      if (processing === "DEVICE")
        return "Listening for “Hey Q” · on this device";
      if (processing === "SERVICE") {
        return "Listening for “Hey Q” · browser speech service";
      }
      return "Listening for “Hey Q”";
    case "HEARING":
      if (processing === "DEVICE") {
        return "Listening for “Hey Q” · checking on this device";
      }
      if (processing === "SERVICE") {
        return "Listening for “Hey Q” · checking with browser speech service";
      }
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
  const t = useT();
  const status = useWakeStatus();
  const processing = useWakeProcessing();
  const text = wakeIndicatorText(status, processing);
  if (text === null) return null;
  const live = status.kind === "LISTENING" || status.kind === "HEARING";
  const pausedByYou = status.kind === "PAUSED" && status.reason === "BY_YOU";
  const Icon = live ? Mic : MicOff;
  return (
    <div
      className="flex justify-end px-4 pt-2"
      data-wake-indicator={status.kind}
      data-wake-processing={processing ?? undefined}
    >
      <div
        role="status"
        className="inline-flex items-center gap-2 border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-1 pe-1 ps-3 cq-caption text-(--cq-text-secondary)"
      >
        <Icon
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        <span>{t(text)}</span>
        {live || pausedByYou ? (
          <button
            type="button"
            onClick={() => setWakePausedByYou(live)}
            className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {live ? t("Pause") : t("Resume")}
          </button>
        ) : (
          <Link
            href="/settings#q"
            className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {t("Settings")}
          </Link>
        )}
        <button
          type="button"
          onClick={() => {
            setWakePausedByYou(false);
            storeWakePreference(false);
          }}
          className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          data-wake-turn-off
        >
          {t("Turn off")}
        </button>
      </div>
    </div>
  );
}
