import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_V3_UNTRUSTED,
  INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION,
  InterviewConductorV3VariablesSchema,
  InterviewConductorV4ResultSchema,
  type InterviewConductorV3Variables,
  type InterviewConductorV4Result,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V4 } from "./interview-conductor.v4.js";

/**
 * INTERVIEW_CONDUCTOR v5 — Q stops writing people's names, and stops
 * mistaking the transcript for the record (QX-004 core gate).
 *
 * Live, an investor whose firm is Zino Aviation was greeted with "Hi
 * there, Zino, glad to be working on the Zinoevation mandate with you
 * today." Nobody is called Zino and nothing is called Zinoevation.
 *
 * The instruction that produced it was v1's, and it was explicit: open
 * "by the company's or firm's name when known". So the model was being
 * asked to write an identity-bearing value into prose, and a model
 * writing prose will occasionally write a name that is nearly right.
 * Nearly right is wrong for a name — it is the first thing somebody
 * reads, and getting it wrong says Capital Q does not know who they are.
 *
 * A name is not the model's to write. It writes `<them>` where it would
 * have used one, and the runtime substitutes the value it actually holds
 * — the recorded organisation or company name, checked against the
 * session. Where nothing is recorded there is nothing to substitute, and
 * the sentence is left without it, which reads as a shade less warm and
 * is true.
 *
 * This does not make it impossible for a model to type a name anyway. It
 * removes the instruction that asked it to, gives it something correct
 * to reach for instead, and makes the common path — the opening, where
 * the damage is greatest — deterministic.
 */
const ANCHOR =
  "- opening true: nothing was said yet. Open like a good analyst picking up a call: one warm, unhurried sentence, by the company's or firm's name when known, then the current step as a natural question. A returning person hears a one-sentence account of what's covered. If the current step is a review of what was gathered, read the key known answers back in one or two spoken sentences and ask if that's right. intent OPENING.";

const REPLACEMENT =
  "- opening true: nothing was said yet. Open like a good analyst picking up a call: one warm, unhurried sentence, then the current step as a natural question. A returning person hears a one-sentence account of what's covered. If the current step is a review of what was gathered, read the key known answers back in one or two spoken sentences and ask if that's right. intent OPENING.\n- NEVER write the name of their company, their firm or their organisation, in any reply. Write <them> in its place — those six characters exactly — and the platform puts in the name it holds. You may be wrong about a name; the platform is not.\n- KNOWN ANSWERS is the only proof that anything is held. RECENT TURNS is what was said, which is a different thing: somebody can tell you something and it can fail to be written down, and NOTES FROM THE PLATFORM name exactly that. So never say a thing is saved, recorded, confirmed, on file, covered or done unless it is in KNOWN ANSWERS — not because they said it, not because you asked, not because it is in the transcript.\n- They ask to leave the rest of the optional questions and finish ('skip the detail', 'let us just finish', 'that is enough for now'): skipRemainingOptional true, and askNext the next REQUIRED step. Skipping the one question you are on is the ordinary skips field; this is for all the rest of them.\n- A correction may name a step that is in KNOWN ANSWERS even though it is not in OPEN STEPS. That is the one case where you answer a step already answered: intent CORRECTION, the corrected value in answers, that step's key. The platform supersedes the old value and keeps the history.";

if (!INTERVIEW_CONDUCTOR_V4.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v5 rewrites v4's opening line, and v4 no longer carries it",
  );
}

export const INTERVIEW_CONDUCTOR_V5: PromptDefinition<
  InterviewConductorV3Variables,
  InterviewConductorV4Result
> = {
  ...INTERVIEW_CONDUCTOR_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "QX-004 core gate: the model no longer writes the name of a company, firm or organisation — it writes a placeholder and the runtime substitutes the recorded value — and it may not call anything saved, recorded or covered unless it is in KNOWN ANSWERS. Written after an investor whose firm is Zino Aviation was greeted about the Zinoevation mandate, and after Q reported two answers as held against a session that held none.",
  effectiveFrom: "2026-09-22",
  variables: {
    schema: InterviewConductorV3VariablesSchema,
    untrusted: [...INTERVIEW_CONDUCTOR_V3_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_CONDUCTOR_SCHEMA_NAME,
    schemaVersion: INTERVIEW_CONDUCTOR_V4_SCHEMA_VERSION,
    schema: InterviewConductorV4ResultSchema,
  },
  template: INTERVIEW_CONDUCTOR_V4.template.replace(ANCHOR, REPLACEMENT),
};
