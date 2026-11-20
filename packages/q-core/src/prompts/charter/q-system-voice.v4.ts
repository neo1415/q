import type { PromptDefinition } from "../definition.js";
import type { QSystemVariables } from "./q-system.v1.js";
import { Q_SYSTEM_VOICE_V3, VOICE_CALL_SECTION } from "./q-system-voice.v3.js";

/**
 * Q_SYSTEM_VOICE v4 (HQ-2, 20 Nov 2026; conversation audit §2.3): the call
 * section's two habits the playbook calls robotic are replaced. "Then stop
 * or offer more ('want the detail?')" taught an automatic closing offer;
 * "I've reached out to…" taught a done-claim and a relay frame. Added: one
 * question a turn, reflected before it is asked, and uncertainty said by
 * what the evidence is. Everything else is v3's, so the prefix moves once.
 */
export const V3_ANSWER_LINE =
  '- Answer what they asked first, in one or two short sentences; then stop or offer more ("want the detail?").';
export const V3_FIRST_PERSON_LINE =
  '- First person for your own work: "I\'ve reached out to…", "I\'d start with…". Never "Capital Q records" or "the record confirms".';

export const V4_ANSWER_LINE =
  "- Answer what they asked first, in one or two short sentences, then stop. Offer more only when something was just delivered and a next step is truly useful, never as a habit.";
export const V4_FIRST_PERSON_LINE =
  '- First person for your own work: "I\'d start with…", "I don\'t know their round size yet". Never "Capital Q records" or "the record confirms", and never speak as a go-between ("I\'ll ask them", "I\'ll pass that on").';
export const V4_CONVERSATION_LINES = `- One question a turn at most. Before you ask, say back in a clause what you understood, then ask the one thing that matters, with the default you would take.
- Say how sure you are by what the evidence is, once, in plain words: "that's their own figure; I haven't seen a document for it", "that's my read, not something they've told us". Never a percentage.
- Three items at most when you list aloud; the rest are on screen.`;

const v3Section = VOICE_CALL_SECTION;
if (
  v3Section.split(V3_ANSWER_LINE).length !== 2 ||
  v3Section.split(V3_FIRST_PERSON_LINE).length !== 2 ||
  Q_SYSTEM_VOICE_V3.template.split(v3Section).length !== 2
) {
  throw new Error("Q_SYSTEM_VOICE v4 edits v3's call section, which changed");
}

export const VOICE_CALL_SECTION_V4 = v3Section
  .replace(V3_ANSWER_LINE, V4_ANSWER_LINE)
  .replace(
    V3_FIRST_PERSON_LINE,
    `${V4_FIRST_PERSON_LINE}\n${V4_CONVERSATION_LINES}`,
  );

export const Q_SYSTEM_VOICE_V4: PromptDefinition<QSystemVariables, never> = {
  ...Q_SYSTEM_VOICE_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "HQ-2 (20 Nov 2026, conversation audit 2.3): no habitual closing offer, no relay or done-claim example, one question a turn reflected first, uncertainty by evidence class, three items at most aloud. v3 otherwise unchanged.",
  effectiveFrom: "2026-11-20",
  template: Q_SYSTEM_VOICE_V3.template.replace(
    v3Section,
    VOICE_CALL_SECTION_V4,
  ),
};
