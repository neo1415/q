import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V70_SCHEMA_VERSION,
  TurnReaderV70ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV70Result,
} from "../schemas/turn-reader.js";
import { PLAN_F03_ASK } from "./plan.v1.js";
import { TURN_READER_V70, V70_PLAN_ASK } from "./turn-reader.v70.js";

/**
 * v71 (plan live run 1, 2026-10-29): PLAN ASK read by what the person
 * wants at the end, with the live misreadings as cases. Output schema v70,
 * unchanged.
 *
 *   - "plan my next two weeks on Ledgerline" (an investor) was read as a
 *     NAMED subject and went to a research memo: a company in their own
 *     pipeline, feed or relationships is their OWN work.
 *   - "I need to hire a CFO before our seed close, sort it out" went to a
 *     research memo: asking Q to sort out, organise or handle a goal that
 *     takes several steps is a PLAN.
 *   - "Review the pitch deck and financial documents I've uploaded and tell
 *     me what investors will push back on" became a plan whose first step
 *     was the review: asking for an analysis, a review or an answer is
 *     that work, done -- never a plan whose first step is the thing asked.
 */
export const V71_PLAN_ASK = `PLAN ASK: planAsk is set when they ask you for a plan of their own, or for work on their own company, mandate or pipeline -- read by what they want at the end, in any words and any language. kind IMPROVE: how to get better at something ongoing ("how do I improve my chances with investors?", an investor's "how do I get better deal flow?", "comment améliorer mes chances auprès des investisseurs ?"). kind GOAL: what to do for a stated goal or period ("what should I do this week?", "plan my raise of USD 2m by March", "help me close two co-investors this quarter", "I need to hire a CFO before our seed close, sort it out", an investor's "plan my next two weeks on Ledgerline", "¿qué debo hacer esta semana?"). kind UPLOADED: they share or point at a plan of their own to review or improve ("here is my plan, make it better"). kind NONE: they asked for something else about their own work (an analysis, a review, a document) -- then deliverable says what. research: NONE when the work can be done from what Capital Q holds about them; MARKET when it needs public news of their market, sector, regulation or the investors and companies in it; SELF when it needs what public sources say about them or their own company; BOTH when both. side: FOUNDER when it is for a founder or their company, INVESTOR when it is for an investor's deal flow, portfolio, pipeline or mandate, null when the turn does not make it plain. subject: OWN -- the default -- when the work is theirs: a founder's own company, its investors and its raise; an investor's own mandate, pipeline, portfolio and every company in their feed, saved list or relationships, even when they name that company ("plan my next two weeks on Ledgerline" from an investor is OWN). NAMED only when they ask for work that belongs to someone else (a plan for another company's founders, another firm's mandate); namedOther carries it. "my", "our", "the documents I've uploaded" and no name at all all mean OWN. deliverable: what they want at the end, read from the ask itself, never from single words. PLAN: steps to take, organised for them -- when they ask for a plan, what to do, to organise, sort out, handle or get done a goal that takes several steps (the CFO ask is a PLAN: hiring before the close is several steps, some theirs, some Q's). ANALYSIS: when they ask you to review, assess, analyse or answer -- the analysis IS the deliverable, so it is done, never planned: "Review the pitch deck and financial documents I've uploaded and tell me what investors will push back on" is planAsk {kind NONE, subject OWN, deliverable ANALYSIS} with teamJob true. DOCUMENT_REVIEW: only when they ask to have the facts in their own documents extracted or checked and confirmed before their record changes ("${PLAN_F03_ASK}" is planAsk {kind NONE, subject OWN, deliverable DOCUMENT_REVIEW} with teamJob true). DOCUMENT: a document of theirs made or reworked (teamJob true). A plan is never the answer to an ask for analysis: if the first step of the plan would be the very thing they asked for, the deliverable is that thing, not PLAN. "how do I improve my chances with investors?" is planAsk {kind IMPROVE, subject OWN, deliverable PLAN}. planAsk is read beside the other fields, never instead of them: "what should I do next?" still sets nextSteps. Null for a question of advice or explanation ("explain a SAFE", "is USD 2.5m sensible for us?"), for a question that only asks about someone else, and for asking what is on their board.
`;

if (TURN_READER_V70.template.split(V70_PLAN_ASK).length !== 2) {
  throw new Error("TURN_READER v71 replaces v70's PLAN ASK rule, which changed");
}

export const TURN_READER_V71: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV70Result
> = {
  ...TURN_READER_V70,
  version: 71,
  status: "ACTIVE",
  changeDescription:
    "Plan live run 1 (2026-10-29): v70 with PLAN ASK read by what the person wants at the end. An investor's company in their own pipeline, feed or relationships is OWN (\"plan my next two weeks on Ledgerline\"); asking Q to sort out, organise or handle a multi-step goal is a PLAN (the CFO ask); asking for a review, analysis or answer is that work (deliverable ANALYSIS with teamJob), never a plan whose first step is the ask; DOCUMENT_REVIEW only for extracting and confirming the facts in their own documents; kind NONE for non-plan work on their own company. Output schema v70, unchanged.",
  effectiveFrom: "2026-10-29",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V70_SCHEMA_VERSION,
    schema: TurnReaderV70ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V70.template.replace(V70_PLAN_ASK, V71_PLAN_ASK),
};
