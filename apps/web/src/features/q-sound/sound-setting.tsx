"use client";

import { playSound } from "./sound-engine";
import { storeSoundPreference, useSoundPreference } from "./sound-preference";
import { SOUND_MODES, SOUND_MODE_LABELS } from "./sound-rules";

/**
 * Settings → Appearance: Q's sounds On, Quiet or Off on this device (I2).
 * Choosing On or Quiet plays the Result ready ping once, so the person
 * hears what they chose.
 */
export function SoundSetting() {
  const mode = useSoundPreference();
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="Q's sounds"
        className="flex flex-wrap gap-1"
        data-sound-setting
      >
        {SOUND_MODES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={mode === choice}
            onClick={() => {
              storeSoundPreference(choice);
              if (choice !== "OFF") playSound("ping");
            }}
            className={
              mode === choice
                ? "cq-appearance-option is-active"
                : "cq-appearance-option"
            }
          >
            {SOUND_MODE_LABELS[choice]}
          </button>
        ))}
      </div>
      <p className="cq-caption text-(--cq-text-secondary)">
        Small sounds when Q wakes, listens, works and has a result. Quiet keeps
        only a soft tone as Q starts working, Result ready, Needs you and
        errors. Never while Q speaks.
      </p>
    </div>
  );
}
