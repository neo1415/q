import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TurnReaderV62ResultSchema,
  compareOverFromShown,
  type PromptRegistry,
  type QuestionKindV58,
  type TurnReaderV14Result,
  type TurnReaderV15Result,
  type TurnReaderV22Result,
  type TurnReaderV40Result,
  type TurnReaderV54Result,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
  type TurnReaderV62Result,
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
  readonly reference?: TurnReaderV40Result["reference"] | undefined;
  /** v49: they hand Q's team a piece of work of several steps. */
  readonly teamJob?: boolean | undefined;
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
  /** v61/v62: what they ask of their own work board (work-board lane). */
  readonly boardAsk?: TurnReaderV62Result["boardAsk"] | undefined;
  /** v62: companies they want put side by side (lane 8); never with fromShown. */
  readonly compare?: TurnReaderV62Result["compare"] | undefined;
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
const TURN_READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.01,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 6_000,
} as const;

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
          text: turn.text.slice(0, 400),
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
        shown: (input.shown ?? "").slice(0, 9_000),
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
        ): ReturnType<typeof gateway.execute<TurnReaderV62Result>> =>
          gateway.execute<TurnReaderV62Result>(
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
              schema: TurnReaderV62ResultSchema,
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
        const parsed = TurnReaderV62ResultSchema.safeParse(
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
