/**
 * Full-duplex voice settings (DUPLEX), from the environment.
 *
 * Off unless CQ_VOICE_REALTIME is "on". Every cap has a safe default and a
 * hard bound: a typo or an absurd value falls back to the default rather
 * than lifting a cap, because the provider budget is the founder's own.
 */

export type DuplexConfig = {
  readonly enabled: boolean;
  /** The line hands over to the standard voice after this long. */
  readonly maxSessionMs: number;
  /** Platform-wide realtime spend per UTC day; reaching it ends lines. */
  readonly dailyCapUsd: number;
  /** Silence for this long ends the line. */
  readonly idleMs: number;
  /** Held against the daily cap for each open line until it reports. */
  readonly sessionReserveUsd: number;
  /** Per response: bounds what one spoken answer can cost. */
  readonly maxOutputTokens: number;
  /** Read-only registry tools offered directly, beside ask_q. */
  readonly maxDirectTools: number;
  /** The client secret is only for opening the line. */
  readonly secretTtlSeconds: number;
};

export const DUPLEX_DEFAULTS: DuplexConfig = {
  enabled: false,
  maxSessionMs: 10 * 60 * 1000,
  dailyCapUsd: 1,
  idleMs: 30 * 1000,
  sessionReserveUsd: 0.25,
  maxOutputTokens: 800,
  maxDirectTools: 6,
  secretTtlSeconds: 60,
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

export function duplexConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): DuplexConfig {
  const flag = env.CQ_VOICE_REALTIME?.trim().toLowerCase();
  return {
    enabled: flag === "on" || flag === "true" || flag === "1",
    maxSessionMs:
      bounded(
        env.CQ_VOICE_REALTIME_MAX_SESSION_SECONDS,
        DUPLEX_DEFAULTS.maxSessionMs / 1000,
        30,
        3600,
      ) * 1000,
    dailyCapUsd: bounded(
      env.CQ_VOICE_REALTIME_DAILY_CAP_USD,
      DUPLEX_DEFAULTS.dailyCapUsd,
      0,
      20,
    ),
    idleMs:
      bounded(
        env.CQ_VOICE_REALTIME_IDLE_SECONDS,
        DUPLEX_DEFAULTS.idleMs / 1000,
        5,
        600,
      ) * 1000,
    sessionReserveUsd: bounded(
      env.CQ_VOICE_REALTIME_SESSION_RESERVE_USD,
      DUPLEX_DEFAULTS.sessionReserveUsd,
      0.01,
      5,
    ),
    maxOutputTokens: Math.floor(
      bounded(
        env.CQ_VOICE_REALTIME_MAX_OUTPUT_TOKENS,
        DUPLEX_DEFAULTS.maxOutputTokens,
        100,
        4096,
      ),
    ),
    maxDirectTools: Math.floor(
      bounded(
        env.CQ_VOICE_REALTIME_DIRECT_TOOLS,
        DUPLEX_DEFAULTS.maxDirectTools,
        0,
        16,
      ),
    ),
    secretTtlSeconds: DUPLEX_DEFAULTS.secretTtlSeconds,
  };
}
