// KUUZA AI investor deck. Facts: docs/flagship/kuuza/{research.md,facts.json,brand.json} only.
// Design: dark-first brand (charcoal #131313, crimson #E9273B, teal #7DBDC1, ice #EFF6FC; Inter + JetBrains Mono).
// Narrative device: "the investor call, rehearsed" — each slide pairs the question an investor asks with the answer,
// echoing the product (conversation rehearsal). The striped bar echoes the logo mark's horizontal crimson-to-teal stripes.
import { esc, st } from "../lib.mjs";

const css = `
:root{--ch:#131313;--sf:#1A1A1A;--sf2:#202020;--cr:#E9273B;--cr2:#A40F1E;--te:#7DBDC1;--te2:#6AAEB2;--ice:#EFF6FC;--mu:#9CA3AF;--ln:#2C2C2C}
body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;color:var(--ice)}
.slide{background:var(--ch)}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}
.wm{font-weight:200;letter-spacing:.32em;font-size:20px;color:var(--ice)}
.wm b{font-weight:200;color:var(--cr)}
.stripes{display:flex;flex-direction:column;gap:5px;width:56px}
.stripes i{display:block;height:5px;border-radius:1px}
.stripes i:nth-child(1){background:#E9273B}.stripes i:nth-child(2){background:#C7414F}.stripes i:nth-child(3){background:#A6656E}
.stripes i:nth-child(4){background:#8F9497}.stripes i:nth-child(5){background:#7DBDC1}
.foot{position:absolute;left:72px;right:64px;bottom:26px;display:flex;justify-content:space-between;font-size:12px;color:var(--mu)}
.foot .mono{color:var(--mu)}
.has-rail .foot{left:432px}
.rail{position:absolute;left:0;top:0;bottom:0;width:384px;background:var(--sf);padding:60px 44px 0 64px;border-right:1px solid var(--ln)}
.rail .who{font-size:13px;color:var(--te);margin-bottom:18px}
.rail h2{font-size:40px;line-height:1.14;font-weight:700;letter-spacing:-.01em}
.rail .num{position:absolute;left:64px;bottom:64px;font-size:12px;color:var(--mu)}
.main{position:absolute;left:432px;right:64px;top:60px;bottom:62px}
.main .who{font-size:13px;color:var(--cr);margin-bottom:14px}
.lead{font-size:27px;line-height:1.34;font-weight:500;margin-bottom:24px}
.lead em{font-style:normal;color:var(--cr)}
p{font-size:18px;line-height:1.5;color:#D6DCE2}
.small{font-size:14px;color:var(--mu);line-height:1.45}
.st{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;white-space:nowrap;padding-left:9px;border-left:3px solid var(--mu);color:var(--ice);line-height:1.2;display:inline-block}
.st-VP{border-color:var(--te)}.st-SR,.st-PT{border-color:var(--cr)}.st-OP{border-color:#E8B54D}.st-AS{border-color:#B0B6BE}.st-UN{border-color:#555;color:var(--mu)}
.rows>div{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:baseline;padding:14px 0;border-top:1px solid var(--ln)}
.rows>div:last-child{border-bottom:1px solid var(--ln)}
.rows .t{font-size:18px;line-height:1.42}
.rows .t b{font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.col h3{font-size:16px;font-weight:600;color:var(--te);margin-bottom:8px}
.col li{font-size:17px;line-height:1.42;padding:7px 0;border-top:1px solid var(--ln)}
.big{font-weight:800;font-size:64px;letter-spacing:-.03em;line-height:1}
.src{position:absolute;left:432px;right:64px;bottom:50px;font-size:11px;color:var(--mu)}
table.t{width:100%;font-size:15px}
table.t th{text-align:left;font-weight:600;color:var(--te);font-size:13.5px;padding:0 12px 9px 0;border-bottom:1px solid var(--te2)}
table.t td{padding:11px 12px 11px 0;border-bottom:1px solid var(--ln);vertical-align:top;line-height:1.38}
table.t td.n{font-family:"JetBrains Mono",monospace;white-space:nowrap}
/* title */
.s-title{background:linear-gradient(118deg,#131313 0%,#1A1A1A 52%,#4A0E15 100%)}
.s-title .top{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:22px}
.s-title h1{position:absolute;left:72px;top:196px;width:900px;font-size:66px;line-height:1.04;font-weight:800;letter-spacing:-.025em}
.s-title h1 span{color:var(--cr)}
.s-title .sub{position:absolute;left:72px;top:448px;width:760px;font-size:21px;line-height:1.45;color:#D6DCE2}
.s-title .meta{position:absolute;left:72px;bottom:56px;font-size:12.5px;color:var(--mu);line-height:1.6}
.s-title .tag{position:absolute;right:72px;bottom:56px;text-align:right;font-size:15px;color:var(--te)}
/* section-style full slides */
.full{position:absolute;left:72px;right:72px;top:60px;bottom:72px}
.full .who{font-size:13px;color:var(--te);margin-bottom:12px}
.full h2{font-size:44px;font-weight:750;letter-spacing:-.015em;line-height:1.1;margin-bottom:26px;max-width:1040px}
.kpi{border-top:2px solid var(--cr);padding-top:14px}
.kpi .v{font-family:"JetBrains Mono",monospace;font-size:48px;font-weight:700;letter-spacing:-.02em}
.kpi .l{font-size:17px;color:#D6DCE2;margin-top:6px;line-height:1.4}
.arith{font-family:"JetBrains Mono",monospace;font-size:15px}
.arith>div{display:grid;grid-template-columns:170px 1fr 200px;gap:20px;padding:16px 0;border-top:1px solid var(--ln);align-items:baseline}
.arith .k{color:var(--te);font-weight:700}
.arith .r{text-align:right;font-weight:700;color:var(--ice);font-size:22px}
.arith .x{font-family:Inter,sans-serif;font-size:16.5px;color:#D6DCE2;line-height:1.4}
.quote{font-size:18px;line-height:1.45;padding:14px 0;border-top:1px solid var(--ln)}
.quote .by{font-size:14px;color:var(--mu);margin-top:6px}
.flag{color:#F2A3AB}
.s-problem .rows>div{padding:10px 0}
`;

const foot = ({ i, n }) =>
  `<div class="foot"><span>KUUZA AI · Investor deck · October 2026 · prepared offline from public sources</span><span class="mono">${String(i).padStart(2, "0")} / ${n}</span></div>`;

/** Two-column "call" slide: the investor's question on the rail, the answer on the right. */
const call = (ask, title, body) => (ctx) =>
  `<div class="has-rail"><div class="rail"><div class="who mono">investor asks</div><h2>${esc(ask)}</h2></div>
   <div class="main"><div class="who mono">kuuza answers · ${esc(title)}</div>${body}</div>${foot(ctx)}</div>`;

const full = (label, title, body) => (ctx) =>
  `<div class="full"><div class="who mono">${esc(label)}</div><h2>${title}</h2>${body}</div>${foot(ctx)}`;

const slides = [
  {
    id: "title",
    title:
      "Thesis — conversation practice for the calls the rest of the world makes",
    uses: [
      "proposition (SELF_REPORTED, kuuza.ai)",
      "taglines (SELF_REPORTED)",
      "operating base Lagos (ASSUMPTION)",
      "founders (OWNER_PROVIDED)",
    ],
    html: () => `
      <div class="top"><div class="stripes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="wm">KUUZA <b>AI</b></div></div>
      <h1>Rehearse the hard conversation <span>before</span> it costs you the deal.</h1>
      <div class="sub">KUUZA AI describes itself as “the Global AI Simulator and Coach for Sales, Service and All Human Communication”: voice, video and text roleplay with AI personas, scored instantly. The thesis: accent, culture and noisy-line realism for Africa, the Middle East and Asia is a wedge the funded Western tools do not target.</div>
      <div class="meta">Investor deck · October 2026 · Cofounders Zino Mario and Excel Chukwu ${st("OP")}<br>Operating base: Lagos, Nigeria ${st("AS", "medium confidence")} · Every claim carries its evidence status</div>
      <div class="tag">“Born in Africa. Built for the World” ${st("SR")}</div>`,
  },
  {
    id: "problem",
    title: "Problem — sales and service skills are learned on live customers",
    uses: [
      "origin story: training 'painfully slow' (SELF_REPORTED, /about)",
      "use cases: onboarding, de-escalation (SELF_REPORTED)",
      "'Generic AI platforms built predominantly just for Western markets' (SELF_REPORTED)",
      "Managers 70-80% coaching claim shown as unsourced marketing",
    ],
    html: call(
      "What is broken today?",
      "the problem",
      `<div class="lead">New reps and service agents practise on <em>real customers</em>. Mistakes are paid for in lost deals, escalations and slow ramp-up.</div>
       <div class="rows">
        <div><div class="t"><b>Training is slow.</b> The founders started KUUZA “after experiencing firsthand how painfully slow sales training can be” in a previous startup.</div>${st("SR", "/about")}</div>
        <div><div class="t"><b>Roleplay does not scale.</b> Practice depends on a manager’s time. KUUZA’s page claims managers spend 70–80% of their time coaching (no source given).</div>${st("SR", "unsourced")}</div>
        <div><div class="t"><b>Practice tools assume a Western call.</b> The company argues most AI platforms are “built predominantly just for Western markets”: clean lines, familiar accents, familiar norms.</div>${st("SR")}</div>
        <div><div class="t"><b>The hard calls are emotional.</b> Complaints with shouting, crying or sarcasm; objections; interviews; pitches. They are rarely rehearsed at all.</div>${st("SR", "use cases")}</div>
       </div>
       <p class="small" style="margin-top:16px">No independent survey of the problem is cited in the research. The size of the pain is an open diligence question.</p>`,
    ),
  },
  {
    id: "solution",
    title: "Solution — pick a scenario, talk to a persona, get scored",
    uses: [
      "how it works (SELF_REPORTED, kuuza.ai home)",
      "persona moods polite→hostile (SELF_REPORTED, /features)",
      "scoring dimensions (SELF_REPORTED)",
    ],
    html: call(
      "What does KUUZA actually do?",
      "the solution",
      `<div class="lead">A flight simulator for conversations: the user rehearses a real scenario with an AI persona that answers “with emotion, tone, attitude, and cultural nuance”. ${st("SR")}</div>
       <div class="grid2" style="margin-top:6px">
        <div class="col"><h3 class="mono">1 · choose a scenario</h3><ul><li>Cold call, discovery, objection handling, upsell, demo</li><li>Complaint and de-escalation</li><li>Interview, negotiation, investor pitch, public speaking</li></ul></div>
        <div class="col"><h3 class="mono">2 · speak naturally</h3><ul><li>Voice, video or text</li><li>Persona moods “from polite to frustrated… hostile”</li><li>Named demo personas, e.g. “Sarah — Sales AI”</li></ul></div>
        <div class="col"><h3 class="mono">3 · get scored at once</h3><ul><li>Accuracy, tone, structure, speed, clarity, empathy, objection skill</li><li>Speech pace, readiness score, script compliance</li></ul></div>
        <div class="col"><h3 class="mono">4 · managers see the team</h3><ul><li>Dashboard, leaderboard, learning paths, benchmarking</li><li>Upload scripts, FAQs and customer profiles</li></ul></div>
       </div>
       <p class="small" style="margin-top:14px">All capabilities as published on kuuza.ai (fetched 2026-10-18). Not independently tested for this deck.</p>`,
    ),
  },
  {
    id: "product",
    title: "Working product & capabilities — what is live vs. listed",
    uses: [
      "Free Demo plan contents (SELF_REPORTED, /pricing)",
      "Custom plan features (SELF_REPORTED, live status UNKNOWN)",
      "stack, latency, certifications (UNKNOWN)",
    ],
    html: call(
      "What can I use today, and what is only listed?",
      "product status",
      `<table class="t" style="font-size:14px">
        <tr><th style="width:44%">Capability</th><th style="width:24%">Where it appears</th><th>Status</th></tr>
        <tr><td><b>Free Demo</b> — no account, password or card; BDR/SDR/AE roleplay, video simulations, real-time feedback, transcription, objection detection; “Up to 1,000 AI calls”</td><td>Public pricing page; self-serve</td><td>${st("SR", "offered publicly")}</td></tr>
        <tr><td><b>Realistic audio</b> — traffic noise, poor signal, interruptions, network delay</td><td>/features</td><td>${st("SR")}</td></tr>
        <tr><td><b>Custom plan</b> — unlimited custom bots, AI bot builder, hiring assessments, custom scorecards, real-call scoring, simulated auto-dialer</td><td>Pricing page, sold via “Book a Demo”</td><td>${st("SR", "listed; live status unverified")}</td></tr>
        <tr><td><b>Integrations</b> — “CRM Integration (20+)”, HubSpot, Salesforce, Zoho, LMS/LXP, “SSO & Advanced Security”, “Multilingual Support (30+ Languages)”</td><td>Pricing page and /features</td><td>${st("SR", "live or roadmap unknown")}</td></tr>
        <tr><td><b>Model and speech stack, latency, security certification</b></td><td>Not published</td><td>${st("UN")}</td></tr>
       </table>
       <p class="small" style="margin-top:14px">Hero widgets on kuuza.ai (“+34% Close Rate”, “11.7% Book Rate”, “12 Days Streak”) are illustrative UI mock-ups, not reported results. They are deliberately not used as traction here.</p>`,
    ),
  },
  {
    id: "edge",
    title: "The claimed edge — culture, accent and noisy-line realism",
    uses: [
      "Cultural & Contextual Intelligence claim (SELF_REPORTED)",
      "noisy-channel audio (SELF_REPORTED)",
      "name etymology (VERIFIED_PUBLIC, Wiktionary)",
      "evidence gap (ASSUMPTION)",
    ],
    html: full(
      "why kuuza, why here",
      `Most practice tools rehearse a quiet call in a Western office. KUUZA says it rehearses the call people actually get.`,
      `<div class="grid3">
        <div class="kpi"><div class="v">accents</div><div class="l">The AI “understands accents, slang, tone, culture, and communication norms… especially within Africa, Asia and The Middle East”.</div><div style="margin-top:12px">${st("SR", "/features")}</div></div>
        <div class="kpi"><div class="v">bad lines</div><div class="l">Simulated traffic noise, poor signal, interruptions and network delay. Uncommon in Western competitors’ marketing; fits emerging-market call reality.</div><div style="margin-top:12px">${st("SR", "/features")}</div></div>
        <div class="kpi"><div class="v">kuuza</div><div class="l">Swahili for “to sell”. The brand is built around selling from an African starting point: “Born in Africa. Built for the World”.</div><div style="margin-top:12px">${st("VP", "Wiktionary")}</div></div>
       </div>
       <div style="margin-top:34px;padding:18px 22px;background:var(--sf);border-left:3px solid var(--te)"><p><b>What would make this a moat, not a slogan</b> ${st("AS")} — evaluation data on non-Western accents, a published model and vendor stack, and named customers outside the founders’ network. None of these is public yet; they are first-call diligence items.</p></div>`,
    ),
  },
  {
    id: "market",
    title: "Market context — a $394.5B training budget, and funded competitors",
    uses: [
      "Global corporate training $394.5B 2025; NA $186.4B; RoW $208.2B; 2026e $398.8B (VERIFIED_PUBLIC, Training Industry)",
      "Second Nature $22M Series B Oct 2025 (VERIFIED_PUBLIC, Built In NYC)",
      "Hyperbound $15M Series A Sep 2025 (VERIFIED_PUBLIC, Entrepreneur India)",
    ],
    html: full(
      "market context",
      `Companies already spend heavily on training. Investors are already funding AI roleplay.`,
      `<div class="grid3" style="grid-template-columns:1.25fr 1fr 1fr">
        <div class="kpi"><div class="v">$394.5B</div><div class="l">Global corporate training spend, 2025. Excludes consumer spend. 2026 estimate: $398.8B.</div></div>
        <div class="kpi"><div class="v">$208.2B</div><div class="l">Of that, spend outside North America (North America: $186.4B). KUUZA’s claimed home ground sits here.</div></div>
        <div class="kpi" style="border-color:var(--te)"><div class="v">$22M · $15M</div><div class="l">Second Nature Series B (Oct 2025) and Hyperbound Series A (Sep 2025): the category is funded, mostly in North America.</div></div>
       </div>
       <div class="small" style="margin-top:30px;line-height:1.7">${st("VP")} Sources: Training Industry, “Size of the Training Industry” — trainingindustry.com/wiki/strategy-alignment-and-planning/size-of-training-industry/ · Built In NYC, 2025-10-20 — builtinnyc.com/articles/second-nature-raises-22m-series-b-20251020 · Entrepreneur India — india.entrepreneur.com/?p=87366 · all fetched 2026-10-18. Funding figures are third-party reports.</div>`,
    ),
  },
  {
    id: "sizing",
    title: "Opportunity sizing — TAM / SAM / SOM (Assumption)",
    uses: [
      "$394.5B and $208.2B base figures (VERIFIED_PUBLIC)",
      "every percentage (ASSUMPTION, research.md §18)",
      "B2C excluded (UNKNOWN monetisation)",
    ],
    html: full(
      "opportunity sizing · assumption arithmetic",
      `TAM ≈ $3.9B · SAM ≈ $167M · SOM ≈ $1.7M ARR<span style="display:block;font-size:20px;font-weight:500;color:var(--mu);margin-top:10px">Every line below is an Assumption. Only the two base spend figures are sourced.</span>`,
      `<div class="arith">
        <div><span class="k">TAM ${st("AS")}</span><span class="x">$394.5B corporate training × 10% sales and service communication training × 10% addressable by AI simulation software</span><span class="r">≈ $3.9B</span></div>
        <div><span class="k">SAM ${st("AS")}</span><span class="x">$208.2B rest-of-world spend × 8% Africa, Middle East and South Asia × 10% communication share × 10% software share</span><span class="r">≈ $167M</span></div>
        <div><span class="k">SOM ${st("AS")}</span><span class="x">1% of SAM within about five years</span><span class="r">≈ $1.7M ARR</span></div>
        <div><span class="k">cross-check ${st("AS")}</span><span class="x">100 enterprise accounts × 50 seats × $30 per seat per month × 12 (KUUZA publishes no price)</span><span class="r">≈ $1.8M ARR</span></div>
       </div>
       <p class="small" style="margin-top:18px">The two base figures are sourced (Training Industry, fetched 2026-10-18). Every percentage, seat count and price above is an analyst assumption, not a sourced number. Consumer coaching is excluded because whether KUUZA monetises it is unknown.</p>`,
    ),
  },
  {
    id: "model",
    title: "Business model — free demo funnel into custom enterprise plans",
    uses: [
      "Free Demo (SELF_REPORTED, /pricing)",
      "Custom plan, no published price (SELF_REPORTED)",
      "enterprise contract model (ASSUMPTION)",
      "B2C monetisation (UNKNOWN)",
    ],
    html: call(
      "How does KUUZA make money?",
      "business model",
      `<div class="lead">Free self-serve demo at the top; custom enterprise plans sold through “Book a Demo”. <em>No price is published.</em></div>
       <div class="rows">
        <div><div class="t"><b>Free Demo</b> — “No Account, No Password, No Credit Card”. For individuals, small teams and founders; “Up to 1,000 AI calls”.</div>${st("SR", "/pricing")}</div>
        <div><div class="t"><b>Custom Plan</b> (“Recommended”) — custom bots, scorecards, real-call scoring, integrations, a dedicated account manager.</div>${st("SR", "price not published")}</div>
        <div><div class="t"><b>Revenue model</b> — enterprise contracts at custom prices, sales-led after the demo.</div>${st("AS")}</div>
        <div><div class="t"><b>Consumer</b> — the Individuals page sells “Start Training Free →”. Whether B2C earns anything is not public.</div>${st("UN")}</div>
       </div>
       <p class="small" style="margin-top:16px">The page headline reads “Simple, Transparent” but shows no numeric price (fetched 2026-10-18). A price list is a founder deliverable.</p>`,
    ),
  },
  {
    id: "segments",
    title: "Segments & distribution",
    uses: [
      "segments and industries named (SELF_REPORTED)",
      "published channels (SELF_REPORTED)",
      "founder-led enterprise motion (ASSUMPTION)",
    ],
    html: call(
      "Who buys, and how do you reach them?",
      "segments & distribution",
      `<div class="grid2">
        <div class="col"><h3 class="mono">segments ${st("SR")}</h3><ul>
          <li><b>Sales teams</b> — BDR, SDR, AE onboarding and objection handling</li>
          <li><b>Customer service and call centres</b> — de-escalation and empathy</li>
          <li><b>Individuals</b> — job seekers, students, founders, professionals</li>
          <li><b>Industries named</b> — aviation, banking, healthcare, tech, e-commerce, retail, logistics, government</li></ul></div>
        <div class="col"><h3 class="mono">distribution</h3><ul>
          <li>Free self-serve demo, then “Book a Custom Demo” ${st("SR")}</li>
          <li>“Partner With Us… training institutions & tech” ${st("SR")}</li>
          <li>LinkedIn, Instagram, YouTube (@kuuza-ai); newsletter; email, phone, WhatsApp, Zoom ${st("SR")}</li>
          <li>Founder-led enterprise sales seeded through the founders’ network, then Nigerian SMEs and services firms ${st("AS")}</li></ul></div>
       </div>
       <p class="small" style="margin-top:18px">The contact form defaults to Nigeria (+234). A one-off “HQ: Nairobi, Kenya” chip on a decorative image on /features is treated as placeholder copy, not an office; the founders should remove or confirm it.</p>`,
    ),
  },
  {
    id: "competition",
    title: "Competition — named, funded, mostly North American",
    uses: [
      "competitor table (VERIFIED_PUBLIC third-party reports, research.md §12)",
      "Yoodli funding not verified (UNKNOWN)",
    ],
    html: full(
      "competition",
      `The category is real and funded. KUUZA must win where the leaders are not looking.`,
      `<table class="t">
        <tr><th style="width:18%">Competitor</th><th style="width:44%">Positioning</th><th>Public data point</th></tr>
        <tr><td><b>Second Nature</b></td><td>AI roleplay for sales and service teams</td><td>$22M Series B, Oct 2025, led by Sienna VC; Zoom is investor and customer ${st("VP")}</td></tr>
        <tr><td><b>Hyperbound</b></td><td>AI sales roleplay and real-call scoring (YC)</td><td>$15M Series A, Sep 2025, led by Peak XV; $18.3M total ${st("VP")}</td></tr>
        <tr><td><b>Yoodli</b></td><td>AI communication and roleplay coach, individual and enterprise</td><td>Funding not verified ${st("UN")}</td></tr>
        <tr><td><b>FullyRamped</b></td><td>AI roleplay for sales reps</td><td>$2.3M raise (IT Brief UK) ${st("VP")}</td></tr>
        <tr><td><b>Awarathon</b> (India)</td><td>AI video roleplay (“Trinity”)</td><td>Emerging-market comparator</td></tr>
        <tr><td><b>Milameet</b> (Togo)</td><td>African AI sales-simulation entrant</td><td>MIT Solve submission</td></tr>
        <tr><td><b>Mindtickle, Gong, Zenarate, Retorio</b></td><td>Sales-readiness, revenue-intelligence and contact-centre simulation incumbents</td><td>Category incumbents; links not individually verified</td></tr>
       </table>`,
    ),
  },
  {
    id: "defensibility",
    title: "Defensibility — the wedge and what must be proven",
    uses: [
      "wedge: accent/culture/noisy-channel + price fit (ASSUMPTION, research.md §12)",
      "evidence gaps (UNKNOWN)",
    ],
    html: call(
      "Why can’t Second Nature just add accents?",
      "defensibility",
      `<div class="lead">They could. The defensible version of KUUZA is one that owns the <em>data and the distribution</em> in markets the leaders under-serve. ${st("AS")}</div>
       <div class="rows">
        <div><div class="t"><b>Local realism as data.</b> Accent, slang and noisy-line scenarios built from African, Middle Eastern and South Asian calls compound with every customer.</div>${st("AS")}</div>
        <div><div class="t"><b>Price fit.</b> Enterprises outside North America buy at different price points than US sales teams.</div>${st("AS")}</div>
        <div><div class="t"><b>Breadth of use.</b> One engine for sales, service and individual practice widens the funnel — but risks diluting focus (see risks).</div>${st("AS")}</div>
        <div><div class="t"><b>Not yet public:</b> accent evaluation data, the model and vendor stack, IP ownership, and independent customers.</div>${st("UN")}</div>
       </div>`,
    ),
  },
  {
    id: "traction",
    title:
      "Traction & proof points — published testimonials, with related-party flags",
    uses: [
      "testimonials on /success-stories (SELF_REPORTED, labelled Published testimonial)",
      "related-party relationships (SELF_REPORTED on zinomario.com; research.md §15)",
      "customer count, revenue, retention (UNKNOWN)",
    ],
    html: full(
      "traction & proof points",
      `Early proof is published testimonials. Most come from the founders’ own network.`,
      `<div class="grid2" style="grid-template-columns:1.35fr 1fr;gap:40px">
        <div>
          <div class="quote"><b>Zino Aviation</b> — Rita Ekwonu (Exec. Asst to the CEO) and Olabisi Ajikanle (Head of Growth & Revenue) ${st("PT")}<div class="by flag">Related party: Zino Mario’s own company. The job title differs between pages.</div></div>
          <div class="quote"><b>FDN Advisory</b> — David Nwankwo, CEO ${st("PT")}<div class="by flag">Related party: David Nwankwo is Managing Partner of FDN Capital Partners, where Zino Mario is a Partner.</div></div>
          <div class="quote"><b>Setu Down (Nigeria)</b> — Samson Popola, CEO: “We tested KUUZA AI” ${st("PT")}<div class="by">Relationship unknown. A test is not necessarily paid use.</div></div>
          <div class="quote" style="border-bottom:1px solid var(--ln)"><b>“Nia Thompson, CEO OF Proxima”</b> on /features ${st("PT")}<div class="by">Unidentifiable.</div></div>
        </div>
        <div>
          <div class="who mono" style="color:var(--te);font-size:13px;margin-bottom:10px">not published</div>
          <div class="rows">
            <div><div class="t">Customer count</div>${st("UN")}</div>
            <div><div class="t">Paying customers</div>${st("UN")}</div>
            <div><div class="t">ARR or revenue</div>${st("UN")}</div>
            <div><div class="t">Usage volumes, retention</div>${st("UN")}</div>
          </div>
          <p class="small" style="margin-top:14px">Unknown is not zero. These are the first numbers to request from the founders, with related parties separated from independent customers.</p>
        </div>
       </div>`,
    ),
  },
  {
    id: "planning",
    title: "Planning assumptions — not actual results",
    uses: [
      "seat-price model 50 seats × $30/month (ASSUMPTION, research.md §18)",
      "account scenarios (ASSUMPTION arithmetic)",
      "unit cost per simulated minute (UNKNOWN)",
    ],
    html: full(
      "planning assumptions — not actual results",
      `Planning assumptions — not actual results`,
      `<p style="margin:-12px 0 20px;max-width:980px">KUUZA has published no revenue, price or cost data. The scenarios below only show how the research’s seat-price assumption scales. They are not forecasts and not company figures.</p>
       <div class="grid2" style="grid-template-columns:1.2fr 1fr;gap:44px">
        <div>
          <table class="t">
            <tr><th>Scenario ${st("AS")}</th><th>Accounts</th><th>Seats each</th><th>$ / seat / month</th><th>ARR</th></tr>
            <tr><td>Early</td><td class="n">25</td><td class="n">50</td><td class="n">30</td><td class="n">$0.45M</td></tr>
            <tr><td>Research cross-check</td><td class="n">100</td><td class="n">50</td><td class="n">30</td><td class="n">$1.8M</td></tr>
            <tr><td>Stretch</td><td class="n">200</td><td class="n">50</td><td class="n">30</td><td class="n">$3.6M</td></tr>
          </table>
          <p class="small" style="margin-top:10px">Arithmetic: accounts × seats × $30 × 12. Same inputs as the research’s bottom-up check.</p>
        </div>
        <div>
          <div class="who mono" style="color:var(--te);font-size:13px;margin-bottom:10px">inputs still unknown</div>
          <div class="rows">
            <div><div class="t">Real list price per seat or contract</div>${st("UN")}</div>
            <div><div class="t">Cost per simulated minute (speech, LLM, voice, avatar vendors)</div>${st("UN")}</div>
            <div><div class="t">Gross margin, latency</div>${st("UN")}</div>
            <div><div class="t">Sales cycle, conversion from free demo</div>${st("UN")}</div>
          </div>
        </div>
       </div>`,
    ),
  },
  {
    id: "roadmap",
    title: "Roadmap & scalability",
    uses: [
      "'Building towards immersive Virtual Reality' (SELF_REPORTED, zinomario.com)",
      "Custom plan items (SELF_REPORTED)",
      "diligence-readiness steps (ASSUMPTION, from research gaps)",
    ],
    html: call(
      "Where does this go, and does it scale?",
      "roadmap & scalability",
      `<div class="grid2">
        <div class="col"><h3 class="mono">stated direction ${st("SR")}</h3><ul>
          <li>“Building towards immersive Virtual Reality” (founder’s site; not on the product site)</li>
          <li>Hiring assessments, real-call scoring and a custom scorecard builder (Custom plan)</li>
          <li>“Multilingual Support (30+ Languages)” and “CRM Integration (20+)”</li>
          <li>Mission: “the global backbone of skills training”</li></ul></div>
        <div class="col"><h3 class="mono">next steps the evidence calls for ${st("AS")}</h3><ul>
          <li>Publish terms and a privacy notice (both 404 today)</li>
          <li>Name the legal entity and registered office</li>
          <li>Publish the model and vendor stack and an accent evaluation</li>
          <li>Win and name independent paying customers</li></ul></div>
       </div>
       <p style="margin-top:20px"><b>Scalability</b> ${st("AS")} — software delivery scales across markets, but real-time voice and video usually rely on third-party speech and model APIs, so cost per minute and latency scale with vendor pricing. Unit cost is unknown.</p>`,
    ),
  },
  {
    id: "team",
    title: "Team & founders",
    uses: [
      "cofounders Zino Mario and Excel Chukwu (OWNER_PROVIDED + SELF_REPORTED)",
      "Zino Mario press identity and pilot history (VERIFIED_PUBLIC, ThisDay; Nairametrics)",
      "self-claims (SELF_REPORTED, zinomario.com)",
      "prior UK companies (VERIFIED_PUBLIC, Companies House)",
      "Excel Chukwu background (UNKNOWN)",
    ],
    html: full(
      "team & founders",
      `“Zino brought the vision, Excel brought the tech.” <span style="font-size:18px;font-weight:500">${st("SR", "/about")}</span>`,
      `<div class="grid2" style="gap:48px">
        <div>
          <div style="font-size:26px;font-weight:700;margin-bottom:4px">Zino Mario <span style="font-size:15px;font-weight:400;color:var(--mu)">cofounder</span></div>
          <div style="margin-bottom:10px">${st("OP", "cofounder role")}</div>
          <div class="rows">
            <div><div class="t">Capt. Zino Mario (Mario-Ghae): founder and CEO of Zino Aviation, Lagos; licensed pilot at 18, retired from flying at 26 (ThisDay; Nairametrics 2026-07-19)</div>${st("VP")}</div>
            <div><div class="t">Raised in the UK; Sikorsky S-92 offshore pilot; two-time TEDx speaker; Partner at FDN Capital Partners. “Youngest commercial pilot” is unverified</div>${st("SR")}</div>
            <div><div class="t">Prior UK companies Pilot Pairing, Mariozino and Delta Dash Aviation — all dissolved</div>${st("VP", "Companies House")}</div>
          </div>
        </div>
        <div>
          <div style="font-size:26px;font-weight:700;margin-bottom:4px">Excel Chukwu <span style="font-size:15px;font-weight:400;color:var(--mu)">cofounder, technology</span></div>
          <div style="margin-bottom:10px">${st("OP", "cofounder role")}</div>
          <div class="rows">
            <div><div class="t">Named cofounder on kuuza.ai/about (“Excel brought the tech”)</div>${st("SR")}</div>
            <div><div class="t">Professional background, prior roles and technical track record</div>${st("UN")}</div>
            <div><div class="t">Equity and IP-assignment position</div>${st("UN")}</div>
          </div>
          <p class="small" style="margin-top:14px">Founder bandwidth is a diligence point: Zino Mario also runs Zino Aviation, SongScribe AI, an FDN partnership and the Man-Up Initiative.</p>
        </div>
       </div>`,
    ),
  },
  {
    id: "risks",
    title: "Key risks & mitigations (incl. regulatory)",
    uses: [
      "risks 1-8 and regulatory items (research.md §16-17)",
      "mitigations (ASSUMPTION)",
    ],
    html: full(
      "key risks & mitigations",
      `The risks are known and nameable. Most are fixable with documents.`,
      `<table class="t" style="font-size:14.5px">
        <tr><th style="width:30%">Risk</th><th style="width:40%">Why it matters</th><th>Mitigation ${st("AS")}</th></tr>
        <tr><td><b>EU AI Act Art. 5(1)(f)</b> — emotion recognition at work banned from 2 Feb 2025; hiring AI may be high-risk (Annex III)</td><td>Scoring employees’ “empathy” or “confidence” from voice; the Custom plan lists hiring assessments</td><td>Scope scoring to skills, not inferred emotion, before any EU sale; legal review of hiring use</td></tr>
        <tr><td><b>NDPA 2023 (Nigeria), UK/EU GDPR, US BIPA and NYC LL144</b></td><td>Voice, video and scores of employees are personal data; voice can become biometric</td><td>Publish privacy notice and DPA; data-residency and retention policy; avoid voice identification</td></tr>
        <tr><td><b>Missing legal pages</b></td><td>/terms and /privacy-policy return 404</td><td>Publish before enterprise or investor diligence</td></tr>
        <tr><td><b>Related-party traction</b></td><td>3 of 4 named stories are founder-affiliated</td><td>Report independent customers separately</td></tr>
        <tr><td><b>Technical cofounder opacity; vendor dependency</b></td><td>No public footprint; IP, stack and unit cost unknown</td><td>CV, IP assignment, stack and cost per minute in the data room</td></tr>
        <tr><td><b>Crowded category; scope sprawl; founder bandwidth; public inconsistencies</b></td><td>Funded US leaders; dating and preaching use cases; several ventures; Nairobi chip, mock metrics</td><td>Focus on enterprise sales and service; fix site copy; state time commitment</td></tr>
       </table>`,
    ),
  },
  {
    id: "funding",
    title: "Funding: to be confirmed by the founders",
    uses: [
      "funding raised (UNKNOWN — not zero)",
      "cap table, entity, price list (UNKNOWN)",
    ],
    html: call(
      "How much are you raising, and for what?",
      "funding",
      `<div class="lead">Funding: <em>to be confirmed by the founders.</em> No raise, round size, valuation or use of funds has been published, and none is assumed here. ${st("UN")}</div>
       <div class="who mono" style="color:var(--te);margin:4px 0 10px">what the founders need to supply</div>
       <div class="rows">
        <div><div class="t">Amount sought, instrument and valuation expectations</div>${st("UN")}</div>
        <div><div class="t">Funding raised to date (none found publicly — unknown, not zero)</div>${st("UN")}</div>
        <div><div class="t">Use of funds by line: product, go-to-market, compliance, hiring</div>${st("UN")}</div>
        <div><div class="t">Legal entity, jurisdiction, incorporation date and cap table</div>${st("UN")}</div>
        <div><div class="t">Runway and monthly burn</div>${st("UN")}</div>
       </div>`,
    ),
  },
  {
    id: "next",
    title: "Investment opportunity & next steps",
    uses: [
      "thesis summary (SELF_REPORTED + ASSUMPTION)",
      "open questions 1-11 (research.md §19)",
    ],
    html: full(
      "investment opportunity & next steps",
      `An early bet on conversation practice built outside the Western default — if the evidence lands.`,
      `<div class="grid2" style="gap:48px">
        <div class="col"><h3 class="mono">the opportunity</h3><ul>
          <li>A publicly usable product with a free demo and an enterprise plan ${st("SR")}</li>
          <li>A large, sourced training budget and a funded category ${st("VP")}</li>
          <li>A differentiated wedge — accent, culture and noisy lines in under-served markets ${st("AS")}</li>
          <li>A founder with a press-verified aviation operating history ${st("VP")}; aviation is a named target industry ${st("SR")}</li></ul></div>
        <div class="col"><h3 class="mono">next steps — the data-room request</h3><ul>
          <li>Entity, cap table, IP assignment, Excel Chukwu’s CV</li>
          <li>Paying customers and ARR, related parties separated</li>
          <li>Custom-plan price list; whether B2C is monetised</li>
          <li>Stack, cost per minute, latency; accent evaluation data</li>
          <li>Proof that 30+ languages, 20+ CRMs and SSO are live</li>
          <li>Privacy policy, terms, DPA, hosting location</li></ul></div>
       </div>
       <p class="small" style="margin-top:20px">Contact (published): support@kuuza.ai ${st("SR")}</p>`,
    ),
  },
  {
    id: "sources",
    title: "Sources & evidence status",
    uses: ["all source URLs and fetch dates (facts.json)"],
    html: (
      ctx,
    ) => `<div class="full" style="top:48px"><div class="who mono">sources & evidence status</div>
      <h2 style="font-size:30px;margin-bottom:14px">Sources & evidence status</h2>
      <div class="grid2" style="grid-template-columns:1.5fr 1fr;gap:36px">
       <table class="t" style="font-size:11.5px">
        <tr><th>Source (all fetched 2026-10-18 UTC)</th><th>Status</th></tr>
        <tr><td>kuuza.ai — /, /about, /features, /pricing, /contact, /faq, /success-stories, solutions pages</td><td>${st("SR")}</td></tr>
        <tr><td>kuuza.ai/terms, /privacy-policy — HTTP 404</td><td>${st("VP")}</td></tr>
        <tr><td>zinomario.com</td><td>${st("SR")}</td></tr>
        <tr><td>thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/</td><td>${st("VP")}</td></tr>
        <tr><td>nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/</td><td>${st("VP")}</td></tr>
        <tr><td>find-and-update.company-information.service.gov.uk — search “kuuza”; officer appointments</td><td>${st("VP")}</td></tr>
        <tr><td>trainingindustry.com/wiki/strategy-alignment-and-planning/size-of-training-industry/</td><td>${st("VP")}</td></tr>
        <tr><td>builtinnyc.com/articles/second-nature-raises-22m-series-b-20251020</td><td>${st("VP")}</td></tr>
        <tr><td>india.entrepreneur.com/?p=87366 · itbrief.co.uk (FullyRamped) · solve.mit.edu/solutions/95306</td><td>${st("VP")}</td></tr>
        <tr><td>wiktionary.com/wiki/uza</td><td>${st("VP")}</td></tr>
        <tr><td>search.cac.gov.ng — not queryable (JavaScript-only)</td><td>${st("UN")}</td></tr>
       </table>
       <div>
        <div class="rows" style="font-size:13px">
          <div><div class="t" style="font-size:13px">Independent record or third-party press</div>${st("VP")}</div>
          <div><div class="t" style="font-size:13px">Company or founder’s own website</div>${st("SR")}</div>
          <div><div class="t" style="font-size:13px">Testimonial published by the company</div>${st("PT")}</div>
          <div><div class="t" style="font-size:13px">Supplied by the Capital Q owner</div>${st("OP")}</div>
          <div><div class="t" style="font-size:13px">Analyst arithmetic or inference</div>${st("AS")}</div>
          <div><div class="t" style="font-size:13px">Not publicly findable; never read as zero</div>${st("UN")}</div>
        </div>
        <p class="small" style="margin-top:12px;font-size:11.5px">Prepared offline from docs/flagship/kuuza/research.md and facts.json. No founder documents were used. Typographic wordmark only: brand assets carry no published licence.</p>
       </div>
      </div></div>${foot(ctx)}`,
  },
];

export default {
  slug: "kuuza",
  company: "KUUZA AI",
  title: "KUUZA AI — Investor deck",
  fonts: [
    ["JetBrains Mono", "JetBrainsMono-Regular.ttf", 400],
    ["JetBrains Mono", "JetBrainsMono-Bold.ttf", 700],
  ],
  css,
  slides,
  readme: {
    direction:
      "Dark-first KUUZA brand (charcoal #131313, crimson #E9273B, teal #7DBDC1, ice #EFF6FC; Inter with JetBrains Mono accents). Narrative device: \"the investor call, rehearsed\" — most slides pair the investor's question (left rail) with KUUZA's answer, mirroring the product. A five-stripe crimson-to-teal bar echoes the logo mark's horizontal stripes without reproducing the mark.",
    brand: [
      "Colours and fonts from `brand.json` (compiled site CSS). Inter is a system font here; JetBrains Mono is the OFL file in `scripts/seed/flagship/deck/fonts/`.",
      "No logo file used: kuuza.ai publishes no asset licence and its Terms page 404s, so the deck uses a clean typographic wordmark. Swap in founder-supplied vector files when available (logo source recorded in brand.json: https://www.kuuza.ai/logo-assets/Lockup%20PNG%2CSVG/Logo-Lock-Gradient.png).",
      "No photography: the site's people imagery includes real likenesses, a Freepik image of unknown licence and likely AI-generated images.",
    ],
    omitted: [
      "Hero widget figures (+34% close rate, 11.7% book rate, 12-day streak): illustrative UI mock-ups, not results.",
      "'HQ: Nairobi, Kenya': decorative chip; mentioned only as a public inconsistency.",
      "Revenue, customer count, funding, round size, valuation, incorporation date, legal entity: UNKNOWN, not shown as numbers.",
      "'Nigeria's youngest commercial pilot': kept only as a self-claim marked unverified.",
      "'Teams typically see improvements within the first week' (FAQ): marketing claim with no evidence; not used.",
    ],
  },
};
