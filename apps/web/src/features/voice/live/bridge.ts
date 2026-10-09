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
  /** When a still-running delegation gets its one quiet progress note. */
  readonly progressAfterMs?: number | undefined;
  readonly onChange?: ((state: LiveBridgeState) => void) | undefined;
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
  readonly state: () => LiveBridgeState;
};

/** OpenAI caps each append at 500 tokens; characters are a safe bound. */
export const LIVE_APPEND_MAX_CHARS = 1_800;
const CONTEXT_TURNS = 8;
const SETTLE_MAX_MS = 1_500;
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
  const progressAfterMs = deps.progressAfterMs ?? 3_000;
  // The transcript as the provider streamed it, both sides, in turns. A
  // turn changes side when the other side's delta arrives.
  const transcript: { role: "user" | "q"; text: string }[] = [];
  // The index of the first transcript turn not yet asked about.
  let askedUpTo = 0;
  let lastInputAt = 0;
  const delegations = new Map<string, DelegationRecord>();
  const order: string[] = [];
  let acked = 0;
  const refused: { eventId: string; message: string }[] = [];
  const pendingEvents = new Set<string>();

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
    if (last !== undefined && last.role === role) last.text += delta;
    else transcript.push({ role, text: delta });
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

  const newest = () => order[order.length - 1];

  const run = (record: DelegationRecord) => {
    record.request = readRequest();
    askedUpTo = transcript.length;
    record.status = "RUNNING";
    changed();
    let progressed = false;
    const progress = timers.setTimeout(() => {
      if (record.status !== "RUNNING" || progressed) return;
      progressed = true;
      // Quiet context only: the voice decides whether to mention it, in
      // its own words, and must not guess the result.
      send(
        "session.thinking.append",
        record.id,
        `Q's backend is still working on: "${record.request}". No result yet. Do not guess it and do not stall with filler; keep the conversation natural.`,
      );
    }, progressAfterMs);
    void deps
      .delegate({
        delegationId: record.id,
        request: record.request,
        context: contextBefore(),
      })
      .then(
        (outcome) => {
          timers.clearTimeout(progress);
          settle(record, outcome);
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
    const superseded = outcome.stale === true || newest() !== record.id;
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
        record.id,
        `Earlier request "${record.request}" (replaced by a newer one; do not answer it now unless asked): ${outcome.commentary}`,
      );
    } else {
      record.status = outcome.failed === true ? "FAILED" : "SPOKEN";
      send("session.commentary.append", record.id, outcome.commentary);
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
        delegationId,
        `The backend confirmed it stopped: "${record.request}".`,
      );
      changed();
      return true;
    },
    state: snapshot,
  };
}
