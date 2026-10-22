// Lily on the ElevenLabs conversational stack, driven exactly like
// scripts/recovery/live/harness.mjs drives GPT-Live: the same cached user
// recordings, the same step rules (q-done = Q quiet 1.5 s; qSpeakingForMs =
// Q playing continuously; afterMs), a 100 ms tick that sends one mic chunk
// and plays 100 ms of Q, and a player that flushes on ElevenLabs'
// `interruption` event (what its official client does).
//
//   node el-run.mjs <agent_id> <scenario 2|3|4|7> <outDir> <ttsCacheDir>
/* global Buffer, WebSocket, clearTimeout, console, fetch, process, setTimeout -- Node 22+ */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [, , AGENT, SCEN, OUT, CACHE] = process.argv;
const KEY = process.env.ELEVENLABS_API_KEY;
const RATE = 16000;
const CHUNK_MS = 100;
const CHUNK = (RATE * 2 * CHUNK_MS) / 1000;
const VOICED_RMS = 300;
const TOOL_DELAY_MS = 6000;

const NIGERIAN_MAN =
  "Speak as a Nigerian man from Lagos in his thirties: natural Nigerian English accent and rhythm, relaxed and conversational, never exaggerated.";
const NIGERIAN_WOMAN =
  "Speak as a Nigerian woman from Lagos in her thirties, a startup investor: natural Nigerian English accent, quick and direct, never exaggerated.";
const SCENARIOS = {
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
};
const scenario = SCENARIOS[SCEN];
const voice = scenario.voice ?? "onyx";
const accent = scenario.accent ?? NIGERIAN_MAN;

function cached(text) {
  const key = createHash("sha256")
    .update(`${voice}|${accent}|${text}`)
    .digest("hex")
    .slice(0, 24);
  const pcm24 = readFileSync(`${CACHE}/${key}.pcm`);
  return execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "-",
      "-f",
      "s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-",
    ],
    { input: pcm24, maxBuffer: 1 << 27 },
  );
}
const rms = (pcm) => {
  let s = 0;
  const n = pcm.length / 2;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2);
    s += v * v;
  }
  return n === 0 ? 0 : Math.sqrt(s / n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const signed = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT}`,
  { headers: { "xi-api-key": KEY } },
).then((r) => r.json());
const ws = new WebSocket(signed.signed_url);
const t0 = Date.now();
const now = () => Date.now() - t0;
const events = [];
const log = (type, data = {}) => events.push({ ms: now(), type, ...data });
let ready = false;
let conversationId = null;
const qQueue = [];
let lastQVoicedAt = -1;
let qSpokeAt = -1;
let qPlaying = false;
let flushes = 0;
const userTrack = [];
const qTrack = [];
const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  switch (m.type) {
    case "conversation_initiation_metadata":
      conversationId = m.conversation_initiation_metadata_event.conversation_id;
      ready = true;
      log("ready", {
        out: m.conversation_initiation_metadata_event.agent_output_audio_format,
      });
      break;
    case "ping":
      send({ type: "pong", event_id: m.ping_event.event_id });
      break;
    case "audio":
      qQueue.push(Buffer.from(m.audio_event.audio_base_64, "base64"));
      if (
        !events.some(
          (x) => x.type === "first_audio_chunk" && x.after === lastUserEnd,
        )
      )
        log("first_audio_chunk", { after: lastUserEnd });
      break;
    case "interruption":
      flushes += qQueue.length > 0 ? 1 : 0;
      qQueue.length = 0;
      log("interruption");
      break;
    case "agent_response":
      log("agent_response", { text: m.agent_response_event.agent_response });
      break;
    case "agent_response_correction":
      log("agent_response_correction", {
        text: m.agent_response_correction_event.corrected_agent_response,
      });
      break;
    case "user_transcript":
      log("user_transcript", {
        text: m.user_transcription_event.user_transcript,
      });
      break;
    case "client_tool_call": {
      const c = m.client_tool_call;
      log("client_tool_call", { name: c.tool_name });
      setTimeout(() => {
        send({
          type: "client_tool_result",
          tool_call_id: c.tool_call_id,
          result:
            "Best fits right now: Ajopot and Ledgerfold, tied at the top; Clinicrest next.",
          is_error: false,
        });
        log("client_tool_result_sent");
      }, TOOL_DELAY_MS);
      break;
    }
    case "agent_tool_response":
      log("agent_tool_response", { name: m.agent_tool_response.tool_name });
      break;
    case "vad_score":
      break;
    default:
      log(m.type);
  }
};
ws.onclose = (e) => log("closed", { code: e.code });
while (!ready) await sleep(20);

// Mic + player ticker.
const mic = [];
let lastUserEnd = null;
let speakingUntil = 0;
let ticking = true;
const ticker = (async () => {
  let next = Date.now();
  while (ticking) {
    const ms = now();
    const chunk =
      mic.length > 0
        ? mic.shift()
        : { pcm: Buffer.alloc(CHUNK), speech: false };
    send({ user_audio_chunk: chunk.pcm.toString("base64") });
    if (chunk.speech) userTrack.push([ms, chunk.pcm]);
    if (chunk.speech && mic.every((c) => !c.speech)) {
      lastUserEnd = ms + CHUNK_MS;
      log("user_speech_end");
    }
    let need = CHUNK;
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
      qTrack.push([ms, pcm]);
      if (rms(pcm) > VOICED_RMS) {
        if (ms - lastQVoicedAt > 700) qSpokeAt = ms;
        lastQVoicedAt = ms;
      }
    }
    qPlaying = ms - lastQVoicedAt < 400;
    next += CHUNK_MS;
    await sleep(Math.max(0, next - Date.now()));
  }
})();
const qQuietFor = () => now() - Math.max(lastQVoicedAt, 0);
const waitUntil = async (f, max) => {
  const end = Date.now() + max;
  while (!f() && Date.now() < end) await sleep(50);
};
const enqueue = (step) => {
  const segs = step.segments ?? [{ say: step.say }];
  log("user_step", { text: segs.map((s) => s.say).join(" ") });
  for (const seg of segs) {
    const pcm = cached(seg.say);
    for (let i = 0; i < pcm.length; i += CHUNK) {
      const part = Buffer.alloc(CHUNK);
      pcm.copy(part, 0, i, Math.min(pcm.length, i + CHUNK));
      mic.push({ pcm: part, speech: true });
    }
    for (let p = 0; p < (seg.pauseAfterMs ?? 0); p += CHUNK_MS)
      mic.push({ pcm: Buffer.alloc(CHUNK), speech: false, pause: true });
  }
  speakingUntil = now() + mic.length * CHUNK_MS;
};
const hardStop = setTimeout(() => {
  ticking = false;
  ws.close();
}, 150000);

for (const step of scenario.steps) {
  if (step.when === "q-done") {
    await waitUntil(() => lastQVoicedAt > (lastUserEnd ?? 0), 30000);
    await waitUntil(() => qQuietFor() > 1500, 40000);
  } else if (
    typeof step.when === "object" &&
    step.when.qSpeakingForMs !== undefined
  ) {
    await waitUntil(
      () => qPlaying && now() - qSpokeAt >= step.when.qSpeakingForMs,
      25000,
    );
  } else if (typeof step.when === "object" && step.when.afterMs !== undefined) {
    await sleep(step.when.afterMs);
  }
  await waitUntil(() => now() >= speakingUntil, 30000);
  enqueue(step);
}
await waitUntil(() => now() >= speakingUntil, 30000);
await waitUntil(() => lastQVoicedAt > (lastUserEnd ?? 0), 25000);
await waitUntil(() => qQuietFor() > 2500, 60000);
// A pending tool: wait for its result, Q's answer to it, then quiet.
const toolSent = () => events.find((e) => e.type === "client_tool_result_sent");
if (events.some((e) => e.type === "client_tool_call")) {
  await waitUntil(() => toolSent() !== undefined, 30000);
  const at = toolSent()?.ms ?? now();
  await waitUntil(() => lastQVoicedAt > at, 20000);
  await waitUntil(() => qQuietFor() > 2500, 60000);
}
ticking = false;
await ticker;
clearTimeout(hardStop);
ws.close();

// Outputs: mixed WAV at 16 kHz plus a summary like the GPT-Live harness's.
mkdirSync(OUT, { recursive: true });
const end =
  Math.max(...userTrack.map(([ms]) => ms), ...qTrack.map(([ms]) => ms)) +
  CHUNK_MS;
const mix = Buffer.alloc(Math.ceil((end / 1000) * RATE) * 2 + CHUNK);
for (const [ms, pcm] of [...userTrack, ...qTrack]) {
  const at = Math.floor((ms * RATE) / 1000) * 2;
  for (let i = 0; i + 1 < pcm.length && at + i + 1 < mix.length; i += 2) {
    mix.writeInt16LE(
      Math.max(
        -32768,
        Math.min(32767, mix.readInt16LE(at + i) + pcm.readInt16LE(i)),
      ),
      at + i,
    );
  }
}
const base = `${OUT}/${String(SCEN).padStart(2, "0")}-${scenario.name}-lily-elevenlabs`;
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-f",
    "s16le",
    "-ar",
    String(RATE),
    "-ac",
    "1",
    "-i",
    "-",
    `${base}.wav`,
  ],
  { input: mix },
);
// Latency: end of each user step's speech to Q's first voiced chunk after it.
const voiced = qTrack
  .filter(([, pcm]) => rms(pcm) > VOICED_RMS)
  .map(([ms]) => ms);
const stepEnds = events
  .filter((e) => e.type === "user_speech_end")
  .map((e) => e.ms + CHUNK_MS);
const latencies = stepEnds.map((t) => {
  const v = voiced.find((ms) => ms >= t);
  return v === undefined ? null : v - t;
});
const summary = {
  scenario: Number(SCEN),
  name: scenario.name,
  line: "ElevenLabs Agents (expressive mode)",
  voice: "Lily pFZP5JQG7iQjIQuC4Bku",
  conversationId,
  wallSeconds: Math.round(now() / 1000),
  latenciesMs: latencies,
  playbackFlushes: flushes,
  said: events
    .filter((e) => e.type === "agent_response")
    .map((e) => e.text)
    .join(" "),
  heard: events
    .filter((e) => e.type === "user_transcript")
    .map((e) => e.text)
    .join(" "),
  events,
};
writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    scenario: SCEN,
    latenciesMs: latencies,
    flushes,
    said: summary.said.slice(0, 400),
    heard: summary.heard.slice(0, 200),
  }),
);
