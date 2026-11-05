"use client";

import { ICON_SIZE, ICON_STROKE, Mic } from "@capital-q/ui/icons";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";

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
 * D2 privacy: whenever "Hey Q" has the microphone, the page says so in
 * words, beside the browser's own indicator, including where the words
 * are recognised. Owner 5 Nov 2026: not a banner at the top of the page.
 * A small round microphone button in the bottom corner (inline-end, above
 * the dock and the composer), named in words; a tap opens Pause and Turn
 * off. Paused for any reason (by you, battery, a call, Q busy, a hidden
 * tab), off, blocked or unavailable, the microphone is closed: nothing
 * shows, and Resume lives in Settings → Q. No motion: nothing pulses, so
 * reduced motion needs no special case.
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
    case "BLOCKED":
    case "OFF":
    case "UNAVAILABLE":
      return null;
  }
}

const ACTION_CLASS =
  "inline-flex min-h-11 items-center rounded-full px-3 cq-body-sm font-medium text-(--cq-text-primary) hover:bg-(--cq-surface-sunken) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)";

export function WakeIndicator() {
  const t = useT();
  const status = useWakeStatus();
  const processing = useWakeProcessing();
  const text = wakeIndicatorText(status, processing);
  if (text === null) return null;
  const words = t(text);
  return (
    <div
      className="cq-wake-indicator"
      data-wake-indicator={status.kind}
      data-wake-processing={processing ?? undefined}
    >
      {/* The words, for assistive technology, as the state changes. */}
      <span role="status" className="sr-only">
        {words}
      </span>
      <PopoverRoot>
        <PopoverTrigger>
          <button
            type="button"
            aria-label={words}
            title={words}
            className="cq-wake-indicator-button"
            data-wake-indicator-button
          >
            <Mic
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent title={words} className="w-auto max-w-72 p-3">
          <span className="mt-1 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setWakePausedByYou(true)}
              className={ACTION_CLASS}
              data-wake-pause
            >
              {t("Pause")}
            </button>
            <button
              type="button"
              onClick={() => {
                setWakePausedByYou(false);
                storeWakePreference(false);
              }}
              className={ACTION_CLASS}
              data-wake-turn-off
            >
              {t("Turn off")}
            </button>
          </span>
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}
