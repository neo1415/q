// Voice over HTTP, without the browser's WebSocket leg (the sandbox proxy
// cannot upgrade): opens a real voice session on the q-api, then plays the
// speech provider's part -- transcript text to the think endpoint, Q's
// sentences to the speak relay -- and measures what a caller hears.
//
//   NODE_USE_ENV_PROXY=1 EMAIL=<fictional> CQ_SEED_ACCOUNT_PASSWORD=... \
//   SB_URL=... SB_PUBLISHABLE=... [REHEARSE=1] [TTS=3] [LOCALE=fr-FR] \
//   [OUT=dir] node scripts/handoff/live/voice-http.mjs "line one" "line two" ...
//
// Per turn: time to Q's first words and to the end, what Q said, any
// bracketed delivery tag left in the text, and the turn state (presence:
// mood/intensity). "BARGE:" before a line aborts it after Q's first words,
// as a person talking over Q does. TTS=n sends Q's first n sentences
// through the speak relay (audio saved to OUT for an STT check), at most 6.

import { writeFileSync } from "node:fs";

const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const EMAIL = process.env.EMAIL ?? "";
if (!EMAIL.endsWith("@fictional.capitalq.local")) {
  console.error("fictional accounts only");
  process.exit(2);
}
const TTS = Math.min(Number(process.env.TTS ?? "0"), 6);

const signIn = await fetch(
  `${process.env.SB_URL}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: process.env.SB_PUBLISHABLE,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: EMAIL,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
    }),
  },
);
if (!signIn.ok) {
  console.error(`sign-in failed: HTTP ${signIn.status}`);
  process.exit(1);
}
const { access_token: token } = await signIn.json();
const authed = (extra = {}) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  ...extra,
});

// ---- a rehearsal to speak in, when asked --------------------------------
let rehearsal;
if (process.env.REHEARSE === "1") {
  const partners = await (
    await fetch(`${QAPI}/v1/q/rehearsals/partners`, { headers: authed() })
  ).json();
  const first = (partners.partners ?? partners.items ?? [])[0];
  const investorOrganisationId = first?.investorOrganisationId ?? first?.id;
  const started = await fetch(`${QAPI}/v1/q/rehearsals`, {
    method: "POST",
    headers: authed({ "idempotency-key": crypto.randomUUID() }),
    body: JSON.stringify({ investorOrganisationId, length: 3 }),
  });
  const body = await started.json();
  rehearsal = body.rehearsalId ?? body.rehearsal?.rehearsalId ?? body.id;
  console.log(
    `rehearsal ${started.status} ${rehearsal ?? JSON.stringify(body).slice(0, 200)}`,
  );
}

// ---- the voice session -----------------------------------------------------
const t0 = Date.now();
const session = await fetch(`${QAPI}/v1/q/voice/sessions`, {
  method: "POST",
  headers: authed(),
  body: JSON.stringify({
    voice: "FEMALE",
    ...(rehearsal === undefined
      ? {}
      : { rehearsal: { rehearsalId: rehearsal } }),
    ...(process.env.LOCALE === undefined ? {} : { locale: process.env.LOCALE }),
  }),
});
const opened = await session.json();
if (!session.ok) {
  console.error(
    `session ${session.status}: ${JSON.stringify(opened).slice(0, 300)}`,
  );
  process.exit(1);
}
const agent = opened.deepgram?.agent ?? {};
const think = agent.think?.endpoint;
const speak = agent.speak?.endpoint;
console.log(
  `session ${Date.now() - t0} ms; provider ${opened.provider}; listen ${agent.listen?.provider?.model} lang ${agent.language ?? "multi"}; keyterms ${(agent.listen?.provider?.keyterms ?? []).length}; first: ${(opened.firstMessage ?? "").slice(0, 120)}`,
);
if (think === undefined) {
  console.error("no think endpoint in the agent settings");
  process.exit(1);
}

const TAG = /\[[a-z][a-z ]{1,30}\]|<break[^>]*>/gi;
const history =
  opened.firstMessage === undefined
    ? []
    : [{ role: "assistant", content: opened.firstMessage }];
let ttsLeft = TTS;
let failures = 0;

for (const raw of process.argv.slice(2)) {
  const barge = raw.startsWith("BARGE:");
  const line = barge ? raw.slice(6).trim() : raw;
  history.push({ role: "user", content: line });
  const controller = new AbortController();
  const started = Date.now();
  let first = null;
  let text = "";
  let status = 0;
  try {
    const response = await fetch(think.url, {
      method: "POST",
      headers: { ...think.headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: "capital-q",
        stream: true,
        messages: history,
      }),
      signal: controller.signal,
    });
    status = response.status;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = frame.replace(/^data: /, "");
        if (data === "[DONE]") continue;
        try {
          const content = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
          if (content.length > 0) {
            if (first === null) first = Date.now() - started;
            text += content;
          }
        } catch {
          // keep-alive or partial frame
        }
      }
      if (barge && first !== null) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!barge) {
      failures += 1;
      console.log(`FAIL think: ${error.message}`);
    }
  }
  const total = Date.now() - started;
  // What Q got out before being talked over stays in the history, as the
  // speech provider keeps it.
  if (text.trim().length > 0)
    history.push({ role: "assistant", content: text.trim() });
  const tags = text.match(TAG) ?? [];
  const state = await fetch(
    `${QAPI}/v1/q/voice/sessions/${opened.voiceSessionId}/turn`,
    { headers: authed() },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  console.log(
    `${barge ? "BARGE" : "TURN "} ${status} first ${first ?? "-"} ms, end ${total} ms${tags.length > 0 ? `, TAGS IN TEXT ${JSON.stringify(tags)}` : ""}; presence ${JSON.stringify(state?.presence ?? null)}\n  > ${line}\n  Q: ${text.trim().replace(/\s+/g, " ").slice(0, 300)}`,
  );
  if (status !== 200 || (first === null && !barge)) failures += 1;

  // Q's first sentence, as the speech provider would send it to be spoken.
  if (ttsLeft > 0 && speak !== undefined && text.trim().length > 0) {
    ttsLeft -= 1;
    const sentence = text.trim().split(/(?<=[.!?])\s+/)[0];
    const s0 = Date.now();
    const audio = await fetch(`${speak.url}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...speak.headers, "content-type": "application/json" },
      body: JSON.stringify({ text: sentence }),
    });
    const reader = audio.body?.getReader();
    let firstByte = null;
    const chunks = [];
    if (reader !== undefined) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByte === null) firstByte = Date.now() - s0;
        chunks.push(value);
      }
    }
    const bytes = chunks.reduce((n, c) => n + c.length, 0);
    console.log(
      `  TTS ${audio.status} ${audio.headers.get("content-type")} first byte ${firstByte ?? "-"} ms, ${bytes} bytes, said: ${sentence.slice(0, 120)}`,
    );
    if (process.env.OUT !== undefined && bytes > 0) {
      const file = `${process.env.OUT}/tts-${TTS - ttsLeft}.mp3`;
      writeFileSync(file, Buffer.concat(chunks.map((c) => Buffer.from(c))));
      console.log(`  saved ${file}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (rehearsal !== undefined) {
  const finished = await fetch(`${QAPI}/v1/q/rehearsals/${rehearsal}/finish`, {
    method: "POST",
    headers: authed({ "idempotency-key": crypto.randomUUID() }),
    body: JSON.stringify({}),
  });
  console.log(
    `rehearsal finish ${finished.status}: ${(await finished.text()).slice(0, 300)}`,
  );
}
console.log(
  failures === 0
    ? "voice http: all turns answered"
    : `voice http: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
