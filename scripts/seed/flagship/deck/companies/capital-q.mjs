// Capital Q investor deck. Facts: docs/flagship/capital-q/{research.md,facts.json,brand.json} only.
// Design: Capital Q's own light-first tokens (canvas #FBFAF7, text #101419, accent #1767D1, borders #CED1D6;
// stage canvas #0B0F18 for the title; gold #C9A227 only on the app icon). Editorial serif per --cq-font-editorial
// (Georgia; Lora is the offline OFL stand-in), UI sans per --cq-font-ui (system stack), Geist Mono for evidence tags.
// Narrative device: an investment memo — numbered sections (§) with a right-hand evidence margin on each slide,
// because "evidence before opinion" is the product's own first rule.
// Brand marks are the owner's repository assets: apps/web/app/icon.svg and the "Capital" outlined wordmark path
// from apps/web/src/features/splash/capital-wordmark.tsx (read at build time, not redrawn).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, esc, st } from "../lib.mjs";

const ICON = readFileSync(join(REPO, "apps/web/app/icon.svg"), "utf8").replace("<svg ", '<svg aria-hidden="true" ');
const WM_SRC = readFileSync(join(REPO, "apps/web/src/features/splash/capital-wordmark.tsx"), "utf8");
const WM_D = WM_SRC.match(/<path d="([^"]+)"/)[1];
const WORDMARK = (h, color) =>
  `<svg aria-hidden="true" viewBox="-35 40 3057 1050" style="height:${h}px;width:auto;fill:${color}"><path d="${WM_D}"/></svg>`;
const QMARK = (size) => `<span class="qmark" style="font-size:${size}px">Q</span>`;

const css = `
:root{--cv:#FBFAF7;--sf:#FEFDFC;--sb:#F4F3F0;--ss:#E8E6E1;--tp:#101419;--t2:#4C5057;--t3:#686C72;--bd:#CED1D6;--bs:#DFE1E5;--ac:#1767D1;--acs:#DDECFF;--ps:#0D773A;--wn:#975D00;--dg:#D02C2A;--stage:#0B0F18;--sacc:#77B2FF;--gold:#C9A227}
body{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Liberation Sans",sans-serif;color:var(--tp)}
.slide{background:var(--cv)}
.serif{font-family:Georgia,Lora,"Times New Roman",serif}
.mono{font-family:"Geist Mono",ui-monospace,monospace}
.qmark{display:inline-block;font-family:Georgia,Lora,serif;font-weight:700;line-height:1;padding:.08em .26em .1em;border:2px solid var(--ac);border-radius:.18em;color:var(--ac)}
.head{position:absolute;left:64px;top:30px;right:64px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--t3);padding-bottom:12px;border-bottom:1px solid var(--bs)}
.head .brand{display:flex;align-items:center;gap:8px;color:var(--tp)}
.body{position:absolute;left:64px;top:84px;width:830px;bottom:58px}
.margin{position:absolute;left:934px;right:64px;top:84px;bottom:58px;border-left:1px solid var(--bd);padding-left:22px}
.margin .k{font-size:11.5px;color:var(--t3);margin-bottom:8px}
.margin li{font-size:12.5px;line-height:1.45;color:var(--t2);padding:7px 0;border-top:1px solid var(--bs)}
.margin li .st{display:block;margin-top:3px}
.sec{font-family:Georgia,Lora,serif;font-style:italic;font-size:17px;color:var(--ac);margin-bottom:8px}
h2{font-family:Georgia,Lora,serif;font-weight:400;font-size:40px;line-height:1.12;letter-spacing:-.01em;margin-bottom:20px}
h2 em{font-style:italic;color:var(--ac)}
p{font-size:17px;line-height:1.5;color:var(--t2)}
p b,li b{color:var(--tp);font-weight:600}
.small{font-size:13.5px;color:var(--t3);line-height:1.45}
.foot{position:absolute;left:64px;right:64px;bottom:22px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--t3)}
.st{font-family:"Geist Mono",ui-monospace,monospace;font-size:11.5px;white-space:nowrap;color:var(--t2);line-height:1.25}
.st::before{display:inline-block;width:12px;font-size:10px}
.st-VP{color:var(--ps)}.st-VP::before{content:"■"}
.st-SR::before,.st-PT::before{content:"◆"}.st-SR,.st-PT{color:#3B4A63}
.st-OP{color:var(--wn)}.st-OP::before{content:"●"}
.st-AS{color:var(--t2)}.st-AS::before{content:"△"}
.st-UN{color:var(--t3)}.st-UN::before{content:"○"}
.stage{font-family:"Geist Mono",monospace;font-size:11.5px;white-space:nowrap;padding:2px 6px;border:1px solid var(--bd);border-radius:3px;color:var(--t2)}
.stage.live{border-color:var(--ps);color:var(--ps)}.stage.dep{border-color:var(--ac);color:var(--ac)}.stage.no{border-style:dashed;color:var(--dg);border-color:var(--dg)}
table.t{width:100%;font-size:14px}
table.t th{text-align:left;font-weight:600;color:var(--t3);font-size:12px;padding:0 12px 8px 0;border-bottom:1px solid var(--tp)}
table.t td{padding:9px 12px 9px 0;border-bottom:1px solid var(--bs);vertical-align:top;line-height:1.38;color:var(--t2)}
table.t td b{color:var(--tp)}
table.t td.n{font-family:"Geist Mono",monospace;white-space:nowrap;color:var(--tp)}
.lst li{font-size:16.5px;line-height:1.45;padding:10px 0;border-top:1px solid var(--bs);color:var(--t2)}
.lst li:last-child{border-bottom:1px solid var(--bs)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:36px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
h3{font-size:13px;font-weight:600;color:var(--tp);margin-bottom:8px;font-family:"Geist Mono",monospace}
.fig .v{font-family:Georgia,Lora,serif;font-size:46px;line-height:1;letter-spacing:-.01em;color:var(--tp)}
.fig .l{font-size:15px;line-height:1.42;color:var(--t2);margin-top:8px}
.fig{border-top:2px solid var(--tp);padding-top:12px}
.arith>div{display:grid;grid-template-columns:120px 1fr 150px;gap:16px;padding:12px 0;border-top:1px solid var(--bs);align-items:baseline}
.arith>div:last-child{border-bottom:1px solid var(--bs)}
.arith .k{font-family:"Geist Mono",monospace;font-weight:700;font-size:14px}
.arith .x{font-size:15px;color:var(--t2);line-height:1.4}
.arith .r{text-align:right;font-family:Georgia,Lora,serif;font-size:24px}
.callout{background:var(--acs);padding:14px 18px;border-left:3px solid var(--ac)}
.callout p{color:var(--tp);font-size:15.5px}
/* title on stage canvas */
.s-title{background:var(--stage);color:#EFEEEB}
.s-title .top{position:absolute;left:72px;top:60px;display:flex;align-items:center;gap:16px}
.s-title .top svg{height:46px;width:46px}
.s-title h1{position:absolute;left:72px;top:150px;width:820px;font-family:Georgia,Lora,serif;font-weight:400;font-size:50px;line-height:1.1;letter-spacing:-.01em}
.s-title h1 em{color:var(--sacc)}
.s-title .sub{position:absolute;left:72px;top:450px;width:760px;font-size:19px;line-height:1.5;color:#ABAEB3}
.s-title .meta{position:absolute;left:72px;bottom:52px;font-size:12.5px;color:#86898E;line-height:1.7}
.s-title .meta .st{color:#ABAEB3}.s-title .meta .st-OP{color:#E5B15B}.s-title .meta .st-VP{color:#67BA7D}
.s-title .rule{position:absolute;right:72px;top:160px;width:250px;border-top:1px solid #2B2E33;padding-top:14px;font-size:13px;line-height:1.6;color:#ABAEB3}
.s-title .rule b{color:#EFEEEB;font-weight:600}
`;

const head = (sec) =>
  `<div class="head"><span class="brand">${WORDMARK(15, "var(--tp)")} ${QMARK(11)}</span><span class="mono">Investment memorandum · ${esc(sec)}</span></div>`;
const foot = ({ i, n }) =>
  `<div class="foot"><span>Capital Q · Investor deck · October 2026 · prepared offline from the repository and public sources · not a securities offer</span><span class="mono">${String(i).padStart(2, "0")} / ${n}</span></div>`;

/** Memo slide: § number, serif headline, body, and the evidence margin. */
const memo = (secNo, secName, title, body, evidence) => (ctx) =>
  `${head(`§${secNo} ${secName}`)}<div class="body"><div class="sec">§${secNo} — ${esc(secName)}</div><h2>${title}</h2>${body}</div>
   <div class="margin"><div class="k mono">evidence</div><ul>${evidence.map((e) => `<li>${e}</li>`).join("")}</ul></div>${foot(ctx)}`;

/** Wide memo slide without the margin (tables). */
const wide = (secNo, secName, title, body) => (ctx) =>
  `${head(`§${secNo} ${secName}`)}<div class="body" style="width:auto;right:64px"><div class="sec">§${secNo} — ${esc(secName)}</div><h2>${title}</h2>${body}</div>${foot(ctx)}`;

const stage = (k, label) => `<span class="stage ${k}">${esc(label)}</span>`;

const slides = [
  {
    id: "title",
    title: "Thesis — evidence before opinion in private capital",
    uses: ["category line (SELF_REPORTED, Product Specification)", "public page and publisher (VERIFIED_PUBLIC, fdncapitalpartners.com/capitalq/)", "cofounders (OWNER_PROVIDED)", "brand marks from repository (owner assets)"],
    html: (ctx) => `
      <div class="top">${ICON}${WORDMARK(34, "#EFEEEB")} <span class="qmark" style="font-size:24px;border-color:var(--sacc);color:var(--sacc)">Q</span></div>
      <h1>Private capital runs on <em>information asymmetry.</em> Capital Q is built to reduce it — with evidence, not opinion.</h1>
      <div class="sub">An AI-native Investment Intelligence Operating System for private capital: founders become more investable, investors find and evaluate relevant opportunities, and both manage one shared relationship — with one institutional analyst, Q, throughout.</div>
      <div class="rule"><b>Investor deck</b><br>October 2026<br><br><b>Cofounders</b><br>Zino Mario · David Nwankwo<br><br><b>Public page</b><br>fdncapitalpartners.com/capitalq/</div>
      <div class="meta">Category line from the locked Product Specification ${st("SR")} · cofounders ${st("OP")} · public page published by FDN Capital Partners ${st("VP")}<br>Every claim carries its evidence status or engineering evidence stage. Unknown stays unknown.</div>`,
  },
  {
    id: "problem",
    title: "Problem — information asymmetry on both sides of the table",
    uses: ["Product Specification Ch.1 §3.1 proposition (SELF_REPORTED)", "marketing line 'months … minutes' (SELF_REPORTED, FDN page)", "GateQ inbound layer (SELF_REPORTED, GateQ spec)"],
    html: memo(
      "01",
      "Problem",
      `Founders cannot see how investable they are. Investors cannot see enough to decide quickly.`,
      `<div class="g2" style="margin-top:4px">
        <div><h3>founders</h3><ul class="lst"><li>Do not know which evidence investors weigh, or what is missing</li><li>Repeat the same story to every investor in a different format</li><li>Get silence instead of a reason</li></ul></div>
        <div><h3>investors</h3><ul class="lst"><li>Screen inbound by hand, in inboxes, forms and spreadsheets</li><li>Mix self-reported claims with verified facts</li><li>Lose the relationship history between tools</li></ul></div>
       </div>
       <p style="margin-top:20px">The public line: “Discovering the right investment opportunity shouldn’t take months. It should take minutes.” ${st("SR", "FDN page")}</p>`,
      [
        `Proposition: “reduce information asymmetry within private capital markets” — Product Specification Ch. 1 §3.1 ${st("SR", "owner product source")}`,
        `GateQ is the “inbound layer”, Capital Q the “outbound and investment-relationship layer” — GateQ Feature Specification ${st("SR")}`,
        `Problem framing is the product sources’ own; no third-party survey of the problem is cited ${st("UN", "external evidence")}`,
      ],
    ),
  },
  {
    id: "solution",
    title: "Solution — one Q, one canonical relationship, human authority",
    uses: ["one Q, intelligence vs commercial authority (SELF_REPORTED, Final System Review §2)", "Prepare→Recommend→Approve→Execute (repo architecture)", "canonical relationship (research §8)"],
    html: memo(
      "02",
      "Solution",
      `One institutional analyst — <em>Q</em> — across preparation, discovery, intake, diligence and the relationship.`,
      `<div class="g3" style="margin-top:6px">
        <div class="fig"><div class="v">One Q</div><div class="l">Users experience one analyst. Specialists work inside it; none is user-selectable, and none talks peer-to-peer.</div></div>
        <div class="fig"><div class="v">One record</div><div class="l">One canonical company, one investor organisation, one company–investor relationship that both sides share.</div></div>
        <div class="fig"><div class="v">Human say</div><div class="l">Q has intelligence authority; people keep commercial authority. Prepare → Recommend → Approve → Execute.</div></div>
       </div>
       <div class="callout" style="margin-top:26px"><p><b>What Capital Q is not:</b> a marketplace, a CRM, a chatbot, a document store or a fundraising directory. Relationship state is computed from an append-only event history by a deterministic projector — never by a model.</p></div>`,
      [
        `“One institutional investment analyst throughout” — Final System Review §2 ${st("SR", "owner product source")}`,
        `UNIQUE (company, investor organisation) relationship; GateQ and Discover resolve to the same row — research §8 ${stage("dep", "deployed")}`,
        `Consequential actions need human approval bound to the exact payload — repository architecture ${st("SR")}`,
      ],
    ),
  },
  {
    id: "product",
    title: "Working product & capabilities — by engineering evidence stage",
    uses: ["feature table with evidence stages CODE OBSERVED / DEPLOYED / LIVE VERIFIED / NOT VERIFIED (research §8)", "fictional demo accounts flagged"],
    html: wide(
      "03",
      "Working product",
      `Built and deployed — graded by what has actually been exercised.`,
      `<table class="t" style="font-size:13.5px">
        <tr><th style="width:21%">Capability</th><th style="width:52%">What it does</th><th>Evidence stage</th></tr>
        <tr><td><b>Q Intelligence</b></td><td>One analyst through a model gateway; Context Firewall filters by scope before any model call; voice, memory, Q Daily</td><td>${stage("dep", "deployed")} parts ${stage("live", "live verified")}</td></tr>
        <tr><td><b>Discover & Explore</b></td><td>Precomputed, mandate-ranked pitch feed (no LLM in ranking); saved, passed, compare; Explore grid with closed-vocabulary reasons</td><td>${stage("dep", "deployed")}</td></tr>
        <tr><td><b>GateQ</b></td><td>Embeddable branded inbound gateway: intake → standardise → Q interview → evaluate → rank → route</td><td>${stage("live", "live verified")} fictional accounts</td></tr>
        <tr><td><b>Relationship Hub</b></td><td>Append-only relationship events; deterministic state from Discovered to Investment or Pass</td><td>H1 ${stage("live", "live verified")} fictional accounts</td></tr>
        <tr><td><b>Company profiles & documents</b></td><td>Canonical profiles; isolated document parser; founder-confirmed pitch readings; data room; Document Studio</td><td>${stage("dep", "deployed")}</td></tr>
        <tr><td><b>Onboarding</b></td><td>Founder: upload what you have, Q works first. Investor: mandate quickly, then a personalised feed</td><td>${stage("", "surface exists")} time-to-feed unmeasured</td></tr>
        <tr><td><b>Diligence workflow</b></td><td>Per-relationship diligence tab; data-room disclosure ownership</td><td>${stage("dep", "deployed")} end-to-end ${stage("no", "not verified")}</td></tr>
       </table>
       <p class="small" style="margin-top:10px">“Live verified” here means exercised on production with recorded evidence, using fictional <span class="mono">*@fictional.capitalq.local</span> demo accounts. A surface that exists is not proof that a journey works end to end.</p>`,
    ),
  },
  {
    id: "scores",
    title: "Scores that refuse to guess — Investability, Suitability, Unicorn Potential",
    uses: ["InvestIQ nine dimensions, Investability = InvestIQ×25 (ADR 0068/0074)", "Suitability, fit-order.v2 0.75/0.25 (ADR 0074/0059)", "Unicorn Potential 0 of 461 numeric (ADR 0076, STATE.md)", "InvestIQ owned by FDN (OWNER_PROVIDED)"],
    html: memo(
      "04",
      "Assessment",
      `Scores appear only when the shared evidence supports them. <em>Unknown is never zero.</em>`,
      `<table class="t" style="font-size:14.5px">
        <tr><th style="width:22%">Score</th><th>How it works</th></tr>
        <tr><td><b>Investability</b><br>0–100</td><td>FDN’s InvestIQ methodology, nine dimensions; InvestIQ overall × 25. Investor-eligible evidence only, identical for every investor. Below coverage gates it reads “not enough shared evidence yet”.</td></tr>
        <tr><td><b>Suitability</b><br>out of 10</td><td>Fit to this investor’s mandate. Never blended with Investability on display. Ranking after hard eligibility uses fit-order.v2: Suitability 0.75, Investability 0.25.</td></tr>
        <tr><td><b>Unicorn Potential</b><br>0–100, premium</td><td>Deterministic indicator of present evidence against a 12-pillar, 24-criterion method. “Not a probability or validated forecast.” Production: <b>0 of 461</b> companies have a numeric score — evidence coverage is below the 60% gate.</td></tr>
       </table>
       <p class="small" style="margin-top:12px">This deck does not call Unicorn Potential a “predictor”. InvestIQ constants are hypotheses pending calibration on 3–5 real FDN companies.</p>`,
      [
        `InvestIQ is FDN Capital Partners’ proprietary methodology; Capital Q implements it — ADR 0068 ${st("OP")}`,
        `Investability and Suitability with coverage gates — ADR 0074 ${stage("dep", "deployed")}`,
        `Unicorn Potential — ADR 0076; 0 numeric of 461 — STATE.md, coverage audit 2026-10-18 ${stage("dep", "deployed")}`,
        `461 includes seeded demo companies; not a customer count ${st("AS")}`,
      ],
    ),
  },
  {
    id: "trust",
    title: "Trust architecture — why investors and founders can both use it",
    uses: ["Context Firewall release-blocking invariant (Final System Review Finding 2)", "no pay-to-rank (OWNER_PROVIDED, ADR 0034)", "deterministic ranking (repo)", "EU data residency (ADR 0014)"],
    html: memo(
      "05",
      "Trust",
      `A two-sided product only works if neither side can be used against the other.`,
      `<ul class="lst">
        <li><b>Context Firewall.</b> Founder-private information never silently alters investor-facing ranking, discoverability or assessment. Release-blocking, enforced at retrieval, features and the database.</li>
        <li><b>No pay-to-rank, ever.</b> Payment never influences ranking.</li>
        <li><b>Deterministic, explainable ranking.</b> Versioned configuration; no model in the feed’s ranking path; never optimised for watch time.</li>
        <li><b>Three separate evidence axes.</b> Truth class, evidence status and lifecycle are kept apart; contradictions coexist until reconciled.</li>
        <li><b>EU data residency.</b> Services in Railway europe-west4; database in Supabase eu-central-1.</li>
       </ul>`,
      [
        `Founder-private data invariant — Final System Review Finding 2 ${st("SR", "owner product source")}`,
        `No pay-to-rank — ADR 0034 and root CLAUDE.md ${st("OP")}`,
        `Hosting and residency — STATE.md, ADR 0014 ${st("SR")}`,
      ],
    ),
  },
  {
    id: "market",
    title: "Market context — private markets and the Africa–GCC corridor",
    uses: ["BlackRock ~US$13T AUM late 2024, >US$20T 2030 (VERIFIED_PUBLIC, BusinessWire)", "Preqin PE ~US$6.7T (VERIFIED_PUBLIC, UK Parliament evidence)", "AVCA US$3.9bn/506; Partech US$4.1bn/570; Big Deal US$2.2bn equity (VERIFIED_PUBLIC)", "Deloitte 86% GenAI adoption (VERIFIED_PUBLIC)"],
    html: wide(
      "06",
      "Market context",
      `A very large asset class, a fast-forming corridor, and buyers already adopting AI.`,
      `<div class="g3" style="grid-template-columns:repeat(4,1fr);gap:26px">
        <div class="fig"><div class="v">US$13T</div><div class="l">Private markets AUM, late 2024; projected above US$20T by 2030 (BlackRock 2025 Private Markets Outlook).</div></div>
        <div class="fig"><div class="v">US$6.7T</div><div class="l">Private equity AUM at 31 March 2025 (Preqin data, cited in UK Parliament written evidence).</div></div>
        <div class="fig"><div class="v">US$3.9bn</div><div class="l">African venture funding 2025 across 506 deals, incl. US$1.8bn venture debt (AVCA). Partech: US$4.1bn, 570 deals. Africa: The Big Deal: US$2.2bn equity.</div></div>
        <div class="fig"><div class="v">86%</div><div class="l">of 1,000 US corporate and PE M&A professionals have adopted GenAI; 35% use it to find and evaluate targets (Deloitte 2025).</div></div>
       </div>
       <div class="small" style="margin-top:26px;line-height:1.7">${st("VP")} third-party estimates; projections labelled · businesswire.com/news/home/20241216468500/en · committees.parliament.uk/writtenevidence/157389/html/ · ecofinagency.com (AVCA 2025) · allafrica.com/stories/202601250064.html · businessday.ng (Africa: The Big Deal 2025) · deloitte.com/us/en/about/press-room/deloitte-survey-genai-in-mna.html · all fetched 2026-10-18. Africa figures differ by source and method; none is preferred here.</div>`,
    ),
  },
  {
    id: "sizing",
    title: "Opportunity sizing — TAM / SAM / SOM (Assumption)",
    uses: ["US$13T AUM base (VERIFIED_PUBLIC)", "all rates, counts and prices (ASSUMPTION, research §13)"],
    html: memo(
      "07",
      "Sizing",
      `TAM ≈ US$1.3bn · SAM ≈ US$9.6M · SOM ≈ US$0.6M ARR <span style="display:block;font-size:17px;font-family:-apple-system,Arial,sans-serif;color:var(--t3);margin-top:8px">Illustrative arithmetic, labelled Assumption — to be replaced by pipeline data.</span>`,
      `<div class="arith">
        <div><span class="k">TAM ${st("AS")}</span><span class="x">US$13T private-markets AUM × 0.01% spent each year on sourcing, diligence and CRM software</span><span class="r">≈ $1.3bn/yr</span></div>
        <div><span class="k">SAM ${st("AS")}</span><span class="x">Africa–GCC: 1,500 investor organisations × US$6,000/yr (US$9.0M) + 20,000 fundraising companies × 5% Pro × US$600/yr (US$0.6M)</span><span class="r">≈ $9.6M/yr</span></div>
        <div><span class="k">SOM ${st("AS")}</span><span class="x">3 years: 5% of investor organisations (75 × US$6,000 = US$0.45M) + 25% of founder revenue (US$0.15M)</span><span class="r">≈ $0.6M ARR</span></div>
        <div><span class="k">fee ${st("AS")}</span><span class="x">Sensitivity only: a 1% facilitation fee on a 1% platform share of AVCA’s US$3.9bn deployed</span><span class="r">≈ $0.39M/yr</span></div>
       </div>`,
      [
        `Only the US$13T and US$3.9bn bases are sourced ${st("VP")}`,
        `Every percentage, organisation count and price is an analyst assumption ${st("AS")}`,
        `No prices are set in any source — ADR 0034 ${st("UN", "pricing")}`,
        `Facilitation fee is a founder direction (2026-09-29), not a locked source, and needs regulatory analysis ${st("OP")}`,
      ],
    ),
  },
  {
    id: "model",
    title: "Business model — free diagnosis, Pro intelligence, optional human execution",
    uses: ["PADL #85 three-layer model (OWNER_PROVIDED)", "ADR 0034 billing PROPOSED; gated features", "no prices (UNKNOWN)", "revenue (UNKNOWN)"],
    html: memo(
      "08",
      "Business model",
      `Revenue from proprietary strategic value and optional execution — <em>not</em> from restricting knowledge.`,
      `<div class="g3">
        <div class="fig"><div class="v">Layer 1</div><div class="l"><b>Diagnosis</b> — free.</div></div>
        <div class="fig"><div class="v">Layer 2</div><div class="l"><b>Strategic Intelligence</b> — “Pro”: the Capital Readiness Blueprint, investor-specific recommendations.</div></div>
        <div class="fig"><div class="v">Layer 3</div><div class="l"><b>Human Execution</b> — optional, by specialist teams (FDN advisory).</div></div>
       </div>
       <p style="margin-top:22px">Billing design (proposed): plans, entitlements and metering as versioned data. Gated features are the model-heavy ones — rehearsals, “Q handles it” delegations, AI images, web research, Q Daily, GateQ gateway count, premium scores and filters. Every account is on a generous launch default today.</p>`,
      [
        `Three-layer model — PADL Ch. 5 Decision #85, locked ${st("OP")}`,
        `Billing — ADR 0034, status PROPOSED ${stage("", "not live")}`,
        `Prices: none set in any source ${st("UN")}`,
        `Revenue and paying customers: none evidenced ${st("UN")}`,
      ],
    ),
  },
  {
    id: "segments",
    title: "Segments & distribution",
    uses: ["target users (research §6, §9)", "Join the Waitlist / Book a Demo (SELF_REPORTED, FDN page)", "FDN offices Doha and Lagos (SELF_REPORTED)", "Qatar demo entities are not partnerships"],
    html: memo(
      "09",
      "Segments & distribution",
      `Three users, one relationship graph.`,
      `<div class="g3">
        <div><h3>founders</h3><ul class="lst"><li>Companies raising capital</li><li>Free diagnosis first; Pro for the Blueprint</li></ul></div>
        <div><h3>investors</h3><ul class="lst"><li>VCs, angels, family offices, corporate and government investors</li><li>Mandate in minutes, then a ranked feed</li></ul></div>
        <div><h3>gateway operators</h3><ul class="lst"><li>Funds, accelerators, investment-promotion agencies</li><li>GateQ on their own site</li></ul></div>
       </div>
       <p style="margin-top:20px"><b>Distribution.</b> The FDN CapitalQ™ page runs “Join the Waitlist” and “Book a Demo”. FDN Capital Partners lists offices in Doha and Lagos, and the prepared demo journeys centre on an Africa → Arabia corridor. FDN provides the optional human-execution layer.</p>`,
      [
        `CTAs on fdncapitalpartners.com/capitalq/ ${st("SR")}`,
        `FDN offices Doha, Qatar and Lagos, Nigeria — no addresses published ${st("SR")}`,
        `Invest Qatar and the “Qatar Five” are prepared demo entities — not partnerships ${st("SR", "repo decision log")}`,
        `Waitlist size and pilots ${st("UN")}`,
      ],
    ),
  },
  {
    id: "competition",
    title: "Competition — named, by job to be done",
    uses: ["competitor list (research §12, illustrative)", "claimed differentiation (SELF_REPORTED, locked sources)"],
    html: wide(
      "10",
      "Competition",
      `Capital Q spans jobs that today live in four separate tool categories.`,
      `<table class="t" style="font-size:15px">
        <tr><th style="width:28%">Job</th><th style="width:44%">Named alternatives</th><th>Capital Q’s claimed difference ${st("SR")}</th></tr>
        <tr><td><b>Private-capital data and deal sourcing</b></td><td>PitchBook, Crunchbase, Grata, Harmonic, Tracxn, Dealroom; in Africa, Briter Intelligence and Africa: The Big Deal</td><td>Evidence-first assessments with explicit unknowns</td></tr>
        <tr><td><b>Investor relationship CRM</b></td><td>Affinity, Intapp DealCloud, 4Degrees, Attio</td><td>One canonical relationship shared by both sides</td></tr>
        <tr><td><b>Inbound deal-flow intake</b></td><td>Intake forms, Airtable and Typeform workflows, Visible.vc, DocSend-style data rooms</td><td>GateQ with a Q interview, resolving to the same record</td></tr>
        <tr><td><b>Founder readiness and fundraising tools</b></td><td>VC4A (Africa), Visible, Foundersuite, generic AI assistants</td><td>Context Firewall; no pay-to-rank; one Q end to end</td></tr>
       </table>
       <p class="small" style="margin-top:12px">Competitor list is illustrative (research §12); competitors’ funding and pricing were not verified in this pass.</p>`,
    ),
  },
  {
    id: "moat",
    title: "Defensibility — what compounds",
    uses: ["differentiation (SELF_REPORTED)", "data-partner and pilot options (ASSUMPTION, research §16)", "marketplace dynamics risk (research §15)"],
    html: memo(
      "11",
      "Defensibility",
      `The moat is trust that compounds: evidence, relationships and a method investors can audit.`,
      `<ul class="lst">
        <li><b>Evidence graph.</b> Each confirmed claim moves a company from self-reported toward document-supported and verified, and stays with its provenance.</li>
        <li><b>Shared relationship history.</b> Both sides work on one append-only record — hard to replicate with a CRM on one side and a form on the other.</li>
        <li><b>A named method.</b> InvestIQ (FDN) and versioned scoring that refuses to score on thin evidence.</li>
        <li><b>Neutrality as policy.</b> No pay-to-rank is a commitment competitors that sell placement cannot copy.</li>
       </ul>
       <p class="small" style="margin-top:14px">${st("AS")} These compound only with enough evidence-rich companies and active investors; today most evidence is self-reported, so most scores stay hidden.</p>`,
      [
        `Differentiation claims — locked product sources ${st("SR")}`,
        `Compounding argument — analyst reading ${st("AS")}`,
        `Calibrated scores need an FDN pilot cohort ${st("AS")}`,
      ],
    ),
  },
  {
    id: "traction",
    title: "Traction & proof points — what is evidenced, and what is not",
    uses: ["live-verified journeys with fictional accounts (repo handoff)", "43 access grants are not revenue (STATE.md)", "paying customers, revenue, waitlist, LOIs (UNKNOWN)"],
    html: memo(
      "12",
      "Traction",
      `Proof today is engineering proof. Commercial proof is still unknown.`,
      `<div class="g2">
        <div><h3>evidenced</h3><ul class="lst">
          <li>Four services deployed on Railway: web, api, q-api, workers ${stage("dep", "deployed")}</li>
          <li>GateQ text journey and Relationship Hub H1 exercised on production ${stage("live", "live verified")}</li>
          <li>Premium Unicorn filters checked for authorization behaviour ${stage("live", "live verified")}</li>
          <li>43 explicit organisation feature-access grants — access, not contracts ${st("SR")}</li></ul></div>
        <div><h3>not evidenced</h3><ul class="lst">
          <li>Paying customers ${st("UN")}</li>
          <li>Revenue ${st("UN")}</li>
          <li>Waitlist size ${st("UN")}</li>
          <li>Pilot customers or signed LOIs ${st("UN")}</li></ul></div>
       </div>`,
      [
        `Verification used fictional demo accounts — handoff 13–14 Oct and 18 Oct ${st("SR", "repo handoff")}`,
        `Companies in production scoring audits include seeded demo data — not customers ${st("SR", "repo")}`,
        `Unknown is not zero ${st("UN")}`,
      ],
    ),
  },
  {
    id: "planning",
    title: "Planning assumptions — not actual results",
    uses: ["US$6,000/yr per investor org, US$600/yr Pro, 5% conversion (ASSUMPTION, research §13)", "scenario arithmetic (ASSUMPTION)", "unit costs (UNKNOWN, research §14)"],
    html: memo(
      "13",
      "Planning assumptions",
      `Planning assumptions — not actual results`,
      `<p style="margin:-6px 0 16px">No prices, revenue or costs exist in any source. These scenarios only scale the research’s illustrative inputs.</p>
       <table class="t" style="font-size:14.5px">
        <tr><th>Scenario ${st("AS")}</th><th>Investor orgs × US$6,000</th><th>Founder Pro × US$600</th><th>ARR</th></tr>
        <tr><td>Early</td><td class="n">25 → $0.15M</td><td class="n">250 → $0.15M</td><td class="n">$0.30M</td></tr>
        <tr><td>Research SOM</td><td class="n">75 → $0.45M</td><td class="n">250 → $0.15M</td><td class="n">$0.60M</td></tr>
        <tr><td>Full SAM</td><td class="n">1,500 → $9.0M</td><td class="n">1,000 → $0.6M</td><td class="n">$9.6M</td></tr>
       </table>
       <p class="small" style="margin-top:10px">Founder counts: 250 = 25% of the 1,000 Pro buyers in SAM (20,000 × 5%). Excludes any facilitation fee and FDN execution services.</p>`,
      [
        `All inputs are analyst assumptions ${st("AS")}`,
        `Cost drivers: model inference, voice and video vendors, video CDN, four services, hosted database ${st("SR", "research §14")}`,
        `Cost per active user ${st("UN")}`,
        `Layer 3 is services revenue with people cost ${st("OP")}`,
      ],
    ),
  },
  {
    id: "roadmap",
    title: "Roadmap & scalability",
    uses: ["repository roadmap items (research §16)", "analyst options (ASSUMPTION)", "capital intensity (research §14)"],
    html: memo(
      "14",
      "Roadmap",
      `Next: calibrate the method on real companies, then switch on billing.`,
      `<div class="g2">
        <div><h3>from the repository and handoff</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">InvestIQ calibration on an FDN pilot (v2)</li>
          <li style="font-size:15.5px">Unicorn inputs v4 and evidence-gap prompts</li>
          <li style="font-size:15.5px">Relationship Hub H2 · billing activation (ADR 0034)</li>
          <li style="font-size:15.5px">A custom app domain · certified Q Pitch tour</li></ul></div>
        <div><h3>analyst options ${st("AS")}</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">White-label GateQ for accelerators and investment-promotion agencies</li>
          <li style="font-size:15.5px">FDN-led pilot cohort to produce verified evidence and first calibrated scores</li>
          <li style="font-size:15.5px">Registry and accounting data partners to lift evidence status</li></ul></div>
       </div>
       <p style="margin-top:16px;font-size:15.5px"><b>Scalability.</b> Software-light, model-heavy: the gated features are exactly the model-heavy ones, so cost scales with paid use.</p>`,
      [
        `Roadmap items — research §16 from STATE.md / ACTIVE-TASKS.md ${st("SR", "repo")}`,
        `Q Pitch claims are limited to its certification manifest; none is claimed here ${st("SR", "repo rule")}`,
        `Calibration timeline ${st("UN")}`,
      ],
    ),
  },
  {
    id: "team",
    title: "Team & founders",
    uses: ["cofounders Zino Mario and David Nwankwo (OWNER_PROVIDED)", "FDN team page roles (SELF_REPORTED)", "Fortune Nwankwo role in Capital Q (UNKNOWN)"],
    html: memo(
      "15",
      "Team",
      `Cofounders from private capital and aviation operations.`,
      `<div class="g2">
        <div><div class="serif" style="font-size:30px;margin-bottom:4px">Zino Mario</div><div style="margin-bottom:10px">Cofounder ${st("OP")}</div><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Partner (Vision, Growth & Governance), FDN Capital Partners ${st("SR", "FDN team page")}</li>
          <li style="font-size:15.5px">Founder and CEO of Zino Aviation, Lagos ${st("VP", "press")}</li>
          <li style="font-size:15.5px">His personal site does not list Capital Q ${st("VP", "observed")}</li></ul></div>
        <div><div class="serif" style="font-size:30px;margin-bottom:4px">David Nwankwo</div><div style="margin-bottom:10px">Cofounder ${st("OP")}</div><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Managing Partner (Strategy, Capital & Ecosystem), FDN Capital Partners ${st("SR", "FDN team page")}</li>
          <li style="font-size:15.5px">Credited on the FDN team page with creating Capital Q ${st("SR")}</li>
          <li style="font-size:15.5px">Background in private capital, wealth management, investment immigration and venture advisory ${st("SR")}</li></ul></div>
       </div>`,
      [
        `Cofounder roles — owner-provided ${st("OP")}`,
        `Fortune Nwankwo, Partner (Operations, Product & Venture Execution) at FDN; role in Capital Q ${st("UN")}`,
        `Cap table and roles ${st("UN")}`,
      ],
    ),
  },
  {
    id: "risks",
    title: "Key risks & mitigations (incl. regulatory)",
    uses: ["risks 1-7 (research §15)", "mitigations (ASSUMPTION; PADL #74 human advisory)"],
    html: wide(
      "16",
      "Risks",
      `The hardest risks are regulatory and evidential — and both are named.`,
      `<table class="t" style="font-size:13.5px">
        <tr><th style="width:27%">Risk</th><th style="width:42%">Why it matters</th><th>Mitigation ${st("AS")}</th></tr>
        <tr><td><b>Investment-advice and securities rules</b> — Nigeria SEC (ISA 2025), QFC/QFMA, EU MiFID/ECSP, US</td><td>Matching, scoring investability and a facilitation fee may trigger broker, adviser or crowdfunding regimes</td><td>Capital-form advice stays with human FDN advisory (PADL #74); legal analysis before any success fee</td></tr>
        <tr><td><b>Score credibility</b></td><td>InvestIQ constants uncalibrated; Unicorn Potential has 0 numeric production scores; landing-page example values are illustrative</td><td>Coverage gates; calibrate on an FDN pilot; never market as prediction</td></tr>
        <tr><td><b>Data protection</b> — GDPR, NDPA 2023, Qatar PDPPL</td><td>Founder-private financial data; EU residency</td><td>Context Firewall at retrieval, feature and database layers</td></tr>
        <tr><td><b>Ownership, naming and IP</b></td><td>Legal owner of the product unknown; InvestIQ belongs to FDN; ™ marks unregistered as far as known</td><td>Entity, IP assignment and FDN agreement before a raise</td></tr>
        <tr><td><b>Operational maturity</b></td><td>Recent merge collisions broke production builds; credentials needing rotation</td><td>Release gates; rotate credentials</td></tr>
        <tr><td><b>Two-sided cold start; model-vendor dependency</b></td><td>Value needs evidence-rich companies and active investors; voice and video rely on vendors</td><td>FDN-seeded cohort; gateway abstraction over providers</td></tr>
       </table>`,
    ),
  },
  {
    id: "funding",
    title: "Funding: to be confirmed by the founders",
    uses: ["funding, round, valuation (UNKNOWN)", "legal entity and FDN relationship (UNKNOWN)"],
    html: memo(
      "17",
      "Funding",
      `Funding: <em>to be confirmed by the founders.</em>`,
      `<p style="margin-bottom:16px">No raise, round size, valuation or use of funds is established in any source, and none is assumed here.</p>
       <h3>what the founders need to supply</h3>
       <ul class="lst">
        <li>The legal entity that owns Capital Q’s IP and contracts with customers, and its relationship to FDN Capital Partners</li>
        <li>Amount sought, instrument, valuation expectations and cap table</li>
        <li>Use of funds by line: calibration pilot, go-to-market, regulatory counsel, model and media costs</li>
        <li>Runway and monthly burn; funding raised to date</li>
       </ul>`,
      [
        `Legal entity ${st("UN")}`,
        `Commercial terms between FDN and Capital Q ${st("UN")}`,
        `Funding raised to date ${st("UN")}`,
      ],
    ),
  },
  {
    id: "next",
    title: "Investment opportunity & next steps",
    uses: ["thesis summary", "open questions 1-7 (research §17)"],
    html: memo(
      "18",
      "Opportunity",
      `A deployed, evidence-first operating system for private capital — ready for its first calibrated cohort.`,
      `<div class="g2">
        <div><h3>the opportunity</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Deployed product across founders, investors and gateways ${stage("dep", "deployed")}</li>
          <li style="font-size:15.5px">A large asset class adopting AI in deal work ${st("VP")}</li>
          <li style="font-size:15.5px">Trust architecture as a product feature ${st("SR")}</li>
          <li style="font-size:15.5px">A distribution and execution partner in FDN ${st("OP")}</li></ul></div>
        <div><h3>next steps</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Entity, IP and FDN agreement</li>
          <li style="font-size:15.5px">Pricing and facilitation-fee decision with regulatory analysis</li>
          <li style="font-size:15.5px">Waitlist, pilots and any LOIs</li>
          <li style="font-size:15.5px">Calibration timeline; trademark status</li></ul></div>
       </div>`,
      [
        `Public page: fdncapitalpartners.com/capitalq/ ${st("VP")}`,
        `App host is a platform default hostname, not a brand domain; no custom domain designated ${st("UN", "domain")}`,
        `Open questions — research §17`,
      ],
    ),
  },
  {
    id: "sources",
    title: "Sources & evidence status",
    uses: ["all sources and fetch dates (facts.json)"],
    html: (ctx) => `${head("§19 Sources")}<div class="body" style="width:auto;right:64px"><div class="sec">§19 — Sources & evidence status</div>
      <div class="g2" style="grid-template-columns:1.55fr 1fr;gap:32px">
       <table class="t" style="font-size:11.5px">
        <tr><th>Source (web fetched 2026-10-18 UTC; repo at build/int-rc cb7b20969)</th><th>Status</th></tr>
        <tr><td>fdncapitalpartners.com/capitalq/ (200) · /capitalq.html (404) · /team/ · /contact/</td><td>${st("VP")} ${st("SR")}</td></tr>
        <tr><td>businesswire.com/news/home/20241216468500/en (BlackRock outlook)</td><td>${st("VP")}</td></tr>
        <tr><td>committees.parliament.uk/writtenevidence/157389/html/ (Preqin)</td><td>${st("VP")}</td></tr>
        <tr><td>ecofinagency.com/news-finances/1402-52907-africa-vc-funding-climbs-to-3-9bn-in-2025-led-by-local-funds-avca</td><td>${st("VP")}</td></tr>
        <tr><td>allafrica.com/stories/202601250064.html (Partech) · businessday.ng (Africa: The Big Deal)</td><td>${st("VP")}</td></tr>
        <tr><td>deloitte.com/us/en/about/press-room/deloitte-survey-genai-in-mna.html</td><td>${st("VP")}</td></tr>
        <tr><td>docs/product-sources — PADL, Product Specification, Final System Review, GateQ spec</td><td>${st("SR")} ${st("OP")}</td></tr>
        <tr><td>docs/adr — 0014, 0034, 0055, 0059, 0068, 0074, 0076</td><td>${st("SR")}</td></tr>
        <tr><td>docs/ai-handoff — STATE.md, ACTIVE-TASKS.md, DECISIONS.md, PROMISE-COVERAGE.md</td><td>${st("SR")}</td></tr>
        <tr><td>apps/ and packages/ — routes and packages observed</td><td>${stage("", "code observed")}</td></tr>
       </table>
       <div><ul class="lst">
          <li style="font-size:13px;padding:6px 0">${st("VP")} independent record or third-party publication</li>
          <li style="font-size:13px;padding:6px 0">${st("SR")} company, owner source or repository record</li>
          <li style="font-size:13px;padding:6px 0">${st("OP")} supplied by the Capital Q owner</li>
          <li style="font-size:13px;padding:6px 0">${st("AS")} analyst arithmetic or inference</li>
          <li style="font-size:13px;padding:6px 0">${st("UN")} not established; never read as zero</li>
          <li style="font-size:13px;padding:6px 0">${stage("live", "live verified")} ${stage("dep", "deployed")} ${stage("", "code observed")} engineering stages</li></ul>
        <p class="small" style="margin-top:10px;font-size:11.5px">Prepared offline from docs/flagship/capital-q/research.md and facts.json; no production systems or provider APIs used. Marks: apps/web/app/icon.svg and the outlined “Capital” wordmark from the repository. No FDN-hosted imagery used.</p></div>
      </div></div>${foot(ctx)}`,
  },
];

export default {
  slug: "capital-q",
  company: "Capital Q",
  title: "Capital Q — Investor deck",
  fonts: [
    ["Geist Mono", "GeistMono-Regular.ttf", 400],
    ["Geist Mono", "GeistMono-Bold.ttf", 700],
    ["Lora", "Lora-Regular.ttf", 400],
    ["Lora", "Lora-Italic.ttf", 400, "italic"],
    ["Lora", "Lora-Bold.ttf", 700],
  ],
  css,
  slides,
  readme: {
    direction:
      "Capital Q's own light-first tokens (canvas #FBFAF7, text #101419, accent #1767D1, borders #CED1D6), with the stage canvas #0B0F18 only on the title. Narrative device: an investment memorandum — numbered § sections, editorial serif headlines, and a right-hand evidence margin on each slide that cites the repository or public source and its status. Engineering claims carry evidence stages (code observed / deployed / live verified / not verified) as in the research.",
    brand: [
      "Colours from `brand.json` (packages/ui/src/tokens/tokens.css, hex approximations of OKLCH). UI font is the `--cq-font-ui` system stack (renders as Liberation Sans offline); editorial serif is `--cq-font-editorial` Georgia with Lora (OFL) as the offline stand-in; Geist Mono is the app's local mono.",
      "Official owner marks from the repository: `apps/web/app/icon.svg` (gold Q icon) and the outlined \"Capital\" wordmark path from `apps/web/src/features/splash/capital-wordmark.tsx`, read at build time. The Q mark is the word-mark in an accent frame, never a sparkle or orb.",
      "No FDN-hosted landing imagery (needs FDN permission). No product screenshots.",
    ],
    omitted: [
      "Paying customers, revenue, waitlist size, pilots, LOIs, prices, funding: UNKNOWN.",
      "Shiftwell, Tensorgate and other companies in scoring audits: seeded demo data, not customers.",
      "Invest Qatar / 'Qatar Five': demo entities, presented only as 'not partnerships'.",
      "Unicorn Potential is never called a predictor; landing-page example values (e.g. 92%) not used.",
      "Railway app hostname not presented as the official site; capitalq.ai / capitalq.com not used.",
      "Cofounder surname: the research flagged an owner-provided 'Okonkwo' vs FDN's 'Nwankwo'; the deck uses David Nwankwo per the owner's brief, matching the FDN team page.",
      "Q Pitch features: none claimed (governed by its certification manifest).",
    ],
  },
};
