// Demo rehearsal access matrix: every seeded demo founder x the five prepared
// Qatar entities. For each cell it opens the rehearsal page on the deployed
// web origin and records PASS when "Ready to rehearse" appears, plus the
// q-api persona endpoint status. It also checks the Rehearsals home lists
// "Researched rehearsals". It never starts a rehearsal (no model cost).
//
//   NODE_USE_ENV_PROXY=1 CQ_SEED_ACCOUNT_PASSWORD=... SB_PUBLISHABLE=<publishable key> \
//   node scripts/handoff/live/rehearsal-matrix.mjs [--cast] [--only=a@x,b@y]
//
// Founders: Kathryn (Spheros) plus the @fictional.capitalq.local demo
// founders; --cast adds the +cq- cast; --only= or env FOUNDERS (comma list)
// replaces the set. Secrets come from env only and are never printed.
import { createRequire } from "node:module";

const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const SB_URL = process.env.SB_URL ?? "https://vcohxiqsmnkzxnvawgri.supabase.co";
const REF = new URL(SB_URL).hostname.split(".")[0];
const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const PUBLISHABLE = need("SB_PUBLISHABLE");
const PASSWORD = need("CQ_SEED_ACCOUNT_PASSWORD");

const fictional = (local) => `${local}@fictional.capitalq.local`;
const DEFAULT_FOUNDERS = [
  "neowalker502@gmail.com", // Kathryn, Spheros
  ...[
    "bench.chowdeck",
    "bench.flutterwave",
    "bench.flutterwave2",
    "founder.ajopot",
    "founder.brightkloof-energy",
    "founder.clinicrest",
    "founder.kazikit",
    "founder.ledgerfold",
    "founder.maji-loop",
    "founder.marketlight-grids",
    "founder.nsuo-labs",
    "founder.onboard1",
    "founder.onboard2",
    "founder.onboard3",
    "founder.onboard4",
    "founder.onboard5",
    "founder.onboard6",
    "founder.onboard7",
    "founder.onboard8",
    "founder.souqsheet",
    "founder.tallyloom",
    "founder.tarmacly",
    "founder.yamfield-agro",
  ].map(fictional),
];
const CAST = [
  "abdullahi-silocredit",
  "adaeze-termly",
  "anjali-baridi",
  "anna-ferrolith",
  "callum-halyardsecurity",
  "camille-orpheagenomics",
  "daniel-tensorgate",
  "eilidh-halyardsecurity",
  "elize-randtreasury",
  "funmilayo-ledgerline",
  "halima-silocredit",
  "helena-clearwaterassurance",
  "juliana-prumo",
  "karim-portside",
  "karthik-akshar",
  "kenji-railheadrobotics",
  "matthias-ferrolith",
  "meera-akshar",
  "megan-shiftwell",
  "minh-hui",
  "ngozi-medtrail",
  "nour-mizan",
  "otieno-baridi",
  "priya-drishtihealth",
  "santiago-cosechalabs",
  "vikram-medtrail",
].map((s) => `adedaniel502+cq-${s}@gmail.com`);

const only = process.argv.find((a) => a.startsWith("--only="));
const fromEnv = process.env.FOUNDERS;
const FOUNDERS = only
  ? only.slice(7).split(",")
  : fromEnv
    ? fromEnv.split(",")
    : process.argv.includes("--cast")
      ? [...DEFAULT_FOUNDERS, ...CAST]
      : DEFAULT_FOUNDERS;

// The five prepared entities (ids from the shipped seed migrations).
const ORG = (n) => `b0075742-0000-4000-8000-0000000000c${n}`;
const CELLS = [
  {
    name: "Shadi Qishta",
    path: "/rehearsals/person/83b86735-315e-57cb-8f90-a05a5dcf8897",
    persona: "EXTERNAL_PERSON/83b86735-315e-57cb-8f90-a05a5dcf8897",
  },
  {
    name: "QInvest",
    path: `/rehearsals/investor/${ORG(1)}`,
    persona: `INVESTOR_ORGANISATION/${ORG(1)}`,
  },
  {
    name: "Muhannad Taslaq (Alchemist Doha)",
    path: `/rehearsals/investor/${ORG(3)}`,
    persona: `INVESTOR_ORGANISATION/${ORG(3)}`,
  },
  {
    name: "Invest Qatar",
    path: "/rehearsals/person/ea3eef8e-952e-5a7e-8291-d790c5ff0e62",
    persona: "EXTERNAL_PERSON/ea3eef8e-952e-5a7e-8291-d790c5ff0e62",
    mustMention: /investment[- ]promotion/iu,
  },
  {
    name: "AlRayan Investment",
    path: `/rehearsals/investor/${ORG(2)}`,
    persona: `INVESTOR_ORGANISATION/${ORG(2)}`,
  },
];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(
    process.env.PLAYWRIGHT_PATH ??
      "/home/user/q-int/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright",
  ));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: ["--ignore-certificate-errors"],
});

const host = new URL(WEB).hostname;
const results = [];
for (const email of FOUNDERS) {
  const row = { email, cells: {}, home: "n/a" };
  results.push(row);
  const attempt = (password) =>
    fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  let signIn = await attempt(PASSWORD);
  // A real demo account (not the seed cast) may have its own password,
  // read from a private file named by CQ_FALLBACK_PASSWORD_FILE; never
  // printed, never committed.
  const fallback = process.env.CQ_FALLBACK_PASSWORD_FILE;
  if (!signIn.ok && fallback) {
    const { readFileSync } = await import("node:fs");
    signIn = await attempt(readFileSync(fallback, "utf8").trim());
  }
  if (!signIn.ok) {
    row.home = `FAIL(sign-in ${signIn.status})`;
    for (const c of CELLS) row.cells[c.name] = "FAIL(sign-in)";
    continue;
  }
  const session = await signIn.json();
  const value =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const cookie = `sb-${REF}-auth-token`;
  const chunks = [];
  for (let i = 0; i < value.length; i += 3180)
    chunks.push(value.slice(i, i + 3180));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  await context.addCookies(
    chunks.map((c, i) => ({
      name: chunks.length === 1 ? cookie : `${cookie}.${i}`,
      value: c,
      domain: host,
      path: "/",
      secure: true,
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  const textOf = async () =>
    (
      await page
        .locator("main")
        .innerText()
        .catch(() => "")
    ).replace(/\s+/g, " ");

  await page
    .goto(`${WEB}/rehearsals`, { waitUntil: "networkidle", timeout: 60000 })
    .catch(() => {});
  const home = await textOf();
  row.home = /Researched rehearsals/u.test(home)
    ? CELLS.every((c) => home.includes(c.name.split(" (")[0]))
      ? "PASS"
      : "FAIL(missing entities)"
    : "FAIL(no Researched rehearsals)";

  for (const cell of CELLS) {
    const api = await fetch(`${QAPI}/v1/q/rehearsals/persona/${cell.persona}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.status)
      .catch(() => "ERR");
    await page
      .goto(`${WEB}${cell.path}`, { waitUntil: "networkidle", timeout: 60000 })
      .catch(() => {});
    const text = await textOf();
    const ready = /Ready to rehearse/u.test(text);
    const role = cell.mustMention === undefined || cell.mustMention.test(text);
    row.cells[cell.name] = `${ready && role ? "PASS" : "FAIL"} (persona ${api}${
      ready ? "" : `; page: ${text.slice(0, 80)}`
    }${ready && !role ? "; wrong role" : ""})`;
  }
  await context.close();
}
await browser.close();

let failed = 0;
for (const row of results) {
  console.log(`${row.email}  home=${row.home}`);
  if (!row.home.startsWith("PASS")) failed += 1;
  for (const [name, verdict] of Object.entries(row.cells)) {
    console.log(`   ${name.padEnd(34)} ${verdict}`);
    if (!verdict.startsWith("PASS")) failed += 1;
  }
}
console.log(
  `\n${failed === 0 ? "ALL PASS" : `${failed} FAILING CELLS`} across ${results.length} founders`,
);
process.exit(failed === 0 ? 0 : 1);
