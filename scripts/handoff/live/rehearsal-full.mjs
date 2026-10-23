// One full rehearsal on production, through the API the rehearsal room uses:
// sign in as a fictional demo founder, start a rehearsal with a counterpart,
// read the persona's opening line, play founder turns (timed), open the
// voice line for it (must be the standard ElevenLabs persona line, never a
// GPT-Live-only one), then finish. Creates one rehearsal and a few model
// turns; no outward messages, no paid video rooms.
//
//   NODE_USE_ENV_PROXY=1 CQ_SEED_ACCOUNT_PASSWORD=... SB_PUBLISHABLE=<publishable key> \
//   node scripts/handoff/live/rehearsal-full.mjs [founderLocal] [KIND/uuid]
//
// Secrets come from env only and are never printed.
const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const SB_URL = process.env.SB_URL ?? "https://vcohxiqsmnkzxnvawgri.supabase.co";
const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const founder = `${process.argv[2] ?? "founder.souqsheet"}@fictional.capitalq.local`;
const [kind, id] = (
  process.argv[3] ??
  "INVESTOR_ORGANISATION/b0075742-0000-4000-8000-0000000000c1"
).split("/");

const signIn = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: need("SB_PUBLISHABLE"),
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email: founder,
    password: need("CQ_SEED_ACCOUNT_PASSWORD"),
  }),
});
if (!signIn.ok) {
  console.error(`sign-in ${signIn.status}`);
  process.exit(1);
}
const { access_token: token } = await signIn.json();
const call = async (method, path, body) => {
  const started = Date.now();
  const response = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (an HTML error page): the status and text say what happened.
  }
  return { status: response.status, ms: Date.now() - started, json, text };
};
const lastThem = (rehearsal) =>
  (rehearsal?.turns ?? []).filter((t) => t.from === "THEM").at(-1)?.text ??
  null;

const report = { founder, counterpart: `${kind}/${id}`, steps: [] };
const step = (name, result, extra = {}) => {
  const row = { name, status: result.status, ms: result.ms, ...extra };
  report.steps.push(row);
  console.log(JSON.stringify(row));
  return result;
};

const started = step(
  "start",
  await call("POST", "/v1/q/rehearsals", {
    counterpart: { kind, id },
    voice: "MALE",
    difficulty: "REALISTIC",
  }),
);
const rehearsal = started.json?.rehearsal ?? started.json;
const rehearsalId = rehearsal?.id;
if (rehearsalId === undefined) {
  console.log(started.text.slice(0, 400));
  process.exit(1);
}
report.opening = lastThem(rehearsal);
console.log(JSON.stringify({ opening: report.opening }));

const voice = step(
  "voice session",
  await call("POST", "/v1/q/voice/sessions", {
    voice: "MALE",
    rehearsal: { rehearsalId },
  }),
);
report.voice = {
  liveOnly: voice.json?.liveOnly === true,
  provider: voice.json?.provider ?? (voice.json?.deepgram ? "deepgram" : null),
};
console.log(JSON.stringify({ voice: report.voice }));

// --voice: one turn on the voice line itself, as the speech provider asks
// for it (the think endpoint, streamed), timing each piece of text heard.
// Before R7 the line's first words came only with the whole turn.
if (process.argv.includes("--voice")) {
  const thinkToken = voice.json?.thinkToken ?? voice.json?.sessionToken;
  const said =
    "Thanks. We have forty paying merchants in Riyadh and Lagos and we grow twenty percent a month, with payback under four months.";
  const startedAt = Date.now();
  const response = await fetch(`${QAPI}/v1/q/voice/think/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${thinkToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "capital-q",
      stream: true,
      messages: [{ role: "user", content: said }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const pieces = [];
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 2);
      if (!event.startsWith("data:") || event.includes("[DONE]")) continue;
      try {
        const content = JSON.parse(event.slice(5)).choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          pieces.push({ ms: Date.now() - startedAt, text: content });
        }
      } catch {
        // A keep-alive or a partial event: nothing heard.
      }
    }
  }
  const doneMs = Date.now() - startedAt;
  report.voiceTurn = { status: response.status, doneMs, pieces };
  console.log(
    JSON.stringify({
      voiceTurn: response.status,
      firstWordsMs: pieces[0]?.ms ?? null,
      doneMs,
      pieces: pieces.map((p) => [p.ms, p.text.slice(0, 80)]),
    }),
  );
}

for (const text of [
  "Thanks for having me. We build invoicing and payments for SMEs in the Gulf and West Africa, and we're raising a three million dollar seed.",
  "We have forty paying merchants in Riyadh and Lagos, growing twenty percent month on month, and our payback on acquisition is under four months.",
]) {
  const turn = step(
    "turn",
    await call("POST", `/v1/q/rehearsals/${rehearsalId}/turns`, { text }),
  );
  const reply = lastThem(turn.json?.rehearsal ?? turn.json);
  const last = (turn.json?.rehearsal ?? turn.json)?.turns
    ?.filter((t) => t.from === "THEM")
    .at(-1);
  console.log(
    JSON.stringify({
      reply,
      mood: last?.mood ?? null,
      beats: last?.beats ?? null,
    }),
  );
  (report.replies ??= []).push(reply);
}

const finished = step(
  "finish",
  await call("POST", `/v1/q/rehearsals/${rehearsalId}/finish`, {}),
);
report.review = Boolean(
  (finished.json?.rehearsal ?? finished.json)?.review ?? finished.json?.review,
);
console.log(JSON.stringify({ rehearsalId, review: report.review }));
