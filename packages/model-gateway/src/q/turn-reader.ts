import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  orEmptyCase,
  PROMPT_EMPTY_CASES,
  renderPrompt,
  TurnReaderV95ResultSchema,
  compareOverFromShown,
  type PromptRegistry,
  type QuestionKindV58,
  type TurnReaderV14Result,
  type TurnReaderV15Result,
  type TurnReaderV22Result,
  type TurnReaderV54Result,
  type TurnReaderV76Variables,
  TURN_READER_V76_RECENT_TURNS_MAX,
  TURN_READER_V76_TURN_TEXT_MAX,
  type TurnReaderV58Result,
  type TurnReaderV62Result,
  type TurnReaderV63Result,
  type TurnReaderV64Result,
  type TurnReaderV65Result,
  type TurnReaderV70Result,
  type TurnReaderV79Result,
  type TurnReaderV82Result,
  type TurnReaderV86Result,
  type TurnReaderV87Result,
  type TurnListConditionsV89,
  type TurnReaderV95Result,
} from "@capital-q/q-core";

import { isModelGatewayError, isModelServiceUnavailable } from "../errors.js";
import type { ModelGateway } from "../gateway.js";

/**
 * Reading one turn to Q before it is answered (CQ-QX-005, ADR 0011).
 *
 * The model reads meaning into the core's closed shape; the conversation
 * core decides from it whether Q may go to the public web. A turn that
 * cannot be read — no route, a timeout, output that does not parse — is
 * null, and the caller treats research as not asked for: Q answers from
 * what Capital Q holds rather than guessing its way onto the web.
 */
export type QTurnReader = {
  readonly read: (input: {
    readonly utterance: string;
    readonly recentTurns: readonly {
      readonly role: "USER" | "Q";
      readonly text: string;
    }[];
    readonly modality: "VOICE" | "TEXT";
    /**
     * v54: Capital Q's record of what Q already said and showed in this
     * conversation (`conversationContextOf`), built by code from the
     * conversation's own stored messages. Empty: nothing shown yet.
     */
    readonly shown?: string | undefined;
    /**
     * Q intelligence step 2 (v76): Capital Q's conversation state -- the
     * entity ledger, lists in order, open threads and the summary of turns
     * older than recentTurns -- rendered by code from the stored
     * conversation (`renderConversationState`). Absent: none yet.
     */
    readonly conversationState?: string | undefined;
    /**
     * The other actions this run can take, from what is offered: a request
     * for one of them is never read as a document (founder live, BIZ-004).
     */
    readonly actions?:
      | readonly {
          readonly name: string;
          readonly does: string;
          /** Declared in the registry, but not offered in this run (ADR 0040). */
          readonly available?: boolean | undefined;
          /** v32: a few words, and the area it is grouped under. */
          readonly short?: string | undefined;
          readonly area?: string | undefined;
        }[]
      | undefined;
    /**
     * v54 (owner 2026-10-17): the tabs and sections the page on screen
     * registered (its manifest's controls, after the firewall), so the
     * reader picks the one asked for by meaning.
     */
    readonly screenControls?: readonly ReaderScreenControl[] | undefined;
    /**
     * Q intelligence step 1: the situation header (date, their time, who
     * is asking, surface, page), built by code on the server.
     */
    readonly situation?: string | undefined;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
      /**
       * The run read for (live 2026-10-25: the reader's 2.5-4.5 s carried
       * no run, so a run's usage hid where its time went).
       */
      readonly qRunId?: string | undefined;
    };
    readonly signal?: AbortSignal | undefined;
    /**
     * Told, when the reading fails, whether it was because no reasoning
     * route could be reached at all (an exhausted account, a refused key,
     * an outage: `isModelServiceUnavailable`) rather than a model that was
     * asked and gave nothing usable. The person is told which (live
     * 2026-10-31). Never called for a cancelled reading.
     */
    readonly onFailure?:
      ((failure: { readonly serviceUnavailable: boolean }) => void) | undefined;
  }) => Promise<QTurnReading | null>;
};

/**
 * One turn's reading. `moreDocuments` (v9) and `sequence` (v11, R35) are
 * optional here so a reader that knows neither still fits; absent is none.
 */
export type QTurnReading = Omit<
  TurnReaderV15Result,
  "moreDocuments" | "sequence" | "addressedToQ" | "question"
> & {
  /**
   * v56: a FIT question may carry `excludeShown` -- they want companies
   * other than those Q already showed in this conversation. Optional so a
   * reading without it fits; absent is false.
   */
  readonly question:
    | (Omit<NonNullable<TurnReaderV15Result["question"]>, "kind"> & {
        /** v58: INVESTOR_PROSPECTS joins the earlier kinds. */
        readonly kind: QuestionKindV58;
        readonly excludeShown?: boolean | undefined;
        /**
         * v88 (owner live 14 Nov 2026, D1): they want companies other than
         * those they are already in contact with. Absent is false.
         */
        readonly excludeRelationships?: boolean | undefined;
        /**
         * v89 (audit 2026-11-15, RC2): the conditions they put on a list
         * (relationship, revenue, inside or outside the mandate, best or
         * worst first). Absent or null: none stated.
         */
        readonly listConditions?: TurnListConditionsV89 | null | undefined;
        /**
         * v90 (owner live 17 Nov 2026, run 333d9645): they ask why
         * companies fit or rank as they do -- the reasons, not the list
         * again. Absent is false.
         */
        readonly fitReasons?: boolean | undefined;
        /**
         * v91 (owner live 17 Nov 2026): the list ask narrows or trims the
         * list Q just showed (true) or asks for a new one (false). Absent
         * or null: not stated.
         */
        readonly refinesShownList?: boolean | null | undefined;
      })
    | null;
  /**
   * v93 (audit 2026-11-13 item 17): the turn asks about other parties'
   * interest or activity on a company or relationship, read by meaning.
   * Absent is false. Beside the word rule, never instead of it.
   */
  readonly othersActivity?: boolean | undefined;
  /**
   * v94 (live 18 Nov 2026, run cce59657): the turn asks whether the person
   * is in contact or has a relationship with particular companies (named,
   * shown or referred to). Absent is false; who is in contact is code's.
   */
  readonly contactStatus?: boolean | undefined;
  /**
   * v95 (HQ-1, 20 Nov 2026): the goal or the subject is unclear, and a
   * wrong guess would be costly. Code picks the answer's shape from these
   * (q-core answer-plan.ts). Absent is false; form only, never substance.
   */
  readonly underspecified?: boolean | undefined;
  readonly costlyIfWrong?: boolean | undefined;
  /** v15: false when spoken words were plainly for someone else. */
  readonly addressedToQ?: boolean | undefined;
  readonly moreDocuments?: TurnReaderV14Result["moreDocuments"] | undefined;
  readonly sequence?: TurnReaderV14Result["sequence"] | undefined;
  /** v22: they asked Q for a meeting with someone, or to take it over. */
  readonly handOver?: TurnReaderV22Result["handOver"] | undefined;
  /** v24: they told Q that what they said just before was not for it. */
  readonly earlierNotForQ?: boolean | undefined;
  /** v25: the whole spoken message is about ending the voice conversation. */
  readonly endVoice?: boolean | undefined;
  /** v27: they authorise saving research or findings into their own profile. */
  readonly saveToOwnProfile?: boolean | undefined;
  /** v31: the one declared app action a direct request asks for, as said. */
  readonly appAction?:
    | {
        readonly tool: string;
        readonly arguments: Readonly<Record<string, unknown>>;
      }
    | null
    | undefined;
  /** v30: the listed action's name that does what they asked, or null. */
  readonly askedAction?: string | null | undefined;
  /** v40: the one record they ask to open, and a repeat of Q's last action. */
  /** v64: the record may be a REHEARSAL with someone (QA F-98). */
  readonly reference?: TurnReaderV64Result["reference"] | undefined;
  /** v49: they hand Q's team a piece of work of several steps. */
  readonly teamJob?: boolean | undefined;
  /**
   * QO-07: the turn hands over work asked for or offered just before
   * ("yes, go ahead"). Read from TURN_READER v62; absent before it.
   */
  readonly workFromEarlier?: boolean | undefined;
  /** v52: they ask what to do next, what is missing, or how ready they are. */
  readonly nextSteps?: boolean | undefined;
  /**
   * v58: whom the turn is about -- the company, organisation or person, as
   * the reader understood it from the words and the recent turns. The only
   * name the public web and pictures are searched by.
   */
  readonly namedOther?: TurnReaderV58Result["namedOther"] | undefined;
  /** v58: they want to be made ready for a call with one named counterpart. */
  readonly meetingPrep?: TurnReaderV58Result["meetingPrep"] | undefined;
  /** v61: what they ask of their own work board (work-board lane). */
  readonly boardAsk?: TurnReaderV63Result["boardAsk"] | undefined;
  /** v62: companies they want put side by side (lane 8); never with fromShown. */
  readonly compare?: TurnReaderV62Result["compare"] | undefined;
  /**
   * v65: what the turn answers -- Q's last question or invitation, a
   * waiting card (and which), or nothing before it (new). Code's word
   * lists only decide when to wait for this.
   */
  readonly replyTo?: TurnReaderV65Result["replyTo"] | undefined;
  /** v65: whom a discovery ask is about (investors or companies). */
  readonly discoverWhom?: TurnReaderV65Result["discoverWhom"] | undefined;
  /**
   * v70 (situation-first planning): they ask for a plan of their own --
   * IMPROVE, GOAL or UPLOADED, the public research it needs, and whose
   * side -- read by meaning; null when no plan is asked.
   */
  readonly planAsk?: TurnReaderV70Result["planAsk"] | undefined;
  /** v70: they redirect work Q's team is already doing for them. */
  readonly directsWork?: boolean | undefined;
  /**
   * v74: the turn takes Q up on what Q's own last turn offered, read by
   * meaning. Code binds it to the offer it recorded with that turn.
   */
  readonly acceptsOffer?: boolean | undefined;
  /**
   * v75: the document asked for is an investment (IC, deal) memo on a
   * company other than their own, read by meaning. Code starts the
   * researched memo job for it (owner decision 2026-10-31).
   */
  readonly investmentMemo?: boolean | undefined;
  /** v55: the page control (a listed id) they ask to open or show now. */
  readonly control?: string | null | undefined;
  /** v54: the turn is answered by this earlier turn of Q's (SHOWN). */
  readonly fromShown?: TurnReaderV54Result["fromShown"] | undefined;
  /** v44: garbled spoken words, read by sound; null when read as written. */
  readonly heardAs?: string | null | undefined;
  /**
   * v77 (Q intelligence step 3): what the turn's pointing words mean, as
   * LEDGER refs read by meaning; code checks each against the ledger shown
   * to the person before anything binds. Absent before v77: none. v79: a
   * reference may carry `named`, a name written in the recent turns.
   */
  readonly references?: TurnReaderV79Result["references"] | undefined;
  /**
   * v78 (Q intelligence step 4): the heaviest work the turn asks of the
   * answer, read by meaning -- the one source of truth for the answer's
   * task class and comparison handling. Absent or null: not read; code
   * takes the neutral default, never a word list.
   */
  readonly answerKind?: TurnReaderV79Result["answerKind"] | undefined;
  /** v78: each separate thing a compound ask wants, in order; absent is one ask. */
  readonly parts?: TurnReaderV79Result["parts"] | undefined;
  /** v78: a fact they ask Q to keep in mind, said back in the second person. */
  readonly remember?: TurnReaderV79Result["remember"] | undefined;
  /**
   * v78: they ask for a chart, graph or plot. v82: true exactly when
   * `chart.wanted` is (derived here, so an older field never disagrees).
   */
  readonly asksForChart?: boolean | undefined;
  /**
   * v82 (A8, owner directive 13 Nov 2026): the chart asked for, read by
   * meaning -- the companies as said (empty: those in context), the
   * canonical metric or UNSPECIFIED, the period and whether it repeats the
   * previous chart. Code resolves, validates and draws; null: none asked.
   */
  readonly chart?: TurnReaderV82Result["chart"] | undefined;
  /**
   * v83/v84 (C10, owner directive and correction 13 Nov 2026): whether the
   * turn should change the page beside the conversation, by meaning -- GO
   * (moved at once), CONTEXT (the page-move decision places it, under its
   * guards; workspace only), OFFER_ONLY (offered) or NONE, and negated.
   * Where, and whether they may open it, stay code's. Absent or null: not
   * read, and code's documented word rules are the fallback. v87 (live 13
   * Nov 2026): `tab` names the part of a record page they mean (data room,
   * team, ...), by meaning; code keeps it only where the page has it.
   */
  readonly navigation?: TurnReaderV87Result["navigation"] | undefined;
  /**
   * v86 (A8, owner directive 13 Nov 2026): they ask to watch a company's
   * pitch, or about a company as a whole, read by meaning. Which company,
   * and whether they may see its picture or play its pitch, stay code's.
   * Absent or null: not read, and no media is added.
   */
  readonly companyMedia?: TurnReaderV86Result["companyMedia"] | undefined;
  /** v78: they ask for the public web, news or press. */
  readonly asksForWeb?: boolean | undefined;
  /** v28: a time they asked for, in minutes from now. */
  readonly timeWindow?:
    | { readonly fromMinutes: number | null; readonly toMinutes: number | null }
    | null
    | undefined;
};

/**
 * Small and fast: a classification in front of an answer the person is
 * waiting for. Two attempts so a single failing provider can fall back.
 * The output room is for a reasoning model's thinking as much as for the
 * JSON: at 300 tokens gpt-oss spent it all thinking and returned nothing,
 * which the provider refused as invalid JSON (local, 2026-09-24).
 */
/**
 * How long one reading attempt may take. Live 2026-10-30 (run 8bc5116c,
 * "Plan my raise over 8 weeks"): both attempts timed out at 6.0 s and the
 * re-read answered at 5,986 ms. ai_ops.model_usage, reads of 12k+ input
 * tokens on the first reader model: p90 4.5 s on 23 Oct rising to 5.7 s on 30 Oct,
 * with 6 s cut-offs 0-4 a day before and 8-9 a day since. Latency follows
 * the output (r 0.77; ~9 ms a token over ~270 tokens) on a fixed start
 * that grew from ~0.7 s to ~2.4 s as the input grew 13k -> 17k tokens. At
 * 6 s the cut-off sat at the day's p95, so a slow spell left turns unread;
 * 9 s is ~1.5x today's p90. A stall is still cut short by the hedge
 * (TURN_READER_SAME_MODEL_HEDGE_MS), not by this.
 */
export const TURN_READER_ATTEMPT_TIMEOUT_MS = 9_000;

/**
 * The cost bound fits a reading on the backup model (DECISIONS
 * 69: no smaller model for the reader). The gateway estimates an attempt
 * with no cache credit, ~31k input tokens at $2/M plus the output room:
 * ~$0.075, so $0.01 skipped the backup model for a smaller model. $0.15 leaves room
 * for the second attempt. It is a bound, not a spend: a reading on OpenAI
 * costs what it did.
 */
const TURN_READER_BUDGET = {
  // The model, its same-model hedge, then the policy's backup (live
  // 2026-11-16: see TURN_READER_SAME_MODEL_HEDGE_MS).
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.15,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: TURN_READER_ATTEMPT_TIMEOUT_MS,
} as const;

/**
 * Live 2026-10-29: 26 of 548 reads failed in 24 h (17 TIMEOUT), and an
 * unread planning ask became a research memo. A real customer's turn is
 * CONFIDENTIAL, and only the first reader model may carry it (both Gemini models are
 * PUBLIC; Groq's on-demand tier refuses a request this size, 413), so the
 * policy's hedge never had a second model. Still waiting at 3.5 s (p50
 * 2.0 s, p90 4.2 s, p99 5.5 s), the same model is asked again and the
 * first valid answer wins: about one read in six, ~USD 0.002 each.
 *
 * Live 2026-11-16 (scenarios D-G, runs d58a4564, 11daded9, 7cef5d87,
 * 06de74f3): the FAST_CLASSIFICATION policy (v2) hedges to its backup,
 * the backup model, at 2.0 s, and under the synthetic posture the first model was
 * also cut at 2.5 s (TURN_READER_FAST_FIRST_ATTEMPT_MS, measured on Gemini
 * an earlier first model in October, no longer the first model). ai_ops.model_usage,
 * the last 24 h: the first model 709 first reads, 106 cut at 2.5 s (15%), answered
 * p50 1.50 s, p90 2.35 s, p95 2.44 s, p99 2.74 s; the backup model ran on 239 of them
 * for USD 2.97 of the day's USD 3.93 reader spend, up to USD 0.058 a read
 * (~37k input tokens, ~4x a whole fresh turn). Now the read is hedged on
 * the first model itself at its observed p95 (2.5 s), each the first model attempt cut at 4 s
 * (TURN_READER_FIRST_ATTEMPT_MS), and
 * the backup model is asked only when the first model has failed twice (sameModelHedgeFirst;
 * DECISIONS 69 keeps the backup model as the reader's backup -- never a smaller
 * model). The gateway logs a hedge and a fallback, with the cost.
 */
export const TURN_READER_SAME_MODEL_HEDGE_MS = 2_500;

/**
 * How long each the first model attempt (the first and its hedge) may take before the
 * backup is asked, in every posture. ai_ops.model_usage, 10 days to
 * 2026-11-16: 2,193 successful the first model reads, 2,175 inside 3.0 s, 16 in
 * 3.0-4.0 s, 3 over 4.0 s (0.14%). Live run 04d46602 (13:01 UTC): three
 * the first model classifications hung together and the backup then took 8.8 s, so a
 * hung attempt must end well before the 9 s budget. Worst case now: the
 * first cut at 4.0 s, its hedge (from 2.5 s) at 6.5 s, then the backup.
 */
export const TURN_READER_FIRST_ATTEMPT_MS = 4_000;

/**
 * The reader's thinking (owner 2026-11-06: "measure first, then reader
 * thinking off with spot checks"). Live Q-IQ run 2: the reader took 4-5 s
 * before the answer could start, the largest single wait of a turn, at
 * LOW. Its latency follows its output tokens (~9 ms a token, above), and a
 * reasoning model's thinking is output. A closed classification into a
 * fixed schema is read with no thinking; left unset, a reasoning model
 * thinks at length, so it is set, never left to the model's default.
 *
 * The level is also keyed (TURN_READ), so it is versioned data as well as
 * code: a FAST_CLASSIFICATION routing policy whose reasoning_levels lists
 * TURN_READ overrides NONE without a deploy (step 7's
 * reasoningUnderPolicy). No policy lists it today; a spot check that
 * regresses is rolled back by writing {"TURN_READ": "LOW"} there.
 */
export const TURN_READER_REASONING = "NONE" as const;
export const TURN_READER_REASONING_KEY = "TURN_READ";

/**
 * The reader's action list budget (HARDEN, 2026-10-02: the app-action
 * registry grows toward 60-80 entries). Offered actions are listed first
 * and never cut below this; declared-but-not-offered ones fill what is
 * left, briefly. A test in q-specialists fails when the registry's acting
 * tools outgrow it, and an over-budget turn is logged, never silent.
 */
export const TURN_READER_ACTIONS_MAX = 160;

/**
 * The grouped form (v32): areas in the order their first offered action
 * appears (the app actions lead), each "Area: name (short); name (short)";
 * then one "Not available here" line per area with names only.
 */
function groupedActions(
  offered: readonly {
    readonly name: string;
    readonly does: string;
    readonly short?: string | undefined;
    readonly area?: string | undefined;
  }[],
  declared: readonly {
    readonly name: string;
    readonly area?: string | undefined;
  }[],
): string {
  const label = (action: {
    readonly does: string;
    readonly short?: string | undefined;
  }) =>
    (action.short ?? action.does.split(/[.;:]/u)[0] ?? action.does)
      .trim()
      .slice(0, 60);
  const byArea = <T extends { readonly area?: string | undefined }>(
    list: readonly T[],
  ): Map<string, T[]> => {
    const areas = new Map<string, T[]>();
    for (const action of list) {
      const area = action.area ?? "Other";
      areas.set(area, [...(areas.get(area) ?? []), action]);
    }
    return areas;
  };
  const lines: string[] = [];
  for (const [area, list] of byArea(offered)) {
    lines.push(
      `${area}: ${list
        .map((action) => `${action.name.slice(0, 80)} (${label(action)})`)
        .join("; ")}`,
    );
  }
  for (const [area, list] of byArea(declared)) {
    lines.push(
      `Not available here, ${area}: ${list
        .map((action) => action.name.slice(0, 80))
        .join(", ")}`,
    );
  }
  return lines.length === 0 ? "(none)" : lines.join("\n");
}

/** The actions as the reader is told of them, within the budget. */
export function readerActions(
  actions: readonly {
    readonly name: string;
    readonly does: string;
    readonly available?: boolean | undefined;
    /** A few words for the grouped list (v32); absent: does, cut. */
    readonly short?: string | undefined;
    /** The area it is grouped under (v32); absent: "Other". */
    readonly area?: string | undefined;
  }[],
): {
  readonly listed: readonly { readonly name: string; readonly does: string }[];
  /** v32: one line per area -- offered "name (short)", then names only. */
  readonly groups: string;
  readonly droppedOffered: readonly string[];
  readonly droppedDeclared: number;
} {
  const offered = actions.filter((action) => action.available !== false);
  const declared = actions.filter((action) => action.available === false);
  const keptOffered = offered.slice(0, TURN_READER_ACTIONS_MAX);
  const room = Math.max(0, TURN_READER_ACTIONS_MAX - keptOffered.length);
  const keptDeclared = declared.slice(0, room);
  return {
    listed: [
      ...keptOffered.map((action) => ({
        name: action.name.slice(0, 80),
        does: action.does.slice(0, 240),
      })),
      ...keptDeclared.map((action) => ({
        name: action.name.slice(0, 80),
        does: `(not available in this conversation) ${action.does.slice(0, 80)}`,
      })),
    ],
    groups: groupedActions(keptOffered, keptDeclared),
    droppedOffered: offered
      .slice(TURN_READER_ACTIONS_MAX)
      .map((action) => action.name),
    droppedDeclared: declared.length - keptDeclared.length,
  };
}

/** Reading fields whose malformed value is dropped, not the reading. */
export const TURN_READER_LENIENT_FIELDS: readonly string[] = [
  "tool",
  "moreDocuments",
  "control",
  // v54: a malformed pointer back costs the pointer, never the reading.
  "fromShown",
  // v58: a malformed subject costs the subject, never the reading.
  "namedOther",
  // v58: a malformed counterpart costs the prep, never the reading.
  "meetingPrep",
  // v61: a malformed board ask costs the ask, never the reading.
  "boardAsk",
  // v62: a malformed hand-back costs the hand-back, never the reading.
  "workFromEarlier",
  // v62: a malformed comparison costs the comparison, never the reading.
  "compare",
  // v65: a malformed reply or discovery target costs itself, never the reading.
  "replyTo",
  "discoverWhom",
  // v70: a malformed plan ask or direction costs itself, never the reading.
  "planAsk",
  "directsWork",
  // v74: a malformed acceptance is no acceptance, never a lost reading.
  "acceptsOffer",
  // v75: a malformed memo reading is no memo, never a lost reading.
  "investmentMemo",
  // v77: malformed references bind nothing, never a lost reading.
  "references",
  // v78: a malformed kind or part costs itself, never the reading.
  "answerKind",
  "parts",
  "remember",
  "asksForChart",
  "asksForWeb",
  // v82: a malformed chart intent is no chart intent, never a lost reading.
  "chart",
  // v83: a malformed navigation intent is not read (word fallback), never a lost reading.
  "navigation",
  // v86: a malformed company media ask is no media, never a lost reading.
  "companyMedia",
];

/** One control of the page on screen, as the reader is told of it (v55). */
export type ReaderScreenControl = {
  readonly id: string;
  readonly kind: string;
  readonly state?: string | undefined;
  readonly label?: string | undefined;
};

/** Kinds the reader may choose: what a person opens or looks at. */
const READER_CONTROL_KINDS: ReadonlySet<string> = new Set(["TAB", "SECTION"]);

/**
 * v54: the page's tabs and sections, one per line as
 * "id (kind, visible name, state)"; "(none)" when it has none.
 */
export function readerScreenControls(
  controls: readonly ReaderScreenControl[] | undefined,
): string {
  const lines = (controls ?? [])
    .filter((control) => READER_CONTROL_KINDS.has(control.kind))
    .slice(0, 48)
    .map((control) => {
      const parts = [
        control.kind,
        ...(control.label === undefined ? [] : [control.label.slice(0, 48)]),
        ...(control.state === undefined ? [] : [control.state]),
      ];
      return `${control.id.slice(0, 80)} (${parts.join(", ")})`;
    });
  return lines.length === 0 ? "(none)" : lines.join("\n");
}

/** Said once after a refused reading: what to fix, never the reading. */
export const TURN_READER_CORRECTION =
  "Your last reading did not match the required JSON schema, so it was refused. Answer again with exactly the schema's fields. A tool carries only its own kind's parameters (NAVIGATE: destination or unknownScreen; SET_VISIBILITY: visibility; PREPARE_DOCUMENT: documentType), the others null. A declared action such as a reminder, a meeting or a message goes in appAction or askedAction, never in tool. Use null for anything you are unsure of.";

/**
 * How much of each recent turn the reader sees (its prompt budget). v76
 * (Q intelligence step 2): 1,600, up from 400 -- the reader routes every
 * turn and a pronoun's antecedent is often past the first 400 characters.
 */
export const TURN_READER_TURN_TEXT_MAX = TURN_READER_V76_TURN_TEXT_MAX;
/** How many recent turns it sees whole; older ones reach it summarised. */
export const TURN_READER_RECENT_TURNS_MAX = TURN_READER_V76_RECENT_TURNS_MAX;
const TURN_TEXT_TAIL = 400;

/**
 * A recent turn as the reader sees it: whole when short; otherwise its
 * opening and its close. Q's offer or question ("…say so and I'll build
 * it.") is its last line, and a bare "yes" means nothing without it
 * (owner 2026-10-30: the head alone cut the offer that closes the answer
 * to "What should I do today?").
 */
export function turnTextForReader(text: string): string {
  if (text.length <= TURN_READER_TURN_TEXT_MAX) return text;
  const head = TURN_READER_TURN_TEXT_MAX - TURN_TEXT_TAIL - 3;
  return `${text.slice(0, head).trimEnd()} … ${text.slice(-TURN_TEXT_TAIL).trimStart()}`;
}

export function createQTurnReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** The person's words; CONFIDENTIAL keeps them off ineligible providers. */
  readonly sensitivity?: ModelSensitivity | undefined;
  /**
   * Doc 15 §62, as every other Q caller declares it: on a deployment that
   * attested its material is synthetic, a faster shared model may read the
   * turn (the routing policy prefers one for FAST_CLASSIFICATION). Absent
   * is REAL_CUSTOMER, where the sensitivity ceiling keeps it off them.
   */
  readonly dataPosture?: ModelDataPosture | undefined;
}): QTurnReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    read: async (input) => {
      const utterance = input.utterance.trim().slice(0, 2_000);
      if (utterance.length === 0) return null;
      const listed = readerActions(input.actions ?? []);
      if (listed.droppedOffered.length > 0 || listed.droppedDeclared > 0) {
        logger.warn(
          {
            droppedOffered: listed.droppedOffered,
            droppedDeclared: listed.droppedDeclared,
            max: TURN_READER_ACTIONS_MAX,
          },
          "the turn reader's action list is over budget",
        );
      }
      const variables: Omit<
        TurnReaderV76Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        recentTurns: input.recentTurns
          .slice(-TURN_READER_RECENT_TURNS_MAX)
          .map((turn) => ({
            role: turn.role,
            text: turnTextForReader(turn.text),
          })),
        utterance,
        modality: input.modality,
        conversationState: orEmptyCase(
          (input.conversationState ?? "").slice(0, 8_200),
          "(nothing yet)",
        ),
        // What this run offers first, in full; then, briefly, what the
        // registry declares that this run does not offer (v30 askedAction),
        // within TURN_READER_ACTIONS_MAX.
        actions: [...listed.listed],
        actionGroups: listed.groups,
        screenControls: readerScreenControls(input.screenControls),
        // Bounded by the schema; the newest turns are kept by its builder.
        // Nothing shown yet is said so: the rules about SHOWN ("when
        // nothing was shown yet") key on it (PROMPT_EMPTY_CASES).
        // Q intelligence step 1: the situation leads Capital Q's own record
        // in the tail, not the charter, so the cached prefix stays the same
        // from turn to turn.
        shown: [
          ...(input.situation === undefined ? [] : [input.situation]),
          orEmptyCase(
            (input.shown ?? "").slice(
              0,
              9_000 -
                (input.situation === undefined
                  ? 0
                  : input.situation.length + 1),
            ),
            PROMPT_EMPTY_CASES.TURN_READER.shown,
          ),
        ].join("\n"),
      };
      try {
        const rendered = renderPrompt<TurnReaderV76Variables>(registry, {
          task: "TURN_READER",
          charter: "Q_SYSTEM",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You classify one turn and nothing else; Capital Q decides what follows from it.",
          variables,
        });
        const ask = (
          messages: typeof rendered.messages,
        ): ReturnType<typeof gateway.execute<TurnReaderV95Result>> =>
          gateway.execute<TurnReaderV95Result>(
            {
              taskClass: "FAST_CLASSIFICATION",
              reasoning: TURN_READER_REASONING,
              reasoningKey: TURN_READER_REASONING_KEY,
              sensitivity,
              ...(dependencies.dataPosture === undefined
                ? {}
                : { dataPosture: dependencies.dataPosture }),
              budget: TURN_READER_BUDGET,
              messages: [...messages],
              output: rendered.output,
              attribution: input.attribution,
            },
            {
              schema: TurnReaderV95ResultSchema,
              // Live 2026-10-13: a reading that wrote a tool's own fields at
              // the root was refused and re-asked (~3.3 s of a ~6 s wait
              // before the answer started). Those keys mean nothing at the
              // root; the reading is kept and its tool stays unread (null).
              unknownRootKeys: "DROP",
              // Live 2026-10-16 ("tool:custom"): a tool written with another
              // kind's parameters failed the tool's own refinement, and the
              // whole reading was refused -- "Set me a reminder…" then went
              // to the general answer, which asked for the city itself. A
              // malformed hand costs the hand (read as none), never the
              // reading: its kind, appAction and askedAction still route it.
              lenientFields: TURN_READER_LENIENT_FIELDS,
              sameModelHedgeAfterMs: TURN_READER_SAME_MODEL_HEDGE_MS,
              sameModelHedgeFirst: true,
              firstAttemptTimeoutMs: TURN_READER_FIRST_ATTEMPT_MS,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
        let response: Awaited<ReturnType<typeof ask>>;
        try {
          response = await ask(rendered.messages);
        } catch (error: unknown) {
          // Still refused: once more, told what was wrong, before the turn
          // is answered unread. Never for a cancellation or a provider
          // failure, which a correction cannot help.
          if (
            !isModelGatewayError(error) ||
            error.failureClass !== "INVALID_MODEL_OUTPUT"
          ) {
            throw error;
          }
          logger.info(
            { correlationId: input.attribution.correlationId },
            "the turn reading was refused; asked once more with a correction",
          );
          response = await ask([
            ...rendered.messages,
            { role: "USER", content: TURN_READER_CORRECTION },
          ]);
        }
        if (response.fallbackUsed) {
          // Its cost is a reader's concern (live 2026-11-16: up to USD
          // 0.058 a read on the backup): said once per read, with it.
          logger.warn(
            {
              correlationId: input.attribution.correlationId,
              qRunId: input.attribution.qRunId,
              attempts: response.attempts.length,
              costUsd: response.cost.amount,
            },
            "the turn was read by the policy's backup model",
          );
        }
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = TurnReaderV95ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        // v82: one source of truth for "a chart was asked for" -- the
        // typed intent; asksForChart is kept for compatibility, derived.
        const chart =
          parsed.data.chart?.wanted === true ? parsed.data.chart : null;
        // A comparison is never answered from an earlier turn (lane 4).
        // v83: "don't open it, just tell me" asks for no move, whatever
        // mode was written beside it.
        const navigation =
          parsed.data.navigation?.negated === true
            ? {
                mode: "NONE" as const,
                negated: true,
                destination: null,
                tab: null,
              }
            : parsed.data.navigation;
        return compareOverFromShown({
          ...parsed.data,
          chart,
          asksForChart: chart !== null || parsed.data.asksForChart,
          navigation,
        });
      } catch (error: unknown) {
        if (!(
          isModelGatewayError(error) && error.failureClass === "CANCELLED"
        )) {
          logger.warn({ err: error }, "a turn to Q was not read");
          input.onFailure?.({
            serviceUnavailable: isModelServiceUnavailable(error),
          });
        }
        return null;
      }
    },
  };
}
