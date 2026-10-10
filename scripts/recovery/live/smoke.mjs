// GPT-Live smoke test: one TTS line in, real reply out, hard 45 s cap.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("/home/user/q/package.json");
const WebSocket = require("ws");
const KEY = process.env.OPENAI_API_KEY;
const OUT = process.argv[2];
const line = process.argv[3] ?? "Guy, how far? Wetin dey happen?";

const tts = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini-tts",
    voice: "onyx",
    input: line,
    instructions:
      "Speak as a Nigerian man from Lagos, casual and friendly, natural Nigerian English accent.",
    response_format: "pcm",
  }),
});
if (!tts.ok) {
  console.log("tts", tts.status, (await tts.text()).slice(0, 300));
  process.exit(1);
}
const input = Buffer.from(await tts.arrayBuffer());
console.log(
  "tts bytes",
  input.length,
  "seconds",
  (input.length / 48000).toFixed(2),
);

const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", {
  headers: { Authorization: `Bearer ${KEY}` },
});
const out = [];
const types = {};
let usage = null;
const said = [];
const heard = [];
let t0 = 0;
const stop = setTimeout(() => {
  console.log("HARD STOP");
  try {
    ws.send(JSON.stringify({ type: "session.close" }));
  } catch {
    // Socket already closed; the hard stop only needs to end the run.
  }
  setTimeout(() => process.exit(2), 5000);
}, 45000);
ws.on("open", () => {
  t0 = Date.now();
  ws.send(
    JSON.stringify({
      type: "session.start",
      session: {
        model: "gpt-live-1",
        instructions:
          "You are Q, a warm, sharp investment analyst for Capital Q. Speak naturally and briefly.",
        audio: {
          format: { type: "audio/pcm", rate: 24000 },
          output: { voice: "marin" },
        },
      },
    }),
  );
});
ws.on("message", async (raw) => {
  const ev = JSON.parse(raw.toString());
  types[ev.type] = (types[ev.type] ?? 0) + 1;
  if (ev.type === "error")
    console.log("ERROR", JSON.stringify(ev).slice(0, 400));
  if (ev.type === "session.started") {
    console.log(
      "started at",
      Date.now() - t0,
      "ms",
      JSON.stringify(ev).slice(0, 300),
    );
    const chunk = 4800; // 100 ms
    for (let i = 0; i < input.length; i += chunk) {
      ws.send(
        JSON.stringify({
          type: "session.input_audio.append",
          audio: input.subarray(i, i + chunk).toString("base64"),
        }),
      );
      await new Promise((r) => setTimeout(r, 100));
    }
    const silence = Buffer.alloc(chunk);
    for (let i = 0; i < 100; i++) {
      // 10 s of silence, continuous stream
      ws.send(
        JSON.stringify({
          type: "session.input_audio.append",
          audio: silence.toString("base64"),
        }),
      );
      await new Promise((r) => setTimeout(r, 100));
    }
    ws.send(JSON.stringify({ type: "session.close" }));
  }
  if (ev.type === "session.output_audio.delta")
    out.push(Buffer.from(ev.delta, "base64"));
  if (ev.type === "session.output_transcript.delta") said.push(ev.delta);
  if (ev.type === "session.input_transcript.delta") heard.push(ev.delta);
  if (ev.type === "session.usage.updated" || ev.type === "session.closed")
    usage = ev.usage ?? usage;
  if (ev.type === "session.closed") {
    clearTimeout(stop);
    const pcm = Buffer.concat(out);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36 + pcm.length, 4);
    h.write("WAVE", 8);
    h.write("fmt ", 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(24000, 24);
    h.writeUInt32LE(48000, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36);
    h.writeUInt32LE(pcm.length, 40);
    writeFileSync(OUT, Buffer.concat([h, pcm]));
    console.log("closed reason", ev.reason, "usage", JSON.stringify(usage));
    console.log("heard:", heard.join(""));
    console.log("said:", said.join(""));
    console.log("out audio seconds", (pcm.length / 48000).toFixed(2));
    console.log("event types", JSON.stringify(types));
    ws.close();
    process.exit(0);
  }
});
ws.on("unexpected-response", (_req, res) => {
  let b = "";
  res.on("data", (d) => (b += d));
  res.on("end", () => {
    console.log("HTTP", res.statusCode, b.slice(0, 400));
    process.exit(1);
  });
});
ws.on("error", (e) => {
  console.log("ws error", e.message);
});
