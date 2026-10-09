import {
  createLiveBridge,
  type DelegationOutcome,
  type LiveBridgeState,
  type LiveServerEvent,
} from "./bridge";

/**
 * V: one GPT-Live call in the browser over WebRTC (OpenAI voice-webrtc,
 * api=live). The microphone goes to the provider as a media track; Q's
 * voice comes back as one. The `oai-events` data channel (created before
 * the offer) carries transcripts, delegations and usage; the delegation
 * bridge answers delegations through Q Brain. The SDP exchange is the Q
 * API's: no key and no ephemeral secret reach this page.
 *
 * Framework-free so it can be driven from any UI; the preview is the only
 * caller for now.
 */

export type LiveCallStats = {
  /** As the provider's session-create response (201) named it. */
  readonly createdModel: string | null;
  /** As the provider's own `session.started` reported it. */
  readonly reportedModel: string | null;
  readonly startedMs: number | null;
  readonly billedSeconds: number | null;
  readonly usageConfirmed: boolean;
  /** End of the person's transcribed words → Q's first transcribed words. */
  readonly latenciesMs: readonly number[];
  readonly qSpeaking: boolean;
  readonly closedReason: string | null;
};

export type LiveCallUpdate = {
  readonly stats: LiveCallStats;
  readonly bridge: LiveBridgeState;
};

export type LiveCallOptions = {
  readonly voice: "FEMALE" | "MALE";
  readonly briefingOpening: boolean;
  readonly firstName?: string | undefined;
  readonly onUpdate: (update: LiveCallUpdate) => void;
  readonly onEnded: (reason: string) => void;
  readonly fetch?: typeof fetch;
};

export type LiveCall = {
  readonly end: (reason?: string) => Promise<void>;
};

const RELAY = "/api/q-voice-live";
const ICE_TIMEOUT_MS = 10_000;
const CLOSE_WAIT_MS = 15_000;
const SPEAKING_LEVEL = 0.02;

async function post<T>(
  doFetch: typeof fetch,
  path: string,
  body: unknown,
  token: string | null,
): Promise<T> {
  const response = await doFetch(`${RELAY}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-q-voice-session": token }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`relay ${String(response.status)}`);
  return (response.status === 204 ? null : await response.json()) as T;
}

function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out while gathering ICE candidates"));
    }, ICE_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export async function startLiveCall(
  options: LiveCallOptions,
): Promise<LiveCall> {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  pc.addEventListener("track", (event) => {
    const [stream] = event.streams;
    if (stream === undefined) return;
    audio.srcObject = stream;
    context.createMediaStreamSource(stream).connect(analyser);
  });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
  const channel = pc.createDataChannel("oai-events");
  await pc.setLocalDescription(await pc.createOffer());
  await iceGathered(pc);
  const offer = pc.localDescription?.sdp;
  if (offer === undefined) throw new Error("Missing local SDP offer");

  const opened = await post<{
    voiceSessionId: string;
    sessionToken?: string;
    sdp: string;
    model: string | null;
    maxSessionMs: number;
  }>(
    doFetch,
    "open",
    {
      sdp: offer,
      voice: options.voice,
      briefingOpening: options.briefingOpening,
      ...(options.firstName === undefined
        ? {}
        : { firstName: options.firstName }),
    },
    null,
  );
  const token = opened.sessionToken ?? null;
  const id = opened.voiceSessionId;
  await pc.setRemoteDescription({ type: "answer", sdp: opened.sdp });

  let stats: LiveCallStats = {
    createdModel: opened.model,
    reportedModel: null,
    startedMs: null,
    billedSeconds: null,
    usageConfirmed: false,
    latenciesMs: [],
    qSpeaking: false,
    closedReason: null,
  };
  const t0 = performance.now();
  let lastInputAt: number | null = null;
  let closed = false;
  let ended = false;
  const update = () => {
    options.onUpdate({ stats, bridge: bridge.state() });
  };

  const bridge = createLiveBridge({
    send: (event) => {
      if (channel.readyState === "open") channel.send(JSON.stringify(event));
    },
    delegate: async (request) => {
      const result = await post<DelegationOutcome & { ended?: boolean }>(
        doFetch,
        `delegate/${id}`,
        request,
        token,
      );
      // Past the hard cap: the server refuses; the call closes.
      if (result.ended === true) void end("max_length");
      return result;
    },
    cancel: async (delegationId) =>
      (
        await post<{ cancelled: boolean }>(
          doFetch,
          `cancel/${id}/${encodeURIComponent(delegationId)}`,
          {},
          token,
        )
      ).cancelled,
    newEventId: () => `cq_${crypto.randomUUID().replace(/-/g, "")}`,
    now: () => Date.now(),
    onChange: update,
    // The call opening (founder 2026-10-09): a warm hello at once, the
    // lowdown when Q Brain's briefing lands. GPT-Live does not speak first
    // by itself, so the app starts both.
    ...(options.briefingOpening
      ? {
          opening: {
            greeting: `The call has just connected. Greet ${options.firstName === undefined ? "them" : JSON.stringify(options.firstName)} warmly now, in one short natural sentence: no question, no filler. Their briefing from the backend is on its way; do not guess it.`,
            request: "Brief me: what needs my attention today?",
          },
        }
      : {}),
  });

  const reportUsage = (seconds: number, final: boolean) =>
    post(doFetch, `usage/${id}`, { seconds, final }, token).catch(
      () => undefined,
    );

  channel.addEventListener("message", (message: MessageEvent<string>) => {
    let event: LiveServerEvent;
    try {
      event = JSON.parse(message.data) as LiveServerEvent;
    } catch {
      return;
    }
    const ms = performance.now() - t0;
    switch (event.type) {
      case "session.started": {
        const session = event["session"] as { model?: unknown } | undefined;
        stats = {
          ...stats,
          reportedModel:
            typeof session?.model === "string" ? session.model : null,
          startedMs: Math.round(ms),
        };
        break;
      }
      case "session.input_transcript.delta":
        lastInputAt = ms;
        break;
      case "session.output_transcript.delta":
        if (lastInputAt !== null) {
          stats = {
            ...stats,
            latenciesMs: [...stats.latenciesMs, Math.round(ms - lastInputAt)],
          };
          lastInputAt = null;
        }
        break;
      case "session.usage.updated":
      case "session.closed": {
        const usage = event["usage"] as { seconds?: unknown } | undefined;
        const seconds =
          typeof usage?.seconds === "number" ? usage.seconds : null;
        const final = event.type === "session.closed";
        if (seconds !== null) {
          stats = { ...stats, billedSeconds: seconds, usageConfirmed: final };
          void reportUsage(seconds, final);
        }
        if (final) {
          closed = true;
          const reason = event["reason"];
          stats = {
            ...stats,
            closedReason: typeof reason === "string" ? reason : "closed",
          };
        }
        break;
      }
      default:
        break;
    }
    bridge.handle(event);
    update();
  });

  // The speaking indicator follows the player, not generation: audio can
  // play after the model has finished producing it.
  const level = new Float32Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(level);
    let sum = 0;
    for (const v of level) sum += v * v;
    const speaking = Math.sqrt(sum / level.length) > SPEAKING_LEVEL;
    if (speaking !== stats.qSpeaking) {
      stats = { ...stats, qSpeaking: speaking };
      update();
    }
  }, 100);

  // Runaway protection: the hard cap closes the call client-side too.
  const cap = setTimeout(() => {
    void end("max_length");
  }, opened.maxSessionMs);

  const end = async (reason = "ended") => {
    if (ended) return;
    ended = true;
    clearTimeout(cap);
    if (channel.readyState === "open") {
      channel.send(JSON.stringify({ type: "session.close" }));
      const deadline = performance.now() + CLOSE_WAIT_MS;
      while (!closed && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    clearInterval(meter);
    for (const track of mic.getTracks()) track.stop();
    pc.close();
    audio.srcObject = null;
    void context.close();
    if (!closed) {
      stats = {
        ...stats,
        closedReason: "no session.closed: usage unconfirmed",
      };
    }
    await post(doFetch, `end/${id}`, { reason }, token).catch(() => undefined);
    update();
    options.onEnded(reason);
  };

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed") void end("network");
  });
  update();
  return { end };
}
