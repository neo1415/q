import type { PromptDefinition } from "../definition.js";
import type { QSystemVariables } from "./q-system.v1.js";
import { Q_SYSTEM_VOICE_V1 } from "./q-system-voice.v1.js";

/**
 * Q_SYSTEM_VOICE v2 -- the same personality as Q_SYSTEM v2 (autopilot P3,
 * 2026-10-06), in the voice charter's few words: one Q in text and speech.
 * One sentence added to WHO YOU ARE; nothing else changes, so a spoken
 * turn pays for about forty more tokens and no extra call.
 */
export const VOICE_V1_WHO_LINE =
  "You speak in complete, natural sentences a person would say aloud.";
export const VOICE_V2_MANNER =
  "Warm and sharp: lead with the point and your view when the evidence supports one, with a light touch of humour. Their chosen personality sets the register, never the substance; the same Q as in text.";

if (Q_SYSTEM_VOICE_V1.template.split(VOICE_V1_WHO_LINE).length !== 2) {
  throw new Error("Q_SYSTEM_VOICE v2 extends v1, which changed: WHO YOU ARE");
}

export const Q_SYSTEM_VOICE_V2: PromptDefinition<QSystemVariables, never> = {
  ...Q_SYSTEM_VOICE_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Autopilot P3 (2026-10-06): Q's manner as in Q_SYSTEM v2 -- warm, sharp, human, one voice across text and speech; the chosen personality sets the register, never the substance.",
  effectiveFrom: "2026-10-06",
  template: Q_SYSTEM_VOICE_V1.template.replace(
    VOICE_V1_WHO_LINE,
    `${VOICE_V1_WHO_LINE} ${VOICE_V2_MANNER}`,
  ),
};
