# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 98-161)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 98-161 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Timing constants: bridges, BARGE_CONFIRM_MS, TURN_ITEMS_MAX, rejoin limits.

```ts
   98  /**
   99   * A slow answer gets a bridging line after this long (SUBTLE). voiceq-63
  100   * (founder, live 2026-10-04: "it was always talking"): at 700 ms nearly
  101   * every answer (3-8 s on the line) was preceded by a bridge, so Q spoke
  102   * before every reply. A bridge is for a pause the person has noticed.
  103   */
  104  export const BRIDGE_AFTER_MS = 2_500;
  105  /** NATURAL listening bridges a little sooner. */
  106  export const BRIDGE_AFTER_NATURAL_MS = 1_600;
  107  /** Reactions play quieter than Q's turns. */
  108  export const BACKCHANNEL_GAIN = 0.6;
  109  /** Output caps: a reaction is under a second, a bridge a short clause. */
  110  export const BACKCHANNEL_MAX_OUTPUT_TOKENS = 40;
  111  export const BRIDGE_MAX_OUTPUT_TOKENS = 90;
  112  /** ADR 0062: long polls for one ask_q's beats, at most. */
  113  const NARRATION_MAX_POLLS = 12;
  114  const NARRATION_FIRST_POLL_MS = 600;
  115  /** R9: reconnects in a row after a dropped poll, and the first wait. */
  116  const NARRATION_MAX_RECONNECTS = 3;
  117  const NARRATION_RECONNECT_MS = 800;
  118  /**
  119   * W7: offline, the poll waits for the connection rather than giving up;
  120   * it looks again this often whether the ask_q is still running, and waits
  121   * at most this long in all.
  122   */
  123  const NARRATION_OFFLINE_LOOK_MS = 1_000;
  124  const NARRATION_OFFLINE_WAIT_MS = 120_000;
  125  /** The commit a reaction waits on; past this it is dropped. */
  126  const COMMIT_WAIT_MS = 400;
  127  /**
  128   * Speech over Q must last this long to stop Q (founder live 2026-10-07:
  129   * the voice cut on blips). Shorter than Hume's 800 ms default: an analyst
  130   * on a call yields quickly to a real interjection.
  131   */
  132  export const BARGE_CONFIRM_MS = 450;
  133  /** Q's volume while it checks whether the sound is a real interruption. */
  134  export const BARGE_DUCK_GAIN = 0.3;
  135  /** The longest a bridge may hold Q's answer back. */
  136  const BRIDGE_HOLD_MS = 2_500;
  137  const TURN_ITEMS_MAX = 3;
  138  const HEARD_MAX = 4;
  139  /** What a line accepts as its opening; the contract caps firstMessage at 700. */
  140  const OPENING_MAX = 700;
  141  
  142  export type DuplexFallbackCause =
  143    "CONNECT" | "NETWORK" | "RELAY" | "CAP" | "MAX_LENGTH";
  144  type RejoinCause = QVoiceDuplexRejoin["cause"];
  145  
  146  /** Rejoins one line may make before it hands over for good. */
  147  export const MAX_REJOINS = 6;
  148  /** Fresh calls tried per rejoin, with a growing pause between them. */
  149  export const REJOIN_ATTEMPTS = 4;
  150  export const REJOIN_BACKOFF_MS = 1_000;
  151  /** Usage reports retried before the relay counts as down. */
  152  const REPORT_ATTEMPTS = 3;
  153  const REPORT_BACKOFF_MS = 600;
  154  /** Recent lines replayed into a rejoined call. */
  155  const REPLAY_MAX = 8;
  156  const REPLAY_CHARS = 400;
  157  /**
  158   * Playout buffer on a WEAK line, in ms: words arrive a little later and
  159   * whole, rather than on time and clipped.
  160   */
  161  export const WEAK_PLAYOUT_BUFFER_MS = 400;
```

# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 280-352)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 280-352 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: getUserMedia constraints, level meter, DUPLEX_CONNECT_MS.

```ts
  280  export function browserDuplexEnvironment(): DuplexEnvironment {
  281    return {
  282      createPeer: () => new RTCPeerConnection(),
  283      getMicrophone: () =>
  284        navigator.mediaDevices.getUserMedia({
  285          audio: { echoCancellation: true, noiseSuppression: true },
  286        }),
  287      fetch: (input, init) => fetch(input, init),
  288      onDeviceChange: (handler) => {
  289        const devices = navigator.mediaDevices as MediaDevices | undefined;
  290        if (devices === undefined) return () => undefined;
  291        devices.addEventListener("devicechange", handler);
  292        return () => {
  293          devices.removeEventListener("devicechange", handler);
  294        };
  295      },
  296      onVisible: (handler) => {
  297        const listener = () => {
  298          if (document.visibilityState === "visible") handler();
  299        };
  300        document.addEventListener("visibilitychange", listener);
  301        return () => {
  302          document.removeEventListener("visibilitychange", listener);
  303        };
  304      },
  305      isOnline: () => navigator.onLine !== false,
  306      onOnline: (handler) => {
  307        window.addEventListener("online", handler);
  308        return () => {
  309          window.removeEventListener("online", handler);
  310        };
  311      },
  312      createAudio: () => {
  313        const audio = document.createElement("audio");
  314        audio.autoplay = true;
  315        return audio;
  316      },
  317      now: () => Date.now(),
  318      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  319      clearTimeout: (handle) => {
  320        window.clearTimeout(handle as number);
  321      },
  322      createLevelMeter: (stream) => {
  323        const Context = window.AudioContext as typeof AudioContext | undefined;
  324        if (Context === undefined) return null;
  325        try {
  326          const context = new Context();
  327          const source = context.createMediaStreamSource(stream);
  328          const analyser = context.createAnalyser();
  329          analyser.fftSize = 1024;
  330          source.connect(analyser);
  331          const frame = new Float32Array(analyser.fftSize);
  332          return {
  333            read: () => {
  334              analyser.getFloatTimeDomainData(frame);
  335              let sum = 0;
  336              for (const sample of frame) sum += sample * sample;
  337              return Math.sqrt(sum / frame.length);
  338            },
  339            close: () => {
  340              source.disconnect();
  341              void context.close().catch(() => undefined);
  342            },
  343          };
  344        } catch {
  345          return null;
  346        }
  347      },
  348    };
  349  }
  350  
  351  /** How long the provider has to answer the session offer (a slow line too). */
  352  export const DUPLEX_CONNECT_MS = 10_000;
```

