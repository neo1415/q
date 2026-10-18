import { stageBandOf } from "../investiq/method-v1.js";
/** Owner-approved provisional heuristics, not fitted probability coefficients. */
export const UNICORN_POTENTIAL_METHOD_VERSION = "unicorn-potential.v1.0.0";
export const UNICORN_POTENTIAL_INPUT_RULES_VERSION =
  "unicorn-potential-inputs.v2";
export type UnicornStage = "PRE_SEED" | "SEED" | "SERIES_A_GROWTH";
export type PillarId = `P${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
export type CriterionRule = {
  readonly label: string;
  readonly gap: string;
  readonly adverse: RegExp;
  readonly limited: RegExp;
  readonly positive: RegExp;
  readonly freshnessDays: number;
};
const criterion = (
  label: string,
  gap: string,
  adverse: RegExp,
  limited: RegExp,
  positive: RegExp,
  freshnessDays = 365,
): CriterionRule => ({ label, gap, adverse, limited, positive, freshnessDays });
export const UNICORN_PILLARS: readonly {
  readonly id: PillarId;
  readonly label: string;
  readonly weights: readonly [number, number, number];
  readonly criteria: readonly [CriterionRule, CriterionRule];
}[] = [
  {
    id: "P1",
    label: "Founder quality & founder–market fit",
    weights: [15, 12, 8],
    criteria: [
      criterion(
        "Relevant founder expertise",
        "Confirmed founder role history tied to the customer problem",
        /\b(founder|founders) (?:has|have) (?:falsified|fabricated) (?:credentials|experience)\b/iu,
        /\b(founder|founders).{0,60}\b(training|learning|first customer interviews)\b/iu,
        /\b(founder|founders).{0,100}\b(previously (?:built|led|worked)|years (?:of experience|in)|domain expertise)\b/iu,
        1095,
      ),
      criterion(
        "Adaptability and founder execution",
        "Dated founder milestones or documented response to customer tests",
        /\bfounder.{0,60}\babandoned (?:all|critical) commitments\b/iu,
        /\bfounder.{0,60}\b(testing|experimenting|revising)\b/iu,
        /\bfounder.{0,80}\b(delivered|shipped|changed).{0,60}\b(milestone|customer feedback|experiment)\b/iu,
      ),
    ],
  },
  {
    id: "P2",
    label: "Market opportunity & expansion",
    weights: [15, 14, 11],
    criteria: [
      criterion(
        "Accessible market demand",
        "Sourced bottom-up market sizing with explicit assumptions",
        /\baccessible market.{0,50}\b(proven nonexistent|legally prohibited)\b/iu,
        /\b(bottom.up|serviceable|accessible) market.{0,80}\b(assumption|estimate|model)\b/iu,
        /\b(bottom.up|serviceable|accessible) market.{0,100}\b(validated demand|customer spending|purchasing data)\b/iu,
      ),
      criterion(
        "Credible expansion path",
        "Dated customer or channel evidence for an adjacent market",
        /\bexpansion.{0,50}\b(permanently prohibited|proven unviable)\b/iu,
        /\bexpansion.{0,60}\b(plan|pilot|test)\b/iu,
        /\bexpansion.{0,80}\b(paying customers|signed distribution|launched successfully)\b/iu,
      ),
    ],
  },
  {
    id: "P3",
    label: "Problem intensity & product–market fit",
    weights: [15, 14, 10],
    criteria: [
      criterion(
        "Problem severity and willingness to pay",
        "Customer interviews, purchasing commitments or paid problem validation",
        /\bcustomer tests.{0,50}\b(no willingness to pay|no material problem)\b/iu,
        /\b(customer interviews|problem interviews).{0,80}\b(problem|pain|need)\b/iu,
        /\b(paid pilots|paying customers|signed purchase orders).{0,80}\b(problem|solution|product)\b/iu,
      ),
      criterion(
        "Repeated adoption or stage-appropriate tests",
        "Dated renewal, retention cohorts or repeated pilot outcomes",
        /\b(all customers churned|all pilots failed)\b/iu,
        /\b(customer pilot|product test).{0,60}\b(completed|positive feedback)\b/iu,
        /\b(customers renewed|repeat purchases|retained customers|successful repeated pilots)\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P4",
    label: "Traction & growth velocity",
    weights: [8, 12, 16],
    criteria: [
      criterion(
        "Dated growth velocity",
        "Dated comparable revenue, usage or customer growth periods",
        /\b(revenue|usage|customer).{0,30}\bdeclined (?:by )?(?:[5-9]\d|100)%/iu,
        /\b(revenue|usage|customer).{0,30}\bgrowth.{0,30}\b(?:quarter|month|year).{0,20}\b20\d\d\b/iu,
        /\b(revenue|usage|customer).{0,30}\bgrew (?:by )?\d+(?:\.\d+)?%.{0,40}\b(?:quarter|month|year).{0,20}\b20\d\d\b/iu,
        120,
      ),
      criterion(
        "Retention-supported traction",
        "Dated recurring revenue or retained customer cohort evidence",
        /\btraction.{0,40}\b(fabricated|entirely fraudulent)\b/iu,
        /\b(revenue|customers).{0,50}\b(one.off|concentrated|non.recurring)\b/iu,
        /\b(recurring revenue|retained cohort|repeat purchase revenue).{0,60}\b20\d\d\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P5",
    label: "Business model & unit economics",
    weights: [6, 8, 12],
    criteria: [
      criterion(
        "Contribution economics and pricing",
        "Sector-specific unit contribution evidence, forecasts explicitly labelled",
        /\bcontribution margin.{0,25}\bnegative\b/iu,
        /\b(forecast|modelled|modeled) (?:unit economics|contribution margin)\b/iu,
        /\bpositive contribution margin.{0,50}\b(actual|realized|realised|measured)\b/iu,
        180,
      ),
      criterion(
        "Sustainable acquisition and monetization",
        "Dated measured acquisition payback and monetization cohorts",
        /\bacquisition costs.{0,40}\bexceed lifetime revenue\b/iu,
        /\b(acquisition payback|monetization).{0,60}\b(modelled|modeled|forecast|pilot)\b/iu,
        /\b(acquisition payback|monetization).{0,60}\b(measured|realized|realised|repeatable)\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P6",
    label: "Defensibility & competitive moat",
    weights: [8, 9, 9],
    criteria: [
      criterion(
        "Differentiated assets",
        "Specific owned technology, licensed IP, proprietary data or network evidence",
        /\b(core intellectual property|core technology).{0,40}\b(infringes|unlicensed|revoked)\b/iu,
        /\b(proprietary technology|proprietary dataset|network advantage).{0,60}\b(prototype|developing|planned)\b/iu,
        /\b(proprietary technology|proprietary dataset|licensed patent).{0,60}\b(deployed|used by customers|granted)\b/iu,
        730,
      ),
      criterion(
        "Independent defensibility test",
        "Dated third-party benchmark or documented competitive evaluation",
        /\bindependent competitive test.{0,40}\bmaterially inferior\b/iu,
        /\bcompetitive (?:test|benchmark|evaluation).{0,60}\b(internal|planned|mixed)\b/iu,
        /\bindependent (?:competitive )?(?:test|benchmark|evaluation).{0,60}\b(advantage|outperformed|superior)\b/iu,
      ),
    ],
  },
  {
    id: "P7",
    label: "Distribution & organic influence",
    weights: [5, 7, 8],
    criteria: [
      criterion(
        "Repeatable acquisition channels",
        "Dated channel cohorts, repeatable sales or executed distribution",
        /\ball acquisition channels.{0,40}\bfailed\b/iu,
        /\b(acquisition channel|distribution channel|sales channel).{0,60}\b(pilot|testing|trial)\b/iu,
        /\b(acquisition channel|distribution channel|sales channel).{0,60}\b(repeatable|repeat customers|executed agreement)\b/iu,
        180,
      ),
      criterion(
        "Organic pull or channel efficiency",
        "Dated referral cohorts or measured efficient sales conversion",
        /\b(referrals|organic demand).{0,40}\bfabricated\b/iu,
        /\b(referrals|organic demand|sales conversion).{0,60}\b(initial|pilot|testing)\b/iu,
        /\b(referrals|organic demand|sales conversion).{0,60}\b(measured|repeatable|sustained)\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P8",
    label: "Capital strength & investor support",
    weights: [5, 6, 6],
    criteria: [
      criterion(
        "Runway and capital access",
        "Dated current cash runway or completed financing, excluding planned raises",
        /\b(runway exhausted|insolvent|unable to meet payroll)\b/iu,
        /\bcurrent runway.{0,25}\b(?:[1-9]|1[0-1]) months\b/iu,
        /\bcurrent runway.{0,25}\b(?:1[2-9]|[2-9]\d) months\b/iu,
        90,
      ),
      criterion(
        "Relevant investor or strategic support",
        "Executed support tied to a specific operating need",
        /\b(all investors withdrew|strategic support terminated)\b/iu,
        /\b(investor support|strategic support).{0,60}\b(discussing|proposed|non.binding)\b/iu,
        /\b(investor support|strategic support).{0,60}\b(executed|delivered|active agreement)\b/iu,
      ),
    ],
  },
  {
    id: "P9",
    label: "Team & execution",
    weights: [8, 7, 6],
    criteria: [
      criterion(
        "Critical function coverage",
        "Named technical, commercial and operational coverage appropriate to stage",
        /\ball critical team members departed\b/iu,
        /\bcritical (?:team )?functions.{0,60}\b(gap|hiring|vacancy)\b/iu,
        /\btechnical.{0,40}\bcommercial.{0,40}\b(operational|operations).{0,40}\b(covered|appointed|staffed)\b/iu,
      ),
      criterion(
        "Time-bound delivery",
        "Dated milestone plan and actual delivery history",
        /\ball critical milestones.{0,40}\bmissed\b/iu,
        /\bmilestones.{0,60}\b(delayed|partially delivered|mixed)\b/iu,
        /\bmilestones.{0,60}\b(delivered on time|completed on schedule)\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P10",
    label: "Timing & structural tailwinds",
    weights: [5, 4, 3],
    criteria: [
      criterion(
        "Structural demand or technology shift",
        "Dated sourced demand, regulatory or technology shift",
        /\b(regulatory ban|technology obsolescence).{0,40}\bprevents operations\b/iu,
        /\b(structural demand|regulatory change|technology shift).{0,60}\b(proposed|emerging|uncertain)\b/iu,
        /\b(structural demand|regulatory change|technology shift).{0,60}\b(enacted|documented|measured)\b/iu,
      ),
      criterion(
        "Ability to exploit the window",
        "Dated operating capability and practical deployment readiness",
        /\bmarket window.{0,50}\bpermanently closed\b/iu,
        /\bmarket window.{0,60}\b(pilot|preparing|testing)\b/iu,
        /\bmarket window.{0,60}\b(deployed|ready to serve|signed customers)\b/iu,
        180,
      ),
    ],
  },
  {
    id: "P11",
    label: "Scalability & operating leverage",
    weights: [6, 5, 9],
    criteria: [
      criterion(
        "Growth decoupled from costs",
        "Comparable actual revenue and cost periods showing operating leverage",
        /\bcost growth.{0,40}\bconsistently exceeds revenue growth\b/iu,
        /\boperating leverage.{0,60}\b(modelled|modeled|forecast)\b/iu,
        /\brevenue growth exceeds cost growth.{0,60}\b(actual|measured|20\d\d)\b/iu,
        180,
      ),
      criterion(
        "Repeatable deployment",
        "Dated repeated customer or geographical deployments",
        /\ball repeat deployments failed\b/iu,
        /\b(repeat deployment|geographic rollout).{0,60}\b(pilot|planned|testing)\b/iu,
        /\b(repeat deployments|geographic rollouts).{0,60}\b(completed|successful|operational)\b/iu,
      ),
    ],
  },
  {
    id: "P12",
    label: "Ecosystem position & strategic optionality",
    weights: [4, 2, 2],
    criteria: [
      criterion(
        "Ecosystem access and partnerships",
        "Dated active agreements and evidence of delivered partner access",
        /\ball ecosystem partnerships terminated\b/iu,
        /\b(ecosystem partnership|platform partnership).{0,60}\b(proposed|pilot|non.binding)\b/iu,
        /\b(ecosystem partnership|platform partnership).{0,60}\b(executed|active|delivered)\b/iu,
      ),
      criterion(
        "Strategic adjacent opportunities",
        "Documented adjacent demand or executed strategic option",
        /\ball strategic options.{0,40}\bprohibited\b/iu,
        /\bstrategic (?:option|opportunity).{0,60}\b(hypothesis|plan|exploring)\b/iu,
        /\bstrategic (?:option|opportunity).{0,60}\b(signed customer|validated demand|executed agreement)\b/iu,
      ),
    ],
  },
];
export function unicornStageOf(stage: string | null): UnicornStage | null {
  const band = stageBandOf(stage?.replace(/ /gu, "_") ?? null);
  return band === null
    ? null
    : band === "SERIES_A" || band === "GROWTH"
      ? "SERIES_A_GROWTH"
      : band;
}
export function pillarWeight(
  weights: readonly [number, number, number],
  stage: UnicornStage | null,
): number | null {
  return stage === null
    ? null
    : weights[stage === "PRE_SEED" ? 0 : stage === "SEED" ? 1 : 2];
}
/** Concrete weaknesses share the adverse anchor branch, but never imply material failure (0). */
export const UNICORN_WEAKNESS_RULES: Readonly<
  Record<PillarId, readonly [RegExp, RegExp]>
> = {
  P1: [
    /\bfounder expertise.{0,50}\bdocumented skills gap\b/iu,
    /\bfounder execution.{0,50}\brepeatedly delayed\b/iu,
  ],
  P2: [
    /\baccessible market.{0,50}\bcontracting demand\b/iu,
    /\bexpansion.{0,50}\bfailed pilot\b/iu,
  ],
  P3: [
    /\bcustomer interviews.{0,50}\blow willingness to pay\b/iu,
    /\bcustomer retention.{0,50}\bdeteriorating\b/iu,
  ],
  P4: [
    /\b(revenue|usage|customer).{0,30}\bdeclined (?:by )?(?:[1-9]|[1-4]\d)%/iu,
    /\btraction.{0,50}\bdeteriorating retention\b/iu,
  ],
  P5: [
    /\bcontribution margin.{0,50}\bbelow break.even\b/iu,
    /\bacquisition payback.{0,50}\bdeteriorating\b/iu,
  ],
  P6: [
    /\bproprietary (?:technology|dataset).{0,50}\bdocumented limitation\b/iu,
    /\bcompetitive (?:test|benchmark).{0,50}\bdisadvantage\b/iu,
  ],
  P7: [
    /\bacquisition channel.{0,50}\bdeteriorating conversion\b/iu,
    /\breferrals.{0,50}\bdeclining\b/iu,
  ],
  P8: [
    /\bcurrent runway.{0,25}\b(?:[1-5]) months\b/iu,
    /\binvestor support.{0,50}\bwithdrawn commitment\b/iu,
  ],
  P9: [
    /\bcritical (?:team )?functions.{0,50}\bconfirmed vacancy\b/iu,
    /\bmilestones.{0,50}\brepeatedly delayed\b/iu,
  ],
  P10: [
    /\bstructural demand.{0,50}\bdeclining\b/iu,
    /\bmarket window.{0,50}\bdeployment delayed\b/iu,
  ],
  P11: [
    /\bcost growth.{0,50}\bexceeds revenue growth\b/iu,
    /\brepeat deployment.{0,50}\bfailed pilot\b/iu,
  ],
  P12: [
    /\becosystem partnership.{0,50}\bsuspended\b/iu,
    /\bstrategic (?:option|opportunity).{0,50}\brejected by customer\b/iu,
  ],
};
