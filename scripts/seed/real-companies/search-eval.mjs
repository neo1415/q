#!/usr/bin/env node
/* global console, fetch, process, URL */
// P13 search-quality eval against production data, READ-ONLY.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/seed/real-companies/search-eval.mjs [before|after|both]
//
// Runs each surface's search SQL (a faithful replica of the repository
// query: the cloud VM cannot open a Postgres connection, so the shipped
// TypeScript is not run here) through the management API's read-only mode
// as a viewer with no organisation. Explore is replicated in JS over the
// companies that have a network pitch (Explore lists pitches only).
// Prints hit@1 / hit@5 per category and surface. No writes, no secrets out.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterSearchSql } from "./search-after.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROJECT_REF = "vcohxiqsmnkzxnvawgri";
const mode = process.argv[2] ?? "both";

async function read(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN?.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const body = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      `sql: HTTP ${r.status} ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body;
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const VISIBLE = `c.company_status = 'active' and c.marketplace_visibility in ('network_visible','public_external')`;

// --- the companies on the network, and what we expect -----------------------
const facts = await read(`
  select c.id, c.canonical_name as name, c.short_description as line, c.headquarters_country as country,
         c.current_stage_code as stage,
         coalesce((select array_agg(n.canonical_code) from taxonomy.entity_assignments a
                     join taxonomy.nodes n on n.id = a.node_id
                    where a.entity_id = c.id and a.status = 'ACTIVE'), '{}') as codes,
         exists (select 1 from media.media_assets m where m.owner_id = c.id and m.purpose = 'FOUNDER_PITCH'
                   and m.status = 'READY' and m.deleted_at is null and m.superseded_at is null) as pitch
    from core.companies c where ${VISIBLE}`);
const byName = new Map(facts.map((f) => [f.name, f]));

const real = JSON.parse(
  readFileSync(join(ROOT, "docs/seed/real-companies/companies.json"), "utf8"),
).map((c) => c.name);
const fictional = JSON.parse(
  readFileSync(join(ROOT, "docs/seed/tavus-20/companies-full.json"), "utf8"),
).map((c) => c.company);

const MISSPELL = {
  Duplo: "Duplow",
  Bumpa: "Bumppa",
  Anchor: "Ancor",
  Koolboks: "Koolbox",
  HoneyCoin: "Honey Coin",
  MoneyHash: "Money Hash",
  Tangible: "Tangable",
  ekko: "Ecko",
  Mintlify: "Mintlfy",
  F2: "F-2",
};
const PARTIAL = {
  Duplo: "dupl",
  Bumpa: "bump",
  Anchor: "anch",
  Koolboks: "koolb",
  HoneyCoin: "coin",
  MoneyHash: "hash",
  Tangible: "tangi",
  ekko: "ekk",
  Mintlify: "mintl",
  F2: "f2",
};
/** Deterministic typo: swap two letters in the middle of the first word. */
function typo(name) {
  const w = name.split(" ")[0];
  if (w.length < 5) return `${w}${w.at(-1)}${name.slice(w.length)}`;
  const i = Math.floor(w.length / 2);
  return `${w.slice(0, i - 1)}${w[i]}${w[i - 1]}${w.slice(i + 1)}${name.slice(w.length)}`;
}
const nameCases = [];
for (const n of real) {
  nameCases.push({ cat: "real exact", q: n, want: n });
  nameCases.push({ cat: "real lowercase", q: n.toLowerCase(), want: n });
  nameCases.push({ cat: "real partial", q: PARTIAL[n], want: n });
  nameCases.push({ cat: "real misspelt", q: MISSPELL[n], want: n });
}
for (const n of fictional) {
  nameCases.push({ cat: "fictional exact", q: n, want: n });
  nameCases.push({
    cat: "fictional partial",
    q: n
      .split(" ")[0]
      .slice(0, Math.max(4, Math.ceil(n.split(" ")[0].length * 0.6)))
      .toLowerCase(),
    want: n,
  });
  nameCases.push({ cat: "fictional misspelt", q: typo(n), want: n });
  if (n.includes(" "))
    nameCases.push({
      cat: "fictional 2nd word",
      q: n.split(" ").slice(1).join(" "),
      want: n,
    });
}
nameCases.push({ cat: "website", q: "getanchor.co", want: "Anchor" });
nameCases.push({ cat: "website", q: "mintlify.com", want: "Mintlify" });
nameCases.push({ cat: "website", q: "https://www.duplo.co", want: "Duplo" });

const FIN = [
  "fintech",
  "payments",
  "payment_infrastructure",
  "cross_border_payments",
  "merchant_payments",
  "embedded_payments",
  "banking",
  "digital_banking",
  "digital_lending",
  "wealthtech",
  "financial_services",
  "capital_markets",
];
const PAY = [
  "payments",
  "payment_infrastructure",
  "cross_border_payments",
  "merchant_payments",
  "embedded_payments",
];
const AFRICA = [
  "NG",
  "KE",
  "EG",
  "GH",
  "ZA",
  "RW",
  "UG",
  "TZ",
  "SN",
  "CI",
  "MA",
  "TN",
  "ET",
];
const has = (f, codes) => f.codes.some((c) => codes.includes(c));
const descCases = [
  {
    q: "Nigerian fintech seed",
    want: (f) => f.country === "NG" && f.stage === "seed" && has(f, FIN),
  },
  { q: "fintech Kenya", want: (f) => f.country === "KE" && has(f, FIN) },
  { q: "London fintech", want: (f) => f.country === "GB" && has(f, FIN) },
  { q: "payments Egypt", want: (f) => f.country === "EG" && has(f, PAY) },
  {
    q: "solar Nigeria",
    want: (f) =>
      f.country === "NG" && has(f, ["clean_energy", "energy_access", "energy"]),
  },
  { q: "developer tools", want: (f) => has(f, ["developer_tools"]) },
  {
    q: "seed stage healthtech",
    want: (f) => f.stage === "seed" && has(f, ["healthcare", "digital_health"]),
  },
  {
    q: "series A logistics",
    want: (f) =>
      f.stage === "series_a" && has(f, ["logistics", "supply_chain"]),
  },
  { q: "stablecoin payments", want: (f) => /stablecoin/i.test(f.line ?? "") },
  {
    q: "B2B payments Africa",
    want: (f) => AFRICA.includes(f.country) && has(f, PAY),
  },
  {
    q: "private credit software",
    want: (f) => /private credit/i.test(f.line ?? ""),
  },
  {
    q: "documentation platform",
    want: (f) => /documentation/i.test(f.line ?? ""),
  },
  { q: "Egyptian startups", want: (f) => f.country === "EG" },
  {
    q: "pre-seed Ghana",
    want: (f) => f.country === "GH" && f.stage === "pre_seed",
  },
  { q: "climate fintech UK", want: (f) => f.name === "ekko" },
].map((d) => ({
  ...d,
  cat: "descriptive",
  wantSet: new Set(facts.filter(d.want).map((f) => f.name)),
}));

// --- before: replicas of the shipped queries ---------------------------------
const like = (t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
async function beforeSearchCompanies(text) {
  const t = text.trim().slice(0, 120);
  const rows =
    await read(`select c.canonical_name as name from core.companies c where ${VISIBLE}
      and c.canonical_name ilike ${q(like(t))} escape '\\' order by c.canonical_name, c.id limit 11`);
  if (rows.length === 0) {
    const letters = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (letters.length >= 4) {
      return (
        await read(`select c.canonical_name as name from core.companies c where ${VISIBLE}
        and extensions.similarity(regexp_replace(lower(c.canonical_name), '[^a-z0-9]', '', 'g'), ${q(letters)}) >= 0.3
        order by extensions.similarity(regexp_replace(lower(c.canonical_name), '[^a-z0-9]', '', 'g'), ${q(letters)}) desc, c.canonical_name, c.id limit 5`)
      ).map((r) => r.name);
    }
  }
  return rows.slice(0, 10).map((r) => r.name);
}
async function beforeClaimable(text) {
  const t = text.trim().slice(0, 120);
  if (t.length < 2) return [];
  let host;
  try {
    host = new URL(t.includes("://") ? t : `https://${t}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    host = null; // not a URL: no website match
  }
  const l = like(t);
  return (
    await read(`select c.canonical_name as name from core.companies c where ${VISIBLE}
     and (c.canonical_name ilike ${q(l)} or c.legal_name ilike ${q(l)}
          or (${host === null ? "null" : q(host)}::text is not null and c.website_url ilike ${q(`%${host ?? ""}%`)}))
     order by c.canonical_name limit 20`)
  ).map((r) => r.name);
}
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function beforeExplore(text) {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .split(" ")
    .filter(Boolean);
  return facts
    .filter((f) => f.pitch)
    .filter((f) => {
      const extra = [];
      if (f.stage)
        extra.push(f.stage.replace(/_/g, " "), f.stage.replace(/_/g, "-"));
      if (f.country) extra.push(f.country, regionNames.of(f.country) ?? "");
      const hay = [f.name, f.line ?? "", ...extra].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .map((f) => f.name); // pool order (newest pitch first), not ranked
}
async function afterSql(text, surface) {
  const sql = afterSearchSql(text, surface);
  if (sql === null) return [];
  return (await read(sql)).map((r) => r.name);
}
function afterExplore(text) {
  // Explore keeps its pitch pool; the shared matcher now ranks it.
  return afterSearchJs(
    text,
    facts.filter((f) => f.pitch),
  );
}
import { afterSearchJs } from "./search-after.mjs";

const SURFACES = {
  before: {
    search_companies: beforeSearchCompanies,
    claimable: beforeClaimable,
    explore: async (t) => beforeExplore(t),
  },
  after: {
    search_companies: (t) => afterSql(t, "search_companies"),
    claimable: (t) => afterSql(t, "claimable"),
    explore: async (t) => afterExplore(t),
  },
};

async function evaluate(which) {
  const out = {};
  const rows = [];
  for (const [surface, fn] of Object.entries(SURFACES[which])) {
    for (const base of [...nameCases, ...descCases]) {
      // Explore lists pitches only; real companies have none by design.
      const c =
        surface === "explore" && base.wantSet
          ? {
              ...base,
              wantSet: new Set(
                [...base.wantSet].filter((n) => byName.get(n)?.pitch),
              ),
            }
          : base;
      if (surface === "explore" && !c.wantSet && !byName.get(c.want)?.pitch)
        continue;
      const got = await fn(c.q);
      const key = `${c.cat}|${surface}`;
      out[key] ??= { n: 0, h1: 0, h5: 0, rec: 0 };
      const o = out[key];
      o.n += 1;
      if (c.wantSet) {
        if (c.wantSet.size === 0) {
          o.n -= 1;
          continue;
        }
        const top5 = got.slice(0, 5);
        const precise = top5.length > 0 && top5.every((g) => c.wantSet.has(g));
        if (top5.some((g) => c.wantSet.has(g))) o.h5 += 1;
        if (got[0] !== undefined && c.wantSet.has(got[0])) o.h1 += 1;
        o.rec +=
          got.slice(0, 10).filter((g) => c.wantSet.has(g)).length /
          c.wantSet.size;
        rows.push(
          `${which} ${surface} "${c.q}" want=${[...c.wantSet].join("/")} got=${got.slice(0, 6).join("/")}${precise ? "" : " (noise)"}`,
        );
      } else {
        const rank = got.indexOf(c.want) + 1;
        if (rank === 1) o.h1 += 1;
        if (rank >= 1 && rank <= 5) o.h5 += 1;
        if (rank !== 1)
          rows.push(
            `${which} ${surface} "${c.q}" want=${c.want} rank=${rank || "miss"} got=${got.slice(0, 4).join("/")}`,
          );
      }
    }
  }
  return { out, rows };
}

const pct = (a, n) => (n === 0 ? "-" : `${Math.round((100 * a) / n)}%`);
const results = {};
for (const which of mode === "both" ? ["before", "after"] : [mode])
  results[which] = await evaluate(which);
const keys = [
  ...new Set(Object.values(results).flatMap((r) => Object.keys(r.out))),
].sort();
console.log(
  "category | surface | n | " +
    Object.keys(results)
      .map((w) => `${w} hit@1 / hit@5`)
      .join(" | "),
);
for (const k of keys) {
  const [cat, surface] = k.split("|");
  const cells = Object.values(results).map((r) => {
    const o = r.out[k];
    return o
      ? `${pct(o.h1, o.n)} / ${pct(o.h5, o.n)}${cat === "descriptive" ? ` rec ${pct(o.rec, o.n)}` : ""}`
      : "-";
  });
  console.log(
    `${cat} | ${surface} | ${Object.values(results)[0].out[k]?.n ?? "-"} | ${cells.join(" | ")}`,
  );
}
if (process.env.DETAIL)
  for (const r of Object.values(results)) console.log(r.rows.join("\n"));
