import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V78_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV78ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV78Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V77, V77_REFERENCES } from "./turn-reader.v77.js";

/**
 * v78 (Q intelligence step 4: one reader). Code chose the answer's work
 * from word lists beside the reading ("compare", "versus", "analyse",
 * "risks", two kinds of work product), so "how does it stack up against
 * Ledgerfold?" ran as small talk and "is there any risk I'm late?" as
 * diligence. v78 asks the reader, by meaning and in any language, for the
 * heaviest work the turn asks (`answerKind`) and each separate thing a
 * compound ask wants (`parts`). Code validates both and never falls back to
 * a word list. v77 is kept whole; the rule sits right after v77's
 * REFERENCES rule, so the cached prefix is unchanged from turn to turn.
 */
export const V78_WHAT_WAS_ASKED = `WHAT WAS ASKED: answerKind is the heaviest work WHAT THEY JUST SAID asks of Q's answer, read by meaning in any language: CHAT for greetings, thanks and talk that asks for nothing; LOOKUP for a fact, a figure, a name, a status or a short explanation ("what's its ARR?", "who's the CEO?", "what does Silo Credit do?"); FOLLOW_UP for more on Q's last answer without new work ("why?", "say more", "and the year before?"); ANALYSIS for judgement over evidence -- an assessment, risks, strengths and weaknesses, diligence, whether something is good, fits or adds up, why it happened ("is their burn sustainable?", "what worries you about them?"); COMPARISON for two or more companies, investors, people, figures or options weighed against each other, however said ("how does it stack up against Ledgerfold?", "which of these is stronger?", "Kestrel or Maji?"); DOCUMENT for a piece of work written to keep -- a memo, brief, plan, report, list of questions, critique or revision. A word alone never decides it: "is there any risk the call is late?" is LOOKUP, "compare notes later" is CHAT. A turn that is not for Q, or only a command (open a page, set a reminder), leaves answerKind out. parts: when WHAT THEY JUST SAID asks for two or more separate things, one entry per thing in the order asked -- ask is that one thing in their words, made self-standing with what it is about ("What's Silo Credit's ARR?", "Who is Silo Credit's CEO?"), and kind is its own answerKind. "What's its ARR and burn, and who's the CEO?" is three parts; "compare its runway and gross margin with Ledgerfold's" is two COMPARISON parts, one per figure. A single ask leaves parts empty (leave it out). answerKind is the heaviest kind among the parts. remember: when they ask Q to keep something in mind about themselves or how they work ("Remember: I pass on gambling", "keep in mind we only do seed"), fact is it said back to them in the second person, short ("you pass on gambling businesses", "you only do seed"), or null when it would not read back plainly; leave remember out for a task for later ("remember to send the deck"), a question ("remember what I said about Kestrel?") and everything else. asksForChart is true only when they ask for a chart, graph or plot of something.
`;

if (TURN_READER_V77.template.split(V77_REFERENCES).length !== 2) {
  throw new Error("TURN_READER v78 extends v77's REFERENCES rule, which changed");
}

export const TURN_READER_V78: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV78Result
> = {
  ...TURN_READER_V77,
  version: 78,
  status: "ACTIVE",
  changeDescription:
    "Q intelligence step 4: v77 plus what was asked -- answerKind (CHAT, LOOKUP, FOLLOW_UP, ANALYSIS, COMPARISON, DOCUMENT), the heaviest work the turn asks, parts, each separate thing a compound ask wants with its own kind, remember (a fact to keep, said back in the second person) and asksForChart, read by meaning in any language. Code takes the answer's task class, comparison handling, every-part note, remember confirmation and chart line from these fields; with no reading it uses a neutral default, never a word list.",
  effectiveFrom: "2026-11-05",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V78_SCHEMA_VERSION,
    schema: TurnReaderV78ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V77.template.replace(
    V77_REFERENCES,
    `${V77_REFERENCES}${V78_WHAT_WAS_ASKED}`,
  ),
};
