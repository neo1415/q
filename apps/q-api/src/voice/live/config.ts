import { GPT_LIVE_VOICES, type GptLiveVoice } from "../providers/gpt-live.js";

/**
 * GPT-Live line settings (workstream V), from the environment. Off unless
 * CQ_VOICE_LIVE is "on". Every cap has a safe default and a hard bound: a
 * typo falls back to the default rather than lifting a cap, because the
 * provider budget is the founder's own.
 */
export type LiveConfig = {
  readonly enabled: boolean;
  /**
   * The line refuses delegations past this, and the client closes. The
   * founder's first live test ended mid-conversation at the old 3-minute
   * cap (2026-10-09): 20 minutes by default, at most 60.
   */
  readonly maxSessionMs: number;
  /** No speech either way for this long closes the line (runaway guard). */
  readonly idleMs: number;
  /** Platform-wide realtime voice spend per UTC day (shared ledger). */
  readonly dailyCapUsd: number;
  /** Held against the daily cap for each open line until it reports. */
  readonly sessionReserveUsd: number;
  /**
   * The longest one delegation may hold Q Brain before it is stopped. Long
   * on purpose: a slow answer is still delivered (founder 2026-10-09: a
   * 23-30 s answer was dropped at 30 s); this only stops a runaway.
   */
  readonly delegationDeadlineMs: number;
  readonly voices: {
    readonly FEMALE: GptLiveVoice;
    readonly MALE: GptLiveVoice;
  };
  /**
   * The developer voice comparison preview: CQ_VOICE_PREVIEW "on" in a
   * local deployment, or in a deployed one when `allowedUsers` names who
   * may use it (the founder's listening test, 2026-10-09).
   */
  readonly preview: boolean;
  /**
   * Who may open a live line outside a local deployment
   * (CQ_VOICE_LIVE_USERS, comma-separated user ids). Null in a local
   * deployment (anyone signed in); elsewhere an empty set refuses everyone,
   * so switching the line on never opens paid sessions to every account.
   */
  readonly allowedUsers: ReadonlySet<string> | null;
};

export const LIVE_DEFAULTS: LiveConfig = {
  enabled: false,
  maxSessionMs: 20 * 60 * 1000,
  idleMs: 3 * 60 * 1000,
  dailyCapUsd: 1,
  sessionReserveUsd: 0.15,
  delegationDeadlineMs: 90_000,
  voices: { FEMALE: "marin", MALE: "cedar" },
  preview: false,
  allowedUsers: null,
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
  const allowedUsers: ReadonlySet<string> = new Set(
    (env.CQ_VOICE_LIVE_USERS ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => /^[0-9a-f-]{36}$/u.test(id)),
  );
  return {
    enabled: on(env.CQ_VOICE_LIVE),
    maxSessionMs:
      bounded(
        env.CQ_VOICE_LIVE_MAX_SESSION_SECONDS,
        LIVE_DEFAULTS.maxSessionMs / 1000,
        30,
        3600,
      ) * 1000,
    idleMs:
      bounded(
        env.CQ_VOICE_LIVE_IDLE_SECONDS,
        LIVE_DEFAULTS.idleMs / 1000,
        30,
        900,
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
        15,
        180,
      ) * 1000,
    voices: {
      FEMALE: voice(
        env.CQ_VOICE_LIVE_VOICE_FEMALE,
        LIVE_DEFAULTS.voices.FEMALE,
      ),
      MALE: voice(env.CQ_VOICE_LIVE_VOICE_MALE, LIVE_DEFAULTS.voices.MALE),
    },
    preview:
      on(env.CQ_VOICE_PREVIEW) &&
      (deploymentEnvironment === "local" || allowedUsers.size > 0),
    allowedUsers: deploymentEnvironment === "local" ? null : allowedUsers,
  };
}
