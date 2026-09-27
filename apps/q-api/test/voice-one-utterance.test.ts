import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { QStreamEvent } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type {
  QOrchestrator,
  QRunRecord,
  QRunStreamService,
  QRuntimeService,
} from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type {
  VoiceSessionBinding,
  VoiceSessionBindings,
} from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { registerVoiceThinkRoute } from "../src/voice/think.js";
import {
  createVoiceTurnHandler,
  latestUtterance,
  type VoiceTurnHandler,
} from "../src/voice/turn.js";
import { utteranceRefOf } from "../src/voice/utterance.js";

/**
 * One utterance, one turn, one answer (acceptance B, voice half, and J).
 *
 * The fixture (hosted, 2026-09-24, conversation 4d31d38d…): one spoken
 * question reached Q as five think requests, 19:43:53 to 19:44:00, each
 * carrying the utterance as the provider had it so far and the browser's
 * "[continue]" cue glued to the front. Every one became a Q run, and four
 * of them answered. What is proven here, with the provider's think
 * requests simulated and every collaborator faked:
 *
 * - the cue is never part of what the person said;
 * - a think the provider drops before any of its answer was heard stops
 *   its run through the runtime's own cancellation, and the engine's
 *   generation is aborted with it;
 * - a newer think supersedes an older one on the same line: the older
 *   request is ended and its run cancelled, so only the last is answered;
 * - "go on" after a partly heard answer still resumes it (pause, not stop).
 */

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const NOW = "2026-09-24T19:43:53.000Z";

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const FIXTURE_PIECES = [
  "[continue] I'm not saying that I'm not saying that you need to find somebody that is publicly linked. I'm asking you that right now, based on what is in aviation, what investors would likely be interested",
  "[continue] I'm not saying that I'm not saying that you need to find somebody that is publicly linked. I'm asking you that right now, based on what is in aviation, what investors would likely be interested.",
  "[continue] I'm not saying that I'm not saying that you need to find somebody that is publicly linked. I'm asking you that right now, based on what is in aviation, what investors would likely be interested. not not which ones are doing it now. Which ones will likely be interested in investing in demo?",
  "[continue] I'm not saying that I'm not saying that you need to find somebody that is publicly linked. I'm asking you that right now, based on what is in aviation, what investors would likely be interested. not not which ones are doing it now. Which ones will likely be interested in investing in specific names.",
  "[continue] I'm not saying that I'm not saying that you need to find somebody that is publicly linked. I'm asking you that right now, based on what is in aviation, what investors would likely be interested. not not which ones are doing it now. Which ones will likely be interested in investing in specific names?",
] as const;

function binding(): VoiceSessionBinding {
  return {
    voiceSessionId: "f0000000-0000-4000-8000-000000000001",
    providerConversationId: "dg_f0000000-0000-4000-8000-000000000001",
    actor: CONTEXT,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: Number.MAX_SAFE_INTEGER,
    connectedAt: 1,
    thinkToken: "secret-think-token",
  };
}

function fakeSpeaker(): VoiceSpeaker & { readonly spoken: string[] } {
  const speaker = {
    providerConversationId: "conv_1",
    isOpen: true,
    spoken: [] as string[],
    speak: async (response: string | AsyncIterable<string>) => {
      if (typeof response === "string") {
        speaker.spoken.push(response);
        return;
      }
      const parts: string[] = [];
      for await (const chunk of response) parts.push(chunk);
      if (parts.length > 0) {
        speaker.spoken.push(parts.join(" ").replace(/\s+/g, " ").trim());
      }
    },
    close: () => undefined,
  };
  return speaker;
}

const event = (
  runId: string,
  type: string,
  data: Record<string, unknown>,
): QStreamEvent =>
  ({
    type,
    runId,
    sequence: 1,
    occurredAt: NOW,
    data,
  }) as unknown as QStreamEvent;

/**
 * A Q world whose runs answer only when released: a run in flight is a
 * run whose answer has not been heard yet, which is what the provider
 * sees while the person is still talking. Cancellation ends a run the way
 * the runtime does, with a failed event carrying the cancelled status.
 */
function world() {
  let next = 0;
  const created: {
    runId: string;
    text: string;
    utteranceRef: string | undefined;
  }[] = [];
  const cancelled: string[] = [];
  const started: { runId: string; signal: AbortSignal | undefined }[] = [];
  // Two gates per run: its first sentence, and the rest of it.
  const release = new Map<string, () => void>();
  const finish = new Map<string, () => void>();
  const gates = new Map<string, Promise<void>>();
  const restGates = new Map<string, Promise<void>>();
  const gate = (runId: string) => {
    let open: () => void = () => undefined;
    let rest: () => void = () => undefined;
    gates.set(
      runId,
      new Promise<void>((resolve) => {
        open = resolve;
      }),
    );
    restGates.set(
      runId,
      new Promise<void>((resolve) => {
        rest = resolve;
      }),
    );
    release.set(runId, open);
    finish.set(runId, rest);
  };
  const until = (waiting: Promise<void> | undefined, signal: AbortSignal) =>
    Promise.race([
      waiting ?? Promise.resolve(),
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);
  const cancelledEvent = (runId: string) => ({
    kind: "durable" as const,
    event: event(runId, "q.run.failed", {
      status: "CANCELLED",
      failure: { code: "RUN_CANCELLED", message: "Cancelled." },
    }),
  });
  const runtime = {
    createRun: (command: {
      input: { message: { text: string } };
      utteranceRef?: string;
    }) => {
      next += 1;
      const runId = `f0000000-0000-4000-8000-0000000001${String(next).padStart(2, "0")}`;
      created.push({
        runId,
        text: command.input.message.text,
        utteranceRef: command.utteranceRef,
      });
      gate(runId);
      return Promise.resolve({
        run: {
          id: runId,
          conversationId: "f0000000-0000-4000-8000-000000000021",
          status: "RECEIVED",
        } as unknown as QRunRecord,
        conversation: {} as never,
        message: {} as never,
        created: true,
      });
    },
    cancelRun: (command: { runId: string }) => {
      cancelled.push(command.runId);
      release.get(command.runId)?.();
      finish.get(command.runId)?.();
      return Promise.resolve({
        run: { id: command.runId, status: "CANCELLED" },
        changed: true,
        summary: {} as never,
      });
    },
  } as unknown as QRuntimeService;
  const stream: QRunStreamService = {
    authorize: (_actor, runId) =>
      Promise.resolve({ id: runId } as unknown as QRunRecord),
    open: async function* (input) {
      const runId = input.run.id;
      await until(gates.get(runId), input.signal);
      if (input.signal.aborted) return;
      if (cancelled.includes(runId)) {
        yield cancelledEvent(runId);
        yield { kind: "end" as const, reason: "TERMINAL" as const };
        return;
      }
      yield {
        kind: "durable" as const,
        event: event(runId, "q.message.delta", {
          messageId: `m-${runId}`,
          text: `Answer for ${runId.slice(-3)}. `,
        }),
      };
      await until(restGates.get(runId), input.signal);
      if (input.signal.aborted) return;
      if (cancelled.includes(runId)) {
        yield cancelledEvent(runId);
        yield { kind: "end" as const, reason: "TERMINAL" as const };
        return;
      }
      yield {
        kind: "durable" as const,
        event: event(runId, "q.message.delta", {
          messageId: `m-${runId}`,
          text: "Second sentence.",
        }),
      };
      yield {
        kind: "durable" as const,
        event: event(runId, "q.run.completed", {
          status: "COMPLETED",
          completedAt: NOW,
        }),
      };
      yield { kind: "end" as const, reason: "TERMINAL" as const };
    },
    stats: () => ({
      noticeSubscribers: 0,
      deltaSubscribers: 0,
      deltasDropped: 0,
    }),
  };
  const orchestrator = {
    start: (input: { runId: string; signal?: AbortSignal }) => {
      started.push({ runId: input.runId, signal: input.signal });
      return Promise.resolve();
    },
  } as unknown as QOrchestrator;
  const answered = () =>
    created
      .map((run) => run.runId)
      .filter((runId) => !cancelled.includes(runId));
  return {
    runtime,
    stream,
    orchestrator,
    created,
    cancelled,
    started,
    /** The whole answer. */
    release: (runId: string) => {
      release.get(runId)?.();
      finish.get(runId)?.();
    },
    /** Only its first sentence; the rest is still being written. */
    releaseFirst: (runId: string) => release.get(runId)?.(),
    finish: (runId: string) => finish.get(runId)?.(),
    answered,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the continue cue is never the person's words", () => {
  it("is taken out of the utterance, and a message that was only the cue stays the cue", () => {
    expect(
      latestUtterance([{ role: "user", content: FIXTURE_PIECES[0] }]),
    ).not.toContain("[continue]");
    expect(
      latestUtterance([
        { role: "user", content: "I like it balanced. [continue]" },
      ]),
    ).toBe("I like it balanced.");
    expect(latestUtterance([{ role: "user", content: " [continue] " }])).toBe(
      "[continue]",
    );
  });
});

describe("one utterance reported as several thinks", () => {
  it("answers once: each superseded think's run is cancelled and its generation aborted", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    const turns: Promise<unknown>[] = [];
    let previous: AbortController | null = null;
    for (const piece of FIXTURE_PIECES) {
      // The provider drops the older request when the person carries on
      // and sends the grown utterance as a new one.
      previous?.abort();
      const controller = new AbortController();
      previous = controller;
      turns.push(
        handle(
          bound,
          [
            { role: "agent", content: "Which investors?" },
            { role: "user", content: piece },
          ],
          controller.signal,
          speaker,
        ),
      );
      await tick();
    }
    const last = q.created.at(-1);
    if (last === undefined) throw new Error("no run");
    q.release(last.runId);
    await Promise.all(turns);
    await tick();

    // Nothing the person said carries the cue.
    for (const run of q.created) expect(run.text).not.toContain("[continue]");
    // One answer: every run but the last was cancelled, and the engine
    // running each of those was told to stop generating.
    expect(q.answered()).toEqual([last.runId]);
    for (const run of q.created.slice(0, -1)) {
      expect(q.cancelled).toContain(run.runId);
      const start = q.started.find((s) => s.runId === run.runId);
      expect(start?.signal?.aborted).toBe(true);
    }
    const lastStart = q.started.find((s) => s.runId === last.runId);
    expect(lastStart?.signal?.aborted).toBe(false);
    expect(speaker.spoken.join(" ")).toContain(
      `Answer for ${last.runId.slice(-3)}.`,
    );
    const answersSpoken = speaker.spoken.filter((line) =>
      line.includes("Answer for"),
    );
    expect(answersSpoken).toHaveLength(1);
  });

  it("keeps a partly heard answer for 'go on', and cancels it when the person asks something new", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    const first = new AbortController();
    const pending = handle(
      bound,
      [{ role: "user", content: "Tell me about seed rounds." }],
      first.signal,
      speaker,
    );
    await tick();
    const firstRun = q.created[0];
    if (firstRun === undefined) throw new Error("no run");
    q.releaseFirst(firstRun.runId);
    await tick();
    // The person talks over Q once its answer has begun to stream.
    first.abort();
    await pending;
    // Heard in part: paused, not cancelled.
    expect(q.cancelled).not.toContain(firstRun.runId);

    const next = handle(
      bound,
      [
        { role: "user", content: "Tell me about seed rounds." },
        { role: "agent", content: "Answer for 101." },
        { role: "user", content: "What about Series A in Lagos?" },
      ],
      new AbortController().signal,
      speaker,
    );
    await tick();
    // A new question makes the paused answer obsolete, and its engine
    // stops generating.
    expect(q.cancelled).toContain(firstRun.runId);
    expect(
      q.started.find((s) => s.runId === firstRun.runId)?.signal?.aborted,
    ).toBe(true);
    const secondRun = q.created[1];
    if (secondRun === undefined) throw new Error("no second run");
    expect(q.cancelled).not.toContain(secondRun.runId);
    q.release(secondRun.runId);
    await next;
    expect(speaker.spoken.at(-1)).toContain(
      `Answer for ${secondRun.runId.slice(-3)}.`,
    );
  });

  it("resumes a partly heard answer on the browser's cue, without cancelling it", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    const first = new AbortController();
    const pending = handle(
      bound,
      [{ role: "user", content: "Tell me about seed rounds." }],
      first.signal,
      speaker,
    );
    await tick();
    const firstRun = q.created[0];
    if (firstRun === undefined) throw new Error("no run");
    q.releaseFirst(firstRun.runId);
    await tick();
    // The person talks over Q once its answer has begun to stream.
    first.abort();
    await pending;
    await tick();
    const resuming = handle(
      bound,
      [
        { role: "user", content: "Tell me about seed rounds." },
        { role: "agent", content: "Answer for 101." },
        { role: "user", content: "[continue]" },
      ],
      new AbortController().signal,
      speaker,
    );
    await tick();
    // The rest of the answer is still being written when the cue arrives.
    q.finish(firstRun.runId);
    const resumed = await resuming;
    expect(resumed).toEqual({ kind: "SPOKEN", path: "Q" });
    expect(q.cancelled).toEqual([]);
    expect(q.created).toHaveLength(1);
    expect(speaker.spoken.at(-1)).toContain("Second sentence.");
  });
});

describe("an utterance the recogniser left open", () => {
  // Live, 2026-09-25: "This one. You know… So yes. See, you…" arrived as
  // twelve growing turns, each recorded, several answered with "I can't
  // identify a clear question".
  it("is not a turn while the person carries on: nothing is started or recorded for the fragment", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    const fragment = new AbortController();
    const held = handle(
      bound,
      [{ role: "user", content: "This one. You know… So yes. See, you…" }],
      fragment.signal,
      speaker,
    );
    await tick();
    // The person carries on; the provider drops the request.
    fragment.abort();
    expect(await held).toEqual({ kind: "NOTHING" });
    const whole = handle(
      bound,
      [
        {
          role: "user",
          content:
            "This one. You know… So yes. See, you could tell me who invests in aviation.",
        },
      ],
      new AbortController().signal,
      speaker,
    );
    await tick();
    const run = q.created[0];
    if (run === undefined) throw new Error("no run");
    q.release(run.runId);
    await whole;
    expect(q.created).toHaveLength(1);
    expect(q.created[0]?.text).toContain("who invests in aviation");
    expect(speaker.spoken).toHaveLength(1);
  });

  it("is answered, a moment later, when the person has stopped", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const speaker = fakeSpeaker();
    const pending = handle(
      binding(),
      [{ role: "user", content: "Which investors would like aviation," }],
      new AbortController().signal,
      speaker,
    );
    await tick();
    expect(q.created).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const run = q.created[0];
    if (run === undefined) throw new Error("no run after the hold");
    q.release(run.runId);
    await pending;
    expect(speaker.spoken.join(" ")).toContain("Answer for");
  });
});

describe("the think route", () => {
  it("ends an older think on the same line when a newer one arrives", async () => {
    const bound = binding();
    const bindings: VoiceSessionBindings = {
      issue: () => true,
      connect: () => bound,
      get: () => bound,
      byVoiceSessionId: () => bound,
      byThinkToken: (token) => (token === bound.thinkToken ? bound : null),
      fingerprints: () => [],
      releaseFor: () => undefined,
      release: () => undefined,
      countFor: () => 1,
      size: () => 1,
    };
    const signals: AbortSignal[] = [];
    const turn: VoiceTurnHandler = (_b, transcript, signal, speaker) => {
      signals.push(signal);
      const said = transcript.at(-1)?.content ?? "";
      if (said === "second") {
        return speaker
          .speak("Only this.")
          .then(() => ({ kind: "SPOKEN" as const, path: "Q" as const }));
      }
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          resolve({ kind: "INTERRUPTED", path: "Q" });
        });
      });
    };
    const server = Fastify();
    registerVoiceThinkRoute(server, {
      path: "/v1/q/voice/think",
      bindings,
      turn,
      logger,
    });
    await server.ready();
    const ask = (content: string) =>
      server.inject({
        method: "POST",
        url: "/v1/q/voice/think/chat/completions",
        headers: { authorization: "Bearer secret-think-token" },
        payload: { messages: [{ role: "user", content }] },
      });
    const older = ask("first");
    await tick();
    const newer = await ask("second");
    const stale = await older;
    expect(signals[0]?.aborted).toBe(true);
    expect(stale.body.trim().endsWith("data: [DONE]")).toBe(true);
    expect(stale.body).not.toContain("Only this.");
    expect(newer.body).toContain("Only this.");
    await server.close();
  });
});

describe("one utterance by identity, not by words (live test 2026-09-27, failure 9)", () => {
  const SESSION = "f0000000-0000-4000-8000-000000000001";
  const before = [
    { role: "user" as const, content: "Find me founders." },
    { role: "agent" as const, content: "None are discoverable yet." },
  ];

  it("names an utterance by its place in the conversation", () => {
    const fragment = utteranceRefOf(SESSION, [
      ...before,
      { role: "user", content: "Okay." },
    ]);
    // Grown and re-heard: none of the first report survives word for
    // word, and it is the same utterance.
    const grown = utteranceRefOf(SESSION, [
      ...before,
      { role: "user", content: "Ok, that that makes sense." },
    ]);
    expect(fragment).toBeDefined();
    expect(grown).toBe(fragment);
    // The same words after Q has replied are a new utterance.
    const again = utteranceRefOf(SESSION, [
      ...before,
      { role: "user", content: "Okay." },
      { role: "agent", content: "Shall we look wider?" },
      { role: "user", content: "Okay." },
    ]);
    expect(again).not.toBe(fragment);
    // Only the person's words make an utterance; Q's own line does not.
    expect(utteranceRefOf(SESSION, before)).toBeUndefined();
    // The stored reference's shape (q-runtime UTTERANCE_REF_PATTERN).
    expect(fragment).toMatch(/^[A-Za-z0-9._:-]{1,255}$/);
  });

  it("cancels a run on a fragment the person went on to extend, even one it would otherwise resume", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    // "Okay." ends a turn at a pause; Q starts answering it.
    const first = new AbortController();
    const pending = handle(
      bound,
      [...before, { role: "user", content: "Okay." }],
      first.signal,
      speaker,
    );
    await tick();
    const fragmentRun = q.created[0];
    if (fragmentRun === undefined) throw new Error("no run");
    q.releaseFirst(fragmentRun.runId);
    await tick();
    // The person carries on: the provider drops the request and brings
    // the utterance grown, with nothing from Q in between. Its words
    // alone ("Okay. Yeah.") read like a go-ahead to finish the paused
    // answer; its identity says it is the same utterance, still talking.
    first.abort();
    await pending;
    const next = handle(
      bound,
      [...before, { role: "user", content: "Okay. Yeah." }],
      new AbortController().signal,
      speaker,
    );
    await tick();
    expect(q.cancelled).toContain(fragmentRun.runId);
    expect(
      q.started.find((s) => s.runId === fragmentRun.runId)?.signal?.aborted,
    ).toBe(true);
    const grownRun = q.created[1];
    if (grownRun === undefined) throw new Error("no run for the utterance");
    expect(grownRun.text).toBe("Okay. Yeah.");
    // Both runs name the one utterance, so the stored conversation reads
    // as one turn (q-runtime withoutSupersededUtterances).
    expect(grownRun.utteranceRef).toBeDefined();
    expect(grownRun.utteranceRef).toBe(fragmentRun.utteranceRef);
    q.release(grownRun.runId);
    await next;
    expect(q.answered()).toEqual([grownRun.runId]);
    expect(speaker.spoken.at(-1)).toContain(
      `Answer for ${grownRun.runId.slice(-3)}.`,
    );
    expect(speaker.spoken.join(" ")).not.toMatch(/as I was saying/i);
  });

  it("stops speaking a run the moment it is superseded, mid-answer", async () => {
    const q = world();
    const handle = createVoiceTurnHandler({
      qRuntime: q.runtime,
      qStream: q.stream,
      orchestration: { orchestrator: q.orchestrator, autostart: true },
      logger,
    });
    const bound = binding();
    const speaker = fakeSpeaker();
    const first = handle(
      bound,
      [...before, { role: "user", content: "Okay." }],
      new AbortController().signal,
      speaker,
    );
    await tick();
    const fragmentRun = q.created[0];
    if (fragmentRun === undefined) throw new Error("no run");
    q.releaseFirst(fragmentRun.runId);
    await tick();
    // The grown utterance arrives while the fragment's answer is still
    // streaming on a request the provider has not dropped.
    const next = handle(
      bound,
      [...before, { role: "user", content: "Okay. That makes sense." }],
      new AbortController().signal,
      speaker,
    );
    await tick();
    q.finish(fragmentRun.runId);
    await first;
    const grownRun = q.created[1];
    if (grownRun === undefined) throw new Error("no run for the utterance");
    q.release(grownRun.runId);
    await next;
    expect(q.cancelled).toContain(fragmentRun.runId);
    // Nothing of the fragment's answer after its first sentence was said.
    expect(speaker.spoken).toEqual([
      `Answer for ${fragmentRun.runId.slice(-3)}.`,
      `Answer for ${grownRun.runId.slice(-3)}. Second sentence.`,
    ]);
    expect(q.answered()).toEqual([grownRun.runId]);
  });
});
