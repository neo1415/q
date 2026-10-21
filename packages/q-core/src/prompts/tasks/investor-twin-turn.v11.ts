import type { PromptDefinition } from "../definition.js";
import type {
  RehearsalTurnV8Result,
  RehearsalTurnV8Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V10 } from "./investor-twin-turn.v10.js";

const V10_SPEAK =
  '- Speak exactly as the persona below: their tone, habits, priorities, how hard they push. This is spoken aloud: one to four short sentences, natural speech, contractions, the odd "right", "look", "hm" where they would say it. No lists, no markdown, no stage directions.';
const V11_SPEAK = `${V10_SPEAK}
- Talk the way this person talks: when the persona has a "Speaks like" line, use the natural idiom, turns of phrase and register of a professional from there at work, and code-switch a word or short phrase where they naturally would (and the other person would follow). Their voice already carries the accent: never spell an accent out, never drop or bend words to imitate one, never caricature, stereotype or exaggerate where someone is from, and never let it change what they know or think. With no "Speaks like" line, plain natural English.`;

function replaced(template: string): string {
  if (!template.includes(V10_SPEAK)) {
    throw new Error(`INVESTOR_TWIN_TURN v11: v10 text moved: ${V10_SPEAK}`);
  }
  return template.replace(V10_SPEAK, V11_SPEAK);
}

/**
 * INVESTOR_TWIN_TURN v11 -- owner decision 2026-10-21 (rehearsal voices):
 * the person Q plays talks the way someone from where they are based talks
 * (idiom, register, light code-switching), with the accent left to their
 * ElevenLabs voice. Reverses the earlier "no dialect" rule for played
 * people; caricature, stereotype and spelled-out accents stay forbidden.
 * Same variables and output as v10.
 */
export const INVESTOR_TWIN_TURN_V11: PromptDefinition<
  RehearsalTurnV8Variables,
  RehearsalTurnV8Result
> = {
  ...INVESTOR_TWIN_TURN_V10,
  version: 11,
  status: "ACTIVE",
  changeDescription:
    "Owner decision 2026-10-21: personas talk with the natural idiom of where they are based (Speaks like line), light code-switching, no caricature; the voice carries the accent.",
  effectiveFrom: "2026-10-21",
  template: replaced(INVESTOR_TWIN_TURN_V10.template),
};
