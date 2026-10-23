import { createDefaultPromptRegistry } from "@capital-q/q-core";
import { describe, expect, it } from "vitest";

import {
  localLanguageLine,
  type RehearsalService,
} from "../src/composition/rehearsals.js";
import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import type { VoiceSpeaker } from "../src/voice/provider.js";
import {
  createRehearsalAwareTurn,
  PERSONA_FILLER_AFTER_MS,
  PERSONA_FILLERS,
} from "../src/voice/rehearsal-turn.js";

import {
  accentForPlace,
  localLanguageFor,
  catalogVoice,
  pickVoice,
  shapeForAge,
  type CatalogVoice,
} from "../src/voice/persona-voices/catalog.js";
import {
  expressivePeak,
  parsePersonaVoiceSpec,
  personaVoiceFor,
  personaVoiceSpec,
  tavusTtsLayer,
  toneSettings,
} from "../src/voice/persona-voices/persona-voice.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";
import {
  createElevenLabsSpeechRelay,
  PERSONA_VOICE_IDS,
  personaModelsFor,
  personaVoiceSettings,
  refusalKind,
} from "../src/voice/providers/elevenlabs-speak.js";
import {
  createSpeechPerformanceBoard,
  deliverLine,
} from "../src/voice/speech-performance.js";

/**
 * REHEARSE: the person Q plays sounds like who they are (Kuuza's persona
 * voices, carried over). The picker, the persona's settings and the
 * relay's fallbacks are driven with fixed data and a fake `fetch`: what is
 * under test is the choice this code makes, never ElevenLabs.
 */

/** Q's own voices: a persona must never speak in them. */
const Q_VOICES = ["EXAVITQu4vr4xnSDxMaL", "onwK4e9ZLuTAKqWW03F9"];

const voice = (
  id: string,
  language: string,
  accent: string,
  gender: string,
  ageGroup: CatalogVoice["ageGroup"],
  verifiedLanguages: readonly string[] = [],
): CatalogVoice => ({
  id,
  name: id,
  category: "professional",
  language,
  accent,
  gender,
  ageGroup,
  verifiedLanguages,
});

const SMALL: readonly CatalogVoice[] = [
  voice("BritMaleSenior01", "en", "british", "male", "senior"),
  voice("BritMaleYoung001", "en", "british", "male", "young_adult"),
  voice("BritFemale000001", "en", "british", "female", "middle_aged"),
  voice("IrishMale0000001", "en", "irish", "male", "middle_aged"),
  voice("AmerFemale000001", "en", "american", "female", "middle_aged"),
  voice("AmerMale00000001", "en", "american", "male", "middle_aged"),
  voice("NaijaFemale00001", "en", "nigerian", "female", "middle_aged"),
  voice("SaffaMale0000001", "en", "south african", "male", "middle_aged"),
  // Arabic: verified for English (tier 1), multilingual only (tier 2),
  // and Arabic-only (never for English).
  voice("ArabicTier100001", "ar", "saudi", "male", "middle_aged", ["ar", "en"]),
  voice("ArabicTier200001", "ar", "modern standard", "male", "middle_aged", [
    "ar",
    "fr",
  ]),
  voice("ArabicOnly000001", "ar", "modern standard", "female", "middle_aged", [
    "ar",
  ]),
];

describe("where a counterpart is based, as an accent", () => {
  it.each([
    ["Dubai, United Arab Emirates", "arabic"],
    ["Abu Dhabi", "arabic"],
    ["AE", "arabic"],
    ["Riyadh, Saudi Arabia", "arabic"],
    ["Lagos, Nigeria", "nigerian"],
    ["NG", "nigerian"],
    ["London", "british"],
    ["Greater London Area", "british"],
    ["GB", "british"],
    ["Cape Town, South Africa", "south_african"],
    ["San Francisco, CA, United States", "american"],
    ["Nairobi, Kenya", "nigerian"],
    ["Singapore", "singaporean"],
    ["Emirati", "arabic"],
  ])("%s → %s", (place, accent) => {
    expect(accentForPlace(place)).toBe(accent);
  });

  it("keeps an unknown place unknown, never a guessed nationality", () => {
    expect(accentForPlace(null)).toBeNull();
    expect(accentForPlace("")).toBeNull();
    expect(accentForPlace("Remote")).toBeNull();
    expect(accentForPlace("Planet Zog")).toBeNull();
    // A two-letter English word inside a phrase is not a country code.
    expect(accentForPlace("based in it")).toBeNull();
  });
});

describe("the voice picker", () => {
  it("gives a Gulf man Arabic-accented English, preferring a voice verified for English", () => {
    const pick = pickVoice({
      accent: "arabic",
      gender: "male",
      ageGroup: null,
      seed: "INVESTOR_ORGANISATION:gulf",
      catalog: SMALL,
    });
    expect(pick?.voice.id).toBe("ArabicTier100001");
    expect(pick?.fellBack).toBe(false);
  });

  it("never uses a single-language voice for English", () => {
    const pick = pickVoice({
      accent: "arabic",
      gender: "female",
      ageGroup: null,
      seed: "x",
      catalog: SMALL,
    });
    // The Arabic-only voice is skipped; arabic → indian → neutral.
    expect(pick?.voice.id).not.toBe("ArabicOnly000001");
    expect(pick?.accent).toBe("american");
    expect(pick?.fellBack).toBe(true);
  });

  it("falls back regionally before neutrally", () => {
    const pick = pickVoice({
      accent: "nigerian",
      gender: "male",
      ageGroup: null,
      seed: "x",
      catalog: SMALL,
    });
    // No Nigerian man in this catalog: South African is the nearest.
    expect(pick?.accent).toBe("south_african");
    const irish = pickVoice({
      accent: "irish",
      gender: "female",
      ageGroup: null,
      seed: "x",
      catalog: SMALL,
    });
    expect(irish?.accent).toBe("british");
  });

  it("matches gender and the nearest age", () => {
    const senior = pickVoice({
      accent: "british",
      gender: "male",
      ageGroup: "senior",
      seed: "x",
      catalog: SMALL,
    });
    expect(senior?.voice.id).toBe("BritMaleSenior01");
    const young = pickVoice({
      accent: "british",
      gender: "male",
      ageGroup: "young_adult",
      seed: "x",
      catalog: SMALL,
    });
    expect(young?.voice.id).toBe("BritMaleYoung001");
    const woman = pickVoice({
      accent: "nigerian",
      gender: "female",
      ageGroup: null,
      seed: "x",
      catalog: SMALL,
    });
    expect(woman?.voice.id).toBe("NaijaFemale00001");
  });

  it("gives an unknown place a neutral voice", () => {
    const pick = pickVoice({
      accent: null,
      gender: "male",
      ageGroup: null,
      seed: "x",
      catalog: SMALL,
    });
    expect(pick?.accent).toBe("american");
    expect(pick?.wanted).toBeNull();
  });

  it("keeps the same counterpart on the same voice, whatever order the catalog is in", () => {
    const seeds = ["COMPANY:a", "COMPANY:b", "COMPANY:c", "COMPANY:d"];
    for (const seed of seeds) {
      const first = pickVoice({
        accent: "british",
        gender: "male",
        ageGroup: null,
        seed,
      });
      const again = pickVoice({
        accent: "british",
        gender: "male",
        ageGroup: null,
        seed,
        catalog: [...SMALL].reverse(),
      });
      const twice = pickVoice({
        accent: "british",
        gender: "male",
        ageGroup: null,
        seed,
      });
      expect(twice?.voice.id).toBe(first?.voice.id);
      expect(again?.voice.id).toBe(
        pickVoice({
          accent: "british",
          gender: "male",
          ageGroup: null,
          seed,
          catalog: SMALL,
        })?.voice.id,
      );
    }
  });

  it("is strict when an accent was chosen by a person", () => {
    expect(
      pickVoice({
        accent: "irish",
        gender: "female",
        ageGroup: null,
        seed: "x",
        strict: true,
        catalog: SMALL,
      }),
    ).toBeNull();
  });

  it("never picks Q's own voice from the committed catalog", () => {
    for (const id of Q_VOICES) expect(catalogVoice(id)).toBeUndefined();
  });

  it("finds real accents in the committed catalog", () => {
    const gulf = pickVoice({
      accent: "arabic",
      gender: "male",
      ageGroup: null,
      seed: "INVESTOR_ORGANISATION:1",
    });
    expect(gulf?.voice.language).toBe("ar");
    expect(gulf?.voice.verifiedLanguages).toContain("en");
    const lagos = pickVoice({
      accent: "nigerian",
      gender: "female",
      ageGroup: null,
      seed: "EXTERNAL_PERSON:2",
    });
    expect(lagos?.voice.accent).toBe("nigerian");
    const london = pickVoice({
      accent: "british",
      gender: "male",
      ageGroup: null,
      seed: "INVESTOR_ORGANISATION:3",
    });
    expect(london?.voice.accent).toBe("british");
  });
});

describe("age and patience in the persona's delivery", () => {
  it("shapes speed and stability by age, and leaves an unknown age alone", () => {
    expect(shapeForAge({ speed: 1, stability: 0.8 }, "senior")).toEqual({
      speed: 0.88,
      stability: 0.7,
    });
    expect(
      shapeForAge({ speed: 0.95, stability: 0.65 }, "young_adult"),
    ).toEqual({
      speed: 1,
      stability: 0.65,
    });
    expect(shapeForAge({ speed: 0.95, stability: 0.65 }, null)).toEqual({
      speed: 0.95,
      stability: 0.65,
    });
  });

  it("makes an impatient person quicker to speak and to take their turn", () => {
    const short = personaVoiceFor({
      seed: "INVESTOR_ORGANISATION:1",
      voice: "MALE",
      basedIn: "Dubai, UAE",
      ageGroup: null,
      patience: "SHORT",
    });
    expect(short?.accent).toBe("arabic");
    expect(short?.speed).toBeGreaterThan(1);
    expect(short?.turnTaking).toBe("EAGER");
    const long = personaVoiceFor({
      seed: "INVESTOR_ORGANISATION:1",
      voice: "MALE",
      basedIn: null,
      ageGroup: null,
      patience: "LONG",
    });
    expect(long?.wanted).toBeNull();
    expect(long?.turnTaking).toBe("PATIENT");
    expect(long?.speed).toBeLessThan(1);
  });

  it("carries the voice through the sealed spec, and reads an older bare id", () => {
    const chosen = personaVoiceFor({
      seed: "COMPANY:1",
      voice: "FEMALE",
      basedIn: "Lagos",
      ageGroup: "senior",
      patience: "TYPICAL",
    });
    expect(chosen).not.toBeNull();
    if (chosen === null) return;
    const spec = personaVoiceSpec(chosen);
    expect(spec.length).toBeLessThanOrEqual(200);
    expect(parsePersonaVoiceSpec(spec)).toEqual({
      voiceId: chosen.voiceId,
      speed: 0.88,
      stability: 0.65,
    });
    expect(parsePersonaVoiceSpec("JBFqnCBsd6RMkjVDRZzb")).toEqual({
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
    });
  });
});

describe("emotion on a model without audio tags", () => {
  it("leaves a neutral line as the voice is", () => {
    expect(toneSettings({ tone: null, intensity: "NORMAL" })).toBeUndefined();
  });

  it("moves the voice for a raised, angry or impatient line", () => {
    const raised = toneSettings({ tone: "ANGRY", intensity: "RAISED" });
    expect(raised?.stability).toBeLessThanOrEqual(0.3);
    expect(raised?.style).toBeGreaterThanOrEqual(0.6);
    const impatient = toneSettings({ tone: "IMPATIENT", intensity: "NORMAL" });
    expect(impatient?.pace).toBeGreaterThan(1);
    const cold = toneSettings({ tone: "COLD", intensity: "NORMAL" });
    expect(cold?.stability).toBeGreaterThan(0.65);
  });

  it("sends v3 only the peaks worth its latency", () => {
    expect(
      expressivePeak([
        { reaction: null, intensity: "NORMAL", tone: "SKEPTICAL" },
      ]),
    ).toBe(false);
    expect(
      expressivePeak([{ reaction: "LAUGH", intensity: "NORMAL", tone: null }]),
    ).toBe(true);
    expect(
      expressivePeak([{ reaction: null, intensity: "RAISED", tone: null }]),
    ).toBe(true);
  });

  it("keeps v3 to its three stabilities and leaves its speed alone", () => {
    const v3 = personaVoiceSettings(
      "eleven_v3_conversational",
      { voiceId: "x", speed: 1.06, stability: 0.65 },
      { speed: undefined, stability: undefined },
    );
    expect(v3).toEqual({
      stability: 0.5,
      similarity_boost: 0.85,
      style: 0,
      use_speaker_boost: true,
    });
    const turbo = personaVoiceSettings(
      "eleven_v4_turbo",
      { voiceId: "x", speed: 1.06, stability: 0.65 },
      { speed: undefined, voice: { stability: 0.4, style: 0.4, pace: 1.04 } },
    );
    expect(turbo).toMatchObject({
      stability: 0.4,
      similarity_boost: 0.85,
      style: 0.4,
      speed: 1.1,
    });
  });
});

describe("telling one ElevenLabs refusal from another", () => {
  it("classifies the English-only voice, a missing voice and an unavailable model", () => {
    expect(
      refusalKind(
        422,
        '{"detail":{"status":"can_only_use_with_monolingual_models","message":"the selected voice can only be used with english-only models such as turbo v2"}}',
      ),
    ).toBe("ENGLISH_ONLY");
    expect(
      refusalKind(
        404,
        '{"detail":{"status":"voice_not_found","message":"a voice with the voice_id x was not found."}}',
      ),
    ).toBe("VOICE_MISSING");
    expect(
      refusalKind(
        400,
        '{"detail":{"status":"model_not_found","message":"model eleven_v4_turbo does not exist."}}',
      ),
    ).toBe("MODEL_UNAVAILABLE");
    expect(refusalKind(500, "voice_not_found")).toBeNull();
    expect(refusalKind(429, "too many requests")).toBeNull();
  });

  it("puts v4 turbo first with flash v2.5 behind it", () => {
    expect(personaModelsFor("eleven_v4_turbo")).toEqual([
      "eleven_v4_turbo",
      "eleven_flash_v2_5",
    ]);
  });
});

type Seen = { voiceId: string; model: string; body: Record<string, unknown> };

/** A fake ElevenLabs: answers each request from `answer`, and records it. */
function fakeElevenLabs(answer: (seen: Seen) => Response): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    const entry = {
      voiceId: url.pathname.split("/")[3] ?? "",
      model: typeof body.model_id === "string" ? body.model_id : "",
      body,
    };
    seen.push(entry);
    return Promise.resolve(answer(entry));
  };
  return { fetch: fetchFake, seen };
}

const pcm = (): Response =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "audio/pcm" },
  });
const refusal = (status: number, detail: string): Response =>
  new Response(JSON.stringify({ detail }), { status });

const ARABIC = "ML7jGRDg4E9hIl5qEm1Z";
const SPEC = `${ARABIC};1.06;0.65`;

describe("the speak relay for a person Q plays", () => {
  const persona = {
    model: "eleven_v4_turbo",
    expressivePeaks: true,
  } as const;

  it("voices a persona line on v4 turbo in the persona's own voice and settings", async () => {
    const fake = fakeElevenLabs(() => pcm());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    const response = await relay.stream({
      voice: "FEMALE",
      text: "What is your churn?",
      voiceId: SPEC,
    });
    expect(response.ok).toBe(true);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({
      voiceId: ARABIC,
      model: "eleven_v4_turbo",
      body: {
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.85,
          speed: 1.06,
        },
      },
    });
  });

  it("leaves Q's own voice and model alone", async () => {
    const fake = fakeElevenLabs(() => pcm());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    await relay.stream({ voice: "FEMALE", text: "Hello, I'm Q." });
    expect(fake.seen[0]).toMatchObject({
      voiceId: Q_VOICES[0],
      model: "eleven_v3_conversational",
    });
  });

  it("sends a raised, angry line to v3 with its audio tags", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "s1",
      deliverLine(["That is not what you told me."], {
        tone: "ANGRY",
        intensity: "RAISED",
        reaction: null,
      }),
    );
    const fake = fakeElevenLabs(() => pcm());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
      performance: board,
    });
    await relay.stream({
      voice: "FEMALE",
      text: "That is not what you told me.",
      voiceId: SPEC,
      session: "s1",
    });
    expect(fake.seen[0]?.model).toBe("eleven_v3_conversational");
    expect(String(fake.seen[0]?.body.text)).toContain("[angry]");
  });

  it("renders an impatient line on v4 turbo as voice settings, never as words", async () => {
    const board = createSpeechPerformanceBoard();
    board.perform(
      "s2",
      deliverLine(["Get to the point."], {
        tone: "IMPATIENT",
        intensity: "NORMAL",
        reaction: null,
      }),
    );
    const fake = fakeElevenLabs(() => pcm());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
      performance: board,
    });
    await relay.stream({
      voice: "FEMALE",
      text: "Get to the point.",
      voiceId: SPEC,
      session: "s2",
    });
    expect(fake.seen[0]?.model).toBe("eleven_v4_turbo");
    expect(fake.seen[0]?.body.text).toBe("Get to the point.");
    expect(fake.seen[0]?.body.voice_settings).toMatchObject({
      stability: 0.45,
      style: 0.35,
    });
  });

  it("retries an English-only voice on flash v2, and goes there directly next time", async () => {
    const fake = fakeElevenLabs((seen) =>
      seen.model === "eleven_flash_v2"
        ? pcm()
        : refusal(
            422,
            "can_only_use_with_monolingual_models: the selected voice can only be used with english-only models",
          ),
    );
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    const first = await relay.stream({
      voice: "FEMALE",
      text: "Go on.",
      voiceId: SPEC,
    });
    expect(first.ok).toBe(true);
    expect(fake.seen.map((s) => s.model)).toEqual([
      "eleven_v4_turbo",
      "eleven_flash_v2",
    ]);
    expect(fake.seen.every((s) => s.voiceId === ARABIC)).toBe(true);
    await relay.stream({ voice: "FEMALE", text: "And then?", voiceId: SPEC });
    expect(fake.seen.at(-1)?.model).toBe("eleven_flash_v2");
    expect(fake.seen).toHaveLength(3);
  });

  it("speaks in a premade persona voice when the account lacks the catalog voice", async () => {
    const fake = fakeElevenLabs((seen) =>
      seen.voiceId === ARABIC
        ? refusal(
            404,
            "voice_not_found: a voice with that voice_id was not found",
          )
        : pcm(),
    );
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    const response = await relay.stream({
      voice: "FEMALE",
      text: "Go on.",
      voiceId: SPEC,
    });
    expect(response.ok).toBe(true);
    const used = fake.seen.at(-1)?.voiceId ?? "";
    expect(PERSONA_VOICE_IDS.FEMALE).toContain(used);
    expect(Q_VOICES).not.toContain(used);
  });

  it("skips a model the account does not have, and remembers it", async () => {
    const fake = fakeElevenLabs((seen) =>
      seen.model === "eleven_v4_turbo"
        ? refusal(400, "model_not_found: model eleven_v4_turbo does not exist")
        : pcm(),
    );
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    await relay.stream({ voice: "MALE", text: "Go on.", voiceId: SPEC });
    expect(fake.seen.map((s) => s.model)).toEqual([
      "eleven_v4_turbo",
      "eleven_flash_v2_5",
    ]);
    await relay.stream({ voice: "MALE", text: "And then?", voiceId: SPEC });
    expect(fake.seen.at(-1)?.model).toBe("eleven_flash_v2_5");
    expect(fake.seen).toHaveLength(3);
  });

  it("never speaks a persona in Q's voice, even for an id it does not know", async () => {
    const fake = fakeElevenLabs(() => pcm());
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      persona,
    });
    await relay.stream({
      voice: "MALE",
      text: "Go on.",
      voiceId: "NotACatalogVoice1;1.00;0.65",
    });
    const used = fake.seen[0]?.voiceId ?? "";
    expect(PERSONA_VOICE_IDS.MALE).toContain(used);
  });
});

describe("turn-taking on the standard line", () => {
  const provider = createDeepgramVoiceProvider({
    apiKey: "dg-key",
    publicUrl: "https://public.example",
    thinkPath: "/v1/q/voice/think",
  });
  const settings = (turnTaking?: "EAGER" | "NORMAL" | "PATIENT") =>
    provider.settingsFor({
      voice: "MALE",
      greeting: undefined,
      thinkToken: "t",
      ...(turnTaking === undefined ? {} : { turnTaking }),
    });
  const eot = (threshold: number, timeoutMs: number) => ({
    agent: {
      listen: {
        provider: { eot_threshold: threshold, eot_timeout_ms: timeoutMs },
      },
    },
  });

  it("keeps Q's own end of turn, and moves it for an impatient or patient persona", () => {
    expect(settings()).toMatchObject(eot(0.85, 4_000));
    expect(settings("EAGER")).toMatchObject(eot(0.8, 3_000));
    expect(settings("PATIENT")).toMatchObject(eot(0.9, 5_000));
  });
});

describe("a slow persona reply (row 11: soft-timeout filler)", () => {
  type Say = RehearsalService["say"];
  const line = (text: string) =>
    ({
      kind: "OK",
      rehearsal: {
        turns: [{ from: "THEM", text, at: "2026-10-21T10:00:00.000Z" }],
      },
    }) as unknown as Awaited<ReturnType<Say>>;
  const run = async (delayMs: number, deferred = false): Promise<string[]> => {
    const spoken: string[] = [];
    const say: Say = () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(line("What is your churn?")), delayMs),
      );
    const turn = createRehearsalAwareTurn({
      rehearsals: { say } as unknown as RehearsalService,
      fallback: () => Promise.resolve({ kind: "NOTHING" }),
      fillerAfterMs: 20,
    });
    const speaker: VoiceSpeaker = {
      providerConversationId: "dg_x",
      isOpen: true,
      deferred,
      speak: (text) => {
        if (typeof text === "string") spoken.push(text);
        return Promise.resolve();
      },
      close: () => undefined,
    };
    await turn(
      {
        voiceSessionId: `v-${String(delayMs)}-${String(deferred)}`,
        actor: {},
        thread: { rehearsal: { rehearsalId: "r1" } },
      } as unknown as VoiceSessionBinding,
      [{ role: "user", content: "We grow fast." }],
      new AbortController().signal,
      speaker,
    );
    return spoken;
  };

  it("says nothing extra when the reply is quick", async () => {
    expect(await run(0)).toEqual(["What is your churn?"]);
  });

  it("fills a long wait with a few in-character words, then the line", async () => {
    const spoken = await run(80);
    expect(spoken).toHaveLength(2);
    expect(PERSONA_FILLERS as readonly string[]).toContain(spoken[0]);
    expect(spoken[1]).toBe("What is your churn?");
  });

  it("never adds a filler on a line that says everything at once", async () => {
    expect(await run(80, true)).toEqual(["What is your churn?"]);
  });

  it("waits about three seconds by default, as Kuuza's soft timeout", () => {
    expect(PERSONA_FILLER_AFTER_MS).toBe(3_000);
  });
});

describe("the Tavus face's persona voice (row 14, UNVERIFIED LIVE)", () => {
  it("names a public ElevenLabs voice and its settings, never a key", () => {
    const chosen = personaVoiceFor({
      seed: "COMPANY:1",
      voice: "FEMALE",
      basedIn: "Lagos, Nigeria",
      ageGroup: null,
      patience: "TYPICAL",
    });
    expect(chosen).not.toBeNull();
    if (chosen === null) return;
    const layer = tavusTtsLayer(chosen);
    expect(layer).toMatchObject({
      tts_engine: "elevenlabs",
      external_voice_id: chosen.voiceId,
      tts_model_name: "eleven_flash_v2_5",
      voice_settings: { similarity_boost: 0.85 },
    });
    expect(JSON.stringify(layer)).not.toMatch(/api_key/u);
  });
});

describe("how the person Q plays talks (row 12, INVESTOR_TWIN_TURN v11)", () => {
  const template =
    createDefaultPromptRegistry().getActive("INVESTOR_TWIN_TURN").definition
      .template;

  it("is the active turn prompt, and asks for idiom from the Speaks like line", () => {
    expect(
      createDefaultPromptRegistry().getActive("INVESTOR_TWIN_TURN").definition
        .version,
    ).toBe(12);
    expect(template).toContain('"Speaks like" line');
    expect(template).toContain("code-switch");
  });

  it("v12: greets in the local language once, in its own script, substance in English", () => {
    expect(template).toContain('"Local language" line');
    expect(template).toContain("own script");
    expect(template).toContain("never transliterated");
    expect(template).toContain("everything that matters stays in English");
  });

  it("forbids caricature, stereotype and spelled-out accents", () => {
    expect(template).toContain("never spell an accent out");
    expect(template).toContain("never caricature, stereotype or exaggerate");
    expect(template).toContain("never let it change what they know or think");
  });
});

describe("warming a persona's library voice before its first line", () => {
  it("warms a library voice once, in a few characters on flash, and skips premade voices", async () => {
    const fake = fakeElevenLabs(() => pcm());
    let clock = 0;
    const relay = createElevenLabsSpeechRelay({
      apiKey: "k",
      fetch: fake.fetch,
      now: () => clock,
    });
    relay.warm?.(SPEC);
    relay.warm?.(SPEC);
    relay.warm?.("JBFqnCBsd6RMkjVDRZzb;1.00;0.65"); // George: premade
    relay.warm?.("NotACatalogVoice1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({
      voiceId: ARABIC,
      model: "eleven_flash_v2_5",
    });
    expect(String(fake.seen[0]?.body.text).length).toBeLessThanOrEqual(4);
    clock += 21 * 60_000;
    relay.warm?.(SPEC);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.seen).toHaveLength(2);
  });
});

describe("where a persona is from, read right (2026-10-23 audit)", () => {
  it("never reads a US state code as a country", () => {
    expect(accentForPlace("Boston, MA")).toBe("american");
    expect(accentForPlace("Denver, CO")).toBe("american");
    expect(accentForPlace("Wilmington, DE")).toBe("american");
    expect(accentForPlace("Boise, ID")).toBe("american");
    expect(accentForPlace("Nashville, TN")).toBe("american");
  });

  it("still reads a known city first, and an ISO code on its own", () => {
    expect(accentForPlace("Riyadh, SA")).toBe("arabic");
    expect(accentForPlace("Casablanca, MA")).toBe("arabic");
    expect(accentForPlace("Lagos, NG")).toBe("nigerian");
    expect(accentForPlace("SA")).toBe("arabic");
    expect(accentForPlace("Istanbul, Türkiye")).toBe("turkish");
  });

  it("tells the turn prompt the language and script, or nothing", () => {
    expect(localLanguageLine("Riyadh, Saudi Arabia")).toBe(
      "\nLocal language: Arabic (write it in Arabic script).",
    );
    expect(localLanguageLine("London, United Kingdom")).toBe("");
    expect(localLanguageLine(null)).toBe("");
  });

  it("names the language a persona greets in, and its script", () => {
    expect(localLanguageFor("Riyadh, Saudi Arabia")).toEqual({
      language: "Arabic",
      script: "Arabic script",
    });
    expect(localLanguageFor("Lagos, Nigeria")?.language).toBe("Yoruba");
    expect(localLanguageFor("Kano, Nigeria")?.language).toBe("Hausa");
    expect(localLanguageFor("Nigeria")?.language).toBe("Nigerian Pidgin");
    expect(localLanguageFor("Bengaluru, India")?.script).toBe("Devanagari");
    // English-speaking or unknown: no local language, never a guess.
    expect(localLanguageFor("London, United Kingdom")).toBeNull();
    expect(localLanguageFor(null)).toBeNull();
  });

  it("gives an Arabic-speaking persona a choice of Arabic voices, not one", () => {
    const picks = Array.from({ length: 40 }, (_, i) =>
      personaVoiceFor({
        seed: `INVESTOR_ORGANISATION:${String(i)}`,
        voice: "MALE",
        basedIn: "Riyadh, Saudi Arabia",
        ageGroup: null,
        patience: "TYPICAL",
      }),
    );
    // Was one voice (Fahad) for every Arabic-speaking man.
    expect(new Set(picks.map((pick) => pick?.voiceId)).size).toBeGreaterThan(3);
    for (const pick of picks) expect(pick?.accent).toBe("arabic");
  });
});
