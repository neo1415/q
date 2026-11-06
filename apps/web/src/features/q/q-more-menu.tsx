"use client";

import type { QVoiceChoice } from "@capital-q/contracts";
import {
  Captions,
  Check,
  EyeOff,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
  Eye,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@capital-q/ui/menu";

import type { CardsMenu } from "./cards/cards-controls";
import { useT } from "@/features/i18n/language";
import { VOICE_LABELS } from "@/features/voice/voice-menu";

function isVoice(value: string): value is QVoiceChoice {
  return value === "FEMALE" || value === "MALE";
}

/**
 * The Q home's one "More" menu (client 2026-11-05: "the top is too
 * cluttered"): Q's voice, reading answers aloud, captions and the
 * transcript, which used to be four controls of their own on the top line,
 * and (owner 2026-11-06) clearing the screen's cards.
 */
export function QMoreMenu({
  voice,
  onChooseVoice,
  readAloud,
  onReadAloud,
  captions,
  onCaptions,
  onTranscript,
  cards,
}: {
  readonly voice: QVoiceChoice;
  readonly onChooseVoice: (voice: QVoiceChoice) => void;
  readonly readAloud: boolean;
  readonly onReadAloud: (on: boolean) => void;
  /** Absent where captions do not apply (Chat shows the whole thread). */
  readonly captions?: boolean | undefined;
  readonly onCaptions?: ((on: boolean) => void) | undefined;
  /** Absent until there is a conversation to save. */
  readonly onTranscript?: (() => void) | undefined;
  /**
   * Clear the cards on this screen, and bring them back (owner 2026-11-06:
   * no floating "Clear" in the thread). Each only when it would act.
   */
  readonly cards?: CardsMenu | undefined;
}) {
  const t = useT();
  const clear = cards?.clear ?? null;
  const restore = cards?.restore ?? null;
  const check = (
    <Check
      aria-hidden="true"
      size={ICON_SIZE.compact}
      strokeWidth={ICON_STROKE}
    />
  );
  return (
    <MenuRoot>
      <MenuTrigger>
        <button
          type="button"
          className="cq-stage-quiet"
          aria-label={t("More")}
          title={t("More")}
          data-q-control="more"
        >
          <MoreHorizontal
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-52">
        <MenuRadioGroup
          label={t("Q's voice")}
          value={voice}
          onValueChange={(next) => {
            if (isVoice(next)) onChooseVoice(next);
          }}
        >
          {(["FEMALE", "MALE"] as const).map((choice) => (
            <MenuRadioItem key={choice} value={choice} indicator={check}>
              {t(VOICE_LABELS[choice])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
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
            <MenuRadioItem key={value} value={value} indicator={check}>
              {t(label)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {onCaptions === undefined &&
        onTranscript === undefined &&
        clear === null &&
        restore === null ? null : (
          <MenuSeparator />
        )}
        {onCaptions === undefined ? null : (
          <MenuItem onClick={() => onCaptions(!(captions ?? false))}>
            <Captions
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span data-q-control="captions" data-q-captions-on={captions}>
              {t(captions === true ? "Hide captions" : "Show captions")}
            </span>
          </MenuItem>
        )}
        {onTranscript === undefined ? null : (
          <MenuItem onClick={onTranscript}>
            <FileText
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span data-q-control="transcript">{t("Open the transcript")}</span>
          </MenuItem>
        )}
        {clear === null ? null : (
          <MenuItem onClick={clear}>
            <EyeOff
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span data-q-cards-clear>{t("Clear the cards")}</span>
          </MenuItem>
        )}
        {restore === null ? null : (
          <MenuItem onClick={restore}>
            <Eye
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span data-q-cards-show>{t("Show the cards again")}</span>
          </MenuItem>
        )}
      </MenuContent>
    </MenuRoot>
  );
}
