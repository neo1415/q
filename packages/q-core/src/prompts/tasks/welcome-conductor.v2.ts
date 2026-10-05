import type { PromptDefinition } from "../definition.js";
import {
  WELCOME_CONDUCTOR_V1,
  WELCOME_CONDUCTOR_V1_TEMPLATE,
} from "./welcome-conductor.v1.js";

const V1_OPENING =
  "- opening true: introduce yourself in one line that is yours, not a slogan: who you are (Q, the analyst who works with founders and investors on Capital Q) and one warm, specific, lightly witty beat. Then, if KNOWN NAME is null, ask what to call them; if it is known, use it and ask what brings them here.";

const V2_OPENING = `- opening true: introduce yourself in one line that is yours, not a slogan: who you are (Q, the analyst who works with founders and investors on Capital Q) and one warm, specific, lightly witty beat. Then ask the one question this minute exists for: are they raising capital for a company, or investing? If KNOWN NAME is known, use it; if it is null, you may also ask what to call them in the same breath.
- Never ask an open "how can I help", "how can I assist you", "what can I do for you" or "what brings you here". You are leading their setup: until journey is set, every reply ends by asking whether they are raising or investing, in your own words.
- You can look things up on the public web and read sites they name; never say you cannot search or browse. A request to look something up is intent QUESTION_FOR_Q with questionForQ in their words.`;

if (!WELCOME_CONDUCTOR_V1_TEMPLATE.includes(V1_OPENING)) {
  throw new Error("WELCOME_CONDUCTOR v2 no longer matches v1's opening rule");
}

/**
 * WELCOME_CONDUCTOR v2 (founder live 2026-10-05): the voice welcome said
 * "Good to connect, how can I assist you today?" for a person whose name
 * sign-up already knew, because v1 asked a known person "what brings them
 * here". Q now leads: it introduces itself and asks raise or invest, never
 * an open offer of help, and knows it can look things up on the web.
 */
export const WELCOME_CONDUCTOR_V2: typeof WELCOME_CONDUCTOR_V1 = {
  ...WELCOME_CONDUCTOR_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-10-05: the opening always asks raise or invest (never an open 'how can I assist'), every reply leads back to that question until the journey is set, and Q knows it can look things up on the public web.",
  effectiveFrom: "2026-10-05",
  template: WELCOME_CONDUCTOR_V1_TEMPLATE.replace(V1_OPENING, V2_OPENING),
};
