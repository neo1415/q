/* eslint-disable no-console -- a developer CLI whose whole purpose is to report what it set up */
/**
 * `pnpm voice:setup -- --ws-url wss://<public-host>/v1/q/voice/ws` (CQ-Q-VOICE-001
 * C §30-§31). DEV ONLY.
 *
 * Creates or updates the ElevenLabs Speech Engine resources Capital Q's Q
 * speaks through — the default (female) voice and the male alternative —
 * pointing both at this environment's public WebSocket route, and records
 * their ids in the repository's gitignored `.env.local` as
 * ELEVENLABS_SPEECH_ENGINE_ID / ELEVENLABS_SPEECH_ENGINE_ID_MALE.
 *
 * The API key is read from validated configuration and handed to the SDK
 * once; it is never printed. The public hostname is runtime configuration
 * of the tunnel and is never committed: re-run this with the new URL when
 * the tunnel changes.
 *
 *   --ws-url <wss://…/v1/q/voice/ws>   required on first run; updates on later runs
 *   --female <voiceId>  --male <voiceId>   override the voice ids (defaults below)
 *   --dry-run                               print the plan, touch nothing
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadQApiConfig } from "@capital-q/config/q-api";
import { Q_VOICE_WS_PATH } from "@capital-q/contracts";

import {
  createSpeechEngineAdmin,
  type SpeechEngineSpec,
} from "../voice/providers/elevenlabs-admin.js";

/**
 * Voice tuning (D §52, revised after the first live transcripts): warm,
 * professional, and alive. Turbo v2 over flash for the fuller delivery;
 * stability low enough that a sentence rises and falls like a person's
 * rather than a reader's, similarity high so it stays the same person;
 * natural speed; latency optimisation kept modest so prosody is not
 * traded for milliseconds. Recorded here, not in a secret.
 */
export const VOICE_TUNING = {
  modelId: "eleven_turbo_v2",
  stability: 0.42,
  similarityBoost: 0.8,
  speed: 1,
  optimizeStreamingLatency: 1,
} as const;

/** Account voices chosen for Q. Overridable by flag; ids are public voice ids, not secrets. */
export const DEFAULT_VOICE_IDS = {
  /** "Sarah" — warm, professional female. */
  FEMALE: "EXAVITQu4vr4xnSDxMaL",
  /** "Daniel" — calm, professional male. */
  MALE: "onwK4e9ZLuTAKqWW03F9",
} as const;

const ENGINE_NAMES = {
  FEMALE: "Capital Q — Q (female voice)",
  MALE: "Capital Q — Q (male voice)",
} as const;

type Args = {
  wsUrl: string | undefined;
  female: string;
  male: string;
  dryRun: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    wsUrl: undefined,
    female: DEFAULT_VOICE_IDS.FEMALE,
    male: DEFAULT_VOICE_IDS.MALE,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--ws-url":
        args.wsUrl = value;
        index += 1;
        break;
      case "--female":
        args.female = value ?? args.female;
        index += 1;
        break;
      case "--male":
        args.male = value ?? args.male;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case undefined:
      default:
        break;
    }
  }
  return args;
}

function validWsUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "wss:" || url.pathname !== Q_VOICE_WS_PATH) {
    return undefined;
  }
  return url.toString();
}

/** Upsert `NAME=value` lines in the gitignored .env.local; nothing else is touched. */
function recordEnv(file: string, values: Readonly<Record<string, string>>) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    if (match === null) {
      return line;
    }
    const name = match[1] ?? "";
    if (name in values) {
      seen.add(name);
      return `${name}=${values[name] ?? ""}`;
    }
    return line;
  });
  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) {
      next.push(`${name}=${value}`);
    }
  }
  writeFileSync(file, `${next.join("\n").replace(/\n*$/, "")}\n`);
}

const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const args = parseArgs(process.argv.slice(2));
const config = loadQApiConfig();

if (config.runtime.deploymentEnvironment !== "local") {
  console.error("[dev] voice:setup runs against a local environment only.");
  process.exit(2);
}
const key = config.secrets.speechProviders.elevenLabs;
if (key === undefined) {
  console.error("[dev] Add ELEVENLABS_API_KEY to the root .env.local.");
  process.exit(2);
}
const wsUrl = validWsUrl(args.wsUrl);
const existing = config.voice.speechEngines;
if (wsUrl === undefined && existing === undefined) {
  console.error(
    `[dev] --ws-url wss://<public-host>${Q_VOICE_WS_PATH} is required the first time.`,
  );
  process.exit(2);
}
if (args.wsUrl !== undefined && wsUrl === undefined) {
  console.error(
    `[dev] --ws-url must be a wss:// URL whose path is ${Q_VOICE_WS_PATH}.`,
  );
  process.exit(2);
}

const specs: readonly SpeechEngineSpec[] = [
  {
    voice: "FEMALE",
    name: ENGINE_NAMES.FEMALE,
    voiceId: args.female,
    existingId: existing?.default,
  },
  {
    voice: "MALE",
    name: ENGINE_NAMES.MALE,
    voiceId: args.male,
    existingId: existing?.male,
  },
];

console.log(
  `[dev] ${wsUrl === undefined ? "keeping the recorded ws url" : `ws url ${wsUrl}`}`,
);
for (const spec of specs) {
  console.log(
    `[dev] ${spec.voice}: ${spec.existingId === undefined ? "create" : `update ${spec.existingId}`} → voice ${spec.voiceId}`,
  );
}
if (args.dryRun) {
  console.log("[dev] dry run: nothing changed.");
  process.exit(0);
}

const admin = createSpeechEngineAdmin({ apiKey: key.reveal() });
const ids: Record<string, string> = {};
for (const spec of specs) {
  const id = await admin.upsert(spec, { wsUrl, tuning: VOICE_TUNING });
  ids[
    spec.voice === "FEMALE"
      ? "ELEVENLABS_SPEECH_ENGINE_ID"
      : "ELEVENLABS_SPEECH_ENGINE_ID_MALE"
  ] = id;
  console.log(`[dev] ${spec.voice}: ${id}`);
}
recordEnv(envFile, ids);
console.log(`[dev] recorded Speech Engine ids in ${envFile}`);
console.log(
  "[dev] restart q-api (or let --watch restart it) so the voice channel composes.",
);
