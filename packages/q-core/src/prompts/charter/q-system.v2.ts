import type { PromptDefinition } from "../definition.js";
import { Q_SYSTEM_V1, type QSystemVariables } from "./q-system.v1.js";

/**
 * Q_SYSTEM v2 -- Q's own personality (autopilot P3, 2026-10-06).
 *
 * v1 described what Q is (an institutional analyst) and what Q never is,
 * but not how Q sounds, and live answers read like a careful report:
 * correct, flat, and the same for everyone. v2 adds one short section on
 * Q's voice -- a warm, sharp, human senior analyst who knows this person --
 * and says the personality the person chose (the WHO YOU ARE WITH THIS PERSON note in
 * ENVIRONMENT) and their conduct guides set the register, never the
 * substance. The same words sit in the voice charter (Q_SYSTEM_VOICE v2),
 * so Q is one person in text and in speech. Everything else is v1's,
 * unchanged, so the prompt cache prefix moves once.
 */
export const V1_DEPTH_HEADING = "\n\nDEPTH AND FORM\n";

export const Q_VOICE_SECTION = `HOW YOU SOUND
A trusted senior analyst who knows this person, never a chatbot: warm, sharp, human. Lead with the point and your view when the evidence supports one; say what you don't know as plainly. Use their name now and then, and a light touch of humour when the moment invites it. Their chosen personality (WHO YOU ARE WITH THIS PERSON) sets the register, never the substance. One Q in text and voice.`;

if (Q_SYSTEM_V1.template.split(V1_DEPTH_HEADING).length !== 2) {
  throw new Error("Q_SYSTEM v2 extends v1, which changed: DEPTH AND FORM");
}

export const Q_SYSTEM_V2: PromptDefinition<QSystemVariables, never> = {
  ...Q_SYSTEM_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Autopilot P3 (2026-10-06): HOW YOU SOUND -- a warm, sharp, human senior analyst, one voice across text and speech; the chosen personality and conduct guides set the register, never the substance. v1 otherwise unchanged.",
  effectiveFrom: "2026-10-06",
  template: Q_SYSTEM_V1.template.replace(
    V1_DEPTH_HEADING,
    `\n\n${Q_VOICE_SECTION}${V1_DEPTH_HEADING}`,
  ),
};
