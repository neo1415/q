import type { AnalysisDocumentResult } from "@capital-q/q-core";

/**
 * The Maji Loop request (owner 2026-10-23, production 17:47 UTC) and what a
 * premium answer to it looks like, as test fixtures: the research a fake
 * provider serves, and the two drafts a fake analyst writes -- the first
 * with the faults production's critique found (an unlabelled figure, no
 * sequenced plan), the second fixing them. Synthetic; no live data.
 */

export const MAJI_LOOP_REQUEST =
  "I want a full growth plan for Maji Loop for the next 12 months. Do proper market research on water access and water kiosks in Kenya, size the market, look at competitors and alternatives, tell me what you think we should do and in what order, and put it in a document I can share with my team.";

export const MAJI_PAGES = [
  {
    url: "https://stats.example/kenya-water-access-2024",
    title: "Kenya household water access, 2024",
    topic: ["access", "households", "statistics", "demand"],
    text: "In 2024 about 62% of Kenyan households had access to basic drinking water. Around 4.1 million urban households buy water from kiosks or vendors, paying KES 3 to KES 5 per 20 litres.",
  },
  {
    url: "https://report.example/water-kiosk-market-kenya",
    title: "Water kiosks in Kenya: market size and growth",
    topic: ["kiosks", "size", "market", "growth"],
    text: "The Kenyan water vending market was worth KES 18 billion in 2023 and grew 7% a year since 2019, with around 12,000 registered water kiosks.",
  },
  {
    url: "https://news.example/majik-water-atms",
    title: "Majik Water and Grundfos Lifelink expand water ATMs in Nairobi",
    topic: ["competitors", "atm", "alternatives"],
    text: "Majik Water and Grundfos Lifelink operate water ATMs selling 20 litres for KES 5 in Nairobi settlements; household borehole connections cost KES 25,000.",
  },
  {
    url: "https://wasreb.example/kiosk-guidelines",
    title: "WASREB guidelines for water kiosks",
    topic: ["regulation", "wasreb", "licensing", "policy"],
    text: "WASREB requires kiosk operators to be licensed by the local water service provider and caps kiosk tariffs set by each utility.",
  },
];

/** The first draft: the faults production's critique found. */
export const MAJI_DRAFT_ONE: AnalysisDocumentResult = {
  title: "Maji Loop growth plan",
  summary:
    "Maji Loop should grow in Nairobi. The market is about KES 25 billion.",
  sections: [
    {
      heading: "Market",
      body: "The water market in Kenya is large and growing at 10% a year. Everything about Maji Loop's own numbers is unknown.",
    },
    {
      heading: "Competitors",
      body: "There are several competitors.",
    },
    {
      heading: "Recommendations",
      body: "Grow faster and raise money.",
    },
  ],
  topRecommendations: ["Grow faster."],
  gaps: [],
};

/** The revision: sized with assumptions, sourced, sequenced, owned. */
export const MAJI_DRAFT_TWO: AnalysisDocumentResult = {
  title: "Maji Loop: 12-month growth plan",
  summary:
    "Kenya's kiosk water market is large, growing and fragmented: KES 18 billion in 2023 [S2], growing about 7% a year [S2]. Maji Loop should win dense Nairobi settlements first with a lower price per litre than water ATMs, prove unit economics on 40 kiosks, then expand to Mombasa and Kisumu in the second half (Q's inference).",
  sections: [
    {
      heading: "Executive summary",
      body: "Around 4.1 million urban households buy from kiosks or vendors [S1], and the market was worth KES 18 billion in 2023 [S2]. The opportunity is real but price-sensitive: water ATMs sell 20 litres for KES 5 [S3]. Our recommendation is to concentrate the first two quarters on Nairobi, prove kiosk-level profitability, and only then open two new cities (Q's inference).",
    },
    {
      heading: "Market and sizing",
      body: "Top-down: KES 18 billion in 2023 [S2], about KES 19.3 billion in 2024 (estimate: KES 18 billion × 1.07 growth [S2]). Bottom-up: 4.1 million households [S1] × 20 litres a day × KES 4 per 20 litres (estimate: mid-point of KES 3 to KES 5 [S1]) ≈ KES 6 billion a year in urban kiosk spend (estimate). The gap between the two suggests the top-down figure includes bulk and rural vending; we treat KES 6-19 billion as the range (estimate).",
    },
    {
      heading: "Customer segments",
      body: "1. Households in informal settlements buying 20-litre jerrycans daily [S1].\n2. Small businesses (food vendors, salons) buying in bulk (Q's inference).\n3. Schools and clinics needing reliable daily supply (Q's inference).",
    },
    {
      heading: "Competitors and alternatives",
      body: "Name | What they offer | Where | Price or scale | Source\nMajik Water | Water ATMs | Nairobi settlements | KES 5 per 20 litres | [S3]\nGrundfos Lifelink | Water ATMs | Nairobi settlements | KES 5 per 20 litres | [S3]\nBorehole connection | Household connection | Peri-urban | KES 25,000 to connect | [S3]\nUtility kiosks | Licensed kiosks | Nationwide | 12,000 registered | [S2]",
    },
    {
      heading: "Our position",
      body: "Maji Loop's record says it runs kiosks in Nairobi (company record, self-reported). Its own volumes and margins are not in the record, so the plan below sets them as the first thing to measure.",
    },
    {
      heading: "Recommendations and sequencing",
      body: "1. Q1 — Instrument every kiosk: litres sold, price, downtime. Owner: Head of operations. Metric: daily litres per kiosk.\n2. Q1 — Secure licences with the local water service provider for every site [S4]. Owner: CEO. Metric: share of kiosks licensed.\n3. Q2 — Price at KES 4 per 20 litres to undercut ATMs at KES 5 [S3]. Owner: Head of growth. Metric: repeat purchase rate.\n4. Q3 — Open 10 kiosks in one new city after Nairobi kiosks reach break-even. Owner: COO. Metric: payback months.\n5. Q4 — Raise the next round on proven unit economics. Owner: CEO. Metric: kiosk-level gross margin.",
    },
    {
      heading: "Metrics to track",
      body: "Litres per kiosk per day; price per 20 litres versus ATMs [S3]; kiosk uptime; payback months per kiosk; share of kiosks licensed [S4].",
    },
    {
      heading: "Risks and mitigations",
      body: "Tariff caps set by each utility limit pricing [S4]: model margins at the cap. ATM operators may cut prices [S3]: keep cost per litre below theirs. Expansion before unit economics are proven burns cash (Q's inference): gate city two on break-even.",
    },
    {
      heading: "Evidence gaps",
      body: "Maji Loop's own litres, revenue and margins are not on record. No public source gives churn between kiosks and ATMs.",
    },
  ],
  topRecommendations: [
    "Instrument every kiosk in Q1 so volumes and margins are known before spending on growth.",
    "Price at KES 4 per 20 litres in Q2 to undercut water ATMs at KES 5.",
    "Open a second city in Q3 only once Nairobi kiosks break even.",
  ],
  gaps: [
    "Maji Loop's own volumes, revenue and margins.",
    "Churn between kiosks and water ATMs.",
  ],
};
