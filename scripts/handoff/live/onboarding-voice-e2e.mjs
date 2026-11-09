// Voice onboarding end-to-end on the LIVE voice line (owner D85, 9 Nov).
//
// One fresh FICTIONAL investor (@fictional.capitalq.local) onboards by
// voice on production: Q speaks on the real live line, and the person's
// answers are real audio, spoken by local espeak-ng (free) and played into
// the page as its microphone (Web Audio in place of getUserMedia; Chromium
// with the media prompt auto-accepted). Each answer is chosen from what Q
// asked (onboarding-voice-lib.mjs) once Q has finished its line.
//
// Checks, read through the product API as the person:
//   - the country saves from a city ("We're based in Doha" → Qatar);
//   - deployment and the three cheques save (a spoken "Yep, that's very
//     correct." accepts a read-back);
//   - no country, deployment or cheque question asked more than twice;
//   - Q's stored lines are not cut mid-sentence;
//   - the answer cards (option buttons) show during voice at least once.
//
// COST: the live line is gpt-live-1 at $0.05 a minute: MAX_MINUTES (default
// 6) is about $0.30, plus the background readings (Anthropic, cents).
// Nothing runs unless CQ_E2E_GO=1 (dry run otherwise). The owner approved
// ONE paid run; the integration owner starts it.
//
//   CQ_E2E_GO=1 NODE_USE_ENV_PROXY=1 MAX_MINUTES=6 OUT=<dir> \
//   SB_URL=... SB_KEY=<admin, creating the account only> \
//   SB_PUBLISHABLE=... CQ_SEED_ACCOUNT_PASSWORD=... \
//   ESPEAK=espeak-ng node scripts/handoff/live/onboarding-voice-e2e.mjs
//
//   Offline self-check (no network): CQ_VOICE_E2E_SELFTEST=1 node …
//
// Secrets are read from env by name and never printed.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  analyse,
  answerFor,
  questionOf,
  selfTest,
} from "./onboarding-voice-lib.mjs";

if (process.env.CQ_VOICE_E2E_SELFTEST === "1") {
  const failed = selfTest();
  console.log(
    failed.length === 0
      ? "selftest OK"
      : `selftest FAILED ${JSON.stringify(failed)}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const MAX_MINUTES = Math.min(10, Number(process.env.MAX_MINUTES ?? 6));
const ESPEAK = process.env.ESPEAK ?? "espeak-ng";
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const OUT = process.env.OUT ?? `/tmp/claude-0/onboarding-voice-e2e/${STAMP}`;
const EMAIL =
  process.env.EMAIL ??
  `e2e-voice-${STAMP}-${Math.random().toString(36).slice(2, 6)}@fictional.capitalq.local`;
if (!EMAIL.endsWith("@fictional.capitalq.local")) {
  console.error("fictional accounts only");
  process.exit(2);
}
const PERSON = "Tunde Bassey-Test";
const ORG = "Kestrel Bay Capital (fictional)";

if (process.env.CQ_E2E_GO !== "1") {
  console.log(
    `onboarding-voice-e2e (dry): investor by live voice as a fresh ${EMAIL}, at most ${MAX_MINUTES} min (~$${(MAX_MINUTES * 0.05).toFixed(2)} gpt-live-1).`,
  );
  console.log("Set CQ_E2E_GO=1 to run against production.");
  process.exit(0);
}
for (const name of [
  "SB_URL",
  "SB_KEY",
  "SB_PUBLISHABLE",
  "CQ_SEED_ACCOUNT_PASSWORD",
]) {
  if (!process.env[name]) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
}
try {
  execFileSync(ESPEAK, ["--version"], { stdio: "ignore" });
} catch {
  console.error(`${ESPEAK} not found: apt-get install -y espeak-ng`);
  process.exit(2);
}
// Run 1 (9 Nov, 8ad54a2b): the live line ended "connect_failed" 6 s after
// it opened: the WebRTC data channel never opened, because this runner
// (a cloud sandbox) reaches the outside only through an HTTPS proxy, with
// no UDP. WebRTC media needs UDP. Checked first, free, before any account
// or paid minute: a STUN binding request must come back.
const udpReachable = () =>
  new Promise((resolve) => {
    import("node:dgram").then(({ createSocket }) => {
      const socket = createSocket("udp4");
      const request = Buffer.alloc(20);
      request.writeUInt16BE(0x0001, 0);
      request.writeUInt32BE(0x2112a442, 4);
      for (let i = 8; i < 20; i += 1)
        request[i] = Math.floor(Math.random() * 256);
      const done = (ok) => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), 6000);
      socket.on("message", () => done(true));
      socket.on("error", () => done(false));
      socket.send(request, 19302, "stun.l.google.com", (error) => {
        if (error) done(false);
      });
    });
  });
if (process.env.CQ_SKIP_UDP_CHECK !== "1" && !(await udpReachable())) {
  console.error(
    "No UDP to the internet from here (STUN got no reply): a WebRTC voice line cannot connect, so nothing was spent. Run this on a machine with normal network (a laptop, or a CI runner with UDP egress).",
  );
  process.exit(3);
}
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- the fictional account -------------------------------------------------
{
  const res = await fetch(`${process.env.SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: process.env.SB_KEY,
      authorization: `Bearer ${process.env.SB_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: EMAIL,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: PERSON,
        full_name: PERSON,
        organisation_name: ORG,
      },
    }),
  });
  if (!res.ok) {
    console.error(`account not created: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`account ${EMAIL}`);
}
let accessToken = null;
const token = async () => {
  if (accessToken !== null) return accessToken;
  const signedIn = await fetch(
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
  if (!signedIn.ok) throw new Error(`HTTP sign-in: ${signedIn.status}`);
  accessToken = (await signedIn.json()).access_token;
  return accessToken;
};
const apiGet = async (path) => {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${await token()}` },
  });
  if (!response.ok)
    throw new Error(`read ${path.split("?")[0]}: HTTP ${response.status}`);
  return response.json();
};
const view = () =>
  apiGet("/v1/onboarding/sessions/current?journeyType=investor").catch(
    () => null,
  );
const turns = async () => {
  const current = await view();
  if (current === null) return [];
  return (
    (
      await apiGet(
        `/v1/onboarding/sessions/${current.session.id}/turns?limit=100`,
      )
    ).items ?? []
  );
};

// ---- the browser, with a microphone this script speaks into ----------------
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const browser = await chromium.launch({
  executablePath:
    process.env.CQ_E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: [
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["microphone"],
});
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // A blocked store just shows the splash.
  }
  // The microphone is this script: what it plays is what Q hears.
  let mic = null;
  const micNow = () => {
    if (mic === null) {
      const context = new AudioContext({ sampleRate: 48000 });
      mic = { context, out: context.createMediaStreamDestination() };
    }
    return mic;
  };
  const original = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (constraints) =>
    constraints?.audio ? micNow().out.stream : original(constraints);
  window.__cqSay = async (base64) => {
    const { context, out } = micNow();
    await context.resume();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const audio = await context.decodeAudioData(bytes.buffer);
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(out);
    source.start();
    return audio.duration;
  };
});
const page = await ctx.newPage();
let shotNo = 0;
const shot = async (name) => {
  shotNo += 1;
  await page
    .screenshot({
      path: `${OUT}/${String(shotNo).padStart(2, "0")}-${name}.png`,
    })
    .catch(() => undefined);
};

await page.goto(`${WEB}/auth/sign-in`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    timeout: 60000,
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);
await page.waitForTimeout(6000);
await page.goto(`${WEB}/onboarding/investor`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(10000);
await shot("opened");

// Voice on: the composer's "Talk with Q".
await page
  .getByRole("button", { name: /Talk with Q/i })
  .first()
  .click({ timeout: 30000 });
await page.waitForTimeout(8000);
await shot("voice-on");

/** Q's newest line on screen. */
const lastQOnScreen = () =>
  page.evaluate(() => {
    const items = [...document.querySelectorAll("li[data-turn]")];
    const q = items.filter(
      (li) => li.querySelector("span")?.textContent?.trim() === "Q",
    );
    return q.at(-1)?.querySelector("p")?.textContent?.trim() ?? "";
  });
/** Option buttons for a question, showing now. */
const cardsShowing = () =>
  page
    .locator("[data-question] button, [data-chip], [role=radiogroup] button")
    .count()
    .catch(() => 0);

const speak = async (words) => {
  const wav = `${OUT}/say-${Date.now()}.wav`;
  execFileSync(ESPEAK, ["-v", "en-us", "-s", "155", "-w", wav, words]);
  const seconds = await page.evaluate(
    (b64) => window.__cqSay(b64),
    readFileSync(wav).toString("base64"),
  );
  await page.waitForTimeout(Math.round(seconds * 1000) + 1500);
};

/** Whether the page shows a live voice line that has dropped (typing fallback). */
const lineDropped = () =>
  page
    .getByText(
      /voice line dropped|Voice isn't available|didn't start|couldn't connect/i,
    )
    .count()
    .then((n) => n > 0)
    .catch(() => false);

const said = [];
let cardsSeen = 0;
const ends = Date.now() + MAX_MINUTES * 60_000;
let lastAnswered = "";
const started = Date.now();
while (Date.now() < ends) {
  // A line that never connected is not waited out (run 1 waited 6 min).
  if (await lineDropped()) {
    check(
      "the live line stayed up",
      false,
      "the page says the voice line dropped",
    );
    break;
  }
  if (said.length === 0 && Date.now() - started > 90_000) {
    check("Q asked something within 90 s of voice on", false);
    break;
  }
  const line = await lastQOnScreen();
  await page.waitForTimeout(1500);
  const still = await lastQOnScreen();
  // Q has finished its line: unchanged, asking, not answered yet.
  if (
    still.length === 0 ||
    still !== line ||
    still === lastAnswered ||
    !/\?\s*$/u.test(still)
  ) {
    if (
      /all set|that's everything|for now|whenever you're ready/i.test(still) &&
      !/\?/u.test(still)
    )
      break;
    continue;
  }
  if ((await cardsShowing()) > 0) cardsSeen += 1;
  const answer = answerFor(still);
  if (answer === null) {
    console.log(`NOTE no answer for: ${questionOf(still).slice(0, 120)}`);
    lastAnswered = still;
    continue;
  }
  said.push({ q: still.slice(0, 200), answer });
  lastAnswered = still;
  await speak(answer);
  if (/please finish/i.test(answer)) {
    await page.waitForTimeout(15000);
    break;
  }
}
await shot("ended");
await page
  .getByRole("button", { name: /End voice|Stop/i })
  .first()
  .click({ timeout: 5000 })
  .catch(() => undefined);
await page.waitForTimeout(8000);

// ---- checks ---------------------------------------------------------------
const current = await view();
const responses = current?.responses ?? [];
const has = (step) => responses.some((r) => String(r.stepKey) === step);
check("country saved from a city (Doha → Qatar)", has("I0.hq_country"));
check("deployment saved", has("I1.deployment_status"));
for (const step of ["I2.cheque_min", "I2.cheque_typical", "I2.cheque_max"]) {
  check(`${step} saved`, has(step));
}
const thread = await turns();
const { qLines, cut, asked } = analyse(thread);
check(
  "no Q line cut mid-sentence",
  cut.length === 0,
  cut.slice(0, 5).join(" | "),
);
for (const [topic, times] of Object.entries(asked)) {
  check(`${topic} asked at most twice`, times <= 2, `asked ${times}`);
}
check(
  "answer cards shown during voice",
  cardsSeen > 0,
  `${cardsSeen} of ${said.length} questions`,
);
writeFileSync(
  `${OUT}/run.json`,
  JSON.stringify(
    { email: EMAIL, minutes: MAX_MINUTES, said, qLines, results },
    null,
    2,
  ),
);
await browser.close();
const failed = results.filter((r) => r.ok === false).length;
console.log(
  `\n${results.length - failed} passed, ${failed} failed. Receipt: ${OUT}/run.json`,
);
process.exit(failed === 0 ? 0 : 1);
