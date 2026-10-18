import { promiseSuite } from "../support/promise.js";
import { CAST, world } from "../support/stack.js";

/**
 * Founder-side promises (docs/strategy/q-promises-2026-10-07.md):
 * Q.01 interviews every business, Q.03 reveals what could stop the raise,
 * Q.04 turns weaknesses into an action plan. (Q.02 is investor-side.)
 * Scores there: 6, 3, 3 of 10. The expected-red annotations name the
 * workstream rows that close each gap.
 */
const W = world();
const ledgerfold = W.company("ledgerfold");

promiseSuite({
  id: "Q.01",
  title: "Conversationally interviews every business",
  actor: CAST.founder,
  page: "/home",
  landmark: /Q still wants to know|questions? for you/iu,
  data: {
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}`,
    nonEmpty: (b) => typeof b === "object" && b !== null,
  },
  backend: {
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/marketplace-readiness`,
  },
  ui: "[data-q-pending-questions]",
  question: "What does Q still want to know about Ledgerfold?",
  expected: "Q still wants to know your monthly burn.",
  authorization: {
    as: CAST.otherFounder,
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}`,
    expect: "refused",
  },
  tools: /profile_answer|read_my_record/u,
  honesty: { require: /unknown|not yet|still/iu },
  awaits: {
    1: [
      ["E5"],
      "the 'Q still wants to know' stack (promises doc item 3) is E5",
    ],
    4: [["E5"], "pending-questions element is E5"],
    5: [["G-R3"], "turn disposition attribute"],
    11: [["E5"], "Home names what Q does not know yet"],
  },
});

promiseSuite({
  id: "Q.03",
  title: "Reveals what could stop the raise",
  actor: CAST.founder,
  page: "/capital?tab=readiness",
  landmark: /Readiness/u,
  data: {
    service: "api",
    path: "/v1/readiness",
    nonEmpty: (b) => JSON.stringify(b).length > 40,
  },
  backend: { service: "api", path: "/v1/readiness" },
  ui: '[data-q-control="section.risks"]',
  question: "What could stop my raise?",
  expected: "Two things could stop the raise.",
  authorization: {
    as: CAST.otherFounder,
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/marketplace-readiness`,
    expect: "refused",
  },
  tools: /readiness/u,
  // Promises doc: no readiness percentage exists, so none may be shown;
  // pillar status in words (Strong / Developing / Gap / Unknown) instead.
  honesty: {
    forbid: /\b\d{1,3}\s?%\s*(ready|readiness)/iu,
    require: /Strong|Developing|Gap|Unknown/u,
  },
  awaits: {
    4: [["C1", "E5"], "section.risks control on Capital readiness"],
    5: [["G-R3"], "turn disposition attribute"],
    11: [["E5"], "pillar status in words (promises doc item 5)"],
  },
});

promiseSuite({
  id: "Q.04",
  title: "Turns weaknesses into an action plan",
  actor: CAST.founder,
  page: "/capital?tab=action-plan",
  landmark: /Action plan/u,
  data: {
    service: "api",
    path: "/v1/readiness",
    nonEmpty: (b) => JSON.stringify(b).length > 40,
  },
  // The Readiness Blueprint route answered 501 in production (promises doc).
  backend: {
    service: "q-api",
    method: "POST",
    path: "/v1/q/readiness-blueprints",
    body: { companyId: ledgerfold.companyId },
  },
  ui: '[role="tablist"]',
  question: "Turn my weaknesses into a plan",
  expected: "Here is a three-step plan.",
  authorization: {
    as: CAST.investor,
    service: "api",
    path: `/v1/companies/${ledgerfold.companyId}/marketplace-readiness`,
    expect: "refused",
  },
  tools: /readiness|plan/u,
  honesty: { forbid: /not built yet/iu },
  awaits: {
    3: [["E5"], "Readiness Blueprint returns 501 (promises doc Q.04)"],
    5: [["G-R3"], "turn disposition attribute"],
    11: [["E5"], "the action plan says 'not built yet'"],
  },
});
