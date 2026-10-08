import { promiseSuite } from "../support/promise.js";
import { CAST, world } from "../support/stack.js";

/**
 * Matching and understanding promises: Q.02 learns how each investor
 * thinks, Q.05 finds the right investors (founders), Q.06 finds the right
 * opportunities (investors), Q.07 lets investors interview the opportunity,
 * Q.08 understands every business the same way.
 */
const W = world();
const ledgerfold = W.company("ledgerfold");
const savanna = W.investor("savanna-seed");
const items = (b: unknown) =>
  Array.isArray((b as { items?: unknown } | null)?.items) &&
  (b as { items: unknown[] }).items.length > 0;

promiseSuite({
  id: "Q.02",
  title: "Learns how each investor thinks",
  actor: CAST.investor,
  page: "/discover",
  landmark: /For you/u,
  data: {
    service: "api",
    path: `/v1/investors/${savanna.investorOrganisationId}/mandates`,
    nonEmpty: items,
  },
  backend: { service: "q-api", path: "/v1/fit/thesis" },
  ui: 'nav[aria-label="Discover"]',
  question: "What do you understand about my thesis?",
  expected: "You back seed-stage fintech in West Africa.",
  // Another investor's thesis never reveals Savanna Seed's mandate.
  authorization: {
    as: CAST.unrelatedInvestor,
    service: "q-api",
    path: "/v1/fit/thesis",
    expect: { mustNotContain: savanna.mandateId },
  },
  tools: /mandate|thesis|read_my_record/u,
  honesty: { forbid: /learns? (continuously|from your behaviour)/iu },
  awaits: { 5: [["G-R3"], "turn disposition attribute"] },
});

promiseSuite({
  id: "Q.05",
  title: "Finds the right investors (for founders)",
  actor: CAST.founder,
  page: "/investors",
  landmark: /investor/iu,
  data: { service: "api", path: "/v1/discovery/investors", nonEmpty: items },
  backend: { service: "api", path: "/v1/discovery/investors" },
  ui: "main a[href*='/investors/']",
  question: "Which investors should I approach first?",
  expected: "Start with Savanna Seed.",
  // Founders are matched on investors' public criteria; a private mandate
  // is never readable by a founder (Context Firewall, CLAUDE.md).
  authorization: {
    as: CAST.founder,
    service: "api",
    path: `/v1/investors/${savanna.investorOrganisationId}/mandates`,
    expect: "refused",
  },
  tools: /discover|investor/u,
  honesty: { forbid: /mandates? (they|you) genuinely meet/iu },
  awaits: { 5: [["G-R3"], "turn disposition attribute"] },
});

promiseSuite({
  id: "Q.06",
  title: "Finds the right opportunities (for investors)",
  actor: CAST.investor,
  page: "/discover",
  landmark: /For you/u,
  data: { service: "api", path: "/v1/discovery/companies", nonEmpty: items },
  backend: { service: "q-api", path: "/v1/fit/top" },
  ui: "main article, main [data-discover-card]",
  question: "Which three companies fit my mandate best?",
  expected: "Ledgerfold fits best.",
  authorization: {
    as: CAST.unrelatedInvestor,
    service: "q-api",
    path: "/v1/fit/top",
    expect: { mustNotContain: savanna.mandateId },
  },
  tools: /fit|discover|search_companies/u,
  // An investor never sees a lower x/10 above a higher one unlabelled (promises doc item 7).
  honesty: { forbid: /NaN|undefined/u },
  awaits: { 5: [["G-R3"], "turn disposition attribute"] },
});

promiseSuite({
  id: "Q.07",
  title: "Lets investors interview the opportunity",
  actor: CAST.investor,
  page: `/company/${ledgerfold.companyId}`,
  landmark: /Ledgerfold/u,
  data: {
    service: "q-api",
    path: `/v1/fit/companies/${ledgerfold.companyId}`,
    nonEmpty: (b) => b !== null && JSON.stringify(b).length > 20,
  },
  backend: {
    service: "q-api",
    path: `/v1/fit/companies/${ledgerfold.companyId}/q-view`,
  },
  ui: "main h1",
  question: "What is Ledgerfold's revenue and how do you know?",
  expected: "Ledgerfold reports revenue as a founder claim.",
  // The investor cannot open the founder's management record.
  authorization: {
    as: CAST.investor,
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}`,
    expect: "refused",
  },
  tools: /get_company|company/u,
  honesty: { require: /claim|evidence|verified|self-reported|unknown/iu },
  awaits: { 5: [["G-R3"], "turn disposition attribute"] },
});

promiseSuite({
  id: "Q.08",
  title: "Understands every business the same way",
  actor: CAST.founder,
  page: `/company/${ledgerfold.companyId}`,
  landmark: /Ledgerfold/u,
  // The 12-section standard reading of the deck (promises doc: 0 readings live).
  data: {
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/deck`,
    nonEmpty: (b) => (b as { extraction?: unknown } | null)?.extraction != null,
  },
  backend: {
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/deck`,
  },
  ui: "main [role='tablist']",
  question: "Read my deck into the standard sections",
  expected: "Your deck covers nine of the twelve sections.",
  authorization: {
    as: CAST.otherFounder,
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/deck`,
    expect: "refused",
  },
  tools: /deck|document/u,
  honesty: { require: /claimed|evidenced|verified|self-reported|unknown/iu },
  awaits: {
    2: [
      ["E5"],
      "the seeded deck has no standard reading (extraction null), as in production",
    ],
    5: [["G-R3"], "turn disposition attribute"],
  },
});
