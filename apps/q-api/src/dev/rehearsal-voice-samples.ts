/* eslint-disable no-console -- a developer CLI whose whole purpose is to report what it made */
/**
 * `node --import ../../scripts/dev-env.mjs src/dev/rehearsal-voice-samples.ts <outDir>`
 * (run from apps/q-api). DEV ONLY; spends a little of the live keys.
 *
 * Evidence for the rehearsal voices (owner, 2026-10-23): for three sample
 * personas, the ACTIVE INVESTOR_TWIN_TURN prompt writes the opening line
 * (with the Speaks like / Local language lines code adds; OpenAI as the
 * gateway routes it, never Gemini), the persona
 * picker chooses the voice from where they are based, and ElevenLabs v4
 * turbo speaks it with the persona's settings and the line's tone. Writes
 * <outDir>/<persona>.mp3 and results.json (text, voice, model, timings,
 * characters). Persona texts are samples written here, not real people.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
} from "@capital-q/q-core";

import { localLanguageLine } from "../composition/rehearsals.js";
import { catalogVoice } from "../voice/persona-voices/catalog.js";
import {
  PERSONA_SIMILARITY,
  personaVoiceFor,
  toneSettings,
} from "../voice/persona-voices/persona-voice.js";
import type { SpeechTone } from "../voice/speech-performance.js";

type Sample = {
  readonly slug: string;
  readonly name: string;
  readonly basedIn: string;
  readonly voice: "MALE" | "FEMALE";
  readonly persona: string;
};

const SAMPLES: readonly Sample[] = [
  {
    slug: "saudi-family-office",
    name: "Al Nakheel Family Office",
    basedIn: "Riyadh, Saudi Arabia",
    voice: "MALE",
    persona:
      "Investment director at a Riyadh family office. Patient capital, long horizons, relationship first: wants to know the founder before the numbers. Courteous and unhurried, but asks pointed questions about governance and who else is on the cap table. Writes tickets of 1-3 million dollars in Series A, GCC expansion a plus.",
  },
  {
    slug: "nigerian-angel",
    name: "Adaeze Okonkwo",
    basedIn: "Lagos, Nigeria",
    voice: "FEMALE",
    persona:
      "Lagos angel investor and former fintech operator. Warm and quick, laughs easily, but cuts straight to unit economics and how the product works for Nigerian SMEs. Invests 25-100 thousand dollars pre-seed; values founders who know the market on the ground.",
  },
  {
    slug: "london-vc-partner",
    name: "Harbourline Ventures",
    basedIn: "London, United Kingdom",
    voice: "MALE",
    persona:
      "Partner at a London Series A fund. Brisk, dry humour, impatient with vague answers; pushes on net revenue retention, CAC payback and why now. Leads 5-10 million pound rounds in B2B software.",
  },
];

/** The turn's mood to the speech tone the relay uses (as performRehearsalLine). */
const TONES = new Set<string>([
  "WARM",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ANGRY",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
  "SAD",
  "AUTHORITATIVE",
  "MEEK",
  "SARCASTIC",
  "AMUSED",
  "HAPPY",
  "DISAPPOINTED",
]);

async function line(sample: Sample): Promise<{
  readonly line: string;
  readonly mood: string;
  readonly intensity: "SOFT" | "NORMAL" | "RAISED";
  readonly ms: number;
}> {
  // As rehearsals.ts passes them; the frame fields are the renderer's.
  const variables = {
    viewerRole: "FOUNDER",
    viewerOrganisation: "Nixo",
    counterpartName: sample.name,
    counterpartRole: "INVESTOR",
    persona:
      sample.persona +
      `\nSpeaks like: someone who lives and works in ${sample.basedIn}.` +
      localLanguageLine(sample.basedIn),
    meetingMaterial:
      "Nixo: invoicing and payments for SMEs in West Africa and the Gulf; raising a 3 million dollar seed.",
    rehearsal: "",
    turnsSoFar: 0,
    minutesElapsed: 0,
    cue: "OPENING",
    difficulty: "REALISTIC",
    temperament: "",
    stance: "",
    cameraOn: false,
    presence: "",
    questioning: "",
    screenShared: false,
  };
  const prompt = renderPrompt(createDefaultPromptRegistry(), {
    task: "INVESTOR_TWIN_TURN",
    operatingMode: "CONTINUOUS_INTELLIGENCE",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes:
      "A private rehearsal on Capital Q. Practice only: nothing here is evidence or is shown to the other person.",
    variables,
  });
  const started = Date.now();
  // OpenAI, as the gateway routes the turn (gpt-5.6-luna first). Never
  // Gemini: unpaid and off in production (owner, 2026-10-23).
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
      messages: prompt.messages.map((message, index) => ({
        role: message.role === "SYSTEM" ? "system" : "user",
        content:
          ("content" in message && typeof message.content === "string"
            ? message.content
            : "") +
          (index === prompt.messages.length - 1
            ? "\n\nAnswer as one JSON object with at least: line, mood, intensity."
            : ""),
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `model ${String(response.status)}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const parsed = JSON.parse(body.choices[0]?.message.content ?? "{}") as {
    line?: string;
    mood?: string;
    intensity?: "SOFT" | "NORMAL" | "RAISED";
  };
  return {
    line: parsed.line ?? "",
    mood: parsed.mood ?? "NEUTRAL",
    intensity: parsed.intensity ?? "NORMAL",
    ms: Date.now() - started,
  };
}

async function speak(
  text: string,
  voiceId: string,
  settings: Record<string, number | boolean>,
): Promise<{ audio: Buffer; model: string; firstByteMs: number }> {
  for (const model of ["eleven_v4_turbo", "eleven_flash_v2_5"]) {
    const started = Date.now();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: settings,
        }),
      },
    );
    if (!response.ok || response.body === null) {
      console.log(`  ${model}: ${String(response.status)}`);
      continue;
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> =
      response.body.getReader();
    const chunks: Uint8Array[] = [];
    let firstByteMs = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs < 0) firstByteMs = Date.now() - started;
      chunks.push(value);
    }
    return { audio: Buffer.concat(chunks), model, firstByteMs };
  }
  throw new Error("no model spoke");
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (out === undefined)
    throw new Error("usage: rehearsal-voice-samples.ts <outDir>");
  mkdirSync(out, { recursive: true });
  const results: unknown[] = [];
  for (const sample of SAMPLES) {
    const chosen = personaVoiceFor({
      seed: `SAMPLE:${sample.slug}`,
      voice: sample.voice,
      basedIn: sample.basedIn,
      ageGroup: null,
      patience: "TYPICAL",
    });
    if (chosen === null) throw new Error("no voice");
    const written = await line(sample);
    const tone = TONES.has(written.mood) ? (written.mood as SpeechTone) : null;
    const shade = toneSettings({ tone, intensity: written.intensity });
    const settings = {
      stability: shade?.stability ?? chosen.stability,
      similarity_boost: PERSONA_SIMILARITY,
      style: shade?.style ?? 0,
      speed: Math.min(1.2, Math.max(0.7, chosen.speed * (shade?.pace ?? 1))),
      use_speaker_boost: true,
    };
    const spoken = await speak(written.line, chosen.voiceId, settings);
    writeFileSync(join(out, `${sample.slug}.mp3`), spoken.audio);
    const voice = catalogVoice(chosen.voiceId);
    const result = {
      persona: sample.slug,
      basedIn: sample.basedIn,
      localLanguage: localLanguageLine(sample.basedIn).trim() || null,
      voice:
        voice === undefined
          ? chosen.voiceId
          : `${voice.name} (${voice.language}/${voice.accent}/${voice.gender})`,
      accent: chosen.accent,
      line: written.line,
      mood: written.mood,
      intensity: written.intensity,
      settings,
      model: spoken.model,
      modelMs: written.ms,
      ttsFirstByteMs: spoken.firstByteMs,
      characters: written.line.length,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  writeFileSync(
    join(out, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

await main();
