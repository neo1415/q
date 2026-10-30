import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  orEmptyCase,
  PROMPT_EMPTY_CASES,
  renderPrompt,
  TurnReaderV74ResultSchema,
  compareOverFromShown,
  type PromptRegistry,
  type QuestionKindV58,
  type TurnReaderV14Result,
  type TurnReaderV15Result,
  type TurnReaderV22Result,
  type TurnReaderV54Result,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
  type TurnReaderV62Result,
  type TurnReaderV63Result,
  type TurnReaderV64Result,
  type TurnReaderV65Result,
  type TurnReaderV70Result,
  type TurnReaderV74Result,
} from "@capital-q/q-core";

import { isModelGatewayError } from "../errors.js";
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
      })
    | null;
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
  /** v55: the page control (a listed id) they ask to open or show now. */
  readonly control?: string | null | undefined;
  /** v54: the turn is answered by this earlier turn of Q's (SHOWN). */
  readonly fromShown?: TurnReaderV54Result["fromShown"] | undefined;
  /** v44: garbled spoken words, read by sound; null when read as written. */
  readonly heardAs?: string | null | undefined;
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
 * tokens on gpt-5.6-luna: p90 4.5 s on 23 Oct rising to 5.7 s on 30 Oct,
 * with 6 s cut-offs 0-4 a day before and 8-9 a day since. Latency follows
 * the output (r 0.77; ~9 ms a token over ~270 tokens) on a fixed start
 * that grew from ~0.7 s to ~2.4 s as the input grew 13k -> 17k tokens. At
 * 6 s the cut-off sat at the day's p95, so a slow spell left turns unread;
 * 9 s is ~1.5x today's p90. A stall is still cut short by the hedge
 * (TURN_READER_SAME_MODEL_HEDGE_MS), not by this.
 */
export const TURN_READER_ATTEMPT_TIMEOUT_MS = 9_000;

const TURN_READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: TURN_READER_ATTEMPT_TIMEOUT_MS,
} as const;

/**
 * Live 2026-10-29: 26 of 548 reads failed in 24 h (17 TIMEOUT), and an
 * unread planning ask became a research memo. A real customer's turn is
 * CONFIDENTIAL, and only gpt-5.6-luna may carry it (both Gemini models are
 * PUBLIC; Groq's on-demand tier refuses a request this size, 413), so the
 * policy's hedge never had a second model. Still waiting at 3.5 s (p50
 * 2.0 s, p90 4.2 s, p99 5.5 s), the same model is asked again and the
 * first valid answer wins: about one read in six, ~USD 0.002 each.
 */
export const TURN_READER_SAME_MODEL_HEDGE_MS = 3_500;

/**
 * How long the first model gets when a synthetic-demo posture routes the
 * read to the fast shared model first and another waits behind it. Measured
 * 2026-10-01 (ai_ops.model_usage, 72 h, Gemini flash-lite): 66 reads
 * answered, p90 1.4 s, p99 3.2 s, only 4 over 2.5 s; 8 hung to the 6 s
 * deadline, each a 6 s stall before the fallback read the turn. At 2.5 s a
 * hung read costs 2.5 s and the fallback keeps its full 6 s. Not applied to
 * other postures, where the first model is the slower one (p50 ~2 s).
 */
export const TURN_READER_FAST_FIRST_ATTEMPT_MS = 2_500;

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

/** How much of each recent turn the reader sees (its prompt budget). */
export const TURN_READER_TURN_TEXT_MAX = 400;
const TURN_TEXT_TAIL = 140;

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
        TurnReaderV55Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        recentTurns: input.recentTurns.slice(-6).map((turn) => ({
          role: turn.role,
          text: turnTextForReader(turn.text),
        })),
        utterance,
        modality: input.modality,
        // What this run offers first, in full; then, briefly, what the
        // registry declares that this run does not offer (v30 askedAction),
        // within TURN_READER_ACTIONS_MAX.
        actions: [...listed.listed],
        actionGroups: listed.groups,
        screenControls: readerScreenControls(input.screenControls),
        // Bounded by the schema; the newest turns are kept by its builder.
        // Nothing shown yet is said so: the rules about SHOWN ("when
        // nothing was shown yet") key on it (PROMPT_EMPTY_CASES).
        shown: orEmptyCase(
          (input.shown ?? "").slice(0, 9_000),
          PROMPT_EMPTY_CASES.TURN_READER.shown,
        ),
      };
      try {
        const rendered = renderPrompt<TurnReaderV55Variables>(registry, {
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
        ): ReturnType<typeof gateway.execute<TurnReaderV74Result>> =>
          gateway.execute<TurnReaderV74Result>(
            {
              taskClass: "FAST_CLASSIFICATION",
              // A closed classification needs little thought; left unset, a
              // reasoning model thinks at length before a one-line answer.
              reasoning: "LOW",
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
              schema: TurnReaderV74ResultSchema,
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
              ...(input.signal === undefined ? {} : { signal: input.signal }),
              ...(dependencies.dataPosture === "SYNTHETIC_DEMO"
                ? { firstAttemptTimeoutMs: TURN_READER_FAST_FIRST_ATTEMPT_MS }
                : {}),
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
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = TurnReaderV74ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        // A comparison is never answered from an earlier turn (lane 4).
        return parsed.success ? compareOverFromShown(parsed.data) : null;
      } catch (error: unknown) {
        if (!(
          isModelGatewayError(error) && error.failureClass === "CANCELLED"
        )) {
          logger.warn({ err: error }, "a turn to Q was not read");
        }
        return null;
      }
    },
  };
}
