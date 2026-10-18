# Evidence: apps/q-api/src/voice/duplex/config.ts (lines 1-140)

- Original path: `apps/q-api/src/voice/duplex/config.ts`
- Line range: 1-140 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: All duplex settings and defaults: daily cap 1 USD, idle 30 s, 10 min sessions, routeTurns/backchannel on.

```ts
    1  /**
    2   * Full-duplex voice settings (DUPLEX), from the environment.
    3   *
    4   * Off unless CQ_VOICE_REALTIME is "on". Every cap has a safe default and a
    5   * hard bound: a typo or an absurd value falls back to the default rather
    6   * than lifting a cap, because the provider budget is the founder's own.
    7   */
    8
    9  export type DuplexConfig = {
   10    readonly enabled: boolean;
   11    /** The line hands over to the standard voice after this long. */
   12    readonly maxSessionMs: number;
   13    /** Platform-wide realtime spend per UTC day; reaching it ends lines. */
   14    readonly dailyCapUsd: number;
   15    /** Silence for this long ends the line. */
   16    readonly idleMs: number;
   17    /** Held against the daily cap for each open line until it reports. */
   18    readonly sessionReserveUsd: number;
   19    /** Per response: bounds what one spoken answer can cost. */
   20    readonly maxOutputTokens: number;
   21    /** Read-only registry tools offered directly, beside ask_q. */
   22    readonly maxDirectTools: number;
   23    /** The client secret is only for opening the line. */
   24    readonly secretTtlSeconds: number;
   25    /**
   26     * BACKCHANNEL: the line listens like a person (reactions, bridges,
   27     * input transcription). On unless CQ_VOICE_REALTIME_BACKCHANNEL is
   28     * "off": the kill switch that leaves duplex exactly as before.
   29     */
   30    readonly backchannel: boolean;
   31    /**
   32     * voiceq-63: the realtime voice's speaking rate. The founder heard
   33     * "rapid-fire" speech; 0.95 is unhurried without sounding slow.
   34     * CQ_VOICE_REALTIME_SPEED, bounded 0.8-1.2.
   35     */
   36    readonly speechSpeed: number;
   37    /**
   38     * VOICE-BRAIN (founder live 2026-10-08): the server, not the realtime
   39     * model, decides who answers each turn; substantive turns always go to
   40     * Q's pipeline. On unless CQ_VOICE_REALTIME_ROUTE_TURNS is "off".
   41     */
   42    readonly routeTurns: boolean;
   43  };
   44
   45  export const DUPLEX_DEFAULTS: DuplexConfig = {
   46    enabled: false,
   47    maxSessionMs: 10 * 60 * 1000,
   48    dailyCapUsd: 1,
   49    idleMs: 30 * 1000,
   50    sessionReserveUsd: 0.25,
   51    maxOutputTokens: 800,
   52    maxDirectTools: 6,
   53    secretTtlSeconds: 60,
   54    backchannel: true,
   55    speechSpeed: 0.95,
   56    routeTurns: true,
   57  };
   58
   59  function bounded(
   60    raw: string | undefined,
   61    fallback: number,
   62    min: number,
   63    max: number,
   64  ): number {
   65    if (raw === undefined || raw.trim().length === 0) return fallback;
   66    const value = Number(raw);
   67    return Number.isFinite(value) && value >= min && value <= max
   68      ? value
   69      : fallback;
   70  }
   71
   72  export function duplexConfigFrom(
   73    env: Readonly<Record<string, string | undefined>>,
   74  ): DuplexConfig {
   75    const flag = env.CQ_VOICE_REALTIME?.trim().toLowerCase();
   76    const backchannel = env.CQ_VOICE_REALTIME_BACKCHANNEL?.trim().toLowerCase();
   77    const routeTurns = env.CQ_VOICE_REALTIME_ROUTE_TURNS?.trim().toLowerCase();
   78    return {
   79      enabled: flag === "on" || flag === "true" || flag === "1",
   80      maxSessionMs:
   81        bounded(
   82          env.CQ_VOICE_REALTIME_MAX_SESSION_SECONDS,
   83          DUPLEX_DEFAULTS.maxSessionMs / 1000,
   84          30,
   85          3600,
   86        ) * 1000,
   87      dailyCapUsd: bounded(
   88        env.CQ_VOICE_REALTIME_DAILY_CAP_USD,
   89        DUPLEX_DEFAULTS.dailyCapUsd,
   90        0,
   91        20,
   92      ),
   93      idleMs:
   94        bounded(
   95          env.CQ_VOICE_REALTIME_IDLE_SECONDS,
   96          DUPLEX_DEFAULTS.idleMs / 1000,
   97          5,
   98          600,
   99        ) * 1000,
  100      sessionReserveUsd: bounded(
  101        env.CQ_VOICE_REALTIME_SESSION_RESERVE_USD,
  102        DUPLEX_DEFAULTS.sessionReserveUsd,
  103        0.01,
  104        5,
  105      ),
  106      maxOutputTokens: Math.floor(
  107        bounded(
  108          env.CQ_VOICE_REALTIME_MAX_OUTPUT_TOKENS,
  109          DUPLEX_DEFAULTS.maxOutputTokens,
  110          100,
  111          4096,
  112        ),
  113      ),
  114      maxDirectTools: Math.floor(
  115        bounded(
  116          env.CQ_VOICE_REALTIME_DIRECT_TOOLS,
  117          DUPLEX_DEFAULTS.maxDirectTools,
  118          0,
  119          16,
  120        ),
  121      ),
  122      secretTtlSeconds: DUPLEX_DEFAULTS.secretTtlSeconds,
  123      speechSpeed: bounded(
  124        env.CQ_VOICE_REALTIME_SPEED,
  125        DUPLEX_DEFAULTS.speechSpeed,
  126        0.8,
  127        1.2,
  128      ),
  129      routeTurns: !(
  130        routeTurns === "off" ||
  131        routeTurns === "false" ||
  132        routeTurns === "0"
  133      ),
  134      backchannel: !(
  135        backchannel === "off" ||
  136        backchannel === "false" ||
  137        backchannel === "0"
  138      ),
  139    };
  140  }
```
