import { AsyncLocalStorage } from "node:async_hooks";

import type {
  ModelGatewayRequestInput,
  ModelGatewayResult,
} from "@capital-q/contracts";
import type {
  ModelGateway,
  ModelGatewayExecuteOptions,
} from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";

import type { VoiceSpeaker } from "./provider.js";
import type { VoiceTurnHandler } from "./turn.js";

/**
 * Where a spoken turn's time goes (CQ-VOICE-010).
 *
 * One structured line per voice turn, "voice turn timed". All times are in
 * milliseconds from the moment the turn reached Q (the think request,
 * which the speech provider sends once it has decided the person has
 * finished):
 *
 *   reasoningStartMs  the first model call began
 *   reasoningEndMs    the last model call ended
 *   firstTextMs       Q's first words were handed to the provider
 *   endMs             the turn finished
 *   ttsRequestMs      the provider asked the speak relay for the first audio
 *   firstAudioMs      the first audio byte came back from the voice vendor
 *
 * Each model call, application-API call and memory recall is listed with
 * its own start and duration, so that "slow" can be traced to its cause
 * rather than guessed at.
 *
 * Nothing the person said and nothing Q said is ever in this line. Only
 * times, counts, task classes, model codes and API route shapes (with
 * identifiers replaced) appear. It is operational telemetry. It is not
 * analytics and not audit.
 *
 * The time before the think request (the provider deciding the turn was
 * over) and playback in the browser are the provider's and the browser's
 * to report. The deployed-stack recipe says where to read them.
 */

export type TimingStepKind = "model" | "api" | "memory";

export type VoiceTurnTiming = {
  readonly id: number;
  /** Q's words were handed to the provider. */
  readonly spoke: () => void;
  readonly step: (
    kind: TimingStepKind,
    label: string,
    startedAt: number,
    ok: boolean,
    detail?: string,
  ) => void;
  readonly end: (outcome: string) => void;
};

export type SpeechTiming = {
  readonly headers: () => void;
  readonly firstByte: () => void;
  readonly rendered: (cues: readonly string[]) => void;
  /** Which engine voiced this utterance, and whether it was a fallback. */
  readonly served: (engine: string, fallback: boolean) => void;
};

export type VoiceTurnTimings = {
  readonly now: () => number;
  readonly begin: (voiceSessionId: string) => VoiceTurnTiming;
  readonly run: <T>(
    timing: VoiceTurnTiming,
    work: () => Promise<T>,
  ) => Promise<T>;
  /** The turn this call is part of, if any. */
  readonly current: () => VoiceTurnTiming | undefined;
  /** The speak relay asked for audio for this session's latest turn. */
  readonly speech: (
    voiceSessionId: string,
    chars: number,
  ) => SpeechTiming | undefined;
  /** Time one piece of work inside the current turn, if there is one. */
  readonly measure: <T>(
    kind: TimingStepKind,
    label: string,
    work: () => Promise<T>,
    detail?: (result: T) => string | undefined,
  ) => Promise<T>;
};

const MAX_STEPS = 24;

type Step = {
  readonly k: TimingStepKind;
  readonly l: string;
  readonly s: number;
  readonly ms: number;
  readonly ok: boolean;
  readonly d?: string;
};

type Open = {
  readonly id: number;
  readonly sessionId: string;
  readonly t0: number;
  reasoningStart?: number;
  reasoningEnd?: number;
  firstText?: number;
  lastText?: number;
  end?: number;
  outcome?: string;
  ttsRequest?: number;
  ttsHeaders?: number;
  firstAudio?: number;
  ttsRequests: number;
  ttsChars: number;
  /** The engine that voiced each utterance, in order. */
  engines: string[];
  ttsFallbacks: number;
  cues: Set<string>;
  steps: Step[];
  done: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function createVoiceTurnTimings(options: {
  readonly logger: Logger;
  readonly now?: (() => number) | undefined;
  /**
   * How long after a turn ends its first audio may still arrive. The
   * provider asks for audio only once it has the words, which is after
   * the think request has already finished for a reply written at once.
   */
  readonly graceMs?: number | undefined;
}): VoiceTurnTimings {
  const now = options.now ?? (() => performance.now());
  const graceMs = options.graceMs ?? 10_000;
  const storage = new AsyncLocalStorage<Open>();
  const latest = new Map<string, Open>();
  const sequence = new Map<string, number>();

  const rel = (open: Open, at: number | undefined) =>
    at === undefined ? null : Math.round(at - open.t0);

  const finish = (open: Open) => {
    if (open.done) return;
    open.done = true;
    if (open.timer !== undefined) clearTimeout(open.timer);
    if (latest.get(open.sessionId) === open) latest.delete(open.sessionId);
    const models = open.steps.filter((s) => s.k === "model");
    options.logger.info(
      {
        qVoiceSessionId: open.sessionId,
        turn: open.id,
        outcome: open.outcome ?? "UNFINISHED",
        reasoningStartMs: rel(open, open.reasoningStart),
        reasoningEndMs: rel(open, open.reasoningEnd),
        firstTextMs: rel(open, open.firstText),
        lastTextMs: rel(open, open.lastText),
        endMs: rel(open, open.end),
        ttsRequestMs: rel(open, open.ttsRequest),
        ttsHeadersMs: rel(open, open.ttsHeaders),
        firstAudioMs: rel(open, open.firstAudio),
        ttsRequests: open.ttsRequests,
        ttsChars: open.ttsChars,
        ttsEngines: open.engines,
        ttsFallbacks: open.ttsFallbacks,
        cues: [...open.cues],
        modelCalls: models.length,
        modelMs: models.reduce((n, s) => n + s.ms, 0),
        steps: open.steps,
      },
      "voice turn timed",
    );
  };

  const settle = (open: Open) => {
    if (open.done || open.end === undefined) return;
    if (open.firstAudio !== undefined) {
      finish(open);
      return;
    }
    if (open.timer === undefined) {
      open.timer = setTimeout(() => finish(open), graceMs);
      open.timer.unref?.();
    }
  };

  const handle = (open: Open): VoiceTurnTiming => ({
    id: open.id,
    spoke: () => {
      const at = now();
      open.firstText ??= at;
      open.lastText = at;
    },
    step: (kind, label, startedAt, ok, detail) => {
      const at = now();
      if (kind === "model") {
        open.reasoningStart =
          open.reasoningStart === undefined
            ? startedAt
            : Math.min(open.reasoningStart, startedAt);
        open.reasoningEnd = Math.max(open.reasoningEnd ?? 0, at);
      }
      if (open.steps.length < MAX_STEPS) {
        open.steps.push({
          k: kind,
          l: label,
          s: Math.round(startedAt - open.t0),
          ms: Math.round(at - startedAt),
          ok,
          ...(detail === undefined ? {} : { d: detail }),
        });
      }
    },
    end: (outcome) => {
      if (open.end !== undefined) return;
      open.end = now();
      open.outcome = outcome;
      settle(open);
    },
  });

  const handles = new WeakMap<Open, VoiceTurnTiming>();
  const handleOf = (open: Open): VoiceTurnTiming => {
    let h = handles.get(open);
    if (h === undefined) {
      h = handle(open);
      handles.set(open, h);
    }
    return h;
  };
  const opens = new WeakMap<VoiceTurnTiming, Open>();

  return {
    now,
    begin: (voiceSessionId) => {
      // A new turn closes the last one's line: whatever it had is all it
      // is going to get.
      const previous = latest.get(voiceSessionId);
      if (previous !== undefined) finish(previous);
      const id = (sequence.get(voiceSessionId) ?? 0) + 1;
      sequence.set(voiceSessionId, id);
      const open: Open = {
        id,
        sessionId: voiceSessionId,
        t0: now(),
        ttsRequests: 0,
        ttsChars: 0,
        engines: [],
        ttsFallbacks: 0,
        cues: new Set(),
        steps: [],
        done: false,
      };
      latest.set(voiceSessionId, open);
      const h = handleOf(open);
      opens.set(h, open);
      return h;
    },
    run: (timing, work) => {
      const open = opens.get(timing);
      return open === undefined ? work() : storage.run(open, work);
    },
    current: () => {
      const open = storage.getStore();
      return open === undefined || open.done ? undefined : handleOf(open);
    },
    speech: (voiceSessionId, chars) => {
      const open = latest.get(voiceSessionId);
      if (open === undefined || open.done) return undefined;
      const first = open.ttsRequest === undefined;
      open.ttsRequest ??= now();
      open.ttsRequests += 1;
      open.ttsChars += chars;
      return {
        headers: () => {
          if (first) open.ttsHeaders ??= now();
        },
        firstByte: () => {
          if (!first || open.firstAudio !== undefined) return;
          open.firstAudio = now();
          settle(open);
        },
        rendered: (cues) => {
          for (const cue of cues) open.cues.add(cue);
        },
        served: (engine, fallback) => {
          if (open.engines.length < MAX_STEPS) open.engines.push(engine);
          if (fallback) open.ttsFallbacks += 1;
        },
      };
    },
    measure: async (kind, label, work, detail) => {
      const open = storage.getStore();
      if (open === undefined || open.done) return work();
      const h = handleOf(open);
      const startedAt = now();
      try {
        const result = await work();
        h.step(kind, label, startedAt, true, detail?.(result));
        return result;
      } catch (error: unknown) {
        h.step(kind, label, startedAt, false, failureOf(error));
        throw error;
      }
    },
  };
}

function failureOf(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const failureClass = (error as { failureClass?: unknown }).failureClass;
    if (typeof failureClass === "string") return failureClass;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "Error";
}

/**
 * The turn handler, timed: each turn opens a timing, runs inside it (so a
 * model or API call anywhere below is attributed to it) and closes it with
 * how it ended. The speaker is wrapped only to note when Q's words left.
 */
export function timedVoiceTurns(
  turn: VoiceTurnHandler,
  timings: VoiceTurnTimings,
): VoiceTurnHandler {
  return async (binding, transcript, signal, speaker) => {
    const timing = timings.begin(binding.voiceSessionId);
    const timedSpeaker: VoiceSpeaker = {
      providerConversationId: speaker.providerConversationId,
      get isOpen() {
        return speaker.isOpen;
      },
      speak: (response) => {
        if (typeof response === "string") {
          if (response.trim().length > 0) timing.spoke();
          return speaker.speak(response);
        }
        return speaker.speak(
          (async function* noted() {
            for await (const part of response) {
              if (part.trim().length > 0) timing.spoke();
              yield part;
            }
          })(),
        );
      },
      close: () => {
        speaker.close();
      },
    };
    try {
      const outcome = await timings.run(timing, () =>
        turn(binding, transcript, signal, timedSpeaker),
      );
      timing.end(signal.aborted ? "INTERRUPTED" : outcome.kind);
      return outcome;
    } catch (error: unknown) {
      timing.end("FAILED");
      throw error;
    }
  };
}

/**
 * The model gateway, with each call made inside a voice turn listed on it:
 * task class, the model that answered, whether a fallback did and how many
 * attempts it took. Outside a turn this adds nothing.
 */
export function timedModelGateway(
  gateway: ModelGateway,
  timings: VoiceTurnTimings,
): ModelGateway {
  return {
    execute: <T = never>(
      request: ModelGatewayRequestInput,
      options?: ModelGatewayExecuteOptions<T>,
    ): Promise<ModelGatewayResult<T>> =>
      timings.measure(
        "model",
        request.taskClass,
        () => gateway.execute<T>(request, options),
        (result) =>
          `${result.modelCode}${result.fallbackUsed ? " fallback" : ""} x${String(result.attempts.length)}`,
      ),
  };
}

/** Route shapes, not identifiers: a UUID or long number becomes ":id". */
export function routeShape(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  return path
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id",
    )
    .replace(/\/\d{3,}(?=\/|$)/g, "/:id");
}

/** A fetch whose calls inside a voice turn are listed on it. */
export function timedFetch(
  inner: typeof fetch,
  timings: VoiceTurnTimings,
): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    return timings.measure(
      "api",
      `${method} ${routeShape(url)}`,
      () => inner(input, init),
      (response) => String(response.status),
    );
  };
}
