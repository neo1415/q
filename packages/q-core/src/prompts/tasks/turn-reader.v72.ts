import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V70_SCHEMA_VERSION,
  TurnReaderV70ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV70Result,
} from "../schemas/turn-reader.js";
import { PLAN_F03_ASK } from "./plan.v1.js";
import { TURN_READER_V71, V71_PLAN_ASK } from "./turn-reader.v71.js";

/**
 * v72 (Q-page sweep 2026-10-29, F14): a founder's "What should I do
 * today?" was read as planAsk {kind GOAL, deliverable PLAN} -- v71's own
 * example made "what should I do this week?" a GOAL -- and started a plan
 * job that took three minutes and came back a draft. A question about what
 * to do now, today or next is answered in the conversation, from what Q
 * already holds about them, in seconds: planAsk null, nextSteps true. A
 * plan is for when they ask for one, or for a programme of work over a
 * period or towards a goal. Output schema v70, unchanged.
 */
export const V72_PLAN_ASK = `PLAN ASK: planAsk is set when they ask you for a plan of their own, or for work on their own company, mandate or pipeline -- read by what they want at the end, in any words and any language. A plan is a programme of steps over a period or towards a goal, written, reviewed and kept for them; it takes minutes. A question about what to do now, today or next ("what should I do today?", "what's my next move?", "anything I should do right now?", "¿qué hago hoy?") is not a plan: answer it in the conversation from what you already hold about them -- planAsk null, nextSteps true -- unless they ask for a plan, a schedule or something organised over a period in the same message. kind IMPROVE: how to get better at something ongoing ("how do I improve my chances with investors?", an investor's "how do I get better deal flow?", "comment améliorer mes chances auprès des investisseurs ?"). kind GOAL: a plan for a stated goal or period ("plan my week", "plan my raise of USD 2m by March", "plan my raise over the next 8 weeks", "help me close two co-investors this quarter", "I need to hire a CFO before our seed close, sort it out", an investor's "plan my next two weeks on Ledgerline", "organízame la semana"). kind UPLOADED: they share or point at a plan of their own to review or improve ("here is my plan, make it better"). kind NONE: they asked for something else about their own work (an analysis, a review, a document) -- then deliverable says what. research: NONE when the work can be done from what Capital Q holds about them; MARKET when it needs public news of their market, sector, regulation or the investors and companies in it; SELF when it needs what public sources say about them or their own company; BOTH when both. side: FOUNDER when it is for a founder or their company, INVESTOR when it is for an investor's deal flow, portfolio, pipeline or mandate, null when the turn does not make it plain. subject: OWN -- the default -- when the work is theirs: a founder's own company, its investors and its raise; an investor's own mandate, pipeline, portfolio and every company in their feed, saved list or relationships, even when they name that company ("plan my next two weeks on Ledgerline" from an investor is OWN). NAMED only when they ask for work that belongs to someone else (a plan for another company's founders, another firm's mandate); namedOther carries it. "my", "our", "the documents I've uploaded" and no name at all all mean OWN. deliverable: what they want at the end, read from the ask itself, never from single words. PLAN: steps to take, organised for them -- when they ask for a plan, or to organise, sort out, handle or get done a goal that takes several steps over time (the CFO ask is a PLAN: hiring before the close is several steps, some theirs, some Q's). ANALYSIS: when they ask you to review, assess, analyse or answer -- the analysis IS the deliverable, so it is done, never planned: "Review the pitch deck and financial documents I've uploaded and tell me what investors will push back on" is planAsk {kind NONE, subject OWN, deliverable ANALYSIS} with teamJob true. DOCUMENT_REVIEW: only when they ask to have the facts in their own documents extracted or checked and confirmed before their record changes ("${PLAN_F03_ASK}" is planAsk {kind NONE, subject OWN, deliverable DOCUMENT_REVIEW} with teamJob true). DOCUMENT: a document of theirs made or reworked (teamJob true). A plan is never the answer to an ask for analysis: if the first step of the plan would be the very thing they asked for, the deliverable is that thing, not PLAN. "how do I improve my chances with investors?" is planAsk {kind IMPROVE, subject OWN, deliverable PLAN}; "what should I do today?" is planAsk null with nextSteps true; "plan my raise over the next 8 weeks" is planAsk {kind GOAL, subject OWN, deliverable PLAN}. planAsk is read beside the other fields, never instead of them: a plan ask about what to do next still sets nextSteps. Null for a question of advice or explanation ("explain a SAFE", "is USD 2.5m sensible for us?"), for a question that only asks about someone else, and for asking what is on their board.
`;

if (TURN_READER_V71.template.split(V71_PLAN_ASK).length !== 2) {
  throw new Error(
    "TURN_READER v72 replaces v71's PLAN ASK rule, which changed",
  );
}

export const TURN_READER_V72: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV70Result
> = {
  ...TURN_READER_V71,
  version: 72,
  status: "ACTIVE",
  changeDescription:
    'Q-page sweep 2026-10-29 (F14): v71 with PLAN ASK telling a plan from a question about what to do now. "What should I do today?" had started a three-minute plan job (v71\'s own GOAL example was "what should I do this week?"); a question about what to do now, today or next is answered in the conversation from what Q holds (planAsk null, nextSteps true) unless they ask for a plan or something organised over a period. GOAL examples are plans asked for ("plan my week", "plan my raise over the next 8 weeks"). Output schema v70, unchanged.',
  effectiveFrom: "2026-10-30",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V70_SCHEMA_VERSION,
    schema: TurnReaderV70ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V71.template.replace(V71_PLAN_ASK, V72_PLAN_ASK),
};
