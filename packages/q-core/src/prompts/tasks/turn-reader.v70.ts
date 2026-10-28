import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V70_SCHEMA_VERSION,
  TurnReaderV70ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV70Result,
} from "../schemas/turn-reader.js";
import { PLAN_F03_ASK } from "./plan.v1.js";
import { V62_WORK_FROM_EARLIER } from "./turn-reader.v62.js";
import { TURN_READER_V69 } from "./turn-reader.v69.js";

/**
 * v70 (situation-first planning, design 2026-10-28 S3): planAsk and
 * directsWork, read by meaning in any words and any language. Code routes
 * a plan ask to the situation-first planner (S5) and appends a direction
 * to running work (S6); until then both are read and nothing else changes.
 * v69 is kept whole; both rules sit after its WORK FROM EARLIER rule.
 */
export const V70_PLAN_ASK = `PLAN ASK: planAsk is set when they ask you for a plan of their own -- how to improve their position, what to do next or over a period, or how to reach a goal -- by what it means, in any words and any language. kind IMPROVE: how to get better at something ongoing ("how do I improve my chances with investors?", "how can we look stronger to funds?", an investor's "how do I get better deal flow?", "comment améliorer mes chances auprès des investisseurs ?", "كيف أحسن فرصي مع المستثمرين؟"). kind GOAL: what to do for a stated goal or period ("what should I do this week?", "plan my raise of USD 2m by March", "help me close two co-investors this quarter", "write me a 12-month fundraising plan", "¿qué debo hacer esta semana?"). kind UPLOADED: they share or point at a plan of their own to review or improve ("here is my plan, make it better", "improve the plan I just attached"). research: NONE when the plan can be made from what Capital Q holds about them; MARKET when it needs public news of their market, sector, regulation or the investors and companies in it; SELF when it needs what public sources say about them or their own company; BOTH when both. side: FOUNDER when the plan is for a founder or their company, INVESTOR when it is for an investor's deal flow, portfolio or mandate, null when the turn does not make it plain. subject: OWN -- the default -- when the work is about their own company (a founder) or their own mandate and pipeline (an investor), which is always so unless they name another company or person; NAMED only when they name one (namedOther carries it). Never read their own work as an unclear subject: "my", "our", "the documents I've uploaded" and no name at all all mean OWN. deliverable: what they want at the end, read from the ask itself -- PLAN: steps to take (the default); DOCUMENT_REVIEW: their own documents read, facts extracted, contradictions set side by side and what needs their confirmation shown before their record changes; ANALYSIS: a written study or recommendation; DOCUMENT: a document of theirs made or reworked. "${PLAN_F03_ASK}" is planAsk {kind GOAL, subject OWN, deliverable DOCUMENT_REVIEW}: a clear ask about their own company, never unclear. "how do I improve my chances with investors?" is planAsk {kind IMPROVE, subject OWN, deliverable PLAN}. planAsk is read beside the other fields, never instead of them: "what should I do next?" still sets nextSteps, and a written plan still sets teamJob. Null for a question of advice or explanation ("explain a SAFE", "is USD 2.5m sensible for us?"), for a question that only asks about someone else, and for asking what is on their board.
`;
export const V70_DIRECTS_WORK = `DIRECTS WORK: directsWork is true when they tell you how to change work your team is already doing for them -- a job or plan you said you started, in the recent turns or what you showed -- by reordering, narrowing, adding to or dropping part of it, without asking for new work ("focus on the fintech ones first", "drop the deck step", "skip the Lagos investors", "do the data room before the outreach", "concentre-toi d'abord sur les fintechs"). False for new work, for approving, declining or editing a change waiting for their approval (that is replyTo WAITING_CARD), for stopping the work altogether, and when no work of theirs is running.
`;

if (TURN_READER_V69.template.split(V62_WORK_FROM_EARLIER).length !== 2) {
  throw new Error(
    "TURN_READER v70 extends v62's WORK FROM EARLIER rule, which changed",
  );
}

export const TURN_READER_V70: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV70Result
> = {
  ...TURN_READER_V69,
  version: 70,
  status: "ACTIVE",
  changeDescription:
    "Situation-first planning (design 2026-10-28, S3 with addendum 3): v69 plus PLAN ASK -- planAsk {kind IMPROVE / GOAL / UPLOADED, research NONE / MARKET / SELF / BOTH, side, subject OWN (default, never unclear) / NAMED, deliverable PLAN / DOCUMENT_REVIEW / ANALYSIS / DOCUMENT; the live F03 ask is GOAL, OWN, DOCUMENT_REVIEW} when they ask for a plan of their own, by meaning in any language, beside nextSteps and teamJob -- and DIRECTS WORK -- directsWork when they redirect work Q's team is already doing. Output schema v70: v65's fields kept, both new fields lenient.",
  effectiveFrom: "2026-10-28",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V70_SCHEMA_VERSION,
    schema: TurnReaderV70ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V69.template.replace(
    V62_WORK_FROM_EARLIER,
    `${V62_WORK_FROM_EARLIER}${V70_PLAN_ASK}${V70_DIRECTS_WORK}`,
  ),
};
