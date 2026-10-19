// SongScribe AI investor deck. Facts: docs/flagship/songscribe/{research.md,facts.json,brand.json} only.
// Design: dark cinematic brand (#0A0A0A / #050505, red #E63946 and #DC2B3C, maroon #7F1D1D, amber #F59E0B,
// light text #D1D5DB). Space Grotesk is not available offline, so display type is Inter Display; mono is Geist Mono
// (the site's --font-geist-mono). Narrative device: an album — Side A "the song" (product), Side B "the business",
// then "liner notes & credits" (team, risks, funding, sources). A tracklist strip on each slide shows where you are.
import { esc, st } from "../lib.mjs";

const css = `
:root{--bg:#0A0A0A;--bg2:#050505;--sf:#141414;--rd:#E63946;--rd2:#DC2B3C;--mr:#7F1D1D;--am:#F59E0B;--tx:#FAFAFA;--lt:#D1D5DB;--mu:#9CA3AF;--ln:#262626}
body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;color:var(--tx)}
.slide{background:var(--bg)}
.mono{font-family:"Geist Mono",ui-monospace,monospace}
.disp{font-family:"Inter Display",Inter,sans-serif}
.wm{font-family:"Inter Display",Inter,sans-serif;font-weight:800;font-size:26px;letter-spacing:.01em}
.wm .s{color:var(--rd2)}
.strip{position:absolute;left:64px;right:64px;top:34px;display:flex;align-items:baseline;gap:22px;font-size:12.5px;color:var(--mu);border-bottom:1px solid var(--ln);padding-bottom:12px;white-space:nowrap}
.strip .side{color:var(--tx);font-weight:700;margin-right:6px}
.strip .on{color:var(--rd)}
.strip .on::before{content:"▶ ";font-size:9px}
.box{position:absolute;left:64px;right:64px;top:92px;bottom:66px}
.trk{font-size:15px;color:var(--rd);margin-bottom:10px}
h2{font-family:"Inter Display",Inter,sans-serif;font-size:50px;line-height:1.04;font-weight:800;letter-spacing:-.025em;margin-bottom:24px;max-width:1080px}
h2 .r{color:var(--rd)}
p{font-size:18px;line-height:1.5;color:var(--lt)}
.small{font-size:14px;line-height:1.45;color:var(--mu)}
.foot{position:absolute;left:64px;right:64px;bottom:24px;display:flex;justify-content:space-between;font-size:12px;color:var(--mu)}
.st{font-family:"Geist Mono",ui-monospace,monospace;font-size:12px;white-space:nowrap;color:var(--mu);display:inline-block;line-height:1.2}
.st::before{content:"[";margin-right:3px}.st::after{content:"]";margin-left:3px}
.st-VP{color:#8FD3A8}.st-SR,.st-PT{color:#F28B94}.st-OP{color:var(--am)}.st-AS{color:#C9CDD3}.st-UN{color:#7A7F87}
.cols{display:grid;gap:34px}
.c2{grid-template-columns:1fr 1fr}.c3{grid-template-columns:repeat(3,1fr)}.c4{grid-template-columns:repeat(4,1fr)}
.lst li{font-size:17.5px;line-height:1.42;padding:10px 0;border-top:1px solid var(--ln)}
.lst li:last-child{border-bottom:1px solid var(--ln)}
.lst li b{font-weight:650}
h3{font-size:15px;font-weight:600;color:var(--am);margin-bottom:10px}
.cover{aspect-ratio:1/1;display:flex;flex-direction:column;justify-content:space-between;padding:20px}
.cover .n{font-family:"Geist Mono",monospace;font-size:13px}
.cover .st,.sleeve .st{color:inherit!important;opacity:.85}
.cover .t{font-family:"Inter Display",Inter,sans-serif;font-size:30px;font-weight:800;line-height:1.02;letter-spacing:-.02em}
table.t{width:100%;font-size:15px}
table.t th{text-align:left;font-weight:600;color:var(--am);font-size:13.5px;padding:0 14px 9px 0;border-bottom:1px solid var(--rd)}
table.t td{padding:10px 14px 10px 0;border-bottom:1px solid var(--ln);vertical-align:top;line-height:1.38;color:var(--lt)}
table.t td b{color:var(--tx)}
table.t td.n{font-family:"Geist Mono",monospace;white-space:nowrap;color:var(--tx)}
.big{font-family:"Inter Display",Inter,sans-serif;font-weight:800;letter-spacing:-.03em;line-height:1}
.stat .v{font-family:"Inter Display",Inter,sans-serif;font-weight:800;font-size:62px;letter-spacing:-.03em;line-height:1}
.stat .l{font-size:16.5px;color:var(--lt);line-height:1.42;margin-top:10px}
.rule{border-top:3px solid var(--rd);padding-top:16px}
/* red "single" slides */
.red{background:var(--rd)!important;color:var(--bg)}
.red .strip{color:#3A0B10;border-color:#B82C38}.red .strip .side,.red .strip .on{color:var(--bg)}
.red p,.red .lst li{color:#1A0507}.red .lst li{border-color:#B82C38}
.red h2 .r{color:var(--tx)}
.red .foot,.red .small{color:#3A0B10}
.red .st{color:#2A070A}.red .stat .l{color:#1A0507}.red h3{color:var(--bg)}.red .trk{color:var(--bg)}
/* title */
.s-title .wmpos{position:absolute;left:72px;top:60px}
.s-title h1{position:absolute;left:72px;top:140px;width:640px;font-family:"Inter Display",Inter,sans-serif;font-size:82px;line-height:.98;font-weight:800;letter-spacing:-.035em}
.s-title h1 span{color:var(--rd)}
.s-title .sub{position:absolute;left:72px;top:356px;width:620px;font-size:19px;line-height:1.45;color:var(--lt)}
.s-title .meta{position:absolute;left:72px;bottom:46px;font-size:13px;color:var(--mu);line-height:1.65}
.s-title .sleeve{position:absolute;right:72px;top:60px;width:440px;height:440px;background:var(--rd);color:var(--bg);padding:30px;display:flex;flex-direction:column;justify-content:space-between}
.s-title .sleeve .big{font-size:58px}
.s-title .sleeve .tl{font-family:"Geist Mono",monospace;font-size:13px;line-height:1.75}
.s-title .back{position:absolute;right:72px;top:520px;width:440px;font-size:13px;color:var(--mu);line-height:1.6}
.arith>div{display:grid;grid-template-columns:200px 1fr 210px;gap:20px;padding:15px 0;border-top:1px solid var(--ln);align-items:baseline}
.arith>div:last-child{border-bottom:1px solid var(--ln)}
.arith .k{font-family:"Geist Mono",monospace;font-weight:700;color:var(--am);font-size:15px}
.arith .x{font-size:17px;color:var(--lt);line-height:1.4}
.arith .r{text-align:right;font-family:"Inter Display",Inter,sans-serif;font-weight:800;font-size:28px;letter-spacing:-.02em}
.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:6px}
.flow>div{border-left:3px solid var(--rd);padding:4px 22px 0 18px}
.flow .n{font-family:"Geist Mono",monospace;color:var(--rd);font-size:14px;margin-bottom:8px}
.flow .h{font-family:"Inter Display",Inter,sans-serif;font-size:26px;font-weight:800;letter-spacing:-.015em;margin-bottom:10px;line-height:1.08}
.flow p{font-size:16.5px}
.s-sources table.t td{padding:7px 12px 7px 0}
`;

const SIDES = {
  A: {
    name: "Side A — the song",
    tracks: [
      "Thesis",
      "At a glance",
      "Problem",
      "Solution",
      "Product",
      "Difference",
    ],
  },
  B: {
    name: "Side B — the business",
    tracks: [
      "Market",
      "Sizing",
      "Model",
      "Segments",
      "Competition",
      "Moat",
      "Traction",
      "Planning",
    ],
  },
  C: {
    name: "Liner notes & credits",
    tracks: ["Roadmap", "Team", "Risks", "Funding", "Next steps", "Sources"],
  },
};

const strip = (side, track) =>
  `<div class="strip mono"><span class="side">${esc(SIDES[side].name)}</span>${SIDES[
    side
  ].tracks
    .map(
      (t, k) =>
        `<span class="${t === track ? "on" : ""}">${side}${k + 1} ${esc(t)}</span>`,
    )
    .join("")}</div>`;

const foot = ({ i, n }) =>
  `<div class="foot"><span>SongScribe AI · Investor deck · October 2026 · prepared offline from public sources</span><span class="mono">${String(i).padStart(2, "0")} / ${n}</span></div>`;

const trackNo = (side, track) =>
  `${side}${SIDES[side].tracks.indexOf(track) + 1}`;

const page = (side, track, title, body, opts = {}) => ({
  red: !!opts.red,
  html: (ctx) =>
    `${strip(side, track)}<div class="box"><div class="trk mono">${trackNo(side, track)} · ${esc(track.toLowerCase())}</div><h2>${title}</h2>${body}</div>${foot(ctx)}`,
});

const S = (id, title, uses, p) => ({
  id: p.red ? `${id} red` : id,
  title,
  uses,
  html: p.html,
});

const slides = [
  {
    id: "title",
    title: "Thesis — your story, turned into a song",
    uses: [
      "proposition and pitch lines (SELF_REPORTED, songscribe.ai)",
      "generation time 30-60 s, 2 variations (SELF_REPORTED, FAQ)",
      "founders (OWNER_PROVIDED)",
      "UK entity (VERIFIED_PUBLIC)",
    ],
    html: (ctx) => `
      <div class="wmpos wm"><span class="s">SONG</span>SCRIBE</div>
      <h1>Your story, turned into <span>a song.</span></h1>
      <div class="sub">SongScribe AI generates complete songs — lyrics, vocals and music — from a personal brief, in “typically 30–60 seconds”, with a licence certificate on paid orders. ${st("SR")}<br><br>Thesis: occasion-led packaging, clear licences and African genre fluency can win the gift, creator and SMB-jingle buyer that prompt-box tools leave to studios.</div>
      <div class="sleeve"><div class="mono" style="font-size:13px">investor deck · october 2026</div><div class="big">No studios.<br>No producers.<br>No waiting.</div><div class="tl">pitch line on songscribe.ai ${st("SR")}</div></div>
      <div class="back">Every claim carries its evidence status; unknown is never shown as zero.<br>Cofounders Zino Mario and Excel Chukwu ${st("OP")}<br>SONGSCRIBE AI LTD, England, no. 17031583 ${st("VP")}<br>Operating base: Lagos, Nigeria ${st("AS", "medium confidence")}</div>
      ${foot(ctx)}`,
  },
  S(
    "glance",
    "At a glance — company record",
    [
      "UK entity, inc. 2026-02-13, Taverham Norwich, SIC 59200, sole director/PSC (VERIFIED_PUBLIC, Companies House)",
      "Terms name 'SongScribe Ltd', Nigerian law (SELF_REPORTED, /terms)",
      "payment rails (SELF_REPORTED)",
      "Nigerian entity (UNKNOWN)",
    ],
    page(
      "A",
      "At a glance",
      `An English company, a Nigerian operating story, and one entity question to settle.`,
      `<div class="cols c2" style="gap:56px">
        <ul class="lst">
          <li><b>SONGSCRIBE AI LTD</b>, company no. 17031583, private limited, Active ${st("VP")}</li>
          <li>Incorporated <b>13 February 2026</b>; registered office Taverham, Norwich, England ${st("VP")}</li>
          <li>SIC 59200 — sound recording and music publishing ${st("VP")}</li>
          <li>Sole director and sole PSC (≥75% shares and votes): Mario-Ghae Efezino ${st("VP")}</li>
        </ul>
        <ul class="lst">
          <li>Terms (effective 17 Nov 2025) name <b>“SongScribe Ltd”</b> under the law of the Federal Republic of Nigeria ${st("SR")}</li>
          <li>Payments via Stripe, Flutterwave, Payoneer and Seerbit ${st("SR")}</li>
          <li>Founder “BASED IN Lagos, Nigeria” ${st("SR", "zinomario.com")}</li>
          <li>A Nigerian CAC entity: not found; the portal could not be queried ${st("UN")}</li>
        </ul>
       </div>
       <p class="small" style="margin-top:18px">The link between the UK company and the songscribe.ai brand is an assumption with high confidence. The Terms pre-date the UK company by about three months — a document fix for the founders.</p>`,
    ),
  ),
  S(
    "problem",
    "Problem — a personal song costs about $199 and takes days",
    [
      "Songfinch ~$199 per human-made song, 3-7 days (VERIFIED_PUBLIC, Digital Music News)",
      "pitch line No Studios/Producers/Waiting (SELF_REPORTED)",
      "segment use cases (SELF_REPORTED)",
    ],
    page(
      "A",
      "Problem",
      `A song for a person, a brand or a channel still means <span class="r">a studio, a producer and a wait.</span>`,
      `<div class="cols c3">
        <div class="rule stat"><div class="v">~$199</div><div class="l">Typical price of a human-made personalised song from Songfinch, the gift incumbent, with 3–7 day delivery and a personal-use licence.</div><div style="margin-top:12px">${st("VP", "Digital Music News")}</div></div>
        <div class="rule stat"><div class="v">3–7 days</div><div class="l">Too slow for the moment it is for: the birthday, the proposal, the campaign launch next week.</div><div style="margin-top:12px">${st("VP", "same report")}</div></div>
        <div class="rule stat"><div class="v">rights?</div><div class="l">Creators and small brands need music they can actually use in ads and monetised video, with a licence they can show.</div><div style="margin-top:12px">${st("AS")}</div></div>
       </div>
       <p style="margin-top:26px;font-size:17px">As of October 2026, businesses, creators and families who want a custom song find it expensive and slow: about $199 and 3–7 days for a human-made personalised song.</p>
       <p class="small" style="margin-top:10px">The research cites no survey of buyer demand. The price anchor is a third-party report on one competitor, not a market average.</p>`,
    ),
  ),
  S(
    "solution",
    "Solution — brief, generate, refine, license",
    [
      "eight-step form and AI Producer (SELF_REPORTED)",
      "30-60 s, 2 variations, revisions (SELF_REPORTED, FAQ)",
      "MP3/WAV, PDF licence certificate (SELF_REPORTED)",
    ],
    page(
      "A",
      "Solution",
      `Tell it the story. Get two finished songs in about a minute.`,
      `<div class="flow">
        <div><div class="n">01 brief</div><div class="h">Story, not a prompt box</div><p>An eight-step guided form, or the conversational AI Producer by chat or voice. Names, memories, occasion, genre, mood.</p></div>
        <div><div class="n">02 generate</div><div class="h">30–60 seconds</div><p>Complete song: lyrics, vocals and music. Each generation returns two variations. AI-written lyrics, your own, or instrumental.</p></div>
        <div><div class="n">03 refine</div><div class="h">Revise freely</div><p>Change genre, mood or lyrics. The AI Producer shows the credit cost and waits for confirmation before spending.</p></div>
        <div><div class="n">04 license</div><div class="h">Download with rights</div><p>MP3 and WAV (lossless on higher tiers), a PDF licence certificate per paid order, a library kept “indefinitely”.</p></div>
       </div>
       <p class="small" style="margin-top:34px">${st("SR")} All steps as described on songscribe.ai and in the FAQ answers in the site bundle (fetched 2026-10-18). Not independently tested for this deck.</p>`,
    ),
  ),
  S(
    "product",
    "Working product & capabilities — live, stated, undisclosed",
    [
      "live pricing page and free demo (SELF_REPORTED)",
      "genres shown (SELF_REPORTED)",
      "multi-language 'Quality may vary' (SELF_REPORTED)",
      "samples hosted on public R2 (VERIFIED_PUBLIC)",
      "underlying model (UNKNOWN)",
    ],
    page(
      "A",
      "Product",
      `What is public today — and the one thing that is not.`,
      `<table class="t" style="font-size:13.5px">
        <tr><th style="width:36%">Capability</th><th style="width:40%">Evidence</th><th>Status</th></tr>
        <tr><td><b>Free demo</b> — 10 AI variations per day, 60-second previews, no downloads</td><td>Public pricing page, no sign-up</td><td>${st("SR", "offered publicly")}</td></tr>
        <tr><td><b>Paid plans</b> Starter to Studio, with downloads and licences</td><td>Public pricing page, USD</td><td>${st("SR")}</td></tr>
        <tr><td><b>Sample library</b> — acoustic, hip-hop/trap, R&B, Afrobeat, Amapiano, gospel, EDM house, instrumentals</td><td>/samples; files served from a public Cloudflare R2 bucket</td><td>${st("VP", "hosting observed")}</td></tr>
        <tr><td><b>Multi-language lyrics</b>, e.g. a wedding song blending English, pidgin and Yoruba</td><td>FAQ: “Quality may vary by language”</td><td>${st("SR")}</td></tr>
        <tr><td><b>Agency & Enterprise</b> — white-label, API access, custom licensing</td><td>/licensing, “Contact Sales”</td><td>${st("SR", "availability unverified")}</td></tr>
        <tr><td><b>Market window</b> — the product is deployed and live with paid plans</td><td>songscribe.ai, as of October 2026</td><td>${st("SR")}</td></tr>
        <tr><td><b>Underlying generation model or vendor</b></td><td>Not disclosed anywhere</td><td>${st("UN")}</td></tr>
       </table>`,
    ),
  ),
  S(
    "difference",
    "The difference — story-first, African genres, licences you can show",
    [
      "claimed differentiators (SELF_REPORTED)",
      "competitive implication (ASSUMPTION, research.md §12)",
    ],
    page(
      "A",
      "Difference",
      `SongScribe does not try to out-model Suno. It packages the song for the moment.`,
      `<div class="cols c3" style="gap:26px">
        <div class="cover" style="background:var(--rd);color:var(--bg)"><div class="n">A6.1 ${st("SR")}</div><div class="t">Story-first personalisation</div><div style="font-size:16px;line-height:1.4">Names, memories and occasions drive the brief, not a blank prompt.</div></div>
        <div class="cover" style="background:var(--mr);color:var(--tx)"><div class="n">A6.2 <span class="st" style="color:#F7C3C8">Self-reported</span></div><div class="t">Afrobeat, Amapiano, Yoruba, pidgin</div><div style="font-size:16px;line-height:1.4">Genre and language fluency for African and diaspora buyers.</div></div>
        <div class="cover" style="background:var(--am);color:var(--bg)"><div class="n">A6.3 <span class="st" style="color:#3B2603">Self-reported</span></div><div class="t">Plan-based licensing</div><div style="font-size:16px;line-height:1.4">Personal to commercial to exclusive, with an “Official Ownership Certificate”.</div></div>
       </div>
       <p class="small" style="margin-top:16px">${st("AS")} The competition is on packaging and genre, not model capability — so licence warranties and margin depend on whichever model vendor sits underneath.</p>`,
    ),
  ),
  S(
    "market red",
    "Market context — recorded music and the generative-AI music market",
    [
      "IFPI 2024: $29.6B (+4.8%), Sub-Saharan Africa $110M (+22.6%) (VERIFIED_PUBLIC, MBW / Music In Africa)",
      "CISAC/PMP 2024 projection: €64B output, €9B provider revenue by 2028 (VERIFIED_PUBLIC)",
      "Suno ~$200M revenue, $2.45B valuation (VERIFIED_PUBLIC, TechCrunch)",
    ],
    page(
      "B",
      "Market",
      `People already pay for AI songs. <span class="r">Africa is the fast-growing edge.</span>`,
      `<div class="cols c4" style="gap:28px">
        <div class="stat"><div class="v">$29.6B</div><div class="l">Global recorded music revenue, 2024, up 4.8% (IFPI).</div></div>
        <div class="stat"><div class="v">+22.6%</div><div class="l">Growing demand: Sub-Saharan Africa recorded-music revenue grew 22.6% in 2024, to $110M — the second-fastest region (IFPI).</div></div>
        <div class="stat"><div class="v">€9B</div><div class="l">Projected 2028 revenue of Gen-AI music and AV providers, from €0.3B; output market to €64B (CISAC / PMP, projection).</div></div>
        <div class="stat"><div class="v">~$200M</div><div class="l">Suno’s reported annual revenue at a $2.45B valuation, Nov 2025.</div></div>
       </div>
       <div class="small" style="margin-top:34px;line-height:1.7">${st("VP")} IFPI Global Music Report 2025 via musicbusinessworldwide.com and musicinafrica.net/node/358892 · CISAC, Dec 2024: cisac.org/Newsroom/news-releases/global-economic-study-shows-human-creators-future-risk-generative-ai · TechCrunch, 2025-11-19 · all fetched 2026-10-18. CISAC figures are projections.</div>
       <p style="margin-top:14px;font-size:16.5px">Expansion plan (as of October 2026): expand into the agency and enterprise market with white-label licensing and API access, offered today through Contact Sales.</p>`,
      { red: true },
    ),
  ),
  S(
    "sizing",
    "Opportunity sizing — TAM / SAM / SOM (Assumption)",
    [
      "CISAC €9B 2028 provider revenue (VERIFIED_PUBLIC projection)",
      "all percentages and subscriber counts (ASSUMPTION, research.md §18)",
    ],
    page(
      "B",
      "Sizing",
      `TAM ≈ €4.5B · SAM ≈ €135M · SOM ≈ €1.35M/yr<span style="display:block;font-size:20px;font-weight:500;color:var(--mu);letter-spacing:0;margin-top:10px">Every line is an Assumption. Only the €9B base is sourced, and it is itself a 2028 projection.</span>`,
      `<div class="arith">
        <div><span class="k">TAM ${st("AS")}</span><span class="x">CISAC 2028 Gen-AI provider revenue, music and AV, €9B × 50% music share</span><span class="r">≈ €4.5B</span></div>
        <div><span class="k">SAM ${st("AS")}</span><span class="x">Serviceable market, an estimate from stated assumptions (as of October 2026). Personalised songs, SMB jingles and creator music for Africa, the diaspora and English-speaking SMBs: 3% of TAM</span><span class="r">≈ €135M</span></div>
        <div><span class="k">SOM ${st("AS")}</span><span class="x">1% of SAM within about 3–5 years</span><span class="r">≈ €1.35M / yr</span></div>
        <div><span class="k">cross-check ${st("AS")}</span><span class="x">5,000 paying subscribers × blended $15 per month (weighted to Starter and Creator) × 12</span><span class="r">≈ $0.9M ARR</span></div>
       </div>`,
    ),
  ),
  S(
    "model",
    "Business model — credit subscriptions plus licences, with conflicting public tiers",
    [
      "live pricing table (SELF_REPORTED, /pricing)",
      "credit rules (SELF_REPORTED)",
      "four conflicting tier schemes, $179 vs $199 (VERIFIED_PUBLIC observation)",
    ],
    page(
      "B",
      "Model",
      `Freemium credits, priced by licence strength.`,
      `<div class="cols" style="grid-template-columns:1.45fr 1fr;gap:40px">
        <table class="t" style="font-size:14.5px">
          <tr><th>Plan ${st("SR")}</th><th>USD / month</th><th>Credits / month</th><th>Licence</th></tr>
          <tr><td><b>Free</b></td><td class="n">0</td><td class="n">3,000 to start</td><td>Preview only</td></tr>
          <tr><td><b>Starter</b></td><td class="n">7</td><td class="n">12,000</td><td>Personal use</td></tr>
          <tr><td><b>Creator</b> (Popular)</td><td class="n">19</td><td class="n">40,000</td><td>Commercial</td></tr>
          <tr><td><b>Pro</b></td><td class="n">69</td><td class="n">150,000</td><td>Exclusive</td></tr>
          <tr><td><b>Studio</b></td><td class="n">179</td><td class="n">600,000</td><td>Full rights, team</td></tr>
          <tr><td><b>Agency & Enterprise</b></td><td class="n">Contact</td><td class="n">Bulk</td><td>Custom, white-label, API</td></tr>
        </table>
        <div>
          <h3 class="mono">what diligence will find ${st("VP", "observed on live site")}</h3>
          <ul class="lst" style="font-size:16px">
            <li style="font-size:16px">Four different tier schemes across /pricing, the FAQ, /terms and /licensing</li>
            <li style="font-size:16px">FAQ: Studio Pro $199/mo; pricing page: Studio $179/mo</li>
            <li style="font-size:16px">Credits per generation not published</li>
            <li style="font-size:16px">Top-ups expire after 12 months; refunds: “all purchases are final”</li>
          </ul>
        </div>
       </div>
       <p class="small" style="margin-top:12px">Reading ${st("AS")}: the company moved from one-time per-song tiers to monthly credit plans without updating the FAQ, terms or licensing copy. Prices fetched 2026-10-18.</p>`,
    ),
  ),
  S(
    "segments",
    "Segments & distribution",
    [
      "segments and use cases (SELF_REPORTED)",
      "published channels (SELF_REPORTED)",
      "inferred motion: gifting virality, church communities, diaspora (ASSUMPTION)",
    ],
    page(
      "B",
      "Segments",
      `Three buyers, one engine.`,
      `<div class="cols c3" style="gap:30px">
        <div><h3 class="mono">personal ${st("SR")}</h3><ul class="lst"><li>Birthdays, anniversaries, proposals</li><li>Weddings, Valentine’s, “missing someone”</li><li>Family and kids</li></ul></div>
        <div><h3 class="mono">creators ${st("SR")}</h3><ul class="lst"><li>YouTubers, podcasters, film makers</li><li>Intros, outros, background and theme music</li><li>Product reviewers</li></ul></div>
        <div><h3 class="mono">businesses & brands ${st("SR")}</h3><ul class="lst"><li>Brand anthems, ads, launches</li><li>Sonic logos and jingles</li><li>Also listed: church and ministry, events, film and TV</li></ul></div>
       </div>
       <div class="cols c2" style="margin-top:24px;gap:40px">
        <p style="font-size:16.5px"><b>Published channels</b> ${st("SR")} — Agency & Enterprise plans are sold through direct sales (Contact Sales); free demo with no sign-up; sample pages with “Create Like This”; Agency & Enterprise “Contact Sales”; Business & Licensing contact route.</p>
        <p style="font-size:16.5px"><b>Likely motion</b> ${st("AS")} — occasion-led social sharing; the founder’s network and church communities; diaspora gifting over Stripe plus African payment rails.</p>
       </div>`,
    ),
  ),
  S(
    "competition",
    "Competition — named players and their public numbers",
    [
      "competitor table (VERIFIED_PUBLIC third-party reports, research.md §12)",
      "ElevenLabs Music not verified (UNKNOWN)",
      "agencies price point (ASSUMPTION)",
    ],
    page(
      "B",
      "Competition",
      `A category with a $2.45B leader and a $199 human incumbent.`,
      `<table class="t" style="font-size:13.5px">
        <tr><th style="width:20%">Competitor</th><th style="width:30%">Model</th><th>Public data point</th></tr>
        <tr><td><b>Suno</b></td><td>Prompt-to-song, subscription</td><td>$250M Series C at $2.45B; ~$200M annual revenue (TechCrunch, Nov 2025); settled with Warner Music, Nov 2025 (Fortune) ${st("VP")}</td></tr>
        <tr><td><b>Udio</b></td><td>Prompt-to-song</td><td>Settlements and partnerships with UMG and Warner reported, late 2025 (Boston Globe) ${st("VP")}</td></tr>
        <tr><td><b>Songfinch</b></td><td>Human-made personalised songs</td><td>~$199 per song, 3–7 days, personal-use licence (Digital Music News) ${st("VP")}</td></tr>
        <tr><td><b>ElevenLabs Music</b></td><td>AI music, commercially cleared</td><td>Not individually verified ${st("UN")}</td></tr>
        <tr><td><b>Soundraw, Beatoven.ai, Mubert, Loudly</b></td><td>Royalty-free AI background music</td><td>Category comparators</td></tr>
        <tr><td><b>Sonic-branding agencies, local jingle producers</b></td><td>Human, bespoke</td><td>The price point SongScribe undercuts for SMB jingles ${st("AS")}</td></tr>
       </table>
       <p style="margin-top:8px;font-size:14px;line-height:1.4">${st("SR")} As of October 2026: unlike human-made song services at about $199 and 3–7 days, SongScribe returns two variations in 30–60 seconds at a lower price. Every paid plan includes licensed use, from personal to commercial to exclusive, with an ownership certificate.</p>`,
    ),
  ),
  S(
    "moat",
    "Defensibility — where SongScribe can hold ground",
    [
      "packaging/genre wedge and vendor dependency (ASSUMPTION, research.md §12)",
      "commoditisation risk (research.md §16)",
    ],
    page(
      "B",
      "Moat",
      `The moat is not the model. It is the brief, the licence and the market.`,
      `<div class="cols c2" style="gap:52px">
        <div><h3 class="mono">what can compound ${st("AS")}</h3><ul class="lst">
          <li><b>Occasion data</b> — a library of story briefs, genres and revisions by occasion and culture</li>
          <li><b>Licence trust</b> — certificates buyers can show to clients, platforms and brands, if chain of title is solid</li>
          <li><b>Local rails and genres</b> — Flutterwave and Seerbit payments; Afrobeat, Amapiano, Yoruba and pidgin</li></ul></div>
        <div><h3 class="mono">what can erode it ${st("AS")}</h3><ul class="lst">
          <li>Suno and Udio set consumer price expectations and could add gifting flows</li>
          <li>Resold third-party models put margin and licence warranties in a vendor’s hands</li>
          <li>The model, its terms and its training-data licences are undisclosed ${st("UN")}</li></ul></div>
       </div>`,
    ),
  ),
  S(
    "traction",
    "Traction & proof points — none published yet",
    [
      "traction, customers, revenue, testimonials (UNKNOWN — none published)",
      "samples presented as 'Real songs created in seconds' (SELF_REPORTED)",
    ],
    page(
      "B",
      "Traction",
      `No traction is published yet. <span class="r">Unknown is not zero.</span>`,
      `<div class="cols c2" style="gap:56px">
        <div><h3 class="mono">what is public</h3><ul class="lst">
          <li>A live, priced product with a free demo and paid plans ${st("SR")}</li>
          <li>A sample library presented as “Real songs created in seconds” ${st("SR")}</li>
          <li>Several samples appear to be personal commissions; none is a published testimonial ${st("AS")}</li></ul></div>
        <div><h3 class="mono">what is not public</h3><ul class="lst">
          <li>Users, paying users, songs generated ${st("UN")}</li>
          <li>Revenue or MRR, conversion from free ${st("UN")}</li>
          <li>Churn, refunds and chargebacks ${st("UN")}</li>
          <li>Testimonials or customer logos ${st("UN")}</li></ul></div>
       </div>
       <p class="small" style="margin-top:18px">These are the first numbers to request. Segment them by personal, creator and brand, and by geography.</p>`,
    ),
  ),
  S(
    "planning",
    "Planning assumptions — not actual results",
    [
      "5,000 subscribers × $15 blended (ASSUMPTION, research.md §18)",
      "scenario arithmetic (ASSUMPTION)",
      "list prices $7/$19 (SELF_REPORTED)",
      "cost per song, conversion, churn (UNKNOWN)",
    ],
    page(
      "B",
      "Planning",
      `Planning assumptions — not actual results`,
      `<p style="margin:-10px 0 20px;max-width:1000px">SongScribe publishes no revenue, users or costs. These scenarios only scale the research’s subscriber assumption. They are not forecasts and not company figures.</p>
       <div class="cols" style="grid-template-columns:1.25fr 1fr;gap:48px">
        <div><table class="t">
          <tr><th>Scenario ${st("AS")}</th><th>Paying subscribers</th><th>Blended $/month</th><th>ARR</th></tr>
          <tr><td>Early</td><td class="n">1,000</td><td class="n">15</td><td class="n">$0.18M</td></tr>
          <tr><td>Research cross-check</td><td class="n">5,000</td><td class="n">15</td><td class="n">$0.9M</td></tr>
          <tr><td>Stretch</td><td class="n">10,000</td><td class="n">15</td><td class="n">$1.8M</td></tr>
        </table>
        <p class="small" style="margin-top:10px">Arithmetic: subscribers × $15 × 12. The $15 blend sits between the published Starter ($7) and Creator ($19) prices.</p></div>
        <div><h3 class="mono">inputs still unknown</h3><ul class="lst" style="font-size:16px">
          <li style="font-size:16px">Model or vendor cost per generated song ${st("UN")}</li>
          <li style="font-size:16px">Credits consumed per generation ${st("UN")}</li>
          <li style="font-size:16px">Free-to-paid conversion and churn ${st("UN")}</li>
          <li style="font-size:16px">Top-up and enterprise revenue mix ${st("UN")}</li></ul></div>
       </div>`,
    ),
  ),
  S(
    "roadmap",
    "Roadmap & scalability",
    [
      "founder vision line (SELF_REPORTED, zinomario.com)",
      "Agency/Enterprise white-label and API (SELF_REPORTED, /licensing)",
      "steps the evidence calls for (ASSUMPTION)",
      "EU AI Act Art. 50 from 2 Aug 2026 (research.md §17)",
    ],
    page(
      "C",
      "Roadmap",
      `“As simple and universal as sending a message.”`,
      `<div class="cols c2" style="gap:52px">
        <div><h3 class="mono">stated direction ${st("SR")}</h3><ul class="lst">
          <li>Founder’s vision: studio-grade music creation “as simple and universal as sending a message” (zinomario.com)</li>
          <li>Agency & Enterprise: bulk pricing, custom licensing, white-label and API access (/licensing)</li>
          <li>Two variations per generation today; “unlimited” on the top subscription per the FAQ</li></ul></div>
        <div><h3 class="mono">next steps the evidence calls for ${st("AS")}</h3><ul class="lst">
          <li>One reconciled price list across pricing, FAQ, terms and licensing</li>
          <li>Machine-readable AI marking on outputs for EU distribution (AI Act Art. 50, applicable from 2 Aug 2026)</li>
          <li>Disclose the model vendor and its output and training-data terms</li>
          <li>Align the contracting entity in the Terms with the UK company</li></ul></div>
       </div>
       <p class="small" style="margin-top:16px">Scalability ${st("AS")}: software delivery is global; cost per song and licence quality scale with the upstream model vendor’s pricing and terms.</p>`,
    ),
  ),
  S(
    "team",
    "Team & founders",
    [
      "cofounders Zino Mario and Excel Chukwu (OWNER_PROVIDED)",
      "Zino Mario sole director/≥75% PSC (VERIFIED_PUBLIC)",
      "Zino Aviation CEO (VERIFIED_PUBLIC, Nairametrics)",
      "music producer self-claim (SELF_REPORTED)",
      "Excel Chukwu role/equity (UNKNOWN)",
    ],
    page(
      "C",
      "Team",
      `Credits`,
      `<div class="cols c2" style="gap:56px">
        <div>
          <div class="big" style="font-size:40px;margin-bottom:6px">Zino Mario</div>
          <div style="margin-bottom:12px;font-size:16px;color:var(--lt)">Cofounder ${st("OP", "cofounder role")}</div>
          <ul class="lst">
            <li>Sole director and ≥75% PSC of SONGSCRIBE AI LTD, registered as Mario-Ghae Efezino ${st("VP")}</li>
            <li>Founder and CEO of Zino Aviation, Lagos (Nairametrics, 2026-07-19) ${st("VP")}</li>
            <li>“Multi-instrumentalist and music producer”; founder of SongScribe AI ${st("SR", "zinomario.com")}</li>
            <li>Previously founded Zino Aviation (2018, Lagos), which he leads as CEO; experience as a licensed pilot in Nigeria and the UK (as of October 2026) ${st("SR")}</li>
          </ul>
        </div>
        <div>
          <div class="big" style="font-size:40px;margin-bottom:6px">Excel Chukwu</div>
          <div style="margin-bottom:12px;font-size:16px;color:var(--lt)">Cofounder ${st("OP", "cofounder role")}</div>
          <ul class="lst">
            <li>Not named on songscribe.ai; not an officer or PSC of the UK company ${st("VP", "register")}</li>
            <li>With Zino Mario at ≥75%, all other shareholders hold at most 25% in the UK company ${st("VP", "PSC filing")}</li>
            <li>Role, equity, vesting and professional background ${st("UN")}</li>
          </ul>
        </div>
       </div>
       <p class="small" style="margin-top:16px">Founder bandwidth is a diligence point: Zino Mario also leads Zino Aviation and KUUZA AI, and is a Partner at FDN Capital Partners.</p>`,
    ),
  ),
  S(
    "risks",
    "Key risks & mitigations (incl. chain-of-title and regulation)",
    [
      "risks 1-7 and regulatory items (research.md §16-17)",
      "mitigations (ASSUMPTION)",
    ],
    page(
      "C",
      "Risks",
      `Chain of title is the risk that decides the rest.`,
      `<table class="t" style="font-size:14px">
        <tr><th style="width:27%">Risk</th><th style="width:40%">Why it matters</th><th>Mitigation ${st("AS")}</th></tr>
        <tr><td><b>Chain of title and model provenance</b></td><td>Exclusive and “full rights” grants are only as good as the undisclosed model’s training data and terms; label suits against Suno and Udio were only partly settled in late 2025</td><td>Name the vendor; secure licensed-data warranties and indemnities</td></tr>
        <tr><td><b>Copyrightability</b> — US human-authorship rule; UK CDPA s9(3); Nigerian Copyright Act 2022 untested</td><td>“Ownership certificates” and Content ID claims on AI output can trigger disputes</td><td>Legal opinion per market; reword certificates</td></tr>
        <tr><td><b>EU AI Act Art. 50</b>; ELVIS Act and voice-likeness laws</td><td>AI audio must be machine-marked for EU distribution; sound-alike bans alone are not enough</td><td>Watermark or metadata on every output</td></tr>
        <tr><td><b>Pricing and terms</b> — four tier schemes; strict no-refund; NDPA, FCCPC, UK CCR 2013</td><td>Consumer complaints and chargebacks</td><td>One price list; compliant cancellation flow</td></tr>
        <tr><td><b>Entity mismatch</b>; minors from 13 and real names in songs</td><td>Terms name a different company; personal data of young users</td><td>Fix the contracting entity; age and data controls</td></tr>
        <tr><td><b>Commoditisation; founder bandwidth</b></td><td>Suno and Udio pricing; several ventures; cofounder role unclear</td><td>Focus on occasion and licence packaging; state time commitment</td></tr>
       </table>`,
    ),
  ),
  S(
    "funding",
    "Funding: to be confirmed by the founders",
    ["funding raised (UNKNOWN — not zero)", "cap table, entity map (UNKNOWN)"],
    page(
      "C",
      "Funding",
      `Funding: <span class="r">to be confirmed by the founders.</span>`,
      `<p style="margin:-6px 0 20px;max-width:980px">No raise, round size, valuation or use of funds has been published, and none is assumed here. Funding raised to date: none found publicly — unknown, not zero. ${st("UN")}</p>
       <div class="cols c2" style="gap:52px">
        <div><h3 class="mono">what the founders need to supply</h3><ul class="lst">
          <li>Amount sought, instrument and valuation expectations ${st("UN")}</li>
          <li>Use of funds by line: model and licensing, product, marketing, legal ${st("UN")}</li>
          <li>Runway and monthly burn ${st("UN")}</li></ul></div>
        <div><h3 class="mono">and the structure it sits on</h3><ul class="lst">
          <li>Entity map: UK SONGSCRIBE AI LTD vs. any Nigerian “SongScribe Ltd” ${st("UN")}</li>
          <li>Cap table, Excel Chukwu’s equity, vesting and IP assignment ${st("UN")}</li>
          <li>Which entity contracts with users and receives payments ${st("UN")}</li></ul></div>
       </div>`,
    ),
  ),
  S(
    "next red",
    "Investment opportunity & next steps",
    [
      "thesis summary (SELF_REPORTED + VERIFIED_PUBLIC market data + ASSUMPTION)",
      "open questions 1-9 (research.md §19)",
    ],
    page(
      "C",
      "Next steps",
      `A priced product in a paying category. <span class="r">Now prove the rights and the revenue.</span>`,
      `<div class="cols c2" style="gap:52px">
        <div><h3 class="mono">the opportunity</h3><ul class="lst">
          <li>Live product with published prices from $7 a month ${st("SR")}</li>
          <li>Proven willingness to pay for AI songs (Suno ~$200M revenue) and a $199 human price anchor ${st("VP")}</li>
          <li>African genre and language fluency; Sub-Saharan Africa grew 22.6% in 2024, the second-fastest region ${st("SR")} ${st("VP")}</li>
          <li>A verified UK company controlled by the founder ${st("VP")}</li></ul></div>
        <div><h3 class="mono">the data-room request</h3><ul class="lst">
          <li>Model vendor, terms, training-data licences, indemnities</li>
          <li>Paying users, MRR, conversion, churn, refunds by segment</li>
          <li>Reconciled price list and credits per generation</li>
          <li>Entity map, cap table, IP assignment</li>
          <li>Copyright and AI Act Art. 50 legal opinion; data-hosting map</li></ul></div>
       </div>
       <p class="small" style="margin-top:14px">Contact (published): support@songscribe.ai ${st("SR")}</p>`,
      { red: true },
    ),
  ),
  {
    id: "sources",
    title: "Sources & evidence status",
    uses: ["all source URLs and fetch dates (facts.json)"],
    html: (
      ctx,
    ) => `${strip("C", "Sources")}<div class="box"><div class="trk mono">C6 · liner notes</div><h2 style="font-size:34px;margin-bottom:14px">Sources & evidence status</h2>
      <div class="cols" style="grid-template-columns:1.6fr 1fr;gap:36px">
       <table class="t" style="font-size:11.5px">
        <tr><th>Source (all fetched 2026-10-18 UTC)</th><th>Status</th></tr>
        <tr><td>songscribe.ai — /, /pricing, /faq (site bundle), /samples, /licensing, /terms, /privacy, /refund</td><td>${st("SR")}</td></tr>
        <tr><td>find-and-update.company-information.service.gov.uk/company/17031583 (+ /officers, /persons-with-significant-control)</td><td>${st("VP")}</td></tr>
        <tr><td>zinomario.com</td><td>${st("SR")}</td></tr>
        <tr><td>nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/</td><td>${st("VP")}</td></tr>
        <tr><td>musicbusinessworldwide.com — global recorded music revenues hit $29.6bn in 2024 · musicinafrica.net/node/358892</td><td>${st("VP")}</td></tr>
        <tr><td>cisac.org/Newsroom/news-releases/global-economic-study-shows-human-creators-future-risk-generative-ai</td><td>${st("VP")}</td></tr>
        <tr><td>techcrunch.com/2025/11/19/legally-embattled-ai-music-startup-suno-raises-at-2-45b-valuation-on-200m-revenue/</td><td>${st("VP")}</td></tr>
        <tr><td>fortune.com/2025/11/26/what-warner-musics-settlement-with-suno-says-about-the-ai-bubble · bostonglobe.com/2025/11/25/business/warner-music-lawsuit-ai-suno/</td><td>${st("VP")}</td></tr>
        <tr><td>digitalmusicnews.com/?p=208933 (Songfinch)</td><td>${st("VP")}</td></tr>
        <tr><td>search.cac.gov.ng — not queryable (JavaScript-only)</td><td>${st("UN")}</td></tr>
       </table>
       <div><ul class="lst" style="font-size:13px">
          <li style="font-size:13.5px;padding:7px 0">${st("VP")} independent record or third-party press</li>
          <li style="font-size:13.5px;padding:7px 0">${st("SR")} company or founder’s own website</li>
          <li style="font-size:13.5px;padding:7px 0">${st("OP")} supplied by the Capital Q owner</li>
          <li style="font-size:13.5px;padding:7px 0">${st("AS")} analyst arithmetic or inference</li>
          <li style="font-size:13.5px;padding:7px 0">${st("UN")} not publicly findable; never read as zero</li></ul>
        <p class="small" style="margin-top:12px;font-size:12px">Prepared offline from docs/flagship/songscribe/research.md and facts.json. No founder documents used. Typographic wordmark only: the site publishes no asset licence. Sample songs and cover art (real names) are not reproduced.</p>
       </div>
      </div></div>${foot(ctx)}`,
  },
];

export default {
  slug: "songscribe",
  company: "SongScribe AI",
  title: "SongScribe AI — Investor deck",
  fonts: [
    ["Geist Mono", "GeistMono-Regular.ttf", 400],
    ["Geist Mono", "GeistMono-Bold.ttf", 700],
  ],
  css,
  slides,
  readme: {
    direction:
      'Dark cinematic SongScribe brand (#0A0A0A, red #E63946/#DC2B3C, maroon #7F1D1D, amber #F59E0B; Inter Display heavy headlines, Geist Mono labels). Narrative device: an album — Side A "the song" (product), Side B "the business", then "liner notes & credits". A tracklist strip on every slide shows position; the market and next-steps slides are full red "singles"; the title uses a square red record sleeve. Visually distinct from KUUZA\'s two-column investor-call layout.',
    brand: [
      "Colours from `brand.json` (site HTML and compiled CSS). Space Grotesk (brand display font, itself an ASSUMPTION in brand.json) is not available offline, so headlines use Inter Display; Geist Mono is the OFL file in `scripts/seed/flagship/deck/fonts/`.",
      "No logo file used: the site publishes no asset licence ('All rights reserved'). The wordmark is typographic — SONG in red, SCRIBE in white — matching the logo's split colouring without the S glyph. Logo source recorded in brand.json: https://www.songscribe.ai/images/songscribe-logo.png.",
      "No photography or sample cover art: samples contain real people's names.",
    ],
    omitted: [
      "Sample song titles and names (e.g. personal commissions): real people's names.",
      "Users, revenue, MRR, testimonials, funding, valuation: UNKNOWN — shown only as unknown.",
      "Studio price shown as the live /pricing figure ($179); the FAQ's $199 is shown only as a conflict.",
      "Excel Chukwu's background: no public footprint; only his owner-provided cofounder role is stated.",
    ],
  },
};
