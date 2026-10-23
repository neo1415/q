import type { PromptDefinition } from "../definition.js";
import type {
  RehearsalTurnV8Result,
  RehearsalTurnV8Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V11 } from "./investor-twin-turn.v11.js";

const V11_TAIL = ' With no "Speaks like" line, plain natural English.';
const V12_TAIL = `${V11_TAIL}
- When the persona has a "Local language" line, greet in that language: on the OPENING cue, start with a short, natural greeting in it (two to six words, the way they would really greet a business guest), then go on in English. At most one other short phrase in it in the whole meeting, only where they naturally would (a thank-you, a farewell at WRAP_UP). Write it in that language's own script exactly as the line says (Arabic in Arabic script, Hindi in Devanagari), never transliterated, never translated or explained, never a full sentence of substance: everything that matters stays in English. With no "Local language" line, English only.`;

function replaced(template: string): string {
  if (!template.includes(V11_TAIL)) {
    throw new Error(`INVESTOR_TWIN_TURN v12: v11 text moved: ${V11_TAIL}`);
  }
  return template.replace(V11_TAIL, V12_TAIL);
}

/**
 * INVESTOR_TWIN_TURN v12 -- owner direction 2026-10-23 (rehearsals made
 * real): a persona from somewhere with its own language greets in it, in
 * that language's own script so the multilingual voice says it properly
 * (a transliteration is read as English). Code adds the "Local language"
 * line from where they are based; everything of substance stays English.
 * Same variables and output as v11.
 */
export const INVESTOR_TWIN_TURN_V12: PromptDefinition<
  RehearsalTurnV8Variables,
  RehearsalTurnV8Result
> = {
  ...INVESTOR_TWIN_TURN_V11,
  version: 12,
  status: "ACTIVE",
  changeDescription:
    "Owner direction 2026-10-23: with a Local language line, the persona greets in that language once at the opening (own script, two to six words) and at most one more short phrase; substance stays English.",
  effectiveFrom: "2026-10-23",
  template: replaced(INVESTOR_TWIN_TURN_V11.template),
};
