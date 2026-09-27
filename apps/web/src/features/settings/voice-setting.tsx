"use client";

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
