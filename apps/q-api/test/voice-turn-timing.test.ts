import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import { createProgressNarrator } from "../src/voice/progress.js";
import {
  createVoiceTurnTimings,
  routeShape,
  timedFetch,
  timedModelGateway,
  timedVoiceTurns,
} from "../src/voice/turn-timing.js";

/**
 * Where a spoken turn's time goes (CQ-VOICE-010). One line per turn, the
 * same shape every time, so the deployed stack can be read by a query
 * rather than by eye. Times only: never what anybody said.
 */

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { serviceName: "t", environment: "test" },
    {
      level: "info",
      destination: {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  );
  const timed = () => lines.filter((l) => l["msg"] === "voice turn timed");
  return { logger, timed };
}

const binding = { voiceSessionId: "vs-1" } as unknown as VoiceSessionBinding;

function speaker(said: string[]): VoiceSpeaker {
  return {
    providerConversationId: undefined,
    isOpen: true,
    speak: async (response) => {
      if (typeof response === "string") {
        said.push(response);
        return;
      }
      for await (const part of response) said.push(part);
    },
    close: () => undefined,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the voice turn timing line", () => {
  it("records reasoning, first words, first audio and every step, relative to the turn's start", async () => {
    const { logger, timed } = capture();
    let now = 1_000;
    const timings = createVoiceTurnTimings({ logger, now: () => now });
    const gateway = timedModelGateway(
      {
        execute: () => {
          now += 1_200;
          return Promise.resolve({
            modelCode: "gemini-3.5-flash-lite",
            fallbackUsed: false,
            attempts: [{}],
          } as never);
        },
      } as ModelGateway,
      timings,
    );
    const fetchFake = timedFetch(() => {
      now += 150;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }, timings);
    const said: string[] = [];
    const turn = timedVoiceTurns(async (_b, _t, _s, out) => {
      now += 40;
      await fetchFake(
        "http://api.local/v1/onboarding/sessions/0b0f6a2c-1111-4222-8333-944455556666",
      );
      await timings.measure("memory", "recall", () => {
        now += 60;
        return Promise.resolve("remembered");
      });
      await gateway.execute({ taskClass: "NORMAL_DIALOGUE" } as never);
      now += 10;
      await out.speak("Got it. What's the smallest cheque you'd take?");
      return { kind: "SPOKEN", path: "INTERVIEW" };
    }, timings);

    await turn(binding, [], new AbortController().signal, speaker(said));
    // The provider asks for the audio after the words have gone out.
    now += 100;
    const speech = timings.speech("vs-1", 45);
    now += 280;
    speech?.headers();
    speech?.firstByte();

    expect(said).toEqual(["Got it. What's the smallest cheque you'd take?"]);
    const [line] = timed();
    expect(line).toMatchObject({
      qVoiceSessionId: "vs-1",
      turn: 1,
      outcome: "SPOKEN",
      reasoningStartMs: 250,
      reasoningEndMs: 1450,
      firstTextMs: 1460,
      endMs: 1460,
      ttsRequestMs: 1560,
      firstAudioMs: 1840,
      modelCalls: 1,
      modelMs: 1200,
    });
    expect(line?.["steps"]).toEqual([
      {
        k: "api",
        l: "GET /v1/onboarding/sessions/:id",
        s: 40,
        ms: 150,
        ok: true,
        d: "200",
      },
      { k: "memory", l: "recall", s: 190, ms: 60, ok: true },
      {
        k: "model",
        l: "NORMAL_DIALOGUE",
        s: 250,
        ms: 1200,
        ok: true,
        d: "gemini-3.5-flash-lite x1",
      },
    ]);
    // Never the words.
    expect(JSON.stringify(line)).not.toMatch(/cheque|remembered/);
  });

  it("still writes the line when no audio ever comes back", async () => {
    vi.useFakeTimers();
    const { logger, timed } = capture();
    const timings = createVoiceTurnTimings({ logger, graceMs: 5_000 });
    const turn = timedVoiceTurns(
      () => Promise.resolve({ kind: "NOTHING" }),
      timings,
    );
    await turn(binding, [], new AbortController().signal, speaker([]));
    expect(timed()).toHaveLength(0);
    vi.advanceTimersByTime(5_000);
    expect(timed()).toHaveLength(1);
    expect(timed()[0]).toMatchObject({
      outcome: "NOTHING",
      firstAudioMs: null,
    });
  });

  it("closes the previous turn's line when the person speaks again", () => {
    const { logger, timed } = capture();
    const timings = createVoiceTurnTimings({ logger });
    const first = timings.begin("vs-1");
    first.end("SPOKEN");
    timings.begin("vs-1");
    expect(timed().map((l) => l["turn"])).toEqual([1]);
  });

  it("names an interrupted turn as interrupted, and a failed one as failed", async () => {
    const { logger, timed } = capture();
    const timings = createVoiceTurnTimings({ logger, graceMs: 0 });
    const aborted = new AbortController();
    aborted.abort();
    await timedVoiceTurns(
      () => Promise.resolve({ kind: "INTERRUPTED", path: "Q" }),
      timings,
    )(binding, [], aborted.signal, speaker([]));
    await expect(
      timedVoiceTurns(() => Promise.reject(new Error("x")), timings)(
        { voiceSessionId: "vs-2" } as unknown as VoiceSessionBinding,
        [],
        new AbortController().signal,
        speaker([]),
      ),
    ).rejects.toThrow("x");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      timed()
        .map((l) => l["outcome"])
        .sort(),
    ).toEqual(["FAILED", "INTERRUPTED"]);
  });

  it("adds nothing to a model call or a fetch made outside any voice turn", async () => {
    const { logger, timed } = capture();
    const timings = createVoiceTurnTimings({ logger });
    const execute = vi.fn(() => Promise.resolve({ modelCode: "m" } as never));
    await timedModelGateway({ execute } as ModelGateway, timings).execute({
      taskClass: "NORMAL_DIALOGUE",
    } as never);
    expect(execute).toHaveBeenCalledOnce();
    expect(timings.speech("nobody", 10)).toBeUndefined();
    expect(timed()).toHaveLength(0);
  });

  it("lists a failed model call with its failure class", async () => {
    const { logger, timed } = capture();
    const timings = createVoiceTurnTimings({ logger, graceMs: 0 });
    const gateway = timedModelGateway(
      {
        execute: () =>
          Promise.reject(
            Object.assign(new Error("no"), { failureClass: "TIMEOUT" }),
          ),
      },
      timings,
    );
    await timedVoiceTurns(async () => {
      await gateway
        .execute({ taskClass: "NORMAL_DIALOGUE" } as never)
        .catch(() => undefined);
      return { kind: "NOTHING" };
    }, timings)(binding, [], new AbortController().signal, speaker([]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(timed()[0]?.["steps"]).toMatchObject([
      { k: "model", l: "NORMAL_DIALOGUE", ok: false, d: "TIMEOUT" },
    ]);
  });
});

describe("route shapes in the timing line", () => {
  it("replaces identifiers, keeps the route", () => {
    expect(
      routeShape(
        "https://api/v1/onboarding/sessions/0b0f6a2c-1111-4222-8333-944455556666/responses?x=1",
      ),
    ).toBe("/v1/onboarding/sessions/:id/responses");
    expect(routeShape("/v1/things/123456/x")).toBe("/v1/things/:id/x");
  });
});

describe("progress while a long answer is worked out", () => {
  const research = "Checking the public web on that.";

  it("says nothing for a quick answer", () => {
    let now = 0;
    const narrator = createProgressNarrator({ startedAt: 0, now: () => now });
    now = 800;
    expect(
      narrator.lineFor("REVIEWING_COMPANY", {
        answered: false,
        researchLine: research,
      }),
    ).toBeNull();
  });

  it("names what it is doing once the run has shown itself to be long, a line or two at most", () => {
    let now = 0;
    const narrator = createProgressNarrator({ startedAt: 0, now: () => now });
    now = 2_000;
    const say = (stage: Parameters<typeof narrator.lineFor>[0]) =>
      narrator.lineFor(stage, { answered: false, researchLine: research });
    expect(say("REVIEWING_COMPANY")).toBe(
      "I'm going through the company's record.",
    );
    expect(say("REVIEWING_COMPANY")).toBeNull();
    expect(say("CHECKING_EVIDENCE")).toBe(
      "I'm checking what the evidence actually supports.",
    );
    expect(say("PREPARING_ANALYSIS")).toBeNull();
  });

  it("announces a move to public sources at once, and never once the answer has begun", () => {
    const narrator = createProgressNarrator({ startedAt: 0, now: () => 10 });
    expect(
      narrator.lineFor("SEARCHING_PUBLIC_SOURCES", {
        answered: false,
        researchLine: research,
      }),
    ).toBe(research);
    const later = createProgressNarrator({ startedAt: 0, now: () => 5_000 });
    expect(
      later.lineFor("PREPARING_ANALYSIS", {
        answered: true,
        researchLine: research,
      }),
    ).toBeNull();
  });

  it("never narrates stages that are not work: waiting and understanding", () => {
    const narrator = createProgressNarrator({ startedAt: 0, now: () => 5_000 });
    for (const stage of [
      "UNDERSTANDING_REQUEST",
      "WAITING_FOR_REPLY",
      "WAITING_FOR_APPROVAL",
    ] as const) {
      expect(
        narrator.lineFor(stage, { answered: false, researchLine: research }),
      ).toBeNull();
    }
  });
});
