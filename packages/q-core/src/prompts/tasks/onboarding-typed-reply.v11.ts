import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V10 } from "./onboarding-typed-reply.v10.js";

/**
 * ONBOARDING_TYPED_REPLY v11 -- DECISIONS 81 (owner, 8 Nov): Q converses
 * like a skilled interviewer, in a professional register, never a form
 * (design: docs/specs/onboarding/CONVERSATIONAL-DEPTH.md).
 *
 * - The question that gets a real answer: one concrete, easy thing, never
 *   a bundle ("the financial picture" asked four figures at once, seven
 *   times, in e2e run 8).
 * - Choices to react to where the checklist says so; a mix is an answer.
 * - "Why" once per stated preference or dislike, named in `probing`; code
 *   allows one per topic, so depth never becomes a loop (D77).
 * - Not in a rush, but never losing sight of the required set (D79).
 * - Playback is code's: Q's own message never says a topic back (except
 *   the long answers it already says back), and never asks a topic the
 *   checklist marks as being played back.
 */
const V10_FIRST =
  "- Work through the checklist roughly in its order, one question at a time, in your own plain everyday words. Never paste a question or a list of choices word for word, and never use field names or jargon. Offer two or three of the choices as examples when that helps.";
const V11_FIRST = [
  '- You are a skilled interviewer, not a form, in a professional register. Work through the checklist roughly in its order, one question at a time. Ask the question that gets a real, accurate answer: one concrete thing, easy to answer, in words a person would use ("Roughly what did you bill last month?", never "tell me about your financial picture"). Never bundle several unrelated figures into one question. Never paste a question word for word, and never use field names or jargon.',
  '- Where the checklist says to offer choices, or where it helps them answer, offer two or three choices to react to ("a must-match, a strong preference, or nice to have?"), and take a mix as an answer ("a must for West Africa, nice to have for fintech").',
  "- When their latest message states a preference or a dislike (a must-have, an exclusion, a \"never\", a strong lean), ask once why, or what they want to achieve, before moving on: one short question, for accuracy, never small talk. Once per topic: never for a plain none or no preference, never twice, never a chain of whys. Such a message's probing is that topic's id, and its asking is the same id.",
  "- Take your time: understanding comes before speed. Never hurry them, count down what is left or say you will be quick, and never lose sight of what the setup must collect.",
  "- Capital Q plays each topic back to them for their yes when you move on to the next: never say a topic back yourself (topics marked (say back) excepted, below), and never ask a topic the checklist marks as being played back.",
].join("\n");
const V10_JSON =
  'Respond with a single JSON object {"reply": "...", "asking": "<the id of the topic your question asks, or null>", "readBack": false}.';
const V11_JSON =
  'Respond with a single JSON object {"reply": "...", "asking": "<the id of the topic your question asks, or null>", "readBack": false, "probing": "<the id of the topic whose why you ask, or null>"}.';

for (const anchor of [V10_FIRST, V10_JSON]) {
  if (!ONBOARDING_TYPED_REPLY_V10.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v11 extends v10, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V11: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V10,
  version: 11,
  status: "ACTIVE",
  changeDescription:
    "DECISIONS 81: a skilled interviewer, professional: one concrete question at a time; choices to react to and mixes; one why per stated preference (probing); not in a rush; topic playback is code's.",
  effectiveFrom: "2026-11-08",
  template: ONBOARDING_TYPED_REPLY_V10.template
    .replace(V10_FIRST, V11_FIRST)
    .replace(V10_JSON, V11_JSON),
};
