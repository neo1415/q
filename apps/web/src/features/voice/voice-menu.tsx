"use client";

import type { QVoiceChoice } from "@capital-q/contracts";
import { Check, ICON_SIZE, ICON_STROKE, Volume2 } from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";

/**
 * Q's voice, behind one small icon (R24): chosen rarely, so it is not two
 * buttons on the stage. The same choice lives on the Settings page.
 */

export const VOICE_LABELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "Female voice",
  MALE: "Male voice",
};

function isVoice(value: string): value is QVoiceChoice {
  return value === "FEMALE" || value === "MALE";
}

export function VoiceMenu({
  voice,
  onChoose,
  className = "cq-stage-quiet",
}: {
  readonly voice: QVoiceChoice;
  readonly onChoose: (voice: QVoiceChoice) => void;
  readonly className?: string | undefined;
}) {
  return (
    <MenuRoot>
      <MenuTrigger>
        <button
          type="button"
          className={className}
          aria-label={`Q's voice: ${VOICE_LABELS[voice]}`}
          data-q-control="voice"
        >
          <Volume2
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-44">
        <MenuRadioGroup
          label="Q's voice"
          value={voice}
          onValueChange={(next) => {
            if (isVoice(next)) onChoose(next);
          }}
        >
          {(["FEMALE", "MALE"] as const).map((choice) => (
            <MenuRadioItem
              key={choice}
              value={choice}
              indicator={
                <Check
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
              }
            >
              {VOICE_LABELS[choice]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
