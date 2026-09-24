import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  createElevenLabsSpeechRelay,
  createElevenLabsSpeechSynthesis,
} from "../src/voice/providers/elevenlabs-speak.js";
import { speechWithFallback } from "../src/voice/synthesis.js";
import {
  renderSpeech,
  SPEECH_MARKUP,
  withoutMarkup,
} from "../src/voice/providers/speech-markup.js";
import { sentences, speakable } from "../src/voice/speech.js";
import {
  anchorCues,
  createSpeechPerformanceBoard,
  type SpeechCues,
} from "../src/voice/speech-performance.js";
import { createVoiceTurnTimings } from "../src/voice/turn-timing.js";

/**
 * How Q's words sound, kept apart from what they are (CQ-VOICE-010).
 *
 * The properties held here:
 * - a cue is rendered only by a voice that was measured to render it;
 * - a cue never enters the text Q is recorded as having said;
 * - a cue that does not fit the reply is dropped rather than guessed at;
 * - a voice without the capability gets the plain sentence, and never the
 *   tag read aloud.
 */

const PLAIN: SpeechCues = {
  reaction: null,
  reactionAt: 0,
  pauseAfter: [],
  pace: "NORMAL",
  emphasis: [],
};

const REPLY =
  "Fair enough, that one's on me. I did ask you the same thing twice. What would you like to do next?";
const SPOKEN = sentences(speakable(REPLY));

describe("anchoring the model's delivery request to what Q will say", () => {
  it("keeps a reaction before a sentence that exists, and nothing else", () => {
    const anchored = anchorCues(SPOKEN, {
      ...PLAIN,
      reaction: "CHUCKLE",
      reactionAt: 0,
    });
    expect(anchored).toEqual([
      {
        sentence: "Fair enough, that one's on me.",
        reaction: "CHUCKLE",
        pauseAfter: false,
        pace: "NORMAL",
        emphasis: [],
      },
    ]);
  });

  it("drops a reaction before a sentence the reply does not have", () => {
    expect(
      anchorCues(SPOKEN, { ...PLAIN, reaction: "LAUGH", reactionAt: 7 }),
    ).toEqual([]);
  });

  it("never pauses after the last sentence: that silence is the person's turn", () => {
    const anchored = anchorCues(SPOKEN, { ...PLAIN, pauseAfter: [0, 2] });
    expect(anchored.map((p) => p.sentence)).toEqual([
      "Fair enough, that one's on me.",
    ]);
  });

  it("emphasises only words the reply actually contains, verbatim", () => {
    const anchored = anchorCues(SPOKEN, {
      ...PLAIN,
      emphasis: ["same thing", "different thing"],
    });
    expect(anchored).toHaveLength(1);
    expect(anchored[0]?.sentence).toBe("I did ask you the same thing twice.");
    expect(anchored[0]?.emphasis).toEqual(["same thing"]);
  });

  it("asks for nothing when nothing was asked for, or the reply is empty", () => {
    expect(anchorCues(SPOKEN, PLAIN)).toEqual([]);
    expect(anchorCues(SPOKEN, null)).toEqual([]);
    expect(anchorCues([], { ...PLAIN, reaction: "LAUGH" })).toEqual([]);
  });

  it("carries a pace to every sentence, since pace is how the whole reply sounds", () => {
    expect(anchorCues(SPOKEN, { ...PLAIN, pace: "SLOWER" })).toHaveLength(3);
  });
});

describe("the board between the think route and the speak relay", () => {
  const cues = anchorCues(SPOKEN, {
    ...PLAIN,
    reaction: "CHUCKLE",
    reactionAt: 0,
    pauseAfter: [1],
  });

  it("hands a sentence's cues to the relay once, and only for that session", () => {
    const board = createSpeechPerformanceBoard();
    board.perform("session-a", cues);
    expect(board.take("session-b", SPOKEN[0] ?? "")).toEqual([]);
    const taken = board.take("session-a", SPOKEN[0] ?? "");
    expect(taken.map((p) => p.reaction)).toEqual(["CHUCKLE"]);
    expect(board.take("session-a", SPOKEN[0] ?? "")).toEqual([]);
  });

  it("finds a sentence however the provider spaced or punctuated it", () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", cues);
    const taken = board.take("s", "  i did ask you the SAME thing twice ");
    expect(taken.map((p) => p.pauseAfter)).toEqual([true]);
  });

  it("matches whole words only: a short line is not found inside a longer one", () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "s",
      anchorCues(["No.", "I know that."], { ...PLAIN, reaction: "SIGH" }),
    );
    expect(board.take("s", "I know that.")).toEqual([]);
    expect(board.take("s", "No.").map((p) => p.reaction)).toEqual(["SIGH"]);
  });

  it("drops cues nobody asked for in time, and a new reply's cues replace the old", () => {
    let now = 0;
    const board = createSpeechPerformanceBoard({ now: () => now, ttlMs: 1000 });
    board.perform("s", cues);
    now = 2000;
    expect(board.take("s", SPOKEN[0] ?? "")).toEqual([]);
    board.perform("s", cues);
    board.perform("s", []);
    expect(board.take("s", SPOKEN[0] ?? "")).toEqual([]);
  });
});

describe("rendering, only where the voice can", () => {
  const performances = anchorCues(SPOKEN, {
    reaction: "CHUCKLE",
    reactionAt: 0,
    pauseAfter: [0],
    pace: "SLOWER",
    emphasis: ["on me"],
  });
  const first = SPOKEN[0] ?? "";

  it("v3 conversational: a tag before the sentence, a pause after it, capitals for stress, no speed", () => {
    const out = renderSpeech(
      first,
      performances,
      SPEECH_MARKUP.eleven_v3_conversational,
    );
    expect(out.text).toBe(
      "[chuckles] Fair enough, that one's ON ME. [short pause]",
    );
    expect(out.speed).toBeUndefined();
    expect(out.rendered).toEqual(["emphasis", "reaction", "pause"]);
  });

  it("turbo v2.5: never a reaction tag (it reads them aloud), a break for the pause, a speed for the pace", () => {
    const out = renderSpeech(
      first,
      performances,
      SPEECH_MARKUP.eleven_turbo_v2_5,
    );
    expect(out.text).toBe(
      `Fair enough, that one's on me. <break time="0.6s" />`,
    );
    expect(out.text).not.toContain("[");
    expect(out.speed).toBe(0.92);
    expect(out.rendered).toEqual(["pause", "pace"]);
  });

  it("gives a sentence with no cues to the voice exactly as Q said it", () => {
    for (const markup of Object.values(SPEECH_MARKUP)) {
      expect(renderSpeech(first, [], markup)).toEqual({
        text: first,
        speed: undefined,
        rendered: [],
      });
    }
  });

  it("removes stage directions a model wrote into its text, so only this layer's markup reaches a voice", () => {
    expect(
      withoutMarkup('[laughs] Fair enough. <break time="1s"/> Next.'),
    ).toBe("Fair enough. Next.");
    expect(
      renderSpeech("[laughs] Fair enough.", [], SPEECH_MARKUP.eleven_turbo_v2_5)
        .text,
    ).toBe("Fair enough.");
  });

  it("puts a reaction only at the start of a sentence the provider split, and a pause only at its end", () => {
    const [p] = anchorCues(["One two three four."], {
      ...PLAIN,
      reaction: "LAUGH",
      pauseAfter: [],
    });
    const markup = SPEECH_MARKUP.eleven_v3_conversational;
    expect(
      renderSpeech("One two", p === undefined ? [] : [p], markup).text,
    ).toBe("[laughs] One two");
    expect(
      renderSpeech("three four.", p === undefined ? [] : [p], markup).text,
    ).toBe("three four.");
  });
});

type Sent = { body: Record<string, unknown>; url: string };

function vendor(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init) => {
      sent.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as Record<string, unknown>,
      });
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/pcm" },
        }),
      );
    },
  };
}

describe("the speak relay with the layer in place", () => {
  it("renders the session's cues into the vendor request and nowhere else", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "session-1",
      anchorCues(SPOKEN, { ...PLAIN, reaction: "LAUGH", reactionAt: 0 }),
    );
    const { fetch, sent } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      model: "eleven_v3_conversational",
      fetch,
      performance: board,
    });
    const said = SPOKEN[0] ?? "";
    const response = await relay.stream({
      voice: "FEMALE",
      text: said,
      session: "session-1",
    });
    expect(response.ok).toBe(true);
    expect(sent[0]?.body).toEqual({
      text: `[laughs] ${said}`,
      model_id: "eleven_v3_conversational",
    });
    // What Q said is what the provider handed over and what the transcript
    // shows: the relay's input was never changed.
    expect(said).toBe("Fair enough, that one's on me.");
    // v3 refuses this parameter outright; it is never sent.
    expect(sent[0]?.url).not.toContain("optimize_streaming_latency");
  });

  it("never sends turbo v2.5 a reaction, on a deployment pinned to it", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "s",
      anchorCues(SPOKEN, { ...PLAIN, reaction: "LAUGH", reactionAt: 0 }),
    );
    const { fetch, sent } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      model: "eleven_turbo_v2_5",
      fetch,
      performance: board,
    });
    await relay.stream({
      voice: "FEMALE",
      text: SPOKEN[0] ?? "",
      session: "s",
    });
    expect(sent[0]?.body).toEqual({
      text: SPOKEN[0],
      model_id: "eleven_turbo_v2_5",
    });
  });

  it("sends a pace on turbo as the voice's full settings, so nothing else is reset", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", anchorCues(SPOKEN, { ...PLAIN, pace: "FASTER" }));
    const { fetch, sent } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      model: "eleven_turbo_v2_5",
      fetch,
      performance: board,
    });
    await relay.stream({
      voice: "FEMALE",
      text: SPOKEN[1] ?? "",
      session: "s",
    });
    expect(sent[0]?.body["voice_settings"]).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
      speed: 1.06,
    });
  });

  it("renders nothing for a call with no session, whatever the board holds", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", anchorCues(SPOKEN, { ...PLAIN, reaction: "SIGH" }));
    const { fetch, sent } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      model: "eleven_v3_conversational",
      fetch,
      performance: board,
    });
    await relay.stream({ voice: "FEMALE", text: SPOKEN[0] ?? "" });
    expect(sent[0]?.body["text"]).toBe(SPOKEN[0]);
  });

  it("notes the turn's first audio byte and which cues were rendered, passing the audio through untouched", async () => {
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
    let now = 0;
    const timings = createVoiceTurnTimings({ logger, now: () => now });
    const board = createSpeechPerformanceBoard();
    board.perform("s", anchorCues(SPOKEN, { ...PLAIN, reaction: "CHUCKLE" }));
    const { fetch } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      model: "eleven_v3_conversational",
      fetch,
      performance: board,
      timings,
    });
    const turn = timings.begin("s");
    now = 900;
    turn.spoke();
    now = 1000;
    const response = await relay.stream({
      voice: "FEMALE",
      text: SPOKEN[0] ?? "",
      session: "s",
    });
    now = 1300;
    turn.end("SPOKEN");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    const timed = lines.find((l) => l["msg"] === "voice turn timed");
    expect(timed).toMatchObject({
      firstTextMs: 900,
      ttsRequestMs: 1000,
      // The relay holds the first chunk before answering, so the first
      // byte is noted when it arrived, not when the agent read it.
      firstAudioMs: 1000,
      endMs: 1300,
      cues: ["reaction"],
      ttsRequests: 1,
      ttsEngines: ["eleven_v3_conversational"],
      ttsFallbacks: 0,
    });
    // What was said is never in the line.
    expect(JSON.stringify(timed)).not.toContain("Fair enough");
  });
});

type Scripted = {
  readonly fetch: typeof fetch;
  readonly sent: (Sent & { signal: AbortSignal | undefined })[];
};

/** A vendor whose answer depends on which model was asked. */
function scripted(
  answer: (model: string, signal: AbortSignal | undefined) => Response,
): Scripted {
  const sent: Scripted["sent"] = [];
  return {
    sent,
    fetch: (input, init) => {
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Record<string, unknown>;
      const signal = init?.signal ?? undefined;
      sent.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        body,
        signal,
      });
      return Promise.resolve(
        answer(
          typeof body["model_id"] === "string" ? body["model_id"] : "aura",
          signal,
        ),
      );
    },
  };
}

const audio = () =>
  new Response(new Uint8Array([7, 7, 7]), {
    status: 200,
    headers: { "content-type": "audio/pcm" },
  });
/** Headers at once, then no audio at all until the request is abandoned. */
const stalled = (signal: AbortSignal | undefined) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        });
      },
    }),
    { status: 200 },
  );

function recordedTimings() {
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
  const timings = createVoiceTurnTimings({ logger, graceMs: 0 });
  return {
    timings,
    line: () => lines.find((l) => l["msg"] === "voice turn timed"),
  };
}

describe("which voice serves an utterance (v3, then turbo, then Aura-2)", () => {
  const cues = anchorCues(SPOKEN, {
    ...PLAIN,
    reaction: "LAUGH",
    reactionAt: 0,
    pauseAfter: [0],
  });
  const said = SPOKEN[0] ?? "";

  it("is v3 conversational by default, with the reaction and the pause", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", cues);
    const { fetch, sent } = scripted(() => audio());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      performance: board,
    });
    await relay.stream({ voice: "FEMALE", text: said, session: "s" });
    expect(sent.map((s) => s.body["model_id"])).toEqual([
      "eleven_v3_conversational",
    ]);
    expect(sent[0]?.body["text"]).toBe(`[laughs] ${said} [short pause]`);
  });

  it("hands the utterance to turbo when v3 errors, keeping the pause and dropping the laugh", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", cues);
    const { timings, line } = recordedTimings();
    const { fetch, sent } = scripted((model) =>
      model === "eleven_v3_conversational"
        ? new Response("busy", { status: 503 })
        : audio(),
    );
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      performance: board,
      timings,
    });
    const turn = timings.begin("s");
    const response = await relay.stream({
      voice: "FEMALE",
      text: said,
      session: "s",
    });
    turn.end("SPOKEN");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      7, 7, 7,
    ]);
    expect(sent.map((s) => s.body["model_id"])).toEqual([
      "eleven_v3_conversational",
      "eleven_turbo_v2_5",
    ]);
    // Same voice, same words; never a tag turbo would read aloud.
    expect(sent[1]?.url).toBe(sent[0]?.url);
    expect(sent[1]?.body["text"]).toBe(`${said} <break time="0.6s" />`);
    expect(String(sent[1]?.body["text"])).not.toContain("[");
    expect(line()).toMatchObject({
      ttsEngines: ["eleven_turbo_v2_5"],
      ttsFallbacks: 1,
      cues: ["pause"],
    });
  });

  it("hands the utterance to turbo when v3 has produced no audio by the deadline, and abandons v3", async () => {
    const { fetch, sent } = scripted((model, signal) =>
      model === "eleven_v3_conversational" ? stalled(signal) : audio(),
    );
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      firstAudioDeadlineMs: 30,
    });
    const started = Date.now();
    const response = await relay.stream({ voice: "FEMALE", text: said });
    expect(response.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(sent.map((s) => s.body["model_id"])).toEqual([
      "eleven_v3_conversational",
      "eleven_turbo_v2_5",
    ]);
    expect(sent[0]?.signal?.aborted).toBe(true);
  });

  it("uses Aura-2 only when ElevenLabs cannot voice the utterance at all, with pauses and nothing else", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform("s", cues);
    const { timings, line } = recordedTimings();
    const { fetch, sent } = scripted(() => new Response("", { status: 500 }));
    const auraSaid: string[] = [];
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      performance: board,
      timings,
      aura: ({ text }) => {
        auraSaid.push(text);
        return Promise.resolve(audio());
      },
    });
    const turn = timings.begin("s");
    const response = await relay.stream({
      voice: "FEMALE",
      text: said,
      session: "s",
    });
    turn.end("SPOKEN");
    expect(response.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(auraSaid).toEqual(["Fair enough, that one's on me..."]);
    expect(line()).toMatchObject({
      ttsEngines: ["aura-2"],
      ttsFallbacks: 1,
    });
  });

  it("goes straight to Aura-2 for a while once ElevenLabs refuses the key", async () => {
    const { fetch, sent } = scripted(() => new Response("", { status: 401 }));
    let aura = 0;
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      aura: () => {
        aura += 1;
        return Promise.resolve(audio());
      },
    });
    await relay.stream({ voice: "FEMALE", text: "One." });
    const before = sent.length;
    await relay.stream({ voice: "FEMALE", text: "Two." });
    expect(sent.length).toBe(before);
    expect(aura).toBe(2);
  });

  it("tells the route the audio did not come when no voice could speak", async () => {
    const { fetch } = scripted(() => new Response("", { status: 500 }));
    const relay = createElevenLabsSpeechRelay({ apiKey: "k", fetch });
    const response = await relay.stream({ voice: "FEMALE", text: said });
    expect(response.ok).toBe(false);
  });

  it("stops trying the moment the agent hangs up", async () => {
    const agent = new AbortController();
    const { fetch, sent } = scripted((_model, signal) => stalled(signal));
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch,
      firstAudioDeadlineMs: 5_000,
    });
    const pending = relay.stream({
      voice: "FEMALE",
      text: said,
      signal: agent.signal,
    });
    setTimeout(() => {
      agent.abort();
    }, 10);
    await expect(pending).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });
});

describe("one-way speech follows the same engine choice", () => {
  const mp3 = () =>
    new Response(new Uint8Array([9, 9]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });

  it("reads a line in v3, stripped of any stage direction", async () => {
    const { fetch, sent } = scripted(() => mp3());
    const speech = createElevenLabsSpeechSynthesis({ apiKey: "k", fetch });
    await speech.synthesise({ voice: "FEMALE", text: "[laughs] Welcome." });
    expect(sent[0]?.body).toEqual({
      text: "Welcome.",
      model_id: "eleven_v3_conversational",
    });
  });

  it("falls back to turbo for the line when v3 fails or is slow", async () => {
    const failing = scripted((model) =>
      model === "eleven_v3_conversational"
        ? new Response("", { status: 500 })
        : mp3(),
    );
    const speech = createElevenLabsSpeechSynthesis({
      apiKey: "k",
      fetch: failing.fetch,
    });
    const out = await speech.synthesise({ voice: "FEMALE", text: "Hello." });
    expect([...out.audio]).toEqual([9, 9]);
    expect(failing.sent.map((s) => s.body["model_id"])).toEqual([
      "eleven_v3_conversational",
      "eleven_turbo_v2_5",
    ]);

    const slow = scripted((model, signal) =>
      model === "eleven_v3_conversational" ? stalled(signal) : mp3(),
    );
    const quick = createElevenLabsSpeechSynthesis({
      apiKey: "k",
      fetch: slow.fetch,
      firstAudioDeadlineMs: 30,
    });
    await quick.synthesise({ voice: "FEMALE", text: "Hello." });
    expect(slow.sent.map((s) => s.body["model_id"])).toEqual([
      "eleven_v3_conversational",
      "eleven_turbo_v2_5",
    ]);
  });

  it("is spoken by Aura-2 when ElevenLabs cannot speak it at all", async () => {
    const eleven = createElevenLabsSpeechSynthesis({
      apiKey: "k",
      fetch: scripted(() => new Response("", { status: 500 })).fetch,
    });
    const aura = {
      name: "deepgram",
      voices: ["FEMALE", "MALE"] as const,
      synthesise: () =>
        Promise.resolve({
          audio: new Uint8Array([1]),
          mediaType: "audio/mpeg",
        }),
    };
    const both = speechWithFallback([eleven, aura]);
    expect(both?.name).toBe("elevenlabs+deepgram");
    const out = await both?.synthesise({ voice: "FEMALE", text: "Hi." });
    expect([...(out?.audio ?? [])]).toEqual([1]);
  });
});
