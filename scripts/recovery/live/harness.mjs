// GPT-Live acceptance recordings (workstream V). REAL provider calls.
//
// Each scenario streams synthetic user speech (gpt-4o-mini-tts with
// accent instructions; the inputs are synthetic and labelled so) into a
// live voice session over WebSocket, in real time, as one continuous
// microphone stream. Q's audio is played through a simulated player
// (real time, flushed when the provider stops generating during the
// user's speech), and both sides are mixed into one WAV.
//
//   set -a; . <key file>; set +a
//   node scripts/recovery/live/harness.mjs --provider live --scenario 1,2 \
//     --out <dir> [--backend offline|local] [--who "name"]
//
// Providers: live = gpt-live-1 (A), realtime = gpt-realtime-mini (B).
// Backends for delegation: offline (no Q Brain: the voice is told so,
// truthfully) or local (Q Brain on the local recovery stack, the scripted
// fake model; POST /v1/q/runs as a seeded investor).
//
// Budget guards: a hard close per session (3 min; 6 min for scenario 10),
// one session at a time, no retries, and a refusal to start once the
// ledger's running total reaches $2.50.
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLiveBridge } from "../../../apps/web/src/features/voice/live/bridge.ts";
import { livePrompt } from "../../../apps/q-api/src/voice/live/prompt.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// `ws` is not hoisted in this workspace; the store copy is the same package.
const require = createRequire(resolve(ROOT, "package.json"));
const WebSocket = (() => {
  try {
    return require("ws");
  } catch {
    return require(
      resolve(ROOT, "node_modules/.pnpm/ws@8.21.3/node_modules/ws"),
    );
  }
})();

const KEY = process.env.OPENAI_API_KEY;
if (typeof KEY !== "string" || KEY.length < 20 || KEY.startsWith("disabled")) {
  console.log("OPENAI_API_KEY is not set to a real key; refusing.");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter((part) => part.trim().length > 0)
    .map((part) => {
      const [name, ...rest] = part.trim().split(" ");
      return [name, rest.join(" ")];
    }),
);
const PROVIDER = args.provider === "realtime" ? "realtime" : "live";
const BACKEND = args.backend === "local" ? "local" : "offline";
const OUT = resolve(args.out ?? ".");
const WHO = args.who ?? "workstream V";
const LEDGER = resolve(ROOT, "docs/recovery/evidence/gpt-live/spend.md");
const LEDGER_STOP_USD = 2.5;
mkdirSync(OUT, { recursive: true });

const RATE = 24000;
const CHUNK_MS = 100;
const CHUNK_BYTES = (RATE * 2 * CHUNK_MS) / 1000; // 16-bit mono
const LIVE_USD_PER_SECOND = 0.05 / 60;
// gpt-realtime-mini, USD per million tokens (model-gateway realtime/openai.ts).
const RT_PRICES = {
  textIn: 0.6,
  textOut: 2.4,
  audioIn: 10,
  audioOut: 20,
  cachedAudioIn: 0.3,
  cachedTextIn: 0.06,
};
const TTS_USD_PER_AUDIO_SECOND = 0.015 / 60;

const NIGERIAN_MAN =
  "Speak as a Nigerian man from Lagos in his thirties: natural Nigerian English accent and rhythm, relaxed and conversational, never exaggerated.";
const NIGERIAN_WOMAN =
  "Speak as a Nigerian woman from Lagos in her thirties, a startup investor: natural Nigerian English accent, quick and direct, never exaggerated.";

// ---------------------------------------------------------------- scenarios
// when: "start" | "q-done" | { qSpeakingForMs } | { afterMs }
const SCENARIOS = {
  0: {
    name: "call-opening-briefing",
    voice: "coral",
    accent: NIGERIAN_WOMAN,
    prompt: { briefingOpening: true, firstName: "Amaka" },
    steps: [
      {
        when: "q-done",
        answeredDelegations: 1,
        say: "Thanks, Q. Okay, tell me more about the first one.",
      },
    ],
  },
  1: {
    name: "pidgin-greeting",
    steps: [
      { when: "start", say: "Guy, how far? Wetin dey happen?" },
      {
        when: "q-done",
        say: "Ah, I dey o. Abeg, wetin you fit help me with today?",
      },
    ],
  },
  2: {
    name: "humour",
    steps: [
      {
        when: "start",
        say: "Q, my co-founder just told an investor that our burn rate is aggressive but spiritual. Should I be worried?",
      },
      {
        when: "q-done",
        say: "Haha, okay okay. So how do I explain burn properly next time?",
      },
    ],
  },
  3: {
    name: "hesitant-question",
    steps: [
      {
        when: "start",
        segments: [
          { say: "So, em...", pauseAfterMs: 1600 },
          { say: "I was wondering, like...", pauseAfterMs: 2200 },
          {
            say: "if we raise a small bridge round now, before the Series A... does that, you know, send the wrong signal to investors?",
          },
        ],
      },
    ],
  },
  4: {
    name: "interruption",
    steps: [
      {
        when: "start",
        say: "Can you explain what a SAFE is, and how it's different from a convertible note?",
      },
      {
        when: { qSpeakingForMs: 3500 },
        say: "Sorry, sorry, wait. Just the short version. One sentence.",
      },
    ],
  },
  5: {
    name: "change-of-mind",
    steps: [
      {
        when: "start",
        say: "Help me think through what to say in a cold email to an angel investor.",
      },
      {
        when: { qSpeakingForMs: 3000 },
        say: "Actually no, scratch that. Let's talk about how I should prepare for the first call instead.",
      },
    ],
  },
  6: {
    name: "top-three-delegated",
    voice: "coral",
    accent: NIGERIAN_WOMAN,
    steps: [
      {
        when: "start",
        say: "What are the top three companies that fit my mandate?",
      },
      {
        when: "q-done",
        say: "Wait, what about the second one? Why is it on the list?",
      },
    ],
  },
  7: {
    name: "talk-while-researching",
    voice: "coral",
    accent: NIGERIAN_WOMAN,
    steps: [
      {
        when: "start",
        say: "Can you check which companies fit my mandate best right now?",
      },
      {
        when: { afterMs: 2500 },
        say: "And while you're at it, remind me, what does pro rata actually mean?",
      },
    ],
  },
  8: {
    name: "facts-arrive-while-speaking",
    voice: "coral",
    accent: NIGERIAN_WOMAN,
    steps: [
      {
        when: "start",
        say: "Show me my top five companies. And meanwhile, tell me how you'd run a first call with a founder.",
      },
    ],
  },
  9: {
    name: "frustrated-user",
    steps: [
      {
        when: "start",
        say: "This is the third time I'm asking this thing. I uploaded my deck yesterday and I still don't know what investors will think of it. Why is this so hard?",
      },
      { when: "q-done", say: "Okay. Fine. So what should I fix first?" },
    ],
  },
  10: {
    name: "five-minute-conversation",
    capMs: 6 * 60 * 1000,
    minMs: 5 * 60 * 1000,
    steps: [
      {
        when: "start",
        say: "Good morning Q. I have about five minutes, I want to talk through my fundraising plan.",
      },
      {
        when: "q-done",
        say: "We're a fintech in Lagos, doing savings for market traders. We've got about four thousand active users.",
      },
      {
        when: "q-done",
        say: "We want to raise around five hundred thousand dollars. Pre-seed. Is that realistic for us?",
      },
      {
        when: "q-done",
        say: "Hmm. Our revenue is small, like three thousand dollars a month. Is that a problem?",
      },
      {
        when: "q-done",
        say: "Okay, that makes sense. What kind of investors should I be talking to first?",
      },
      {
        when: "q-done",
        say: "Abeg, explain the difference between an angel and a pre-seed fund, simply.",
      },
      {
        when: { qSpeakingForMs: 4000 },
        say: "Sorry, quick one. Do angels usually lead rounds?",
      },
      {
        when: "q-done",
        say: "Got it. What would make an investor say no to us quickly?",
      },
      {
        when: "q-done",
        say: "Our biggest risk is that the traders don't save consistently in the rainy season.",
      },
      {
        when: "q-done",
        say: "That's actually a good point. How do I show that in the deck without scaring people?",
      },
      {
        when: "q-done",
        say: "Okay. And valuation, how do I even think about that at this stage?",
      },
      {
        when: "q-done",
        say: "Ehen. Last thing, how long should the whole raise take, realistically?",
      },
      {
        when: "q-done",
        say: "Alright. Can you summarise what we agreed, in a few lines?",
      },
      { when: "q-done", say: "Perfect. Thank you, Q. Talk later." },
    ],
  },
};

// --------------------------------------------------------------------- utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ledgerTotal() {
  if (!existsSync(LEDGER)) return 0;
  const rows = readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("| 20"));
  const last = rows[rows.length - 1];
  if (last === undefined) return 0;
  const cells = last.split("|").map((c) => c.trim());
  const total = Number((cells[cells.length - 2] ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(total) ? total : 0;
}

function ledgerAppend({ what, seconds, costUsd, note }) {
  const total = ledgerTotal() + costUsd;
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  appendFileSync(
    LEDGER,
    `| ${when} | ${WHO} | ${what} | ${seconds} | $${costUsd.toFixed(3)}${note ? ` (${note})` : ""} | $${total.toFixed(3)} |\n`,
  );
  return total;
}

const TTS_CACHE = resolve(OUT, "tts-cache");
mkdirSync(TTS_CACHE, { recursive: true });
let ttsSeconds = 0;
async function tts(text, voice, accent) {
  const key = createHash("sha256")
    .update(`${voice}|${accent}|${text}`)
    .digest("hex")
    .slice(0, 24);
  const file = resolve(TTS_CACHE, `${key}.pcm`);
  if (existsSync(file)) return readFileSync(file);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      instructions: accent,
      response_format: "pcm",
    }),
  });
  if (!response.ok) throw new Error(`tts ${response.status}`);
  const pcm = Buffer.from(await response.arrayBuffer());
  ttsSeconds += pcm.length / (RATE * 2);
  writeFileSync(file, pcm);
  return pcm;
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** A growable mono track addressed by milliseconds. */
function track() {
  let buf = Buffer.alloc(RATE * 2 * 60);
  let end = 0;
  return {
    put(ms, pcm) {
      const at = Math.floor((ms * RATE) / 1000) * 2;
      if (at + pcm.length > buf.length) {
        const next = Buffer.alloc(Math.max(buf.length * 2, at + pcm.length));
        buf.copy(next);
        buf = next;
      }
      pcm.copy(buf, at);
      end = Math.max(end, at + pcm.length);
    },
    pcm: () => buf.subarray(0, end),
  };
}

function mix(a, b) {
  const len = Math.max(a.length, b.length);
  const out = Buffer.alloc(len);
  for (let i = 0; i + 1 < len; i += 2) {
    const x = i + 1 < a.length ? a.readInt16LE(i) : 0;
    const y = i + 1 < b.length ? b.readInt16LE(i) : 0;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, x + y)), i);
  }
  return out;
}

const VOICED_RMS = 300;
function rms(pcm) {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i += 1) {
    const v = pcm.readInt16LE(i * 2);
    sum += v * v;
  }
  return n === 0 ? 0 : Math.sqrt(sum / n);
}

const FILLER = [
  /let me (just )?(put|pull|bring) (that|this|it) up/i,
  /one moment/i,
  /i'?m thinking/i,
  /give me a (sec|second|moment)/i,
  /great question/i,
  /absolutely!/i,
  /hold on( a)?( sec| second)?/i,
  /bear with me/i,
  /hang on/i,
  /pull(ing)? (it|them|that|those) up/i,
];

// ------------------------------------------------------------- Q Brain side
async function localBackend() {
  const stack = (() => {
    const file = process.env.CQ_RECOVERY_STACK_ENV;
    if (file === undefined || !existsSync(file)) return {};
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
  })();
  const supabase = stack.SUPABASE_URL ?? "http://127.0.0.1:54321";
  const qApi = stack.CQ_Q_API_URL ?? "http://127.0.0.1:3202";
  const email = args.as ?? "investor.savanna-seed@fictional.capitalq.local";
  const signIn = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: stack.SUPABASE_PUBLISHABLE_KEY ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: stack.CQ_SEED_ACCOUNT_PASSWORD ?? "CapitalQ-dev-2026!",
    }),
  });
  if (!signIn.ok) throw new Error(`local sign-in refused ${signIn.status}`);
  const token = (await signIn.json()).access_token;
  let conversationId;
  const runs = new Map(); // delegation id -> promise (one id, one run)
  return async ({ delegationId, request, context }) => {
    if (runs.has(delegationId)) return runs.get(delegationId);
    const work = (async () => {
      const created = await fetch(`${qApi}/v1/q/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          // The delegation id is the idempotency key: a repeat is the same run.
          "idempotency-key": `live-${delegationId}`,
        },
        body: JSON.stringify({
          capability: "ANSWER",
          message: { text: request.slice(0, 2000) || "(inaudible)" },
          modality: "VOICE",
          ...(conversationId === undefined ? {} : { conversationId }),
        }),
      });
      if (!created.ok) throw new Error(`run refused ${created.status}`);
      const handle = await created.json();
      conversationId = handle.conversationId ?? conversationId;
      for (let i = 0; i < 60; i += 1) {
        const run = await (
          await fetch(`${qApi}/v1/q/runs/${handle.runId}`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json();
        if (
          ["COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"].includes(
            run.status,
          )
        ) {
          const answer = (run.messages ?? [])
            .filter((m) => m.role === "Q")
            .pop();
          const cards = (answer?.blocks ?? []).flatMap((b) =>
            (b.cards ?? []).map((c) => ({
              name: c.name,
              fit: c.fit?.score ?? null,
            })),
          );
          // The local stack's model is a scripted fake: a request it has no
          // rule for is not Q's judgment, and is never handed over as one.
          if (
            typeof answer?.text === "string" &&
            answer.text.startsWith("[scripted vendor]")
          ) {
            return {
              runId: handle.runId,
              mock: true,
              failed: true,
              commentary: `Q's backend has no verified answer for "${request}" in this test setup. The backend returned nothing about their records for this. If the question needs their records, say plainly you can't confirm it right now; if it doesn't, answer it yourself from general knowledge, without claiming anything about their records. Invent nothing.`,
            };
          }
          if (run.status === "FAILED" || answer === undefined) {
            return {
              commentary:
                "Q's backend could not complete that. Say so plainly; do not invent an answer.",
              failed: true,
              runId: handle.runId,
            };
          }
          return {
            runId: handle.runId,
            approvalPending: run.status === "AWAITING_APPROVAL",
            commentary: `Verified result from Q's backend for "${request}". Speak it in your own words; summarise, do not read lists. ${answer.text ?? ""}${cards.length > 0 ? ` Cards on their screen: ${JSON.stringify(cards)}` : ""}`,
          };
        }
        await sleep(500);
      }
      return {
        commentary:
          "Q's backend is still working and did not finish in time. Say so; do not guess.",
        failed: true,
      };
    })();
    runs.set(delegationId, work);
    return work;
  };
}

const offlineBackend = async ({ request }) => ({
  commentary: `Q's backend is not connected in this test call, so nothing about "${request}" could be checked. Say so honestly and briefly, do not invent records, and carry on with what you can discuss without them.`,
});

// The app's call opening (shared shape with the preview): greet now, brief
// when Q Brain's answer lands.
function openingFor(firstName) {
  return {
    greeting: `The call has just connected. Greet ${firstName === undefined ? "them" : JSON.stringify(firstName)} warmly now, in one short natural sentence: no question, no filler. Their briefing from the backend is on its way; do not guess it.`,
    request: "Brief me: which companies fit my mandate best right now?",
  };
}

// ------------------------------------------------------------------ session
async function runScenario(id) {
  const scenario = SCENARIOS[id];
  const voice = scenario.voice ?? "onyx";
  const accent = scenario.accent ?? NIGERIAN_MAN;
  const capMs = scenario.capMs ?? 3 * 60 * 1000;
  // Synthesize every input first (cached): nothing waits on TTS mid-call.
  const steps = [];
  for (const step of scenario.steps) {
    const segments = step.segments ?? [{ say: step.say }];
    const audio = [];
    for (const seg of segments)
      audio.push({
        pcm: await tts(seg.say, voice, accent),
        pauseAfterMs: seg.pauseAfterMs ?? 0,
        say: seg.say,
      });
    steps.push({ ...step, audio, text: segments.map((s) => s.say).join(" ") });
  }

  const userTrack = track();
  const qTrack = track();
  const log = [];
  const types = {};
  const firsts = {};
  let t0 = 0;
  const now = () => Date.now() - t0;
  let usageSeconds = null;
  let rtUsage = {
    textIn: 0,
    textOut: 0,
    audioIn: 0,
    audioOut: 0,
    cachedAudioIn: 0,
    cachedTextIn: 0,
  };
  let reportedModel = null;
  let reportedSession = null;
  let closedReason = null;
  let closed = false;

  // Input: one continuous stream; queued speech or silence, every 100 ms.
  const queue = [];
  let speakingUntil = -1; // ms when queued user speech ends
  let userSpeechEndedAt = null;
  // Player: Q's audio plays in real time from its own queue.
  const qQueue = [];
  let qPlaying = false;
  let lastQDeltaAt = -1;
  let lastQVoicedAt = -1;
  let qSpokeAt = -1; // when the current Q playback began
  let qAudioMs = 0;
  let flushes = 0;
  const latencies = [];
  let awaitingFirstAudio = null; // { step, endedAt }
  let currentStep = 0;

  const ws =
    PROVIDER === "live"
      ? new WebSocket("wss://api.openai.com/v1/live/sessions", {
          headers: { Authorization: `Bearer ${KEY}` },
        })
      : new WebSocket(
          "wss://api.openai.com/v1/realtime?model=gpt-realtime-mini",
          { headers: { Authorization: `Bearer ${KEY}` } },
        );
  const send = (event) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(event));
  };

  const backend = BACKEND === "local" ? await localBackend() : offlineBackend;
  const delegations = [];
  const bridge = createLiveBridge({
    send: (event) => {
      log.push({
        ms: now(),
        dir: "out",
        type: event.type,
        delegation: event.delegation_id,
        content: event.content,
      });
      send(event);
    },
    delegate: async (req) => {
      const started = now();
      const outcome = await backend(req);
      delegations.push({
        id: req.delegationId,
        request: req.request,
        ms: now() - started,
        startedAt: started,
        runId: outcome.runId ?? null,
        failed: outcome.failed === true,
        scriptedNoRule: outcome.mock === true,
        commentary: outcome.commentary,
      });
      return outcome;
    },
    newEventId: () => `cq_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    now: () => Date.now(),
    // The call opening, as the app runs it. The attention read answers 500
    // on this branch, so the lowdown is Q's code-built fit ranking.
    ...(scenario.prompt?.briefingOpening === true
      ? { opening: openingFor(scenario.prompt.firstName) }
      : {}),
  });

  // Hard client-side cap, whatever happens.
  let hardStopped = false;
  const hardStop = setTimeout(() => {
    hardStopped = true;
    console.log(`scenario ${id}: HARD STOP at cap`);
    send({ type: "session.close" });
    setTimeout(() => ws.close(), 15000);
  }, capMs);

  const ready = new Promise((resolveReady, rejectReady) => {
    ws.on("open", () => {
      t0 = Date.now();
      const instructions = livePrompt({
        role: "investor",
        ...(scenario.prompt ?? {}),
      });
      if (PROVIDER === "live") {
        send({
          type: "session.start",
          session: {
            model: "gpt-live-1",
            instructions,
            audio: {
              format: { type: "audio/pcm", rate: RATE },
              output: { voice: "marin" },
            },
            delegation: { type: "client" },
          },
        });
      } else {
        // B baseline: the same personality, standalone (no routing, no tools).
        send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: instructions.split("Delegation policy:")[0],
            output_modalities: ["audio"],
            audio: {
              input: {
                format: { type: "audio/pcm", rate: RATE },
                turn_detection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  create_response: true,
                  interrupt_response: true,
                },
                transcription: { model: "gpt-4o-mini-transcribe" },
              },
              output: {
                format: { type: "audio/pcm", rate: RATE },
                voice: "marin",
                speed: 0.95,
              },
            },
          },
        });
      }
    });
    ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString());
      types[ev.type] = (types[ev.type] ?? 0) + 1;
      if (
        firsts[ev.type] === undefined &&
        !/audio\.delta|audio_buffer/.test(ev.type)
      )
        firsts[ev.type] = JSON.stringify(ev).slice(0, 400);
      const ms = now();
      switch (ev.type) {
        case "session.started":
          reportedModel = ev.session?.model ?? null;
          reportedSession = ev.session?.id ?? null;
          resolveReady();
          break;
        case "session.created":
        case "session.updated":
          reportedModel = ev.session?.model ?? reportedModel;
          reportedSession = ev.session?.id ?? reportedSession;
          // B: our session.update has been applied; start the stream.
          if (ev.type === "session.updated") resolveReady();
          break;
        case "session.output_audio.delta":
        case "response.output_audio.delta": {
          const pcm = Buffer.from(ev.delta, "base64");
          qQueue.push(pcm);
          lastQDeltaAt = ms;
          // GPT-Live streams output audio continuously, silence included:
          // Q is speaking only where the audio carries energy.
          if (rms(pcm) < VOICED_RMS) break;
          if (ms - lastQVoicedAt > 700) qSpokeAt = ms;
          lastQVoicedAt = ms;
          if (awaitingFirstAudio !== null) {
            latencies.push({
              step: awaitingFirstAudio.step,
              ms: ms - awaitingFirstAudio.endedAt,
            });
            awaitingFirstAudio = null;
          }
          break;
        }
        case "session.output_transcript.delta":
        case "response.output_audio_transcript.delta":
          log.push({ ms, dir: "q", text: ev.delta });
          break;
        case "session.input_transcript.delta":
        case "conversation.item.input_audio_transcription.delta":
          log.push({ ms, dir: "heard", text: ev.delta });
          break;
        case "input_audio_buffer.speech_started":
          // B: the provider cut its response; the client truncates playback.
          if (qQueue.length > 0) {
            qQueue.length = 0;
            flushes += 1;
            log.push({ ms, dir: "flush" });
          }
          break;
        case "session.usage.updated":
          usageSeconds = ev.usage?.seconds ?? usageSeconds;
          break;
        case "response.done": {
          const u = ev.response?.usage;
          if (u) {
            const ind = u.input_token_details ?? {};
            const cached = ind.cached_tokens_details ?? {};
            const outd = u.output_token_details ?? {};
            rtUsage.audioIn +=
              (ind.audio_tokens ?? 0) - (cached.audio_tokens ?? 0);
            rtUsage.cachedAudioIn += cached.audio_tokens ?? 0;
            rtUsage.textIn +=
              (ind.text_tokens ?? 0) - (cached.text_tokens ?? 0);
            rtUsage.cachedTextIn += cached.text_tokens ?? 0;
            rtUsage.audioOut += outd.audio_tokens ?? 0;
            rtUsage.textOut += outd.text_tokens ?? 0;
          }
          break;
        }
        case "session.closed":
          usageSeconds = ev.usage?.seconds ?? usageSeconds;
          closedReason = ev.reason ?? null;
          closed = true;
          break;
        case "error":
          log.push({
            ms,
            dir: "error",
            text: JSON.stringify(ev.error ?? ev).slice(0, 300),
          });
          console.log("provider error", JSON.stringify(ev).slice(0, 300));
          break;
        default:
          break;
      }
      if (
        ev.type.startsWith("session.delegation") ||
        ev.type.endsWith(".appended")
      )
        log.push({
          ms,
          dir: "in",
          type: ev.type,
          id: ev.delegation?.id ?? ev.client_event_id,
        });
      bridge.handle(ev);
    });
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () =>
        rejectReady(new Error(`HTTP ${res.statusCode} ${body.slice(0, 200)}`)),
      );
    });
    ws.on("error", (e) => rejectReady(e));
  });

  await ready;
  console.log(
    `scenario ${id} (${scenario.name}) on ${PROVIDER}: started, model=${reportedModel}`,
  );

  // The tick: one input chunk and one player chunk every 100 ms.
  let ticking = true;
  const ticker = (async () => {
    let next = Date.now();
    while (ticking) {
      const ms = now();
      let chunk = queue.shift();
      const speech = chunk !== undefined && chunk.speech;
      if (chunk === undefined)
        chunk = { pcm: Buffer.alloc(CHUNK_BYTES), speech: false };
      userTrack.put(ms, chunk.pcm);
      if (PROVIDER === "live")
        send({
          type: "session.input_audio.append",
          audio: chunk.pcm.toString("base64"),
        });
      else
        send({
          type: "input_audio_buffer.append",
          audio: chunk.pcm.toString("base64"),
        });
      if (speech && queue.every((c) => !c.speech)) {
        userSpeechEndedAt = ms;
        awaitingFirstAudio = { step: currentStep, endedAt: ms };
      }
      // Player. GPT-Live has no barge-in event: when the person is talking
      // and the provider has stopped generating, what is still queued was
      // never going to be said, so the player drops it.
      const userTalking = ms < speakingUntil;
      void userTalking;
      let need = CHUNK_BYTES;
      const parts = [];
      while (need > 0 && qQueue.length > 0) {
        const head = qQueue[0];
        if (head.length <= need) {
          parts.push(head);
          need -= head.length;
          qQueue.shift();
        } else {
          parts.push(head.subarray(0, need));
          qQueue[0] = head.subarray(need);
          need = 0;
        }
      }
      if (parts.length > 0) {
        const pcm = Buffer.concat(parts);
        qTrack.put(ms, pcm);
        qAudioMs += (pcm.length / (RATE * 2)) * 1000;
      }
      qPlaying = ms - lastQVoicedAt < 400;
      next += CHUNK_MS;
      await sleep(Math.max(0, next - Date.now()));
    }
  })();

  const enqueue = (step) => {
    for (const seg of step.audio) {
      for (let i = 0; i < seg.pcm.length; i += CHUNK_BYTES) {
        const part = Buffer.alloc(CHUNK_BYTES);
        seg.pcm.copy(part, 0, i, Math.min(seg.pcm.length, i + CHUNK_BYTES));
        queue.push({ pcm: part, speech: true });
      }
      for (let p = 0; p < seg.pauseAfterMs; p += CHUNK_MS)
        queue.push({ pcm: Buffer.alloc(CHUNK_BYTES), speech: false });
    }
    speakingUntil = now() + queue.length * CHUNK_MS;
    log.push({ ms: now(), dir: "user", text: step.text });
  };

  const qQuietFor = () => now() - Math.max(lastQVoicedAt, 0);
  const waitUntil = async (pred, maxMs) => {
    const end = now() + maxMs;
    while (now() < end && !hardStopped && !closed) {
      if (pred()) return true;
      await sleep(100);
    }
    return false;
  };
  const busyDelegating = () =>
    bridge
      .state()
      .delegations.some(
        (d) => d.status === "RUNNING" || d.status === "WAITING_FOR_WORDS",
      );

  for (let i = 0; i < steps.length && !hardStopped; i += 1) {
    const step = steps[i];
    currentStep = i;
    if (step.when === "q-done") {
      const before = lastQDeltaAt;
      // Q must have answered the previous turn, then be quiet for 1.5 s.
      await waitUntil(() => lastQVoicedAt > (userSpeechEndedAt ?? 0), 25000);
      await waitUntil(() => qQuietFor() > 1500 && !busyDelegating(), 40000);
      // The opening: the hello comes first, the briefing after it lands.
      if (step.answeredDelegations !== undefined) {
        await waitUntil(
          () =>
            bridge
              .state()
              .delegations.filter(
                (d) =>
                  d.status !== "WAITING_FOR_WORDS" && d.status !== "RUNNING",
              ).length >= step.answeredDelegations && qQuietFor() > 1500,
          60000,
        );
        // Q speaks the briefing once it lands: let it, then wait for quiet.
        await sleep(2500);
        await waitUntil(() => qQuietFor() > 1500, 40000);
      }
      void before;
    } else if (
      typeof step.when === "object" &&
      step.when.qSpeakingForMs !== undefined
    ) {
      await waitUntil(
        () => qPlaying && now() - qSpokeAt >= step.when.qSpeakingForMs,
        25000,
      );
    } else if (
      typeof step.when === "object" &&
      step.when.afterMs !== undefined
    ) {
      await sleep(step.when.afterMs);
    }
    // Wait for the user's own previous speech to finish being sent.
    await waitUntil(() => now() >= speakingUntil, 30000);
    enqueue(step);
  }
  // The last answer, and a long-conversation floor.
  await waitUntil(() => now() >= speakingUntil, 30000);
  await waitUntil(() => lastQVoicedAt > (userSpeechEndedAt ?? 0), 25000);
  await waitUntil(() => qQuietFor() > 2500 && !busyDelegating(), 60000);
  if (scenario.minMs !== undefined)
    await waitUntil(() => now() >= scenario.minMs, scenario.minMs);

  // Close and wait up to 15 s for final usage.
  if (PROVIDER === "live") {
    send({ type: "session.close" });
    await waitUntil(() => closed, 15000);
  }
  ticking = false;
  await ticker;
  clearTimeout(hardStop);
  try {
    ws.close();
  } catch {}

  // ---------------------------------------------------------------- outputs
  const base = resolve(
    OUT,
    `${String(id).padStart(2, "0")}-${scenario.name}-${PROVIDER === "live" ? "A-gpt-live" : "B-realtime-mini"}`,
  );
  writeFileSync(`${base}.wav`, wav(mix(userTrack.pcm(), qTrack.pcm())));
  const qText = log
    .filter((l) => l.dir === "q")
    .map((l) => l.text)
    .join("");
  const heard = log
    .filter((l) => l.dir === "heard")
    .map((l) => l.text)
    .join("");
  const fillers = FILLER.filter((re) => re.test(qText)).map((re) => re.source);
  let costUsd;
  let billed;
  if (PROVIDER === "live") {
    billed = usageSeconds ?? Math.ceil(now() / 1000);
    costUsd = billed * LIVE_USD_PER_SECOND;
  } else {
    billed = Math.ceil(now() / 1000);
    costUsd =
      (rtUsage.audioIn * RT_PRICES.audioIn +
        rtUsage.cachedAudioIn * RT_PRICES.cachedAudioIn +
        rtUsage.textIn * RT_PRICES.textIn +
        rtUsage.cachedTextIn * RT_PRICES.cachedTextIn +
        rtUsage.audioOut * RT_PRICES.audioOut +
        rtUsage.textOut * RT_PRICES.textOut) /
      1e6;
  }
  const ttsCost = ttsSeconds * TTS_USD_PER_AUDIO_SECOND;
  ttsSeconds = 0;
  const summary = {
    scenario: id,
    name: scenario.name,
    provider: PROVIDER,
    reportedModel,
    reportedSession: reportedSession === null ? null : "(present)",
    backend: BACKEND,
    inputs: "synthetic: gpt-4o-mini-tts, Nigerian English accent instructions",
    wallSeconds: Math.round(now() / 1000),
    billedSeconds: billed,
    usageConfirmed:
      PROVIDER === "live"
        ? closed && usageSeconds !== null
        : "tokens from response.done",
    closedReason,
    hardStopped,
    costUsd: Number(costUsd.toFixed(4)),
    ttsCostUsd: Number(ttsCost.toFixed(4)),
    latenciesMs: latencies,
    qAudioSeconds: Math.round(qAudioMs / 1000),
    playbackFlushes: flushes,
    fillerHits: fillers,
    delegations,
    bridge: { ...bridge.state(), transcript: undefined },
    eventTypes: types,
    firstEvents: firsts,
    heard,
    said: qText,
    timeline: log,
    rtUsage: PROVIDER === "realtime" ? rtUsage : undefined,
  };
  writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
  const total = ledgerAppend({
    what: `Scenario ${id} ${scenario.name} on ${PROVIDER === "live" ? "gpt-live-1" : "gpt-realtime-mini"}${ttsCost > 0 ? " + TTS inputs" : ""}`,
    seconds:
      PROVIDER === "live"
        ? `${billed}${summary.usageConfirmed ? "" : " (unconfirmed)"}`
        : `${billed} wall (tokens)`,
    costUsd: costUsd + ttsCost,
  });
  console.log(
    `scenario ${id}: wav ${base}.wav billed=${billed}s cost=$${(costUsd + ttsCost).toFixed(3)} running=$${total.toFixed(3)} latencies=${JSON.stringify(latencies.map((l) => l.ms))} fillers=${fillers.length} flushes=${flushes} delegations=${delegations.length}`,
  );
  console.log(`  heard: ${heard.slice(0, 300)}`);
  console.log(`  said: ${qText.slice(0, 600)}`);
  return total;
}

const ids = String(args.scenario ?? "1")
  .split(",")
  .map((s) => Number(s.trim()));
for (const id of ids) {
  if (SCENARIOS[id] === undefined) {
    console.log(`no scenario ${id}`);
    continue;
  }
  const total = ledgerTotal();
  if (total >= LEDGER_STOP_USD) {
    console.log(
      `ledger at $${total.toFixed(3)}: stop at $${LEDGER_STOP_USD}, not starting scenario ${id}`,
    );
    break;
  }
  try {
    await runScenario(id);
  } catch (error) {
    // No retries: a failed session is reported, never re-run in a loop.
    console.log(`scenario ${id} failed: ${error.message}`);
  }
}
process.exit(0);
