"use client";

import { Q_VOICE_LISTENING_LEVELS } from "@capital-q/contracts";

import {
  storeListeningPreference,
  useListeningPreference,
} from "../voice/listening-preference";
import {
  storeVoicePreference,
  useVoicePreference,
} from "../voice/voice-preference";
import { VOICE_LABELS } from "../voice/voice-menu";

/**
 * Q's voice on the Settings page: the same choice as the small icon on the
 * Q page, worded, and remembered on this device (R28).
 */
export function VoiceSetting() {
  const voice = useVoicePreference();
  return (
    <div
      role="group"
      aria-label="Q's voice"
      className="flex flex-wrap gap-1"
      data-voice-setting
    >
      {(["FEMALE", "MALE"] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={voice === choice}
          onClick={() => {
            storeVoicePreference(choice);
          }}
          className={
            voice === choice
              ? "cq-appearance-option is-active"
              : "cq-appearance-option"
          }
        >
          {VOICE_LABELS[choice]}
        </button>
      ))}
    </div>
  );
}

const LISTENING_LABELS = {
  OFF: "Off",
  SUBTLE: "Subtle",
  NATURAL: "Natural",
} as const;

/**
 * BACKCHANNEL: how much Q reacts while you talk on live voice ("mm",
 * "oh no") and whether it says a short line while an answer is slow.
 * Kept on this device; saying "stop doing that" on a call changes it too,
 * and Q remembers that for you.
 */
export function ListeningSetting() {
  const level = useListeningPreference();
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="Listening sounds"
        className="flex flex-wrap gap-1"
        data-listening-setting
      >
        {Q_VOICE_LISTENING_LEVELS.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={level === choice}
            onClick={() => {
              storeListeningPreference(choice);
            }}
            className={
              level === choice
                ? "cq-appearance-option is-active"
                : "cq-appearance-option"
            }
          >
            {LISTENING_LABELS[choice]}
          </button>
        ))}
      </div>
      <p className="cq-caption text-(--cq-text-secondary)">
        On live voice: small reactions while you talk, and a short line while an
        answer takes a moment.
      </p>
    </div>
  );
}
