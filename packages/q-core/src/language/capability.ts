import { languageInfo } from "./registry.js";

/**
 * What each voice and video provider documents for each language, read
 * once from the providers' own pages into data (checked 2026-10-16; the
 * handoff doc docs/ai-handoff/LANGUAGES-2026-10-16.md quotes them). Each
 * channel picks its configuration for a language from here, or says it
 * cannot: a language a provider does not list is never sent to it, and the
 * channel falls back to text with a plain note instead of pretending.
 */

export const LANGUAGE_CAPABILITY_SOURCES = {
  deepgram: "https://developers.deepgram.com/docs/models-languages-overview",
  deepgramVoiceAgent:
    "https://developers.deepgram.com/docs/configure-voice-agent",
  elevenlabs: "https://elevenlabs.io/docs/overview/models",
  tavus:
    "https://docs.tavus.io/sections/conversational-video-interface/language-support.md",
  openaiTranscription:
    "https://developers.openai.com/api/docs/guides/speech-to-text",
  whisperLanguages:
    "https://github.com/openai/whisper/blob/main/whisper/tokenizer.py",
  gptLive: "https://developers.openai.com/api/docs/models/gpt-live-1",
  gptLivePrompting:
    "https://developers.openai.com/api/docs/guides/live-prompting",
} as const;

const list = (codes: string): ReadonlySet<string> =>
  new Set(codes.trim().split(/\s+/u));

/** Deepgram Flux English (`flux-general-en`). */
const FLUX_EN = list("en");
/** Deepgram Flux Multilingual (`flux-general-multi`): ten languages, code-switching among them. */
const FLUX_MULTI = list("en es fr de hi ru pt ja it nl");
/** Deepgram Nova-3: primary subtags. */
const NOVA3 = list(`
  af ar hy as be bn bs bg ca zh hr cs da nl en et fi fr ka de el gu he hi hu id
  it ja kn kk ko lv lt mk ms mr mn ne no ps fa pl pt pa ro ru sr sk sl es sv tl
  ta te th tr uk ur vi`);
/** Deepgram Nova-3: the regional codes it names (used when the person's tag has one). */
const NOVA3_REGIONAL = list(`
  af-ZA ar-AE ar-SA ar-QA ar-KW ar-SY ar-LB ar-PS ar-JO ar-EG ar-SD ar-TD ar-MA
  ar-DZ ar-TN ar-IQ ar-IR as-IN zh-HK zh-CN zh-Hans zh-TW zh-Hant cs-CZ da-DK
  en-US en-AU en-GB en-IN en-NZ nl-BE fr-CA ka-GE de-CH gu-IN kk-KZ ko-KR ps-AF
  pt-BR pt-PT pa-IN es-419 sv-SE th-TH tr-TR`);
/** ElevenLabs Eleven v3 and v3 Conversational (`language_code`, ISO 639-1 or 639-3). */
const ELEVEN_V3 = list(`
  af ar hy as ast az be bn bs bg my yue ca ceb ny hr cs da nl en et fil fi fr gl
  ka de el gu ha he hi hu is id ga it ja jv kn kk ky ko lv ln lt lb mk ms ml mt
  zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sd sk sl so es sw sv tg ta te
  th tr uk ur uz vi cy yo`);
/** Tavus CVI `languages` (42, default `tavus-auto` engines). */
const TAVUS = list(`
  ar bn bg zh hr cs da nl en fi fr ka de el gu he hi hu id it ja kn ko ms ml mr
  no pl pt pa ro ru sk es sv tl ta te th tr uk vi`);
/** OpenAI transcription follows Whisper's language list (`language` hint, ISO 639-1). */
const WHISPER = list(`
  en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro
  da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu
  is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo
  uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue`);

/** CLDR writes some languages with a code a provider spells differently. */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  nb: "no",
  fil: "tl",
};

function providerCode(
  primary: string,
  supported: ReadonlySet<string>,
): string | null {
  if (supported.has(primary)) return primary;
  const alias = PROVIDER_ALIASES[primary];
  return alias !== undefined && supported.has(alias) ? alias : null;
}

/** How the standard voice line listens (Deepgram Voice Agent `agent.listen.provider`). */
export type VoiceListenPlan =
  | { readonly model: "flux-general-en" | "flux-general-multi" }
  | { readonly model: "nova-3"; readonly language: string };

/** How Q speaks (ElevenLabs, `language_code`). */
export type VoiceSpeakPlan = { readonly languageCode: string };

/** How a Tavus room listens and speaks (`properties.languages`, first opens). */
export type VideoPlan = { readonly languages: readonly string[] };

export type LanguageChannels = {
  /** Null: the standard voice line cannot hear this language. */
  readonly listen: VoiceListenPlan | null;
  /** Null: Q cannot speak this language aloud. */
  readonly speak: VoiceSpeakPlan | null;
  /** Null: video rooms (rehearsal video, GateQ video) cannot run in it. */
  readonly video: VideoPlan | null;
  /** The duplex line's transcription hint (OpenAI), or null when Whisper does not list it. */
  readonly transcriptionHint: string | null;
  /**
   * GPT-Live publishes no language list; its prompting guide sets the
   * language by instruction. Never "supported", only "by instruction".
   */
  readonly live: "BY_INSTRUCTION";
};

/** The configuration every channel uses for a language (any offered tag). */
export function languageChannels(
  value: string | null | undefined,
): LanguageChannels {
  const info = languageInfo(value);
  const primary = info?.primary ?? "en";
  const tag = info?.tag ?? "en";
  const listen: VoiceListenPlan | null = FLUX_EN.has(primary)
    ? { model: "flux-general-en" }
    : FLUX_MULTI.has(primary)
      ? { model: "flux-general-multi" }
      : providerCode(primary, NOVA3) !== null
        ? {
            model: "nova-3",
            // The person's region when Nova-3 names it (ar-AE), else the language.
            language: NOVA3_REGIONAL.has(tag)
              ? tag
              : (providerCode(primary, NOVA3) ?? primary),
          }
        : null;
  const elevenCode = providerCode(primary, ELEVEN_V3);
  const tavusCode = providerCode(primary, TAVUS);
  const whisperCode = providerCode(primary, WHISPER);
  return {
    listen,
    speak: elevenCode === null ? null : { languageCode: elevenCode },
    // Their language first; English understood, as people mix both at work.
    video:
      tavusCode === null
        ? null
        : { languages: tavusCode === "en" ? ["en"] : [tavusCode, "en"] },
    transcriptionHint: whisperCode,
    live: "BY_INSTRUCTION",
  };
}

/** Whether a whole spoken line (hear and speak) works in this language. */
export function voiceLineAvailable(value: string | null | undefined): boolean {
  const channels = languageChannels(value);
  return channels.listen !== null && channels.speak !== null;
}
