/**
 * The GPT-Live client delegation bridge (workstream V).
 *
 * GPT-Live is the voice; Q Brain is the authority. When the voice decides
 * a turn needs the backend it emits `session.delegation.created`, which
 * carries an id and nothing else (OpenAI live-delegation guide). This
 * bridge rebuilds the request from the transcript it has kept, asks Q
 * Brain once per delegation id, and hands back only what Q verified:
 *
 * - one delegation id → one Q run, whatever the provider repeats;
 * - an interruption never starts or cancels a run (the voice yielding the
 *   floor is not "cancel"); cancelling is explicit and confirmed first;
 * - a newer delegation supersedes an older one: the older result is kept
 *   as quiet context (`session.thinking.append`) so "the second one" keeps
 *   its referent, but it is never spoken over the newer question;
 * - progress is said at most once, quietly, never as filler.
 *
 * Dependency-free (no React, no DOM, no Zod) so the browser preview and
 * the recording harness (Node type stripping) run the same code.
 */

export type LiveServerEvent = {
  readonly type: string;
  readonly [key: string]: unknown;
};

export type LiveClientEvent = {
  readonly type:
    | "session.commentary.append"
    | "session.thinking.append"
    | "session.instructions.append";
  readonly event_id: string;
  readonly delegation_id: string | null;
  readonly content: string;
};

/** What Q Brain answered for one delegation. */
export type DelegationOutcome = {
  /** Verified facts or Q's own words, for the voice to say in its words. */
  readonly commentary: string | null;
  /** The server already knows a newer delegation replaced this one. */
  readonly stale?: boolean | undefined;
  /** Q prepared something that waits for the person's approval on screen. */
  readonly approvalPending?: boolean | undefined;
  /** Q could not answer; `commentary` then says so truthfully. */
  readonly failed?: boolean | undefined;
  /** Q's run moved the screen (followed before it is spoken). */
  readonly moved?: boolean | undefined;
};

export type DelegationRequest = {
  readonly delegationId: string;
  /** The person's words since the previous delegation. */
  readonly request: string;
  /** The recent exchange, oldest first, so references resolve. */
  readonly context: readonly {
    readonly role: "user" | "q";
    readonly text: string;
  }[];
};

export type Timers = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type LiveBridgeDependencies = {
  /** Sends one client event to the provider (data channel or socket). */
  readonly send: (event: LiveClientEvent) => void;
  /** Q Brain, once per delegation id. */
  readonly delegate: (request: DelegationRequest) => Promise<DelegationOutcome>;
  /** Asks the server to stop a run; true only once it confirmed. */
  readonly cancel?: ((delegationId: string) => Promise<boolean>) | undefined;
  readonly newEventId: () => string;
  readonly now: () => number;
  readonly timers?: Timers | undefined;
  /** How long the transcript may settle before the request is read. */
  readonly settleMs?: number | undefined;
  /**
   * The call opening (founder 2026-10-09): a warm hello at once, then the
   * lowdown when Q Brain's briefing lands. GPT-Live does not speak first on
   * its own (recorded 2026-10-09), so the app starts both: the greeting as
   * session instructions, the briefing as its own Q run, spoken through
   * commentary when it arrives. A question of theirs asked before it lands
   * supersedes it (kept as quiet context, never spoken over them).
   */
  readonly opening?:
    | {
        readonly greeting: string;
        /** A Q run for the briefing, spoken when it lands. */
        readonly request?: string | undefined;
        /**
         * Or Q's opening already in hand (the surface's first message, Q's
         * own verified words): said in the voice's own words at once.
         */
        readonly content?: string | undefined;
      }
    | undefined;
  /**
   * When a still-running delegation gets its one progress line (founder
   * 2026-10-09: silence while a 25 s answer worked read as "can you do it
   * or not"). Spoken once, in the voice's own words; never repeated.
   */
  readonly progressAfterMs?: number | undefined;
  readonly onChange?: ((state: LiveBridgeState) => void) | undefined;
  /**
   * Runs before a result is spoken. Returns what the voice must know about
   * the screen (the move's receipt), or null. A run that moved the screen
   * is followed and its receipt awaited here, so the voice never says a
   * page is open before it is (founder live 2026-10-09).
   */
  readonly beforeSpeak?:
    ((outcome: DelegationOutcome) => Promise<string | null>) | undefined;
};

export type DelegationStatus =
  | "WAITING_FOR_WORDS"
  | "RUNNING"
  | "SPOKEN"
  | "SUPERSEDED"
  | "FAILED"
  | "CANCELLED";

export type DelegationRecord = {
  readonly id: string;
  /** The provider's delegation id; null for the app's own (the opening). */
  readonly providerId: string | null;
  request: string;
  status: DelegationStatus;
  readonly createdAt: number;
  answeredAt?: number | undefined;
  commentary?: string | null | undefined;
  approvalPending?: boolean | undefined;
};

export type LiveBridgeState = {
  readonly delegations: readonly DelegationRecord[];
  readonly transcript: readonly {
    readonly role: "user" | "q";
    readonly text: string;
  }[];
  /** Client events the provider acknowledged, and ones it refused. */
  readonly acked: number;
  readonly refused: readonly {
    readonly eventId: string;
    readonly message: string;
  }[];
};

export type LiveBridge = {
  /** Feed every provider event here, in order. */
  readonly handle: (event: LiveServerEvent) => void;
  /** Explicit cancel; true only when the server confirmed it. */
  readonly cancel: (delegationId: string) => Promise<boolean>;
  /**
   * Typed words while the call is open: straight to Q Brain (the provider
   * does not hear them), the verified answer spoken like any other.
   */
  readonly typed: (text: string) => void;
  readonly state: () => LiveBridgeState;
};

/** OpenAI caps each append at 500 tokens; characters are a safe bound. */
export const LIVE_APPEND_MAX_CHARS = 1_800;
const CONTEXT_TURNS = 8;
const SETTLE_MAX_MS = 1_500;
const OPENING_ID = "opening";
const TRANSCRIPT_KEPT = 60;

export function boundedContent(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= LIVE_APPEND_MAX_CHARS
    ? clean
    : `${clean.slice(0, LIVE_APPEND_MAX_CHARS - 1)}…`;
}

const defaultTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function createLiveBridge(deps: LiveBridgeDependencies): LiveBridge {
  const timers = deps.timers ?? defaultTimers;
  const settleMs = deps.settleMs ?? 400;
  const progressAfterMs = deps.progressAfterMs ?? 5_000;
  // The transcript as the provider streamed it, both sides, in turns. A
  // turn changes side when the other side's delta arrives.
  const transcript: { role: "user" | "q"; text: string }[] = [];
  // The index of the first transcript turn not yet asked about.
  let askedUpTo = 0;
  // Words after a delegation read its request start a turn of their own,
  // even mid-utterance: they belong to the next request, not that one.
  let boundary = false;
  let lastInputAt = 0;
  const delegations = new Map<string, DelegationRecord>();
  const order: string[] = [];
  let acked = 0;
  const refused: { eventId: string; message: string }[] = [];
  const pendingEvents = new Set<string>();
  let openingStarted = false;
  let typedCount = 0;

  const changed = () => deps.onChange?.(snapshot());
  const snapshot = (): LiveBridgeState => ({
    delegations: order.flatMap((id) => {
      const record = delegations.get(id);
      return record === undefined ? [] : [{ ...record }];
    }),
    transcript: transcript.map((turn) => ({ ...turn })),
    acked,
    refused: [...refused],
  });

  const append = (role: "user" | "q", delta: string) => {
    if (delta.length === 0) return;
    const last = transcript[transcript.length - 1];
    if (last !== undefined && last.role === role && !boundary) {
      last.text += delta;
    } else transcript.push({ role, text: delta });
    boundary = false;
    if (transcript.length > TRANSCRIPT_KEPT) {
      const drop = transcript.length - TRANSCRIPT_KEPT;
      transcript.splice(0, drop);
      askedUpTo = Math.max(0, askedUpTo - drop);
    }
  };

  const send = (
    type: LiveClientEvent["type"],
    delegationId: string | null,
    content: string,
  ) => {
    const eventId = deps.newEventId();
    pendingEvents.add(eventId);
    deps.send({
      type,
      event_id: eventId,
      delegation_id: delegationId,
      content: boundedContent(content),
    });
  };

  /** The person's words since the last delegation (falls back to their last turn). */
  const readRequest = (): string => {
    const words = transcript
      .slice(askedUpTo)
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.text.trim())
      .filter((text) => text.length > 0);
    if (words.length > 0) return words.join(" ");
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const turn = transcript[i];
      if (turn?.role === "user" && turn.text.trim().length > 0)
        return turn.text.trim();
    }
    return "";
  };

  const contextBefore = () =>
    transcript
      .slice(Math.max(0, transcript.length - CONTEXT_TURNS))
      .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
      .filter((turn) => turn.text.length > 0);

  const run = (record: DelegationRecord, fixed?: string) => {
    if (fixed === undefined) {
      record.request = readRequest();
      askedUpTo = transcript.length;
      boundary = true;
    } else {
      record.request = fixed;
    }
    record.status = "RUNNING";
    changed();
    let progressed = false;
    const progress = timers.setTimeout(() => {
      if (record.status !== "RUNNING" || progressed) return;
      progressed = true;
      // One spoken line, in the voice's own words, about what is coming;
      // never the result, never repeated.
      send(
        "session.commentary.append",
        record.providerId,
        `Q's backend is still working on: "${record.request}". Say once, in a few natural, specific words, what you are getting for them (for example "pulling your best mandate fits now"), then keep the conversation going. Do not guess the result, do not apologise, and do not say this again.`,
      );
    }, progressAfterMs);
    void deps
      .delegate({
        delegationId: record.id,
        request: record.request,
        context: contextBefore(),
      })
      .then(
        async (outcome) => {
          timers.clearTimeout(progress);
          const note =
            deps.beforeSpeak === undefined
              ? null
              : await deps.beforeSpeak(outcome).catch(() => null);
          settle(
            record,
            note === null || outcome.commentary === null
              ? outcome
              : { ...outcome, commentary: `${note} ${outcome.commentary}` },
          );
        },
        () => {
          timers.clearTimeout(progress);
          settle(record, {
            commentary:
              "Q's backend could not complete that request. Say so plainly and offer to try again; do not invent an answer.",
            failed: true,
          });
        },
      );
  };

  const settle = (record: DelegationRecord, outcome: DelegationOutcome) => {
    if (record.status === "CANCELLED") return;
    record.answeredAt = deps.now();
    record.commentary = outcome.commentary;
    record.approvalPending = outcome.approvalPending;
    const index = order.indexOf(record.id);
    const statusOf = (id: string) => delegations.get(id)?.status;
    const working = (id: string) =>
      statusOf(id) === "RUNNING" || statusOf(id) === "WAITING_FOR_WORDS";
    const newer = order.slice(index + 1);
    // Recorded live (2026-10-09): a nudge ("still waiting, can you do it or
    // not") was delegated too; its empty answer came back first and was
    // spoken ("I can't confirm…") while the real answer was still working.
    // A failed answer is never spoken while an earlier request works on.
    if (outcome.failed === true && order.slice(0, index).some(working)) {
      record.status = "FAILED";
      send(
        "session.thinking.append",
        record.providerId,
        `Nothing came back for "${record.request}". Their earlier request is still being worked on: if they are waiting, tell them it is on its way; do not say you can't do it.`,
      );
      changed();
      return;
    }
    // Spoken unless a newer request has already been answered: a slow
    // verified answer is the freshest they can have while the newer ones
    // still work or came back empty (the founder's nudges must never cost
    // them the answer they waited for).
    const superseded = newer.some((id) => statusOf(id) === "SPOKEN");
    const newerPending = !superseded && newer.length > 0;
    if (outcome.commentary === null || outcome.commentary.length === 0) {
      record.status = superseded ? "SUPERSEDED" : "SPOKEN";
      changed();
      return;
    }
    if (superseded) {
      // Kept for reference ("the second one"), never spoken over the
      // newer question.
      record.status = "SUPERSEDED";
      send(
        "session.thinking.append",
        record.providerId,
        `Earlier request "${record.request}" (replaced by a newer one; do not answer it now unless asked): ${outcome.commentary}`,
      );
    } else {
      record.status = outcome.failed === true ? "FAILED" : "SPOKEN";
      send(
        "session.commentary.append",
        record.providerId,
        newerPending
          ? `This answers their earlier request "${record.request}"; if they have since asked for something different, say it briefly. ${outcome.commentary}`
          : outcome.commentary,
      );
    }
    changed();
  };

  const onDelegation = (event: LiveServerEvent) => {
    const delegation = event["delegation"] as
      { id?: unknown; target?: unknown } | undefined;
    const id = typeof delegation?.id === "string" ? delegation.id : null;
    if (id === null) return;
    if (delegation?.target !== undefined && delegation.target !== "client")
      return;
    // One id, one run: a repeat of a known id is ignored.
    if (delegations.has(id)) return;
    const record: DelegationRecord = {
      id,
      providerId: id,
      request: "",
      status: "WAITING_FOR_WORDS",
      createdAt: deps.now(),
    };
    delegations.set(id, record);
    order.push(id);
    changed();
    // The delegation can arrive before the last words are transcribed:
    // wait until the input transcript has been quiet for `settleMs`.
    // Bounded: someone who keeps talking does not hold the run back.
    const waitForWords = () => {
      const at = deps.now();
      const quietFor = at - lastInputAt;
      if (quietFor >= settleMs || at - record.createdAt >= SETTLE_MAX_MS) {
        run(record);
        return;
      }
      timers.setTimeout(waitForWords, Math.max(50, settleMs - quietFor));
    };
    waitForWords();
  };

  return {
    handle: (event) => {
      switch (event.type) {
        case "session.input_transcript.delta": {
          const delta =
            typeof event["delta"] === "string" ? event["delta"] : "";
          lastInputAt = deps.now();
          append("user", delta);
          return;
        }
        case "session.output_transcript.delta": {
          const delta =
            typeof event["delta"] === "string" ? event["delta"] : "";
          append("q", delta);
          return;
        }
        case "session.delegation.created":
          onDelegation(event);
          return;
        case "session.started": {
          const opening = deps.opening;
          if (opening === undefined || openingStarted) return;
          openingStarted = true;
          if (opening.content !== undefined && opening.content.length > 0) {
            // Q's own opening, in hand: greeting and lowdown in one go, as
            // commentary (spoken). Recorded live (2026-10-09), an
            // instructions append alone did not reliably make the voice
            // speak first: one take waited 25 s for the person.
            send(
              "session.commentary.append",
              null,
              `${opening.greeting} Then give them this opening in your own words, naturally. If it is a briefing, summarise it as a colleague would: how much is waiting, the top two or three items by name and what each needs from them. If it asks them something, ask it. Never read it out word for word and never repeat card or screen text. Opening: ${opening.content}`,
            );
            return;
          }
          // Spoken now (commentary), not only instructions: see above.
          send(
            "session.commentary.append",
            null,
            `${opening.greeting} Their briefing is on its way from the backend; do not guess it.`,
          );
          if (opening.request === undefined) return;
          const record: DelegationRecord = {
            id: OPENING_ID,
            providerId: null,
            request: opening.request,
            status: "RUNNING",
            createdAt: deps.now(),
          };
          delegations.set(OPENING_ID, record);
          order.push(OPENING_ID);
          run(record, opening.request);
          return;
        }
        case "session.commentary.appended":
        case "session.thinking.appended":
        case "session.instructions.appended": {
          const id = event["client_event_id"];
          if (typeof id === "string" && pendingEvents.delete(id)) acked += 1;
          return;
        }
        case "error": {
          const error = event["error"] as
            { client_event_id?: unknown; message?: unknown } | undefined;
          const id = error?.client_event_id;
          if (typeof id === "string" && pendingEvents.delete(id)) {
            refused.push({
              eventId: id,
              message:
                typeof error?.message === "string"
                  ? error.message.slice(0, 200)
                  : "refused",
            });
            changed();
          }
          return;
        }
        default:
          return;
      }
    },
    cancel: async (delegationId) => {
      const record = delegations.get(delegationId);
      if (record === undefined || record.status !== "RUNNING") return false;
      const confirmed = (await deps.cancel?.(delegationId)) === true;
      // Never tell the person it stopped before the server confirmed it.
      if (!confirmed) return false;
      record.status = "CANCELLED";
      send(
        "session.thinking.append",
        record.providerId,
        `The backend confirmed it stopped: "${record.request}".`,
      );
      changed();
      return true;
    },
    typed: (text) => {
      const words = text.trim().slice(0, 2_000);
      if (words.length === 0) return;
      typedCount += 1;
      const id = `typed_${String(typedCount)}`;
      transcript.push({ role: "user", text: words });
      askedUpTo = transcript.length;
      boundary = true;
      const record: DelegationRecord = {
        id,
        providerId: null,
        request: words,
        status: "RUNNING",
        createdAt: deps.now(),
      };
      delegations.set(id, record);
      order.push(id);
      run(record, words);
    },
    state: snapshot,
  };
}
