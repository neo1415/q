import type {
  QAnswerCard,
  QAnswerCardLevel,
  QAnswerCardsBlock,
} from "@capital-q/contracts";

/**
 * Fictional answers for the /dev/canvas preview and the tests (the
 * mockup's demo content). No real companies or people.
 */

type M = readonly [string, QAnswerCardLevel, string];
const L = (stage: M, sector: M, geo: M, cheque: M, traction: M, team: M) =>
  [stage, sector, geo, cheque, traction, team].map(([label, level, value]) => ({
    label,
    level,
    value,
  }));

function card(
  key: string,
  name: string,
  line: string,
  score: number,
  measured: number,
  hue: number,
  reasons: readonly string[],
  measures: QAnswerCard["measures"],
  said: string | null = null,
  view: string | null = null,
): QAnswerCard {
  return {
    key,
    name,
    line,
    hue,
    fit: { score, measured, of: 6 },
    reasons: [...reasons],
    measures,
    view,
    said,
    sourceCount: 3,
    subject: null,
  };
}

export const DEMO_COMPANIES: readonly QAnswerCard[] = [
  card(
    "norrland",
    "Norrland Grid",
    "Schedules grid batteries to sell power at the best hour",
    8.6,
    5,
    1,
    [
      "Seed round inside your cheque range",
      "Grid software is core to your mandate",
      "£38k a month in revenue, backed by statements",
    ],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "STRONG", "Grid software"],
      ["Geography", "GOOD", "Sweden"],
      ["Cheque", "STRONG", "£400k open"],
      ["Traction", "GOOD", "£38k a month"],
      ["Team", "UNKNOWN", "Not shared yet"],
    ),
    "Norrland Grid fits best: a seed round in your range, and revenue backed by statements.",
    "Go for it: book a call",
  ),
  card(
    "kestrel",
    "Kestrel Heat",
    "Heat pumps for terraced homes, installed in a day",
    8.1,
    6,
    2,
    [
      "Climate hardware with recurring service income",
      "Two founders who built an installer before",
      "Raising £900k, lead not yet set",
    ],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "GOOD", "Home energy"],
      ["Geography", "STRONG", "UK"],
      ["Cheque", "STRONG", "£900k round"],
      ["Traction", "GOOD", "310 installs"],
      ["Team", "STRONG", "Second company"],
    ),
    "Kestrel Heat is close behind: a strong team, and the round has no lead yet.",
    "Meet: ask who leads",
  ),
  card(
    "atlas",
    "Atlas Ledger",
    "Treasury software for small lenders",
    7.4,
    5,
    3,
    [
      "Fintech with paying lenders",
      "Round is at the top of your range",
      "Revenue is a claim: no documents yet",
    ],
    L(
      ["Stage", "GOOD", "Series A"],
      ["Sector", "STRONG", "Fintech"],
      ["Geography", "STRONG", "UK"],
      ["Cheque", "PARTIAL", "£1.5m minimum"],
      ["Traction", "UNKNOWN", "Claimed, no documents"],
      ["Team", "GOOD", "Ex-bank team"],
    ),
    "Atlas Ledger fits the sector, but its revenue is only a claim so far.",
    "Wait for revenue documents",
  ),
  card(
    "tidewater",
    "Tidewater Labs",
    "Sensors that find leaks in water mains",
    7.1,
    6,
    4,
    [
      "Climate adjacent, utility buyers",
      "Pilots with two councils",
      "Long sales cycles",
    ],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "PARTIAL", "Water"],
      ["Geography", "GOOD", "Norway"],
      ["Cheque", "GOOD", "£600k open"],
      ["Traction", "PARTIAL", "2 pilots"],
      ["Team", "GOOD", "Engineers"],
    ),
  ),
  card(
    "morrow",
    "Morrow Pay",
    "Pay-by-bank checkout for marketplaces",
    6.9,
    6,
    5,
    ["Fintech, early revenue", "Crowded field", "Strong founder-market fit"],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "GOOD", "Payments"],
      ["Geography", "STRONG", "UK"],
      ["Cheque", "STRONG", "£500k open"],
      ["Traction", "PARTIAL", "£9k a month"],
      ["Team", "GOOD", "Ex-Adyen"],
    ),
  ),
  card(
    "lumen",
    "Lumen Carbon",
    "Measures carbon in farm soil from satellite data",
    6.4,
    5,
    6,
    [
      "Climate, very early",
      "Below your usual stage",
      "Science team with a patent",
    ],
    L(
      ["Stage", "PARTIAL", "Pre-seed"],
      ["Sector", "STRONG", "Carbon"],
      ["Geography", "GOOD", "Denmark"],
      ["Cheque", "GOOD", "£300k open"],
      ["Traction", "UNKNOWN", "Pre-revenue"],
      ["Team", "STRONG", "PhD founders"],
    ),
  ),
  card(
    "ferrous",
    "Ferrous Works",
    "Recycles steel offcuts into new stock",
    6.2,
    6,
    7,
    ["Industrial climate play", "Capital heavy", "Real revenue"],
    L(
      ["Stage", "GOOD", "Series A"],
      ["Sector", "GOOD", "Materials"],
      ["Geography", "STRONG", "UK"],
      ["Cheque", "PARTIAL", "£3m round"],
      ["Traction", "STRONG", "£1.1m a year"],
      ["Team", "GOOD", "Operators"],
    ),
  ),
  card(
    "quarry",
    "Quarry Health",
    "Claims checks for private clinics",
    5.8,
    5,
    1,
    ["Outside your sectors", "Good traction", "Fits on cheque"],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "PARTIAL", "Health admin"],
      ["Geography", "STRONG", "UK"],
      ["Cheque", "STRONG", "£700k open"],
      ["Traction", "GOOD", "£20k a month"],
      ["Team", "UNKNOWN", "Not shared yet"],
    ),
  ),
  card(
    "sable",
    "Sable Freight",
    "Shared electric vans for city deliveries",
    5.5,
    6,
    2,
    ["Climate logistics", "Unit costs unproven", "Fits on stage"],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "GOOD", "Logistics"],
      ["Geography", "GOOD", "Norway"],
      ["Cheque", "GOOD", "£800k open"],
      ["Traction", "PARTIAL", "1 city"],
      ["Team", "GOOD", "Ex-Bring"],
    ),
  ),
  card(
    "halcyon",
    "Halcyon Cooling",
    "Low-power cooling for small data rooms",
    5.2,
    6,
    3,
    ["Energy efficiency", "Ireland is outside your regions", "Early pilots"],
    L(
      ["Stage", "STRONG", "Seed"],
      ["Sector", "GOOD", "Efficiency"],
      ["Geography", "PARTIAL", "Ireland"],
      ["Cheque", "GOOD", "£600k open"],
      ["Traction", "PARTIAL", "3 pilots"],
      ["Team", "GOOD", "Engineers"],
    ),
  ),
];

const NUMBER_TITLES: Readonly<Record<number, string>> = {
  1: "Top pick for your mandate",
  3: "Top three for your mandate",
};

export function demoTop(n: number): QAnswerCardsBlock {
  return {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: NUMBER_TITLES[n] ?? `Top ${String(n)} for your mandate`,
    cards: DEMO_COMPANIES.slice(0, n),
    followUps: [
      "Compare side by side",
      "Draft an intro to Norrland Grid",
      "Why is Atlas Ledger third?",
    ],
  };
}

export const DEMO_COMPARE: QAnswerCardsBlock = {
  kind: "ANSWER_CARDS",
  shape: "SIDE_BY_SIDE",
  title: "Compare them side by side",
  cards: DEMO_COMPANIES.slice(0, 3),
  followUps: [],
};

export const DEMO_RESEARCH: QAnswerCardsBlock = {
  kind: "ANSWER_CARDS",
  shape: "RESEARCH",
  title: "Research Y Combinator",
  cards: [
    {
      key: "yc-what",
      name: "What Y Combinator is",
      line: "An accelerator that invests in very early companies, several batches a year",
      hue: 1,
      fit: null,
      reasons: [
        "A standard deal: a fixed cheque for a small stake",
        "Batches of a few hundred companies",
        "Demo Day is where most rounds start",
      ],
      measures: [],
      view: null,
      said: "Y Combinator invests in very early companies, in several batches a year.",
      sourceCount: 4,
      subject: null,
    },
    {
      key: "yc-you",
      name: "What it means for you",
      line: "Where its companies meet your mandate",
      hue: 3,
      fit: null,
      reasons: [
        "Climate and fintech are a growing share of each batch",
        "Most raise a seed round within weeks of Demo Day",
        "UK and Nordic founders are a small minority",
      ],
      measures: [],
      view: null,
      said: "For you, its climate and fintech companies are worth watching after Demo Day.",
      sourceCount: 3,
      subject: null,
    },
    {
      key: "yc-ask",
      name: "Questions to ask",
      line: "What Q could not confirm",
      hue: 4,
      fit: null,
      reasons: [
        "Current valuation caps at Demo Day: not public",
        "How many climate companies in the current batch",
        "Whether European companies relocate",
      ],
      measures: [],
      view: null,
      said: "Three things I couldn’t confirm. I can keep looking.",
      sourceCount: 2,
      subject: null,
    },
  ],
  followUps: ["Which YC companies fit my mandate?"],
};
