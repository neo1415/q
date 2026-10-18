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
import { INTERVIEW_CONDUCTOR_V5 } from "./interview-conductor.v5.js";

/**
 * INTERVIEW_CONDUCTOR v6 — a value waiting for yes is decided, not said
 * again (QX-004 core gate).
 *
 * Money and exclusions are read back before they are recorded, because
 * they are the answers an investor is judged on. The platform holds the
 * value and asks; a yes writes it. Local, 2026-09-23:
 *
 *   Q     Are you deploying capital right now?
 *   them  I write 50 to 250 thousand pounds a cheque.
 *   Q     Minimum cheque: 50000. Is that right?
 *   them  Pre-seed and seed, mostly in the UK.
 *   Q     Fifty thousand minimum and two hundred fifty thousand maximum,
 *         is that right?
 *
 * Asked about a held cheque and given a sentence about stages instead,
 * the model put the cheque figures in `answers` again rather than in
 * `confirmations`. Restating a held value is not a decision on it, so
 * nothing was written; and the stages and geography, which is what was
 * actually said, went nowhere at all. Two turns in, the session held
 * nothing past the person's title.
 *
 * Two instructions, and they are about which field a thing belongs in
 * rather than about what any of it means:
 *
 * A step in PENDING CONFIRMATIONS is decided in `confirmations` and never
 * repeated in `answers`. The value is already in the platform's hands; it
 * is waiting for yes, no, or a different figure.
 *
 * And a turn that is not about what is held still answers what was said.
 * The held value stays held and can be raised again; the sentence in
 * front of you is the one that gets lost if you spend the turn on
 * something else.
 *
 * The runtime side of the same defect is fixed in the interviewer, which
 * now compares a held value with what came back by value rather than by
 * the sentence describing it — "50000" and "£50,000" are the same money,
 * and treating the difference as a correction is what kept the loop
 * alive.
 */
const ANCHOR =
  '- confirmations: when PENDING CONFIRMATIONS or DOCUMENT PROPOSALS is non-empty and the person says yes, CONFIRMED; no, REJECTED; a different value, REVISED with value. Read a document proposal back naturally the first time it is relevant ("your deck says forty customers, still right?").';

const REPLACEMENT = `${ANCHOR}
- A step in PENDING CONFIRMATIONS is decided in confirmations and never repeated in answers. Its value is already held by the platform and is waiting on yes, no, or a different figure; saying the same figure again is not a decision, and the platform goes on holding it.
- If what they just said is not a decision on what is held, answer what they did say — put it in answers, with the steps it belongs to — and leave the held value alone. It stays held and you can raise it once the question in front of you is settled. The sentence you were just given is the one that gets lost if you spend the turn restating something else.`;

if (!INTERVIEW_CONDUCTOR_V5.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v6 extends v5's confirmations line, and v5 no longer carries it",
  );
}

export const INTERVIEW_CONDUCTOR_V6: PromptDefinition<
  InterviewConductorV3Variables,
  InterviewConductorV4Result
> = {
  ...INTERVIEW_CONDUCTOR_V5,
  version: 6,
  // Superseded by v7: the turn is read against every open step, not
  // against the one question in hand.
  status: "DEPRECATED",
  changeDescription:
    "QX-004 core gate: a step waiting for confirmation is decided in confirmations rather than answered again, and a turn about something else still answers what was said. Written after a held cheque was restated turn after turn — never committed — while the stages and geography the person actually gave were dropped.",
  effectiveFrom: "2026-09-23",
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
  template: INTERVIEW_CONDUCTOR_V5.template.replace(ANCHOR, REPLACEMENT),
};
