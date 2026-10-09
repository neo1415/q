import { GPT_LIVE_VOICES, type GptLiveVoice } from "../providers/gpt-live.js";

/**
 * GPT-Live line settings (workstream V), from the environment. Off unless
 * CQ_VOICE_LIVE is "on". Every cap has a safe default and a hard bound: a
 * typo falls back to the default rather than lifting a cap, because the
 * provider budget is the founder's own.
 */
export type LiveConfig = {
  readonly enabled: boolean;
  /** The line refuses delegations past this, and the client closes. */
  readonly maxSessionMs: number;
  /** Platform-wide realtime voice spend per UTC day (shared ledger). */
  readonly dailyCapUsd: number;
  /** Held against the daily cap for each open line until it reports. */
  readonly sessionReserveUsd: number;
  /** The longest one delegation may hold Q Brain. */
  readonly delegationDeadlineMs: number;
  readonly voices: {
    readonly FEMALE: GptLiveVoice;
    readonly MALE: GptLiveVoice;
  };
  /**
   * The developer voice comparison preview. Only in a local deployment,
   * and only with CQ_VOICE_PREVIEW "on": never reachable in production.
   */
  readonly preview: boolean;
};

export const LIVE_DEFAULTS: LiveConfig = {
  enabled: false,
  maxSessionMs: 3 * 60 * 1000,
  dailyCapUsd: 1,
  sessionReserveUsd: 0.15,
  delegationDeadlineMs: 30_000,
  voices: { FEMALE: "marin", MALE: "cedar" },
  preview: false,
};

function bounded(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

const on = (raw: string | undefined) => {
  const flag = raw?.trim().toLowerCase();
  return flag === "on" || flag === "true" || flag === "1";
};

function voice(raw: string | undefined, fallback: GptLiveVoice): GptLiveVoice {
  const value = raw?.trim().toLowerCase();
  return (GPT_LIVE_VOICES as readonly string[]).includes(value ?? "")
    ? (value as GptLiveVoice)
    : fallback;
}

export function liveConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
  deploymentEnvironment: string,
): LiveConfig {
  return {
    enabled: on(env.CQ_VOICE_LIVE),
    maxSessionMs:
      bounded(
        env.CQ_VOICE_LIVE_MAX_SESSION_SECONDS,
        LIVE_DEFAULTS.maxSessionMs / 1000,
        30,
        600,
      ) * 1000,
    dailyCapUsd: bounded(
      env.CQ_VOICE_LIVE_DAILY_CAP_USD,
      LIVE_DEFAULTS.dailyCapUsd,
      0,
      20,
    ),
    sessionReserveUsd: LIVE_DEFAULTS.sessionReserveUsd,
    delegationDeadlineMs:
      bounded(
        env.CQ_VOICE_LIVE_DELEGATION_DEADLINE_SECONDS,
        LIVE_DEFAULTS.delegationDeadlineMs / 1000,
        8,
        120,
      ) * 1000,
    voices: {
      FEMALE: voice(
        env.CQ_VOICE_LIVE_VOICE_FEMALE,
        LIVE_DEFAULTS.voices.FEMALE,
      ),
      MALE: voice(env.CQ_VOICE_LIVE_VOICE_MALE, LIVE_DEFAULTS.voices.MALE),
    },
    preview: deploymentEnvironment === "local" && on(env.CQ_VOICE_PREVIEW),
  };
}
