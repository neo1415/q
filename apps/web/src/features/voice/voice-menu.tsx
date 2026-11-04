"use client";

import type { QVoiceChoice } from "@capital-q/contracts";
import { Check, ICON_SIZE, ICON_STROKE, Volume2 } from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@capital-q/ui/menu";
import { useT } from "@/features/i18n/language";

/**
 * Q's voice, behind one small icon (R24): chosen rarely, so it is not two
 * buttons on the stage. The same choice lives on the Settings page.
 *
 * Where a surface passes `onReadAloud`, the same menu also holds whether
 * typed answers are read aloud (A6, owner 2026-11-04: silent by default).
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
  readAloud = false,
  onReadAloud,
}: {
  readonly voice: QVoiceChoice;
  readonly onChoose: (voice: QVoiceChoice) => void;
  readonly className?: string | undefined;
  readonly readAloud?: boolean | undefined;
  readonly onReadAloud?: ((on: boolean) => void) | undefined;
}) {
  const t = useT();
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
          label={t("Q's voice")}
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
              {t(VOICE_LABELS[choice])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {onReadAloud === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuRadioGroup
              label={t("Read answers aloud")}
              value={readAloud ? "on" : "off"}
              onValueChange={(next) => onReadAloud(next === "on")}
            >
              {(
                [
                  ["off", "Answers in writing only"],
                  ["on", "Read answers aloud"],
                ] as const
              ).map(([value, label]) => (
                <MenuRadioItem
                  key={value}
                  value={value}
                  indicator={
                    <Check
                      aria-hidden="true"
                      size={ICON_SIZE.compact}
                      strokeWidth={ICON_STROKE}
                    />
                  }
                >
                  {t(label)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        )}
      </MenuContent>
    </MenuRoot>
  );
}
