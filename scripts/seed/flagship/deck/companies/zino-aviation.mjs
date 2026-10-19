// Zino Aviation investor deck. Facts: docs/flagship/zino-aviation/{research.md,facts.json,brand.json} only.
// Design: the Jet site's palette (gold #B59B48 / light #D9C48A / dark #8A7434, charcoal #222222 / #141414,
// cream #F6F4EF, line #E7E2D6, ink-soft #7A7A7A). GT Alpina is commercial and Poppins/Cormorant are not available
// offline, so display serif is Crimson Pro and sans is Outfit (both OFL, in ./fonts).
// Narrative device: a flight plan — the deck is a route from departure (thesis) to arrival (next steps), with a
// waypoint bar along the bottom of every slide. Service status uses the research's own vocabulary
// (ACTIVE / MARKETED / PLANNED / PARTNER-DELIVERED) alongside the evidence statuses.
import { esc, st } from "../lib.mjs";

const css = `
:root{--gold:#B59B48;--goldl:#D9C48A;--goldd:#8A7434;--ink:#222222;--ink2:#141414;--soft:#7A7A7A;--paper:#FFFFFF;--cream:#F6F4EF;--line:#E7E2D6;--t2:#4A4740}
body{font-family:Outfit,Poppins,"Segoe UI",sans-serif;color:var(--ink)}
.slide{background:var(--cream)}
.serif{font-family:"Crimson Pro","GT Alpina","Cormorant Garamond",Georgia,serif}
.wm{font-family:"Crimson Pro",Georgia,serif;font-weight:700;font-size:26px;letter-spacing:.2em;color:var(--gold)}
.wm small{font-family:Outfit,sans-serif;font-weight:400;font-size:11px;letter-spacing:.32em;color:var(--soft);margin-left:10px}
.top{position:absolute;left:64px;right:64px;top:30px;display:flex;justify-content:space-between;align-items:baseline;padding-bottom:12px;border-bottom:1px solid var(--line)}
.top .leg{font-size:12.5px;color:var(--soft)}
.top .leg b{color:var(--goldd);font-weight:600}
.box{position:absolute;left:64px;right:64px;top:88px;bottom:84px}
h2{font-family:"Crimson Pro",Georgia,serif;font-weight:400;font-size:46px;line-height:1.06;letter-spacing:-.005em;margin-bottom:20px;color:var(--ink2);max-width:1080px}
h2 i{color:var(--goldd)}
p{font-size:17px;line-height:1.5;color:var(--t2)}
p b,li b,td b{color:var(--ink2);font-weight:600}
.small{font-size:13.5px;color:var(--soft);line-height:1.45}
.route{position:absolute;left:64px;right:64px;bottom:46px;height:14px}
.route .ln{position:absolute;left:0;right:0;top:6px;border-top:1px dashed #CFC6B0}
.route .done{position:absolute;left:0;top:5px;border-top:3px solid var(--gold)}
.route i{position:absolute;top:2px;width:10px;height:10px;border-radius:50%;background:var(--cream);border:2px solid #CFC6B0;margin-left:-5px}
.route i.p{border-color:var(--gold);background:var(--gold)}
.route i.c{width:14px;height:14px;top:0;margin-left:-7px;border-color:var(--goldd);background:var(--paper)}
.foot{position:absolute;left:64px;right:64px;bottom:18px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--soft)}
.st{font-size:11.5px;white-space:nowrap;font-weight:500;letter-spacing:.01em;color:var(--t2);line-height:1.25}
.st::before{content:"";display:inline-block;width:7px;height:7px;margin-right:5px;vertical-align:1px}
.st-VP::before{background:#2F6B45;border-radius:50%}.st-VP{color:#2F6B45}
.st-SR::before,.st-PT::before{border:1.5px solid var(--goldd);border-radius:50%}.st-SR,.st-PT{color:var(--goldd)}
.st-OP::before{background:#9A5B12}.st-OP{color:#9A5B12}
.st-AS::before{border:1.5px solid var(--t2);transform:rotate(45deg)}
.st-UN::before{border:1.5px dashed var(--soft)}.st-UN{color:var(--soft)}
.svc{font-size:11px;font-weight:600;letter-spacing:.02em;padding:2px 7px;border-radius:2px;white-space:nowrap}
.svc.A{background:#2F6B45;color:#fff}.svc.M{background:var(--goldl);color:var(--ink2)}.svc.P{border:1px dashed var(--soft);color:var(--t2)}.svc.D{border:1px solid var(--ink);color:var(--ink)}.svc.U{border:1px dashed var(--soft);color:var(--soft)}
table.t{width:100%;font-size:14.5px;background:var(--paper)}
table.t th{text-align:left;font-weight:600;color:var(--goldd);font-size:12.5px;padding:10px 12px 8px;border-bottom:1px solid var(--gold)}
table.t td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.38;color:var(--t2)}
table.t td.n{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink2)}
.lst li{font-size:16.5px;line-height:1.45;padding:10px 0;border-top:1px solid var(--line);color:var(--t2)}
.lst li:last-child{border-bottom:1px solid var(--line)}
h3{font-size:14px;font-weight:600;color:var(--goldd);margin-bottom:8px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}
.fig{border-top:1px solid var(--gold);padding-top:12px}
.fig .v{font-family:"Crimson Pro",Georgia,serif;font-size:56px;line-height:1;color:var(--ink2)}
.fig .l{font-size:15px;line-height:1.42;color:var(--t2);margin-top:8px}
.path{display:grid;grid-template-columns:repeat(7,1fr);gap:0;margin-top:6px}
.path>div{border-top:3px solid var(--gold);padding:12px 14px 0 0;position:relative}
.path>div::before{content:"";position:absolute;left:0;top:-8px;width:11px;height:11px;border-radius:50%;background:var(--gold)}
.path .n{font-size:12px;color:var(--goldd);font-weight:600;margin-bottom:4px}
.path .h{font-family:"Crimson Pro",Georgia,serif;font-size:21px;line-height:1.1;color:var(--ink2);margin-bottom:6px}
.path p{font-size:13.5px;line-height:1.4}
.arith>div{display:grid;grid-template-columns:150px 1fr 190px;gap:16px;padding:11px 0;border-top:1px solid var(--line);align-items:baseline}
.arith>div:last-child{border-bottom:1px solid var(--line)}
.arith .k{font-weight:600;font-size:14px;color:var(--goldd)}
.arith .x{font-size:15px;color:var(--t2);line-height:1.4}
.arith .r{text-align:right;font-family:"Crimson Pro",Georgia,serif;font-size:25px;color:var(--ink2)}
/* dark slides */
.dark{background:var(--ink2)!important;color:var(--cream)}
.dark h2{color:var(--cream)}.dark h2 i{color:var(--goldl)}
.dark p{color:#CFCAC0}.dark .small,.dark .foot,.dark .top .leg{color:#9C978C}.dark .top{border-color:#33312C}
.dark .route .ln{border-color:#4A473F}.dark .route i{background:var(--ink2);border-color:#4A473F}.dark .route i.p{background:var(--gold);border-color:var(--gold)}.dark .route i.c{background:var(--ink2);border-color:var(--goldl)}
.dark .st{color:#CFCAC0}.dark .st-SR{color:var(--goldl)}.dark .st-SR::before{border-color:var(--goldl)}.dark .st-VP{color:#8CC7A0}.dark .st-VP::before{background:#8CC7A0}.dark .st-OP{color:#E3B26A}.dark .st-OP::before{background:#E3B26A}
.dark .fig .v{color:var(--cream)}.dark .fig .l{color:#CFCAC0}.dark .lst li{color:#CFCAC0;border-color:#33312C}.dark .lst li b{color:var(--cream)}
/* title */
.s-title .wmb{position:absolute;left:72px;top:58px}
.s-title .wmb .wm{font-size:34px}
.s-title h1{position:absolute;left:72px;top:170px;width:820px;font-family:"Crimson Pro",Georgia,serif;font-weight:400;font-size:66px;line-height:1.02;color:var(--cream)}
.s-title h1 i{color:var(--goldl)}
.s-title .sub{position:absolute;left:72px;top:400px;width:720px;font-size:19px;line-height:1.5;color:#CFCAC0}
.s-title .card{position:absolute;right:72px;top:170px;width:290px;border-top:1px solid var(--gold);padding-top:14px;font-size:13.5px;line-height:1.65;color:#CFCAC0}
.s-title .card b{color:var(--cream);font-weight:600}
`;

const LEGS = [
  "Departure",
  "Company record",
  "Problem",
  "Solution",
  "Academy",
  "Jet",
  "Market",
  "Sizing",
  "Model",
  "Segments",
  "Competition",
  "Defensibility",
  "Traction",
  "Planning",
  "Partners",
  "Roadmap",
  "Team",
  "Risks",
  "Funding",
  "Arrival",
  "Sources",
];

const route = (i, n) => {
  const pct = (k) => ((k - 1) / (n - 1)) * 100;
  const dots = Array.from(
    { length: n },
    (_, k) =>
      `<i class="${k + 1 < i ? "p" : k + 1 === i ? "c" : ""}" style="left:${pct(k + 1)}%"></i>`,
  ).join("");
  return `<div class="route" aria-hidden="true"><div class="ln"></div><div class="done" style="width:${pct(i)}%"></div>${dots}</div>`;
};

const frame = (body) => (ctx) =>
  `<div class="top"><span class="wm">ZINO<small>AVIATION</small></span><span class="leg">Leg ${String(ctx.i).padStart(2, "0")} · <b>${esc(LEGS[ctx.i - 1])}</b></span></div>
   <div class="box">${body}</div>${route(ctx.i, ctx.n)}
   <div class="foot"><span>Zino Aviation · Investor deck · October 2026 · prepared offline from public sources</span><span>${String(ctx.i).padStart(2, "0")} / ${ctx.n}</span></div>`;

const svc = (k) => {
  const m = {
    A: "Active",
    M: "Marketed",
    P: "Planned",
    D: "Partner-delivered",
    U: "Unknown",
  };
  return `<span class="svc ${k}">${m[k]}</span>`;
};

const slides = [
  {
    id: "title dark",
    title:
      "Thesis — a pilot-career business with evidence, and a private-aviation brand still taking off",
    uses: [
      "proposition and divisions (SELF_REPORTED)",
      "Academy operating evidence vs Jet 'Coming Soon' (research §1, §7)",
      "founder & CEO (VERIFIED_PUBLIC register)",
      "cofounder/COO per ThisDay",
    ],
    html: (ctx) => `
      <div class="wmb"><span class="wm">ZINO<small>AVIATION</small></span></div>
      <h1>Africa needs pilots. Zino Aviation has spent years <i>guiding them in.</i></h1>
      <div class="sub">A Lagos-based aviation services business with two divisions: <b style="color:var(--cream)">Academy</b>, a pilot-career consultancy with years of public evidence of operation, and <b style="color:var(--cream)">Jet</b>, a private-aviation advisory and brokerage brand launched in October 2026 whose services are mostly marketed or coming soon.</div>
      <div class="card"><b>Investor deck</b> · October 2026<br><br><b>Founder & CEO</b><br>Capt. Zino Mario ${st("VP", "UK register")}<br><br><b>Co-founder & COO</b><br>Temisan Mario — as named by ThisDay (2022) ${st("VP", "press")}<br><br>Operating base: Lagos, Nigeria ${st("SR")}</div>
      ${route(ctx.i, ctx.n)}
      <div class="foot"><span>Every claim carries its evidence status. Licences, aircraft, partnerships and placements stay claims unless independently confirmed.</span><span>01 / ${ctx.n}</span></div>`,
  },
  {
    id: "record",
    title: "Company record — what is registered, and what is not",
    uses: [
      "ZINO AVIATION LTD 13100002, inc 2020-12-24, Edgware, SIC 70229, directors, accounts overdue (VERIFIED_PUBLIC, Companies House)",
      "founded 2018 (SELF_REPORTED)",
      "Nigerian CAC entity (UNKNOWN)",
      "Zino Group (SELF_REPORTED, no entity)",
    ],
    html: frame(`<h2>One registered UK company. The Nigerian entity is <i>still to be shown.</i></h2>
      <div class="g2" style="gap:48px">
        <div><h3>Verified on the UK register ${st("VP")}</h3><ul class="lst">
          <li><b>ZINO AVIATION LTD</b>, England & Wales, company 13100002, active, private limited</li>
          <li>Incorporated <b>24 December 2020</b>; registered office Edgware, Middlesex; SIC 70229 management consultancy</li>
          <li>Directors Efezino Mario-Ghae and Temisan Mario-Ghae, both appointed 2020-12-24</li>
          <li>Accounts <b>overdue</b>: FY to 2025-12-31 was due 2026-09-30</li></ul></div>
        <div><h3>Claimed or not yet found</h3><ul class="lst">
          <li>Founded in <b>2018</b>, per the Academy site ${st("SR")}</li>
          <li>Nigerian CAC registration and RC number ${st("UN")}</li>
          <li>“Zino Group” used in job adverts; no registered group entity found ${st("SR")}</li>
          <li>Jet and Academy are trading divisions of one brand, not separate companies ${st("AS")}</li></ul></div>
      </div>
      <p class="small" style="margin-top:14px">Which legal entity contracts with Nigerian customers — and holds any Nigerian permits — is the first document to obtain.</p>`),
  },
  {
    id: "problem",
    title:
      "Problem — pilot demand is large, but the path to the flight deck is costly and unguided",
    uses: [
      "Boeing 2025 outlook: 23,000 new pilots in Africa, ~660,000 global (VERIFIED_PUBLIC)",
      "tuition priced in USD/EUR/ZAR (SELF_REPORTED published prices)",
      "no pilot-loan system; type ratings US$15-25k; many licensed pilots unemployed (SELF_REPORTED, CEO in Nairametrics)",
    ],
    html: frame(`<h2>Demand for pilots is real. <i>The route there is expensive, foreign-priced and hard to navigate.</i></h2>
      <div class="g3">
        <div class="fig"><div class="v">23,000</div><div class="l">New pilots Africa needs over 2025–2044, of about 660,000 globally (Boeing Pilot & Technician Outlook 2025).</div><div style="margin-top:10px">${st("VP", "Boeing")}</div></div>
        <div class="fig"><div class="v">$45k–€72.5k</div><div class="l">Range of partner-school ab-initio programme prices Zino publishes — in USD, EUR and ZAR, while most customers earn naira.</div><div style="margin-top:10px">${st("SR", "published prices")}</div></div>
        <div class="fig"><div class="v">$15–25k</div><div class="l">Typical type-rating cost, with no pilot-loan system — and, the CEO says, many licensed Nigerian pilots still unemployed.</div><div style="margin-top:10px">${st("SR", "CEO, Nairametrics 2026")}</div></div>
      </div>
      <p class="small" style="margin-top:24px">A later Boeing Africa forecast (2026–2045) cites 22,000; the two windows are not mixed here.</p>`),
  },
  {
    id: "solution",
    title:
      "Solution — an end-to-end pilot-career pathway, delivered with partner schools",
    uses: [
      "Academy funnel (research §8)",
      "service list and partner delivery (SELF_REPORTED, academy.zinoaviation.com)",
    ],
    html: frame(`<h2>One guide from first webinar to first job — <i>with partners flying the training.</i></h2>
      <div class="path">
        <div><div class="n">01</div><div class="h">Webinar & call</div><p>Free webinar; paid 1-on-1 calls with Capt. Zino</p></div>
        <div><div class="n">02</div><div class="h">Masterclass</div><p>Online Pilot Masterclass and Employment Bootcamp</p></div>
        <div><div class="n">03</div><div class="h">Mentorship</div><p>Pilot Mentorship Programme</p></div>
        <div><div class="n">04</div><div class="h">Ground & sim</div><p>Ground school and simulator sessions in Lagos</p></div>
        <div><div class="n">05</div><div class="h">Flight school</div><p>SACAA and EASA programmes at partner schools</p></div>
        <div><div class="n">06</div><div class="h">Type rating</div><p>Via partner ATOs; prep CBT course</p></div>
        <div><div class="n">07</div><div class="h">Employment</div><p>Assessment and referral to airlines and operators</p></div>
      </div>
      <div class="g2" style="margin-top:28px">
        <p>${st("SR")} Funnel as described across academy.zinoaviation.com (fetched 2026-10-18). Flight training, type ratings and medicals are <b>partner-delivered</b>; Zino is not evidenced as an approved training organisation.</p>
        <p>${st("SR")} Also marketed: logistics management for governments, parastatals and airlines running cadet programmes — no client is named.</p>
      </div>`),
  },
  {
    id: "academy",
    title: "Working product: Academy — services by evidence of operation",
    uses: [
      "Academy services table with ACTIVE/MARKETED/PLANNED/PARTNER-DELIVERED (research §7)",
      "737NG ownership SELF_REPORTED; FSTD qualification UNKNOWN",
    ],
    html: frame(`<h2 style="font-size:38px">Academy: the operating core.</h2>
      <table class="t" style="font-size:13.5px">
        <tr><th style="width:30%">Service</th><th style="width:16%">Status</th><th>Evidence</th></tr>
        <tr><td><b>Pilot mentorship; 1-on-1 calls</b></td><td>${svc("A")}</td><td>Dedicated page with named testimonials; calls bookable at ₦95,000 / 30 min and ₦150,000 / 1 hr ${st("SR")}</td></tr>
        <tr><td><b>Masterclass, bootcamp, webinar</b></td><td>${svc("A")}</td><td>Pages live; ThisDay reported an in-person Lagos masterclass in 2022 ${st("VP", "press")}</td></tr>
        <tr><td><b>Simulator experience, Lagos</b></td><td>${svc("A")}</td><td>Bookable; Mon–Fri 9–6, Sat 8–12; about 1h30 sessions; gift certificates ${st("SR")}</td></tr>
        <tr><td><b>Boeing 737NG simulator</b></td><td>${svc("U")}</td><td>Ownership claimed by the founder; <b>no NCAA or EASA FSTD qualification found</b> — not a qualified training device ${st("SR")}</td></tr>
        <tr><td><b>Ground school</b></td><td>${svc("A")}</td><td>Job advert for a Ground & Simulator Instructor in VI, Lagos ${st("SR")}</td></tr>
        <tr><td><b>Flight training; type ratings; medicals</b></td><td>${svc("D")}</td><td>Partner schools SafeFly Express and TAE Aviation Academy; unnamed ATOs and AMEs ${st("SR")}</td></tr>
        <tr><td><b>Recruitment; logistics; aptitude</b></td><td>${svc("M")}</td><td>“Established agreements with airlines” claimed; none named ${st("SR")}</td></tr>
        <tr><td><b>Pilot funding / loans</b></td><td>${svc("P")}</td><td>CEO: “working on” with banks, airlines and governments ${st("SR")}</td></tr>
      </table>`),
  },
  {
    id: "jet",
    title: "Working product: Jet — marketed and coming soon; no AOC",
    uses: [
      "Jet services table (research §7)",
      "site build Oct 2026 (VERIFIED_PUBLIC observation)",
      "AOC (UNKNOWN — none found)",
      "aircraft owned (UNKNOWN)",
    ],
    html: frame(`<h2 style="font-size:38px">Jet: “Private Aviation, Simplified.” <i>Launched, not yet evidenced.</i></h2>
      <table class="t" style="font-size:13.5px">
        <tr><th style="width:30%">Service</th><th style="width:16%">Status</th><th>Evidence</th></tr>
        <tr><td><b>Private jet charter</b></td><td>${svc("M")}</td><td>Quote form live. No aircraft, operator, AOC holder or completed flight named — would have to be flown by an AOC holder ${st("SR")}</td></tr>
        <tr><td><b>Aircraft acquisition · JetVault</b></td><td>${svc("M")}</td><td>Experience Centre and digital platform described; no address, no evidence the platform is live ${st("SR")}</td></tr>
        <tr><td><b>The Journey Concierge™</b></td><td>${svc("M")}</td><td>10+ concierge solutions, delivered by third parties; trademark status unknown ${st("SR")}</td></tr>
        <tr><td><b>Advisory for HNW clients</b></td><td>${svc("M")}</td><td>Homepage copy and contact form; Advisory page “coming soon” ${st("SR")}</td></tr>
        <tr><td><b>Sales, management, financing, interiors</b></td><td>${svc("P")}</td><td>Links lead to coming-soon.html ${st("SR")}</td></tr>
        <tr><td><b>ZinoJet Network; Knowledge Centre</b></td><td>${svc("P")}</td><td>Homepage only; no network members named ${st("SR")}</td></tr>
        <tr><td><b>Privacy policy and terms</b></td><td>${svc("P")}</td><td>Coming soon — while the site collects personal data ${st("VP", "observed")}</td></tr>
       </table>
       <p class="small" style="margin-top:10px">Site stylesheets versioned 20261006 (early October 2026) ${st("VP", "observed")}. No AOC held by any Zino entity was found ${st("UN")}; no aircraft owned is described ${st("UN")}. This deck does not state or imply either.</p>`),
  },
  {
    id: "market dark",
    title: "Market context — pilot demand and Nigeria's private fleet",
    uses: [
      "Boeing 23,000 Africa / ~660,000 global 2025-2044; 22,000 for 2026-2045 (VERIFIED_PUBLIC)",
      "Nigeria private jets ~240 (Minister, reported) vs over 157 by 2024 (AllAfrica) — conflicting",
      "36 private jet operators (BusinessDay, undated)",
    ],
    html: frame(`<h2>Two markets, both with public numbers — <i>and the jet numbers disagree.</i></h2>
      <div class="g4">
        <div class="fig"><div class="v">23,000</div><div class="l">New pilots Africa needs, 2025–2044 (Boeing). ~660,000 globally.</div></div>
        <div class="fig"><div class="v">22,000</div><div class="l">Boeing’s later Africa forecast for 2026–2045 (via AFM). A different window.</div></div>
        <div class="fig"><div class="v">~240</div><div class="l">Private jets operating in Nigeria — Minister Festus Keyamo, as reported. Another source: “over 157 by 2024”.</div></div>
        <div class="fig"><div class="v">36</div><div class="l">Private jet operators in Nigeria, per a BusinessDay report (undated in results).</div></div>
      </div>
      <p class="small" style="margin-top:26px;line-height:1.7">${st("VP")} investors.boeing.com (2025 Pilot & Technician Outlook) · afm.aero/boeing-forecasts-africa-will-need-22000-new-pilots-as-fleet-more-than-doubles-by-2045 · ground.news (Keyamo) · allafrica.com/stories/202603200305.html · businessday.ng (private charter uptake) · fetched 2026-10-18. Registered and operating fleet definitions differ; no figure is preferred.</p>`),
  },
  {
    id: "sizing",
    title: "Opportunity sizing — TAM / SAM / SOM (Assumption)",
    uses: [
      "23,000 pilots / 20 years (VERIFIED_PUBLIC input)",
      "all costs, shares, take-rates, fleet turnover and fees (ASSUMPTION, research §13)",
      "Jet SOM (UNKNOWN)",
    ],
    html: frame(`<h2 style="font-size:36px">Academy SOM ≈ US$0.30M/yr · Jet SOM unknown <span class="small" style="font-family:Outfit,sans-serif;display:block;font-size:16px;margin-top:6px">Every percentage, price and count below is an Assumption. TAM and SAM are underlying spend, not Zino revenue.</span></h2>
      <div class="arith">
        <div><span class="k">Academy TAM ${st("AS")}</span><span class="x">23,000 pilots ÷ 20 years ≈ 1,150 new pilots/yr × US$55,000 average ab-initio cost (midpoint of Zino’s published partner prices)</span><span class="r">≈ $63M/yr</span></div>
        <div><span class="k">Academy SAM ${st("AS")}</span><span class="x">Nigeria = 20% → about 230 cadets/yr ≈ US$12.7M tuition; plus US$3,000 ancillary spend per cadet ≈ US$0.7M</span><span class="r">≈ $13.4M/yr combined</span></div>
        <div><span class="k">Academy SOM ${st("AS")}</span><span class="x">15% of Nigerian cadets → about 35/yr × (10% of tuition ≈ US$5,500 + US$3,000 direct services), within 3 years</span><span class="r">≈ $0.30M/yr</span></div>
        <div><span class="k">Jet SAM ${st("AS")}</span><span class="x">160–240 aircraft × 5% turnover = 8–12 deals × 1.5% of US$10M; management: 30% externally managed × US$200k/yr</span><span class="r">$1.2–1.8M + $9.6–14.4M</span></div>
        <div><span class="k">Jet SOM ${st("UN")}</span><span class="x">Unknown until first transactions exist</span><span class="r">—</span></div>
      </div>`),
  },
  {
    id: "model",
    title:
      "Business model — fees on advice and access; tuition passes to partners",
    uses: [
      "call prices NGN 95,000/150,000 (SELF_REPORTED, /call)",
      "partner programme prices incl. inconsistencies (SELF_REPORTED, /sacaa, /easa)",
      "Zino take-rate (UNKNOWN)",
      "Jet revenue streams inferred (UNKNOWN amounts)",
    ],
    html: frame(`<h2>Zino earns fees and commissions — <i>not</i> the full tuition it lists.</h2>
      <div class="g2" style="grid-template-columns:1.15fr 1fr;gap:36px">
        <div><table class="t" style="font-size:13.5px">
          <tr><th>Published price ${st("SR")}</th><th>Amount</th></tr>
          <tr><td>1-on-1 call with Capt. Zino, 30 min / 1 hr</td><td class="n">₦95,000 / ₦150,000</td></tr>
          <tr><td>SACAA 0-CPL, SafeFly Express</td><td class="n">$45,000 <i>and</i> ZAR 875,000 ($54,000)</td></tr>
          <tr><td>SACAA CPL+CFI · SACAA PPL</td><td class="n">ZAR 948,000 ($58,500) · $19,000</td></tr>
          <tr><td>EASA 0-ATPL(f), TAE Aviation Academy</td><td class="n">€65,000 <i>and</i> €62,000</td></tr>
          <tr><td>EASA 0-ATPL+FI · EASA PPL</td><td class="n">€72,500 · €15,000</td></tr>
        </table>
        <p class="small" style="margin-top:8px">Two programmes show two different prices on the same page — a misrepresentation risk to fix.</p></div>
        <div><h3>Revenue streams</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px"><b>Academy:</b> calls, courses and events, mentorship, simulator packages, recruitment and logistics fees ${st("SR")}</li>
          <li style="font-size:15.5px"><b>Partner programmes:</b> Zino’s commission or margin ${st("UN")}</li>
          <li style="font-size:15.5px"><b>Jet:</b> advisory, brokerage, management, charter revenue-share, concierge, interiors and financing fees — inferred from marketed services; none evidenced as earned ${st("UN")}</li></ul></div>
      </div>`),
  },
  {
    id: "segments",
    title: "Segments & distribution",
    uses: [
      "customer groups and funnel (research §8)",
      "payment gateways (SELF_REPORTED)",
      "8,000+ network (SELF_REPORTED, CEO)",
      "homepage counters are template placeholders",
    ],
    html: frame(`<h2>Aspiring pilots first; institutions and HNW clients next.</h2>
      <div class="g3">
        <div><h3>Academy · individuals</h3><ul class="lst"><li>Aspiring pilots, largely Nigerian</li><li>Qualified pilots seeking jobs</li><li>Families and corporates for simulator sessions</li></ul></div>
        <div><h3>Academy · institutions</h3><ul class="lst"><li>Governments and parastatals</li><li>Airlines and private operators</li><li>Assessment, logistics, recruitment</li></ul></div>
        <div><h3>Jet · targets</h3><ul class="lst"><li>HNW individuals and corporates</li><li>Government, diplomatic and medical missions</li><li>Aircraft owners</li></ul></div>
      </div>
      <div class="g2" style="margin-top:20px">
        <p style="font-size:15.5px"><b>Distribution</b> ${st("SR")} — blog, social, TEDx and webinars feed paid calls, masterclasses and mentorship; payment by PayPal, Paystack, DPO or offline. Jet: private consultations, charter quote form, JetVault consultations.</p>
        <p style="font-size:15.5px"><b>Reach</b> — “more than 8,000 aspiring pilots in our network” ${st("SR", "CEO")}. The homepage “1000+” counters are template placeholders, not data.</p>
      </div>`),
  },
  {
    id: "competition",
    title: "Competition — named ATOs, simulator centres and charter brokers",
    uses: [
      "Caverton ATO015 + EASA AW139 Level D FSTD (VERIFIED_PUBLIC, AFM)",
      "Lagos Aviation Academy NCAA ATO (VERIFIED_PUBLIC, Blueprint)",
      "NCAT, IAC Ilorin; PrivateFly, LunaJets (research §12)",
      "Zino differentiation (SELF_REPORTED)",
    ],
    html: frame(`<h2>Competitors hold approvals Zino has not shown. <i>Zino competes on guidance.</i></h2>
      <table class="t" style="font-size:14px">
        <tr><th style="width:30%">Competitor</th><th style="width:44%">Position</th><th>Evidence</th></tr>
        <tr><td><b>Caverton Aviation Training Center</b>, Lagos</td><td>NCAA-approved ATO015 with an EASA-qualified AW139 Level D FSTD</td><td>${st("VP", "AFM report")}</td></tr>
        <tr><td><b>Lagos Aviation Academy</b></td><td>NCAA-approved ATO</td><td>${st("VP", "Blueprint")}</td></tr>
        <tr><td><b>NCAT Zaria; International Aviation College, Ilorin</b></td><td>Nigerian flight colleges</td><td>Named in research</td></tr>
        <tr><td><b>Global flight schools and agents; social-media mentors</b></td><td>Recruit Nigerian students directly</td><td>Category</td></tr>
        <tr><td><b>Charter brokers and operators</b>; PrivateFly, LunaJets</td><td>Private aviation in Nigeria and internationally</td><td>Category</td></tr>
      </table>
      <p style="margin-top:16px;font-size:15.5px"><b>Zino’s claimed difference</b> ${st("SR")} — end-to-end mentorship, cost reduction, an employment network and a Lagos 737NG simulator.</p>`),
  },
  {
    id: "defensibility",
    title: "Defensibility — brand, network and an end-to-end funnel",
    uses: [
      "founder-led brand and media (SELF_REPORTED; ThisDay/Nairametrics coverage VERIFIED_PUBLIC)",
      "funnel and network (SELF_REPORTED)",
      "analyst reading (ASSUMPTION)",
    ],
    html: frame(`<h2>What a competitor cannot easily copy — <i>and what it can.</i></h2>
      <div class="g2" style="gap:48px">
        <div><h3>Hard to copy ${st("AS")}</h3><ul class="lst">
          <li><b>A trusted guide.</b> A pilot-founder brand with press coverage (ThisDay 2022, Nairametrics 2026) and TEDx talks</li>
          <li><b>A funnel already running.</b> Webinar → call → masterclass → mentorship → partner school → job</li>
          <li><b>A claimed 8,000-person network</b> of aspiring pilots ${st("SR")}</li>
          <li><b>A Lagos simulator</b> — if its qualification is proven</li></ul></div>
        <div><h3>Easy to copy or at risk ${st("AS")}</h3><ul class="lst">
          <li>Partner-school brokerage, without exclusive contracts ${st("UN", "terms")}</li>
          <li>Key-person dependence on Capt. Zino</li>
          <li>Jet brokerage and concierge, without named operators</li>
          <li>Approvals that competitors hold and Zino has not shown (ATO, FSTD)</li></ul></div>
      </div>`),
  },
  {
    id: "traction",
    title:
      "Traction & proof points — published testimonials and press, labelled",
    uses: [
      "mentee testimonials (SELF_REPORTED, labelled Published testimonial)",
      "ThisDay 2022 masterclass (VERIFIED_PUBLIC that press reported; sell-out SELF_REPORTED)",
      "8,000+ network, Fuzu 20-50 (SELF_REPORTED)",
      "revenue, students, placements (UNKNOWN)",
    ],
    html: frame(`<h2>Years of visible activity. <i>No audited numbers yet.</i></h2>
      <div class="g2" style="grid-template-columns:1.2fr 1fr;gap:44px">
        <div><ul class="lst">
          <li>Mentee testimonial from a “First Officer, Bristow Group, S76D” ${st("PT")}</li>
          <li>Mentee testimonial from a “First Officer, ATR … Green Africa Airways” ${st("PT")} — employers of mentees, not partners</li>
          <li>In-person Pilot Masterclass in Lagos reported by ThisDay, 2022 ${st("VP", "press")}; “sold out” ${st("SR")}</li>
          <li>Interview with the CEO in Nairametrics, July 2026 ${st("VP", "press")}</li>
          <li>“More than 8,000 aspiring pilots in our network” ${st("SR", "CEO")}; 20–50 staff on Fuzu ${st("SR", "employer")}</li>
          <li>Strategic alliance with SafeFly Express reported by Guardian Nigeria; terms unknown ${st("VP", "press headline")}</li></ul></div>
        <div><h3>Not published</h3><ul class="lst">
          <li>Revenue and margins ${st("UN")}</li>
          <li>Student enrolments and completions ${st("UN")}</li>
          <li>Verified placements ${st("UN")}</li>
          <li>Any Jet transaction or flight ${st("UN")}</li></ul>
          <p class="small" style="margin-top:10px">Do not infer revenue from tuition prices: Zino likely earns a fee or commission.</p></div>
      </div>`),
  },
  {
    id: "planning",
    title: "Planning assumptions — not actual results",
    uses: [
      "research SOM inputs: 35 cadets × (US$5,500 + US$3,000) (ASSUMPTION)",
      "Jet US$150k per deal (ASSUMPTION)",
      "scenario arithmetic (ASSUMPTION)",
      "unit economics, simulator utilisation (UNKNOWN)",
    ],
    html: frame(`<h2>Planning assumptions — not actual results</h2>
      <p style="margin:-8px 0 16px">Zino Aviation publishes no revenue, enrolment or transaction data. These scenarios only scale the research’s illustrative inputs; they are not forecasts and not company figures.</p>
      <div class="g2" style="grid-template-columns:1.25fr 1fr;gap:40px">
        <div><table class="t">
          <tr><th>Scenario ${st("AS")}</th><th>Cadets/yr via Zino</th><th>Per cadet</th><th>Academy revenue</th></tr>
          <tr><td>Early</td><td class="n">15</td><td class="n">$8,500</td><td class="n">$0.13M</td></tr>
          <tr><td>Research SOM</td><td class="n">35</td><td class="n">$8,500</td><td class="n">$0.30M</td></tr>
          <tr><td>Stretch</td><td class="n">70</td><td class="n">$8,500</td><td class="n">$0.60M</td></tr>
          <tr><td>Jet: per brokered deal</td><td class="n">1 deal</td><td class="n">1.5% × $10M</td><td class="n">$0.15M</td></tr>
        </table>
        <p class="small" style="margin-top:8px">Per cadet = 10% of US$55,000 tuition (US$5,500) + US$3,000 direct services. Excludes simulator, institutional and recruitment fees.</p></div>
        <div><h3>Inputs still unknown</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Actual commission or take-rate per partner programme ${st("UN")}</li>
          <li style="font-size:15.5px">Simulator cost, financing and utilisation ${st("UN")}</li>
          <li style="font-size:15.5px">Gross margin by service; CAC by channel ${st("UN")}</li>
          <li style="font-size:15.5px">Conversion: webinar → mentorship → enrolment → placement ${st("UN")}</li></ul></div>
      </div>`),
  },
  {
    id: "partners",
    title: "Partnerships — claimed vs evidenced",
    uses: [
      "partnership table (research §11)",
      "AOC holder required, not named",
    ],
    html: frame(`<h2>Partners named on the site are <i>claims until contracts are shown.</i></h2>
      <table class="t" style="font-size:14px">
        <tr><th style="width:30%">Partner</th><th style="width:34%">Claimed role</th><th>Evidence</th></tr>
        <tr><td><b>SafeFly Express</b>, Lanseria, South Africa</td><td>SACAA flight school, accommodation, employment pathway</td><td>Named on site ${st("SR")}; alliance headline in Guardian Nigeria ${st("VP", "press")}; terms ${st("UN")}</td></tr>
        <tr><td><b>TAE Aviation Academy</b>, Megara, Greece</td><td>EASA ATO for the ATPL programme</td><td>Named on site only ${st("SR")}</td></tr>
        <tr><td><b>Type-rating ATOs; aviation medical examiners</b></td><td>Type ratings; Class 1–3 medicals</td><td>Unnamed ${st("UN")}</td></tr>
        <tr><td><b>“Partner airlines and private jet companies”</b></td><td>Recruitment off-takers</td><td>Unnamed ${st("UN")}</td></tr>
        <tr><td><b>Banks, airlines, governments</b></td><td>Pilot funding, cadet programmes</td><td>“Working on” ${st("SR", "CEO")}</td></tr>
        <tr><td><b>AOC holder for charter</b></td><td>Would operate charter flights</td><td><b>Not named anywhere</b> — required before charter is represented as operational ${st("UN")}</td></tr>
      </table>`),
  },
  {
    id: "roadmap",
    title: "Roadmap & scalability",
    uses: [
      "stated roadmap (SELF_REPORTED, research §16)",
      "analyst options (ASSUMPTION)",
      "capital intensity (research §14)",
    ],
    html: frame(`<h2>From consultancy to <i>“the continent’s leading aviation platform”</i> — the stated ambition.</h2>
      <div class="g2" style="gap:48px">
        <div><h3>Stated by the company ${st("SR")}</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Pilot funding with banks, governments and airlines</li>
          <li style="font-size:15.5px">Airline cadet programmes</li>
          <li style="font-size:15.5px">Africa-wide expansion</li>
          <li style="font-size:15.5px">JetVault digital platform, ZinoJet Network, Knowledge Centre</li></ul></div>
        <div><h3>Options the evidence suggests ${st("AS")}</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Qualify the 737NG device; seek NCAA ATO approval for ground school or MCC</li>
          <li style="font-size:15.5px">Wet-lease simulator time to airlines</li>
          <li style="font-size:15.5px">Publish formal AOC-holder partnerships for charter</li>
          <li style="font-size:15.5px">Recruitment-as-a-service with a named airline; tuition financing</li></ul></div>
      </div>
      <p style="margin-top:14px;font-size:15px"><b>Scalability</b> ${st("AS")} — the Academy is mostly asset-light (partners deliver training); the simulator is the capital exception. Jet stays asset-light as brokerage; operating or owning aircraft would raise capital, insurance and regulatory burden sharply.</p>`),
  },
  {
    id: "team",
    title: "Team & founders",
    uses: [
      "Capt. Zino Mario, founder & CEO; registered name (VERIFIED_PUBLIC)",
      "self-reported background (SELF_REPORTED, unverified superlatives labelled)",
      "Temisan Mario co-founder/COO (ThisDay) and UK director (VERIFIED_PUBLIC)",
      "other ventures (SELF_REPORTED/OWNER_PROVIDED)",
    ],
    html: frame(`<h2>A pilot-founder, and a co-founder on the register.</h2>
      <div class="g2" style="gap:48px">
        <div><div class="serif" style="font-size:32px;color:var(--ink2)">Capt. Zino Mario</div><div style="margin:2px 0 10px;font-size:15px;color:var(--t2)">Founder & CEO · UK director, registered as Efezino Mario-Ghae ${st("VP", "Companies House")}</div><ul class="lst" style="font-size:15px">
          <li style="font-size:15px">Licensed pilot at 18; flew aeroplanes and helicopters incl. offshore Sikorsky S-92; retired from active flying in 2021 ${st("SR")}</li>
          <li style="font-size:15px">“Several thousand flight hours” (ThisDay 2022) ${st("SR", "founder in press")}</li>
          <li style="font-size:15px">EASA, FAA and ICAO licences claimed — numbers and validity not verified ${st("SR")}</li>
          <li style="font-size:15px">“Nigeria’s youngest commercial pilot” — unverified superlative ${st("SR")}</li></ul></div>
        <div><div class="serif" style="font-size:32px;color:var(--ink2)">Temisan Mario</div><div style="margin:2px 0 10px;font-size:15px;color:var(--t2)">Co-founder & Chief Operating Officer, as named by ThisDay (2022) ${st("VP", "press")}</div><ul class="lst" style="font-size:15px">
          <li style="font-size:15px">Director of ZINO AVIATION LTD since 2020-12-24, as Temisan Mario-Ghae ${st("VP", "Companies House")}</li>
          <li style="font-size:15px">Also named COO by Guardian Nigeria (search snippet) ${st("SR")}</li>
          <li style="font-size:15px">Staff: 20–50 per Fuzu employer profile ${st("SR")}</li></ul>
          <p class="small" style="margin-top:10px">Capt. Zino also partners at FDN Capital Partners and founded KUUZA AI and SongScribe AI ${st("SR")}; he is a Capital Q cofounder ${st("OP")}. None is part of Zino Aviation.</p></div>
      </div>`),
  },
  {
    id: "risks",
    title: "Key risks & mitigations (incl. licence and aircraft unknowns)",
    uses: [
      "regulatory and operational risks 1-9 (research §15)",
      "NCAA AOC / Part 9; Part 3 ATO; FSTD qualification",
      "mitigations (ASSUMPTION)",
    ],
    html: frame(`<h2 style="font-size:38px">The licence and aircraft questions come first.</h2>
      <table class="t" style="font-size:13px">
        <tr><th style="width:28%">Risk</th><th style="width:40%">Why it matters</th><th>Mitigation ${st("AS")}</th></tr>
        <tr><td><b>Charter without an AOC</b></td><td>Nigerian charter must be operated by an NCAA AOC holder (Nig.CARs Part 9); no Zino AOC found</td><td>Present Jet as broker/agent; name the operating carrier on every quote</td></tr>
        <tr><td><b>Training approvals</b></td><td>Not evidenced as an NCAA-approved ATO (Part 3); simulator FSTD level unknown; instructor licences unshown</td><td>Never call the simulator “certified” or creditable without the qualification certificate</td></tr>
        <tr><td><b>Data protection</b> — NDPA 2023, UK GDPR</td><td>Jet collects personal data with no live privacy policy or terms</td><td>Publish policy, terms and the legal entity name</td></tr>
        <tr><td><b>Pricing inconsistencies; superlatives</b></td><td>$45k vs $54k, €62k vs €65k; “world’s first and leading” unverified</td><td>One price per programme; attribute or remove superlatives</td></tr>
        <tr><td><b>Governance</b></td><td>UK accounts overdue; Nigerian entity unknown</td><td>File accounts; provide CAC documents and group chart</td></tr>
        <tr><td><b>Key person; FX and affordability; third parties</b></td><td>Brand depends on Capt. Zino; tuition in USD/EUR/ZAR; unnamed partners deliver core services</td><td>Build the team bench; tuition financing; written partner contracts</td></tr>
      </table>`),
  },
  {
    id: "funding dark",
    title: "Funding: to be confirmed by the founders",
    uses: [
      "funding, round, valuation, use of funds (UNKNOWN)",
      "open questions (research §17)",
    ],
    html: frame(`<h2>Funding: <i>to be confirmed by the founders.</i></h2>
      <p style="margin-bottom:18px;max-width:1000px">No raise, round size, valuation or use of funds is published, and none is assumed here. Funding raised to date is unknown — not zero.</p>
      <div class="g2" style="gap:48px">
        <div><h3>The raise</h3><ul class="lst">
          <li>Amount sought, instrument, valuation expectations</li>
          <li>Use of funds: simulator qualification, Academy growth, Jet operations, compliance</li>
          <li>Runway, burn and revenue by service line for three years</li></ul></div>
        <div><h3>The documents it rests on</h3><ul class="lst">
          <li>CAC certificates, MEMART, shareholder register; relation to the UK company</li>
          <li>Simulator: provider, ownership or lease, financing, qualification</li>
          <li>Signed partner agreements and commission terms</li></ul></div>
      </div>`),
  },
  {
    id: "arrival",
    title: "Investment opportunity & next steps",
    uses: ["thesis summary", "open questions 1-12 (research §17)"],
    html: frame(`<h2>An operating Academy to back now; <i>a Jet brand to prove next.</i></h2>
      <div class="g2" style="gap:48px">
        <div><h3>The opportunity</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Large, sourced pilot demand in Africa ${st("VP")}</li>
          <li style="font-size:15.5px">A pilot-career funnel with years of public activity and press ${st("VP")} ${st("SR")}</li>
          <li style="font-size:15.5px">A founder-led brand and a claimed 8,000-person network ${st("SR")}</li>
          <li style="font-size:15.5px">Optionality in private aviation, once operators and transactions are shown ${st("AS")}</li></ul></div>
        <div><h3>Next steps — data-room request</h3><ul class="lst" style="font-size:15.5px">
          <li style="font-size:15.5px">Entity documents and group structure; 2018 founding evidence</li>
          <li style="font-size:15.5px">Simulator file and any FSTD qualification</li>
          <li style="font-size:15.5px">Enrolments, completions, consented placements; basis of “8,000+”</li>
          <li style="font-size:15.5px">Jet: completed deals, AOC holders used, escrow, insurance, JetVault status</li>
          <li style="font-size:15.5px">Founder licence documents; trademarks; NDPA compliance</li></ul></div>
      </div>
      <p class="small" style="margin-top:12px">Contact (published): enquiries@zinoaviation.com ${st("SR")}</p>`),
  },
  {
    id: "sources",
    title: "Sources & evidence status",
    uses: ["all source URLs and fetch dates (research Sources, facts.json)"],
    html: frame(`<h2 style="font-size:32px;margin-bottom:12px">Sources & evidence status</h2>
      <div class="g2" style="grid-template-columns:1.6fr 1fr;gap:28px">
        <table class="t" style="font-size:11px">
          <tr><th style="padding:6px 10px">Source (all fetched 2026-10-18 UTC)</th><th style="padding:6px 10px">Status</th></tr>
          <tr><td style="padding:5px 10px">zinoaviation.com · jet.zinoaviation.com (charter, aircraft-acquisition, journey-concierge, contact, coming-soon; css)</td><td style="padding:5px 10px">${st("SR")}</td></tr>
          <tr><td style="padding:5px 10px">academy.zinoaviation.com — /start-flying, /simulator, /pilotjob, /sacaa, /easa, /type, /logistics, /call, /careers, privacy PDF</td><td style="padding:5px 10px">${st("SR")}</td></tr>
          <tr><td style="padding:5px 10px">zinomario.com · fdncapitalpartners.com/team/ · fuzu.com/nigeria/company/zino-aviation</td><td style="padding:5px 10px">${st("SR")}</td></tr>
          <tr><td style="padding:5px 10px">find-and-update.company-information.service.gov.uk/company/13100002 (+ /officers)</td><td style="padding:5px 10px">${st("VP")}</td></tr>
          <tr><td style="padding:5px 10px">thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/</td><td style="padding:5px 10px">${st("VP")}</td></tr>
          <tr><td style="padding:5px 10px">nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/</td><td style="padding:5px 10px">${st("VP")} ${st("SR")}</td></tr>
          <tr><td style="padding:5px 10px">guardian.ng — Zino Aviation, SafeFly partner (HTTP 403; search snippet only)</td><td style="padding:5px 10px">${st("VP")}</td></tr>
          <tr><td style="padding:5px 10px">investors.boeing.com — 2025 Pilot & Technician Outlook · afm.aero (Boeing Africa 2026–2045; Caverton FSTD)</td><td style="padding:5px 10px">${st("VP")}</td></tr>
          <tr><td style="padding:5px 10px">ground.news (Keyamo) · allafrica.com/stories/202603200305.html · businessday.ng · blueprint.ng/?p=243994</td><td style="padding:5px 10px">${st("VP")}</td></tr>
          <tr><td style="padding:5px 10px">ncaa.gov.ng — AOC (Part 9) note; Nig.CARs Part 3 ATO PDF</td><td style="padding:5px 10px">${st("VP")}</td></tr>
        </table>
        <div><ul class="lst">
          <li style="font-size:13px;padding:6px 0">${st("VP")} independent record or third-party press</li>
          <li style="font-size:13px;padding:6px 0">${st("SR")} company or founder’s own site, or founder quoted</li>
          <li style="font-size:13px;padding:6px 0">${st("OP")} supplied by the Capital Q owner</li>
          <li style="font-size:13px;padding:6px 0">${st("AS")} analyst modelling input</li>
          <li style="font-size:13px;padding:6px 0">${st("UN")} not established; never read as zero</li>
          <li style="font-size:13px;padding:6px 0">${svc("A")} ${svc("M")} ${svc("P")} ${svc("D")} service status</li></ul>
          <p class="small" style="margin-top:8px;font-size:11.5px">Prepared offline from docs/flagship/zino-aviation/research.md and facts.json. Typographic wordmark only: no public brand licence. No site photography (Unsplash or company) reused.</p></div>
      </div>`),
  },
];

export default {
  slug: "zino-aviation",
  company: "Zino Aviation",
  title: "Zino Aviation — Investor deck",
  fonts: [
    ["Crimson Pro", "CrimsonPro-Regular.ttf", 400],
    ["Crimson Pro", "CrimsonPro-Italic.ttf", 400, "italic"],
    ["Crimson Pro", "CrimsonPro-Bold.ttf", 700],
    ["Outfit", "Outfit-Regular.ttf", 400],
    ["Outfit", "Outfit-Bold.ttf", 600],
  ],
  css,
  slides,
  readme: {
    direction:
      "Zino Aviation Jet's editorial palette (cream #F6F4EF, gold #B59B48 / #D9C48A / #8A7434, charcoal #222222 / #141414, line #E7E2D6) with a serif display face and geometric sans. Narrative device: a flight plan — each slide is a numbered leg, with a waypoint route bar along the bottom from Departure to Arrival; title, market and funding slides are charcoal \"night\" legs. Services carry the research's operating status (Active / Marketed / Planned / Partner-delivered) as well as evidence status.",
    brand: [
      "Colours from `brand.json` (jet.zinoaviation.com css :root). GT Alpina (commercial) and Poppins/Cormorant Garamond are not available offline, so display type is Crimson Pro and UI type is Outfit (both OFL, in `scripts/seed/flagship/deck/fonts/`).",
      'No logo file used: no public brand licence was found, so the deck uses a typographic "ZINO AVIATION" wordmark. Official logo source recorded in brand.json: https://jet.zinoaviation.com/assets/img/logo-gold.svg.',
      "No photography: Jet imagery is Unsplash (third-party photographers) or company-owned without a licence.",
    ],
    omitted: [
      "Any AOC, ATO approval, FSTD qualification level, owned aircraft, completed charter or transaction: UNKNOWN — stated only as not found.",
      "Revenue, enrolments, placements, funding: UNKNOWN.",
      "Unnamed airline agreements and the 'As Featured in' logo strip: not presented as partnerships or coverage.",
      "Homepage '1000+' counters: template placeholders, mentioned only as such.",
      "Marketing superlatives ('world's first and leading', 'state-of-the-art', 'youngest commercial pilot'): attributed and marked unverified, never asserted.",
      "Founder date of birth from the register: deliberately omitted.",
    ],
  },
};
