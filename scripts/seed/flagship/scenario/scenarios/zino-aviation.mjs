// Zino Aviation: illustrative high-growth scenario (synthetic evidence).
// Every number here is invented for illustration and internally consistent;
// none is the company's actual performance (real revenue, margins and
// student counts are UNKNOWN). Public context (Academy and Jet divisions,
// Lagos Boeing 737NG simulator, partner flight schools, trading since 2018,
// UK company since 2020-12-24) comes from docs/flagship/zino-aviation/research.md.

export default {
  slug: "zino-aviation",
  company: "Zino Aviation",
  stageCode: "growth",
  stageNote:
    "Established services business, not a pre-seed technology start-up: trading since 2018 and a UK company since 2020-12-24, with no venture round. The engine's stage bands are funding rounds, so the scenario uses the 'growth' band (SERIES_A_GROWTH), whose weights stress traction, unit economics and operating leverage (P4 16, P5 12, P11 9) over founder and market narrative. Scoring a mature operator as pre-seed would overweight its founder story. The business is capital-intensive at the Academy (an owned Lagos 737NG simulator, partly financed by an asset-backed facility) and asset-light at Jet (advisory and brokerage, no owned aircraft).",
  sectorCodes: ["aviation_services", "education"],
  businessModelCodes: ["services", "brokerage"],
  overview:
    "Zino Aviation earns fees and commissions from two divisions. The Academy sells Lagos simulator sessions, ground school, pilot placement and cadet programme management, and earns a fee (not the full tuition) on partner flight-school programmes. Jet earns aircraft charter and acquisition brokerage commissions and advisory fees. The scenario reports in USD (naira receipts converted at each month's average rate) and measures to 30 September 2026.",
  keyFigures: [
    ["Revenue FY2025 (Jan to Dec 2025)", "USD 1.62 million"],
    [
      "Revenue Q3 2025 / Q3 2026",
      "USD 430,000 / USD 610,000 (+42% year on year)",
    ],
    [
      "Q3 2026 mix",
      "Academy USD 420,000; Jet USD 190,000 (fees and commissions only)",
    ],
    ["Contribution margin Q3 2026", "46% (USD 280,600 on USD 610,000)"],
    [
      "Repeat purchase revenue Q3 2026",
      "USD 268,000 (44% of revenue); 7 of 8 programme clients renewed for 2026",
    ],
    ["Blended CAC / payback", "USD 1,500 per account / 2.5 months"],
    [
      "Cash / net outflow / runway",
      "USD 650,000 / USD 25,000 per month incl. simulator capex / 26 months",
    ],
    [
      "Bottom-up accessible market (Academy)",
      "9,000 pilots x USD 9,500 per year = about USD 85M per year",
    ],
  ],
  founders: [
    {
      id: "zino-aviation-founder-ceo",
      criterion: "P1.A",
      title: "and CEO",
      detail:
        "has 8 years of experience as a licensed commercial and offshore helicopter pilot and domain expertise in West African pilot careers; he has led the business since 2018.",
    },
  ],
  claims: [
    {
      id: "zino-aviation-p1b",
      criterion: "P1.B",
      claimKey: "founder.execution",
      statement:
        "The founder changed the Academy offer in response to customer feedback in 2025, adding employment bootcamps, and delivered the Ghana cadet intake milestone in May 2026.",
    },
    {
      id: "zino-aviation-p2a",
      criterion: "P2.A",
      claimKey: "market.accessible_demand",
      statement:
        "Bottom-up accessible market sized from customer spending of USD 9,500 per pilot per year on type-rating preparation, recurrent simulator time and placement (Q3 2026 average of paying pilots) across about 9,000 licensed and cadet pilots in Nigeria and West Africa, or about USD 85 million per year for the Academy alone.",
    },
    {
      id: "zino-aviation-p2b",
      criterion: "P2.B",
      claimKey: "market.expansion",
      statement:
        "Expansion into Ghana: 4 Accra charter operators and 120 Ghanaian cadets became paying customers between April 2026 and September 2026 under a signed distribution agreement with an Accra school partner.",
    },
    {
      id: "zino-aviation-p3a",
      criterion: "P3.A",
      claimKey: "customers.problem_validation",
      statement:
        "Paying customers cite one problem: licensed West African pilots lack type-rating preparation and recurrent simulator time near home; 1,140 paying customers bought Lagos simulator, ground school or placement services in Q3 2026.",
    },
    {
      id: "zino-aviation-p3b",
      criterion: "P3.B",
      claimKey: "customers.retention",
      statement:
        "Retained customers: 7 of the 8 airline and government programme clients from 2025 renewed for 2026, and repeat purchases were 44% of Q3 2026 revenue.",
    },
    {
      id: "zino-aviation-p4a",
      criterion: "P4.A",
      claimKey: "traction.revenue_velocity",
      statement:
        "Revenue grew 42% year on year in 2026: USD 430,000 in Q3 2025 (July 2025 to September 2025) to USD 610,000 in Q3 2026 (July 2026 to September 2026).",
    },
    {
      id: "zino-aviation-p4b",
      criterion: "P4.B",
      claimKey: "traction.repeat_revenue",
      statement:
        "Repeat purchase revenue of USD 268,000 in Q3 2026 (July 2026 to September 2026) came from returning airline, operator and simulator customers, 44% of revenue.",
    },
    {
      id: "zino-aviation-p5a",
      criterion: "P5.A",
      claimKey: "financial.contribution_economics",
      statement:
        "Positive contribution margin of 46% measured on Q3 2026 actual revenue of USD 610,000 after instructor, simulator operating, partner and broker costs of USD 329,400.",
    },
    {
      id: "zino-aviation-p5b",
      criterion: "P5.B",
      claimKey: "financial.acquisition_payback",
      statement:
        "Acquisition payback measured at 2.5 months for corporate and cadet accounts won in Q2 2026 and Q3 2026: blended CAC of USD 1,500 against USD 600 monthly contribution per account.",
    },
    {
      id: "zino-aviation-p6a",
      criterion: "P6.A",
      claimKey: "product.differentiated_asset",
      statement:
        "Proprietary dataset deployed in placement: assessment records of 3,800 West African pilots and cadets, used by customers (partner airlines and operators) to shortlist candidates since 2024.",
    },
    {
      id: "zino-aviation-p7a",
      criterion: "P7.A",
      claimKey: "distribution.channel",
      statement:
        "Partner sales channel through flight schools and airlines is repeatable: it produced 38% of revenue in Q3 2026 and 36% in Q3 2025.",
    },
    {
      id: "zino-aviation-p7b",
      criterion: "P7.B",
      claimKey: "distribution.organic_pull",
      statement:
        "Referrals measured: returning customers and alumni referred 31% of new paying customers between April 2026 and September 2026.",
    },
    {
      id: "zino-aviation-p8a",
      criterion: "P8.A",
      claimKey: "capital.runway",
      statement:
        "Current runway is 26 months at September 2026 net cash outflow of USD 25,000 per month including simulator capital expenditure, from cash of USD 650,000 held on 30 September 2026.",
    },
    {
      id: "zino-aviation-p8b",
      criterion: "P8.B",
      claimKey: "capital.strategic_support",
      statement:
        "Strategic support executed in June 2026: a USD 1.2 million asset-backed facility from a Lagos bank for simulator equipment, with an active agreement for a regional airline to send its first officers for recurrent simulator checks.",
    },
    {
      id: "zino-aviation-p9a",
      criterion: "P9.A",
      claimKey: "team.function_coverage",
      statement:
        "Technical, commercial and operational functions are covered: a head of instruction with 6 type-rated instructors and 2 simulator engineers, a commercial director for Academy and Jet, and an operations manager who runs scheduling, visas and welfare.",
    },
    {
      id: "zino-aviation-p9b",
      criterion: "P9.B",
      claimKey: "team.delivery",
      statement:
        "Operating milestones for 2026 were delivered on time: simulator recertification in March 2026, the Ghana cadet intake in May 2026 and the Jet advisory desk in September 2026.",
    },
    {
      id: "zino-aviation-p10a",
      criterion: "P10.A",
      claimKey: "market.timing",
      statement:
        "Structural demand documented: West African airlines added aircraft and routes in 2024 and 2025, and every airline pilot needs a type rating and recurrent simulator checks under civil aviation rules.",
    },
    {
      id: "zino-aviation-p10b",
      criterion: "P10.B",
      claimKey: "market.window",
      statement:
        "The market window is being used: Zino Aviation is deployed with 1,140 paying customers and 9 airline and operator clients in Nigeria and Ghana as of September 2026.",
    },
    {
      id: "zino-aviation-p11a",
      criterion: "P11.A",
      claimKey: "financial.operating_leverage",
      statement:
        "Revenue growth exceeds cost growth in actual 2026 results: Q3 2026 revenue rose 42% over Q3 2025 while total operating costs rose 24%.",
    },
    {
      id: "zino-aviation-p11b",
      criterion: "P11.B",
      claimKey: "operations.repeat_deployment",
      statement:
        "Repeat deployments completed in 2026: the cadet logistics programme ran for two airlines and one state government in Nigeria and went live in Ghana in May 2026.",
    },
    {
      id: "zino-aviation-p12a",
      criterion: "P12.A",
      claimKey: "ecosystem.partnership",
      statement:
        "Ecosystem partnership active since 2024 with two approved partner flight schools in South Africa and Greece, which delivered 64 cadet places in 2026.",
    },
    {
      id: "zino-aviation-p12b",
      criterion: "P12.B",
      claimKey: "strategy.adjacent_opportunity",
      statement:
        "Strategic opportunity in cadet financing has an executed agreement: a Lagos bank and Zino Aviation launched a cadet loan product in August 2026 with 40 approved cadets.",
    },
  ],
  structured: [
    {
      id: "zino-aviation-revenue",
      claimKey: "financial.revenue",
      statement:
        "Revenue USD 610,000 for Q3 2026 (July 2026 to September 2026).",
      value: {
        kind: "MONEY",
        amount: "610000",
        currency: "USD",
        periodEnd: "2026-09",
      },
    },
    {
      id: "zino-aviation-cm",
      claimKey: "financial.contribution_margin",
      statement: "Contribution margin 46% on Q3 2026 revenue.",
      value: { kind: "PERCENT", value: "46", asOf: "2026-09" },
    },
    {
      id: "zino-aviation-runway",
      claimKey: "financial.runway_months",
      statement: "Cash runway 26 months at 30 September 2026.",
      value: { kind: "MONTHS", value: "26", asOf: "2026-09-30" },
    },
    {
      id: "zino-aviation-growth",
      claimKey: "traction.growth",
      statement: "Revenue up 42% from Q3 2025 to Q3 2026.",
      value: {
        kind: "PERCENT",
        metric: "REVENUE",
        value: "42",
        periodStart: "2025-07",
        periodEnd: "2026-09",
        currency: "USD",
      },
    },
  ],
  ungraded: [
    {
      criterion: "P6.B",
      reason:
        "Independent defensibility test: the rubric's demonstrated anchor requires an independent (third-party) benchmark. Asserting one would be a claim of independent corroboration, which this scenario never makes, so the criterion is left UNKNOWN. An internal comparison of placement rates would grade only 2 (limited).",
    },
  ],
  realEvidenceGaps: [
    "Filed accounts: the UK company's FY2025 accounts were overdue on 2026-10-18; management accounts for 2025 and 2026.",
    "The legal entity that contracts with Nigerian customers (no CAC registration found) and any NCAA approvals for the simulator.",
    "Zino's own take (fee or commission) separated from pass-through partner tuition.",
    "Named airline, operator and government agreements behind placement and programme claims.",
  ],
};
