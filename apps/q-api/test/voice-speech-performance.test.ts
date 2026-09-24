import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import { createElevenLabsSpeechRelay } from "../src/voice/providers/elevenlabs-speak.js";
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

  it("keeps turbo v2.5 the default and never sends it a reaction", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "s",
      anchorCues(SPOKEN, { ...PLAIN, reaction: "LAUGH", reactionAt: 0 }),
    );
    const { fetch, sent } = vendor();
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
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
      firstAudioMs: 1300,
      endMs: 1300,
      cues: ["reaction"],
      ttsRequests: 1,
    });
    // What was said is never in the line.
    expect(JSON.stringify(timed)).not.toContain("Fair enough");
  });
});
