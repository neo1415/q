import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { QVoiceChoice } from "@capital-q/contracts";

/**
 * Speech Engine resource administration (CQ-Q-VOICE-001 C §30-§31; D §52).
 * Used by the developer setup script only; the running service never
 * creates or reconfigures a resource. Same file boundary as the runtime
 * adapter: the ElevenLabs SDK appears nowhere else.
 */

export type SpeechEngineSpec = {
  readonly voice: QVoiceChoice;
  readonly name: string;
  readonly voiceId: string;
  readonly existingId: string | undefined;
};

export type SpeechEngineTuning = {
  readonly modelId:
    "eleven_flash_v2" | "eleven_turbo_v2" | "eleven_v3_conversational";
  /** Inline audio tags ([laughs], [sighs]) rendered; v3 conversational only. */
  readonly expressive: boolean;
  readonly stability: number;
  readonly similarityBoost: number;
  readonly speed: number;
  readonly optimizeStreamingLatency: 0 | 1 | 2 | 3 | 4;
};

/** Words the transcriber should expect in an investment interview. */
/**
 * Words the recogniser should expect. The interview vocabulary, and the
 * names and places a Nigerian or wider West African founder is likely to
 * say — a recogniser mis-hears a name it has never been told about far
 * more often than an accent.
 */
const ASR_KEYWORDS = [
  "Capital Q",
  "Vaultlyne",
  "naira",
  "Abuja",
  "Port Harcourt",
  "Ibadan",
  "Yaba",
  "Lekki",
  "Accra",
  "Kigali",
  "Kampala",
  "Cairo",
  "Johannesburg",
  "Cape Town",
  "Paystack",
  "Flutterwave",
  "Moniepoint",
  "OPay",
  "Interswitch",
  "Jumia",
  "Andela",
  "Y Combinator",
  "angel",
  "pre-money",
  "post-money",
  "SAFE",
  "convertible note",
  "cheque size",
  "ticket size",
  "LP",
  "GP",
  "fund of funds",
  "family office",
  "pilot",
  "design partner",
  "churn",
  "runway",
  "burn",
  "gross margin",
  "take rate",
  "GMV",
  "agritech",
  "healthtech",
  "edtech",
  "proptech",
  "insurtech",
  "mobility",
  "MRR",
  "ARR",
  "pre-seed",
  "seed",
  "Series A",
  "Series B",
  "Lagos",
  "Nairobi",
  "Nigeria",
  "Ghana",
  "Kenya",
  "fintech",
  "logistics",
  "SaaS",
  "B2B",
];

export function createSpeechEngineAdmin(options: { readonly apiKey: string }) {
  const client = new ElevenLabsClient({ apiKey: options.apiKey });
  return {
    /** Create the resource, or update the recorded one; returns its id. */
    upsert: async (
      spec: SpeechEngineSpec,
      settings: {
        readonly wsUrl: string | undefined;
        readonly tuning: SpeechEngineTuning;
      },
    ): Promise<string> => {
      const tts = {
        modelId: settings.tuning.modelId,
        voiceId: spec.voiceId,
        stability: settings.tuning.stability,
        similarityBoost: settings.tuning.similarityBoost,
        speed: settings.tuning.speed,
        optimizeStreamingLatency: settings.tuning.optimizeStreamingLatency,
        ...(settings.tuning.expressive
          ? {
              expressiveMode: true,
              suggestedAudioTags: [
                { tag: "laughs", description: "a short, warm laugh at a joke" },
                { tag: "chuckles", description: "a quiet amused reaction" },
                { tag: "sighs", description: "a small sigh at a setback" },
              ],
            }
          : { expressiveMode: false }),
      };
      // The realtime Scribe recogniser, told the interview's vocabulary.
      const asr = {
        provider: "scribe_realtime" as const,
        keywords: ASR_KEYWORDS,
      };
      // Patient turn-taking (D §55): a person thinking is not a person done.
      // A person's "mm-hm", "okay", "right" while Q speaks is listening,
      // not interrupting; audio that VAD missed is re-read at the timeout.
      const turn = {
        turnTimeout: 10,
        turnEagerness: "patient" as const,
        retranscribeOnTurnTimeout: true,
        interruptionIgnoreTerms: [
          "mm-hm",
          "mhm",
          "uh-huh",
          "okay",
          "ok",
          "yeah",
          "yes",
          "right",
          "sure",
          "got it",
          "I see",
          "go on",
        ],
        mergeWithDefaultIgnoreTerms: true,
      };
      // Minimal audio retention by default (doc 12 §36.6, TM-VOICE-04).
      const privacy = { recordVoice: false, deleteAudio: true };
      if (spec.existingId !== undefined) {
        const updated = await client.speechEngine.update(spec.existingId, {
          name: spec.name,
          ...(settings.wsUrl === undefined
            ? {}
            : { speechEngine: { wsUrl: settings.wsUrl } }),
          tts,
          asr,
          turn,
          privacy,
        });
        return updated.engineId;
      }
      if (settings.wsUrl === undefined) {
        throw new Error("a ws url is required to create a Speech Engine");
      }
      const created = await client.speechEngine.create({
        name: spec.name,
        speechEngine: { wsUrl: settings.wsUrl },
        tts,
        asr,
        turn,
        privacy,
        overrides: { firstMessage: true },
      });
      return created.engineId;
    },
  };
}
