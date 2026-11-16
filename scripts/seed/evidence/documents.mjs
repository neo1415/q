// Synthetic evidence documents for the three showcase companies: the two
// fictional tavus-20 companies (Tensorgate, Halyard Security) and Nixo
// (decision 99: the owner's own account, seeded like the fictional ones with
// the same synthetic marking), built from one fixture each.
//
// Pure and deterministic: no clock, no randomness, no network, no model.
// The fixture JSON is the single source of truth; every number printed in
// every document is read from it or derived from it here, so the documents
// reconcile with each other by construction and the validator
// (apps/workers/test/demo-evidence-fixtures.test.ts) checks that they do.
//
// Owner directive 2026-11-16 (docs/ai-handoff/directives/
// 2026-11-16-demo-evidence-data-room-seeding.md), Phases 2-3 only: nothing
// here uploads, seeds or writes anywhere but the local build directory.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SYNTHETIC_HEADER =
  "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD";
export const WATERMARK_TEXT = "SYNTHETIC DEMO DOCUMENT";
export const FIXTURE_KEYS = ["tensorgate", "halyard", "nixo"];

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, "fixtures");
export const MANIFEST_DIR = join(HERE, "manifests");

export function loadFixture(key) {
  if (!FIXTURE_KEYS.includes(key)) throw new Error(`unknown fixture ${key}`);
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${key}.json`), "utf8"));
}

/**
 * Default sensitivity per document type, mirrored from
 * packages/evidence/src/domain/sensitivity.ts (defaultDocumentSensitivity).
 * The validator asserts this copy agrees with the real function, so the
 * manifest can never claim a weaker class than the product will assign.
 */
const HIGHLY_CONFIDENTIAL_TYPES = new Set([
  "FINANCIAL_MODEL",
  "MANAGEMENT_ACCOUNTS",
  "FINANCIAL",
]);
export function defaultSensitivityFor(documentType) {
  return HIGHLY_CONFIDENTIAL_TYPES.has(documentType)
    ? "HIGHLY_CONFIDENTIAL"
    : "CONFIDENTIAL";
}

// ---------------------------------------------------------------- formats

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-10" -> "Oct 2026". */
export function monthLabel(month) {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
/** "2026-10" -> "October 2026". */
export function monthLong(month) {
  const [y, m] = month.split("-");
  return `${MONTH_LONG[Number(m) - 1]} ${y}`;
}
/** "2026-09-26" -> "26 Sep 2026". */
export function dateLabel(date) {
  const [y, m, d] = date.split("-");
  return `${d} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
/** Whole currency units with thousands separators; negatives with "-". */
export function amount(value) {
  if (!Number.isInteger(value)) throw new Error(`not whole: ${value}`);
  const sign = value < 0 ? "-" : "";
  return sign + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** One decimal place, half away from zero, as text. */
export function oneDecimal(value) {
  const scaled = Math.round(Math.abs(value) * 10);
  const sign = value < 0 && scaled !== 0 ? "-" : "";
  return `${sign}${Math.floor(scaled / 10)}.${scaled % 10}`;
}
export function percent1(numerator, denominator) {
  return `${oneDecimal((numerator * 100) / denominator)}%`;
}
function lastDay(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}

/**
 * Percentages of whole-share holdings to two decimals that sum to exactly
 * 100.00 (largest remainder, ties by input order), in hundredths.
 */
export function ownershipHundredths(shares) {
  const total = shares.reduce((a, b) => a + b, 0);
  const raw = shares.map((s) => (s * 10000) / total);
  const base = raw.map((r) => Math.floor(r));
  let rest = 10000 - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest === 0) break;
    base[i] += 1;
    rest -= 1;
  }
  return base;
}
export function hundredthsLabel(h) {
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}%`;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- derived

export function actualMonths(fx) {
  return fx.actuals.map((a) => a.month);
}
export function lastActual(fx) {
  return fx.actuals[fx.actuals.length - 1];
}
export function actualPeriodLabel(fx) {
  return `${monthLabel(fx.periods.firstActualMonth)} to ${monthLabel(fx.periods.lastActualMonth)}`;
}
export function projectionPeriodLabel(fx) {
  return `${monthLabel(fx.periods.projectionFirstMonth)} to ${monthLabel(fx.periods.projectionLastMonth)}`;
}

/** Revenue and cost of revenue over the twelve months to the last actual. */
export function trailingTwelve(fx) {
  const rows = fx.actuals.slice(-12);
  const revenue = rows.reduce((s, a) => s + a.revenue.total, 0);
  const cogs = rows.reduce((s, a) => s + a.cogs.total, 0);
  return {
    from: rows[0].month,
    to: rows[rows.length - 1].month,
    revenue,
    cogs,
  };
}

/**
 * Licence gross margin (Halyard): licence revenue less the per-seat costs
 * (hosting, authenticator services, support tooling), excluding the
 * deployment team and deployment fees. This is the deck's 82% definition.
 */
export function licenceMarginTwelve(fx) {
  const rows = fx.actuals.slice(-12);
  const revenue = rows.reduce((s, a) => s + (a.revenue.lines.licences ?? 0), 0);
  const cost = rows.reduce(
    (s, a) => s + a.cogs.total - (a.cogs.lines.deploymentTeamPayroll ?? 0),
    0,
  );
  return { revenue, cost };
}

/**
 * Subscription gross margin (Nixo): subscription revenue less hosting and
 * model inference, excluding onboarding fees and the contract engineers.
 */
export function subscriptionMarginTwelve(fx) {
  const rows = fx.actuals.slice(-12);
  const revenue = rows.reduce(
    (s, a) => s + (a.revenue.lines.platformSubscriptions ?? 0),
    0,
  );
  const cost = rows.reduce(
    (s, a) => s + (a.cogs.lines.hostingAndInference ?? 0),
    0,
  );
  return { revenue, cost };
}

/** The one sentence of raise terms every document that mentions the raise prints. */
export function raiseTermsLine(fx) {
  const r = fx.raise;
  const c = r.currency;
  const valuation =
    r.valuationCap !== undefined
      ? `valuation cap ${c} ${amount(r.valuationCap)}`
      : `pre-money valuation ${c} ${amount(r.preMoneyValuation)}`;
  return (
    `Seed round terms: ${c} ${amount(r.targetAmount)}; instrument ${r.instrument}; ` +
    `${valuation}; minimum cheque ${c} ${amount(r.minimumCheque)}; ` +
    `target close ${dateLabel(r.targetCloseOn)}.`
  );
}

const LINE_LABELS = {
  platformFloor: "Platform floor fees",
  usageAboveFloor: "Usage above floor",
  implementation: "Implementation fees",
  licences: "Licence fees",
  deploymentFees: "Deployment fees",
  cloudAndGpuEnclaveCapacity: "Cloud and GPU enclave capacity",
  hosting: "Hosting and infrastructure",
  authenticatorServices: "Authenticator and attestation services",
  supportTooling: "Support tooling",
  deploymentTeamPayroll: "Deployment team payroll",
  payrollEngineering: "Payroll - engineering",
  payrollGoToMarket: "Payroll - go-to-market",
  payrollOperations: "Payroll - operations",
  payrollSales: "Payroll - sales",
  softwareAndTools: "Software and tools",
  officeAustin: "Office (Austin)",
  offices: "Offices (Edinburgh, Manchester)",
  professionalFees: "Professional fees",
  securityAndAssurance: "Security testing and audits",
  assuranceAndCertifications: "Assurance and certifications",
  insurance: "Insurance",
  travelAndEvents: "Travel and events",
  travelAndOnSite: "Travel and on-site deployment",
  recruitment: "Recruitment",
  other: "Other",
  platformSubscriptions: "Platform subscriptions",
  onboardingServices: "Onboarding and integration services",
  hostingAndInference: "Hosting and model inference",
  contractForwardDeployedEngineers: "Contract forward-deployed engineers",
  payrollProduct: "Payroll - product",
  officeSanFrancisco: "Office (San Francisco)",
};
export function lineLabel(key) {
  const label = LINE_LABELS[key];
  if (label === undefined) throw new Error(`no label for ${key}`);
  return label;
}

const HEADCOUNT_LABELS = {
  engineering: "Engineering",
  goToMarket: "Go-to-market",
  operations: "Operations",
  deployment: "Deployment",
  sales: "Sales",
  product: "Product",
};

/** Nixo: the month index of `month` from the start of `from` (both YYYY-MM). */
function monthIndex(from, month) {
  const [ya, ma] = from.split("-").map(Number);
  const [yb, mb] = month.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Nixo: onboarding fee recognised for one customer in one month (thirds from go-live). */
function onboardingRecognised(c, month) {
  const i = monthIndex(c.goLiveOn.slice(0, 7), month);
  return i >= 0 && i < 3 ? c.onboardingFee / 3 : 0;
}

/** Nixo: employees and contractors at 30 Sep 2026, the date the profile recorded a team of 12. */
function nixoTeamAtSeptember(fx) {
  const sep = fx.actuals.find((a) => a.month === "2026-09");
  return `${sep.headcount.total} employees and ${sep.kpis.contractorsForwardDeployed} contract forward-deployed engineers at 30 Sep 2026`;
}

/** Nixo: the one customer that has signed but is not billed yet. */
function nixoSignedNotBilling(fx) {
  const c = fx.customers.find((x) => x.status === "SIGNED_NOT_BILLING");
  if (c === undefined) throw new Error("no signed-not-billing customer");
  return c;
}

function customerName(fx, id) {
  const c = fx.customers.find((x) => x.id === id);
  if (c === undefined) throw new Error(`unknown customer ${id}`);
  return `${c.label} (${c.segment})`;
}

/** Monthly revenue attributed to each customer, from the fixture's own rules. */
export function revenueByCustomer(fx, month) {
  const out = {};
  for (const c of fx.customers) out[c.id] = 0;
  if (fx.key === "tensorgate") {
    for (const c of fx.customers) {
      if (
        c.billingStartOn !== undefined &&
        c.billingStartOn.slice(0, 7) <= month
      ) {
        out[c.id] += c.annualFloor / 12;
      }
    }
    const a = fx.actuals.find((x) => x.month === month);
    out["TG-C01"] += a.revenue.lines.implementation;
  } else if (fx.key === "nixo") {
    const a = fx.actuals.find((x) => x.month === month);
    for (const [id, seats] of Object.entries(a.kpis.seatsByCustomer))
      out[id] += seats * fx.pricing.pricePerSeatPerMonth;
    for (const c of fx.customers) out[c.id] += onboardingRecognised(c, month);
  } else {
    const a = fx.actuals.find((x) => x.month === month);
    for (const [id, seats] of Object.entries(a.kpis.seatsByCustomer))
      out[id] += seats;
    for (const c of fx.customers) {
      if (c.deploymentFee && c.goLiveOn.slice(0, 7) === month)
        out[c.id] += c.deploymentFee;
    }
  }
  return out;
}

// ---------------------------------------------------------------- blocks

const h = (text) => ({ kind: "heading", text });
const p = (text) => ({ kind: "paragraph", text });
const table = (columns, rows, options = {}) => ({
  kind: "table",
  columns,
  rows,
  labelWidth: options.labelWidth ?? 150,
  ...(options.widths ? { widths: options.widths } : {}),
});

function monthTables(months, rowsFor, title, perTable = 6) {
  const blocks = [];
  for (const group of chunk(months, perTable)) {
    blocks.push(
      h(
        `${title}: ${monthLabel(group[0])} to ${monthLabel(group[group.length - 1])}`,
      ),
    );
    blocks.push(table(["", ...group.map(monthLabel)], rowsFor(group)));
  }
  return blocks;
}

function row(label, values) {
  return [label, ...values];
}

// ---------------------------------------------------------------- documents

function docBase(fx, slug, title, documentType, format, period, extra = {}) {
  const id = `${fx.idPrefix}-${slug}`;
  return {
    id,
    title,
    documentType,
    format,
    fileName: `${id}.${format}`,
    mimeType: format === "pdf" ? "application/pdf" : "text/csv",
    period,
    issuedOn: fx.documentDefaults.issuedOn,
    version: fx.documentDefaults.version,
    ...extra,
  };
}

function managementAccounts(fx) {
  const C = fx.currency;
  const months = actualMonths(fx);
  const last = lastActual(fx);
  const t12 = trailingTwelve(fx);
  const revenueKeys = Object.keys(fx.actuals[0].revenue.lines);
  const cogsKeys = Object.keys(fx.actuals[0].cogs.lines);
  const opexKeys = Object.keys(fx.actuals[0].opex.lines);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const blocks = [
    h("Basis of preparation"),
    p(
      `${fx.documentDefaults.preparedBy}. Accrual basis. Amounts in ${C}, whole units.`,
    ),
    p(
      {
        tensorgate:
          "Revenue recognition: each paid contract's annual platform floor (180,000) is recognised evenly by month from the billing start date. The implementation fee is recognised over the first three months of service. No usage above the floor was billed in the period.",
        halyard:
          "Revenue recognition: licences at 12 per user per year are recognised monthly (1.00 per licensed seat per month). Deployment fees are invoiced at contract signature and recognised at go-live. The deployment team's payroll is reported in cost of sales.",
        nixo: "Revenue recognition: platform subscriptions at 1,200 per forward-deployed engineering seat per month are invoiced monthly in advance and recognised in the month of service. Onboarding and integration fees are invoiced at contract signature and recognised in thirds over the first three months from go-live. Hosting, model inference and the contract forward-deployed engineers who deliver onboarding are reported in cost of revenue.",
      }[fx.key],
    ),
    h(`Summary for ${monthLong(last.month)}`),
    table(
      ["", monthLabel(last.month)],
      [
        ["Revenue", amount(last.revenue.total)],
        ["Gross profit", amount(last.grossProfit)],
        ["Net result for the month", amount(last.netResult)],
        ["Cash at month end", amount(last.cash.closing)],
        ["Net burn (payments less customer receipts)", amount(last.netBurn)],
        [
          "Runway at this month's net burn (months)",
          oneDecimal(last.cash.closing / last.netBurn),
        ],
        ["Headcount at month end", String(last.headcount.total)],
      ],
      { labelWidth: 260 },
    ),
    p(
      `Gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(t12.revenue - t12.cogs, t12.revenue)} (revenue ${amount(t12.revenue)}, cost of revenue ${amount(t12.cogs)}).`,
    ),
  ];
  if (fx.key === "halyard") {
    const lm = licenceMarginTwelve(fx);
    blocks.push(
      p(
        `Licence gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(lm.revenue - lm.cost, lm.revenue)} (licence revenue ${amount(lm.revenue)} less hosting, authenticator services and support tooling ${amount(lm.cost)}; excludes the deployment team and deployment fees).`,
      ),
    );
  }
  if (fx.key === "nixo") {
    const sm = subscriptionMarginTwelve(fx);
    blocks.push(
      p(
        `Subscription gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(sm.revenue - sm.cost, sm.revenue)} (subscription revenue ${amount(sm.revenue)} less hosting and model inference ${amount(sm.cost)}; excludes onboarding fees and the contract forward-deployed engineers).`,
      ),
    );
  }
  blocks.push(
    ...monthTables(
      months,
      (g) => [
        ...revenueKeys.map((k) =>
          row(
            lineLabel(k),
            g.map((m) => amount(get(m).revenue.lines[k])),
          ),
        ),
        row(
          "Total revenue",
          g.map((m) => amount(get(m).revenue.total)),
        ),
        ...cogsKeys.map((k) =>
          row(
            lineLabel(k),
            g.map((m) => amount(get(m).cogs.lines[k])),
          ),
        ),
        row(
          "Total cost of revenue",
          g.map((m) => amount(get(m).cogs.total)),
        ),
        row(
          "Gross profit",
          g.map((m) => amount(get(m).grossProfit)),
        ),
        ...opexKeys.map((k) =>
          row(
            lineLabel(k),
            g.map((m) => amount(get(m).opex.lines[k])),
          ),
        ),
        row(
          "Total operating expenses",
          g.map((m) => amount(get(m).opex.total)),
        ),
        row(
          "Net result",
          g.map((m) => amount(get(m).netResult)),
        ),
        row(
          "Headcount (month end)",
          g.map((m) => String(get(m).headcount.total)),
        ),
      ],
      "Profit and loss",
    ),
    ...monthTables(
      months,
      (g) => [
        row(
          "Opening cash",
          g.map((m) => amount(get(m).cash.opening)),
        ),
        row(
          "Receipts from customers",
          g.map((m) => amount(get(m).cash.receipts)),
        ),
        row(
          "Funding received",
          g.map((m) => amount(get(m).cash.fundingReceived)),
        ),
        row(
          "Payments",
          g.map((m) => amount(get(m).cash.payments)),
        ),
        row(
          "Closing cash",
          g.map((m) => amount(get(m).cash.closing)),
        ),
        row(
          "Net burn",
          g.map((m) => amount(get(m).netBurn)),
        ),
        row(
          "Runway (months)",
          g.map((m) => oneDecimal(get(m).cash.closing / get(m).netBurn)),
        ),
      ],
      "Cash flow",
    ),
    h("Funding received in the period"),
    table(
      ["Date", "Round", "Instrument", `Amount (${C})`],
      fx.funding.map((f) => [
        dateLabel(f.receivedOn),
        f.round,
        f.instrument,
        amount(f.amount),
      ]),
      { widths: [62, 160, 220, 75] },
    ),
  );
  const bs = balanceSheet(fx);
  blocks.push(
    h(`Balance sheet summary at ${dateLabel(lastDay(last.month))}`),
    table(
      ["", C],
      [
        ["Cash at bank", amount(bs.cash)],
        ["Trade receivables", amount(bs.receivables)],
        ["Total assets", amount(bs.totalAssets)],
        ["Deferred revenue", amount(bs.deferredRevenue)],
        ["Other payables and accruals", amount(bs.otherPayables)],
        ["Total liabilities", amount(bs.totalLiabilities)],
        ["Net assets", amount(bs.netAssets)],
        ["Capital raised to date", amount(bs.capitalRaised)],
        ["Accumulated losses", amount(bs.accumulatedLosses)],
        ["Total equity", amount(bs.capitalRaised + bs.accumulatedLosses)],
      ],
      { labelWidth: 260 },
    ),
    p(
      "Fixed assets are expensed as bought in this summary. The detailed monthly figures are in the monthly actuals data file; revenue by customer and the invoice reconciliation are in the revenue breakdown.",
    ),
  );
  return {
    ...docBase(
      fx,
      "management-accounts",
      `Management accounts, ${actualPeriodLabel(fx)}`,
      "MANAGEMENT_ACCOUNTS",
      "pdf",
      { from: fx.periods.firstActualMonth, to: fx.periods.lastActualMonth },
    ),
    blocks,
  };
}

/** Balance sheet at the last actual month end, derived from the fixture. */
export function balanceSheet(fx) {
  const last = lastActual(fx);
  const ob = fx.openingBalances;
  const cash = last.cash.closing;
  const receivables = last.receivablesClosing;
  const deferredRevenue = last.deferredRevenueClosing;
  const otherPayables = ob.otherPayablesAndAccruals;
  const totalAssets = cash + receivables;
  const totalLiabilities = deferredRevenue + otherPayables;
  const netAssets = totalAssets - totalLiabilities;
  const capitalRaised =
    ob.capitalRaisedToDate + fx.funding.reduce((s, f) => s + f.amount, 0);
  return {
    cash,
    receivables,
    deferredRevenue,
    otherPayables,
    totalAssets,
    totalLiabilities,
    netAssets,
    capitalRaised,
    accumulatedLosses: netAssets - capitalRaised,
  };
}

function monthlyActualsCsv(fx) {
  const revenueKeys = Object.keys(fx.actuals[0].revenue.lines);
  const cogsKeys = Object.keys(fx.actuals[0].cogs.lines);
  const opexKeys = Object.keys(fx.actuals[0].opex.lines);
  const header = [
    "month",
    "currency",
    ...revenueKeys.map((k) => `revenue_${k}`),
    "revenue_total",
    ...cogsKeys.map((k) => `cogs_${k}`),
    "cogs_total",
    "gross_profit",
    ...opexKeys.map((k) => `opex_${k}`),
    "opex_total",
    "net_result",
    "cash_opening",
    "receipts",
    "funding_received",
    "payments",
    "cash_closing",
    "net_burn",
    "headcount_total",
    "record_status",
  ];
  const rows = fx.actuals.map((a) => [
    a.month,
    fx.currency,
    ...revenueKeys.map((k) => String(a.revenue.lines[k])),
    String(a.revenue.total),
    ...cogsKeys.map((k) => String(a.cogs.lines[k])),
    String(a.cogs.total),
    String(a.grossProfit),
    ...opexKeys.map((k) => String(a.opex.lines[k])),
    String(a.opex.total),
    String(a.netResult),
    String(a.cash.opening),
    String(a.cash.receipts),
    String(a.cash.fundingReceived),
    String(a.cash.payments),
    String(a.cash.closing),
    String(a.netBurn),
    String(a.headcount.total),
    "SYNTHETIC DEMO",
  ]);
  return {
    ...docBase(
      fx,
      "monthly-actuals",
      `Monthly actuals data, ${actualPeriodLabel(fx)}`,
      "MANAGEMENT_ACCOUNTS",
      "csv",
      { from: fx.periods.firstActualMonth, to: fx.periods.lastActualMonth },
    ),
    csv: { header, rows },
  };
}

function revenueBreakdown(fx) {
  const C = fx.currency;
  const months = actualMonths(fx);
  const byMonth = Object.fromEntries(
    months.map((m) => [m, revenueByCustomer(fx, m)]),
  );
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const invoicedIn = (m) =>
    fx.invoices
      .filter((i) => i.issuedOn.slice(0, 7) === m)
      .reduce((s, i) => s + i.amount, 0);
  const blocks = [
    h("Scope"),
    p(
      `Recognised revenue by customer and month, ${actualPeriodLabel(fx)}, in ${C}. Customer names are withheld; each customer is identified by a letter or number and its segment.`,
    ),
    ...monthTables(
      months,
      (g) => [
        ...fx.customers.map((c) =>
          row(
            customerName(fx, c.id),
            g.map((m) => amount(byMonth[m][c.id])),
          ),
        ),
        row(
          "Total recognised revenue",
          g.map((m) => amount(get(m).revenue.total)),
        ),
      ],
      "Revenue by customer",
    ),
    ...monthTables(
      months,
      (g) => [
        row(
          "Invoiced in the month",
          g.map((m) => amount(invoicedIn(m))),
        ),
        row(
          "Reconciling items",
          g.map((m) =>
            amount(get(m).reconcilingItems.reduce((s, r) => s + r.amount, 0)),
          ),
        ),
        row(
          "Recognised revenue",
          g.map((m) => amount(get(m).revenue.total)),
        ),
      ],
      "Invoiced against recognised revenue",
    ),
    h("Reconciling items"),
    table(
      ["Month", "Item", `Amount (${C})`],
      fx.actuals.flatMap((a) =>
        a.reconcilingItems.map((r) => [
          monthLabel(a.month),
          r.description,
          amount(r.amount),
        ]),
      ),
      { widths: [55, 380, 80] },
    ),
  ];
  if (fx.key === "tensorgate") {
    const c = fx.customers.find((x) => x.id === "TG-C03");
    blocks.push(
      h("Contracted against billed"),
      p(
        `${customerName(fx, c.id)} signed on ${dateLabel(c.contractSignedOn)}. Billing start: ${dateLabel(c.billingStartOn)}, after deployment acceptance on ${dateLabel(c.goLiveOn)}. Its 180,000 annual floor counts in contracted ARR from August 2026 and in recognised revenue from October 2026.`,
      ),
    );
  } else if (fx.key === "nixo") {
    const c = nixoSignedNotBilling(fx);
    const last = lastActual(fx);
    blocks.push(
      h("Contracted against billed"),
      p(
        // No dates after the last actual month here: this is an actuals
        // document. The billing start is in the customer contract summary.
        `${customerName(fx, c.id)} signed on ${dateLabel(c.contractSignedOn)} for ${c.contractedSeats} seats, but its subscription is not yet billed: billing starts after its planned go-live (see the customer contract summary). Its ${amount(c.contractedSeats * fx.pricing.pricePerSeatPerMonth * 12)} a year counts in contracted ARR (${amount(last.kpis.contractedArr)} at ${monthLabel(last.month)}) but not in recognised revenue: subscription revenue for ${monthLabel(last.month)} is ${amount(last.revenue.lines.platformSubscriptions)}, ${amount(last.kpis.annualisedSubscriptionRevenue)} annualised. Its ${amount(c.onboardingFee)} onboarding fee was invoiced and collected in ${monthLabel(last.month)} and is held in deferred revenue.`,
      ),
      h("Subscription revenue"),
      p(
        "Subscription revenue for each customer equals its billed seats in the month at 1,200 per seat per month. Seat counts by customer are in the cohorts and retention document.",
      ),
    );
  } else {
    blocks.push(
      h("Licence revenue"),
      p(
        "Licence revenue for each customer equals its licensed seats in the month at 1.00 per seat per month (12 per user per year). Seat counts by customer are in the cohorts and retention document.",
      ),
    );
  }
  return {
    ...docBase(
      fx,
      "revenue-breakdown",
      "Monthly revenue by customer",
      "FINANCIAL",
      "pdf",
      {
        from: fx.periods.firstActualMonth,
        to: fx.periods.lastActualMonth,
      },
    ),
    blocks,
  };
}

function invoiceRegisterCsv(fx) {
  const header = [
    "invoice_number",
    "customer_id",
    "customer",
    "issued_on",
    "service_month",
    "kind",
    "description",
    "amount",
    "currency",
    "due_on",
    "paid_on",
    "record_status",
  ];
  const rows = fx.invoices.map((i) => [
    i.number,
    i.customerId,
    customerName(fx, i.customerId),
    i.issuedOn,
    i.serviceMonth,
    i.kind,
    i.description,
    String(i.amount),
    fx.currency,
    i.dueOn,
    i.paidOn,
    "SYNTHETIC DEMO",
  ]);
  return {
    ...docBase(fx, "invoice-register", "Invoice register", "FINANCIAL", "csv", {
      from: fx.invoices[0].issuedOn.slice(0, 7),
      to: fx.periods.lastActualMonth,
    }),
    csv: { header, rows },
  };
}

/** Payment day of month for each cost line in the bank statement. */
const PAYMENT_DAY = {
  cloudAndGpuEnclaveCapacity: 3,
  hosting: 3,
  authenticatorServices: 3,
  supportTooling: 3,
  softwareAndTools: 5,
  officeAustin: 1,
  offices: 1,
  insurance: 10,
  professionalFees: 12,
  securityAndAssurance: 14,
  assuranceAndCertifications: 14,
  travelAndEvents: 18,
  travelAndOnSite: 18,
  recruitment: 20,
  other: 22,
  hostingAndInference: 3,
  officeSanFrancisco: 1,
  contractForwardDeployedEngineers: 28,
};
const PAYEE = {
  cloudAndGpuEnclaveCapacity: "Cloud infrastructure provider",
  hosting: "Cloud hosting provider",
  authenticatorServices: "Authenticator services provider",
  supportTooling: "Support tooling subscription",
  softwareAndTools: "Software subscriptions",
  officeAustin: "Office rent",
  offices: "Office rent",
  insurance: "Insurance premium",
  professionalFees: "Professional fees",
  securityAndAssurance: "Security testing and audit fees",
  assuranceAndCertifications: "Assurance and certification fees",
  travelAndEvents: "Travel and events",
  travelAndOnSite: "Travel and on-site costs",
  recruitment: "Recruitment fee",
  other: "Sundry payments",
  hostingAndInference: "Cloud hosting and model inference provider",
  officeSanFrancisco: "Office rent",
  contractForwardDeployedEngineers: "Contract engineering services",
};

/** Bank transactions for one month, derived from receipts and cost lines. */
export function bankTransactions(fx, month) {
  const a = fx.actuals.find((x) => x.month === month);
  const tx = [];
  for (const i of fx.invoices) {
    if (i.paidOn.slice(0, 7) === month) {
      tx.push({
        date: i.paidOn,
        description: `Receipt - ${customerName(fx, i.customerId)} - ${i.number}`,
        moneyIn: i.amount,
        moneyOut: 0,
        order: 0,
      });
    }
  }
  for (const f of fx.funding) {
    if (f.receivedOn.slice(0, 7) === month) {
      tx.push({
        date: f.receivedOn,
        description: `Funds received - ${f.round}`,
        moneyIn: f.amount,
        moneyOut: 0,
        order: 1,
      });
    }
  }
  const payroll = Object.entries({ ...a.cogs.lines, ...a.opex.lines })
    .filter(([k]) => k.toLowerCase().includes("payroll"))
    .reduce((s, [, v]) => s + v, 0);
  if (payroll > 0) {
    tx.push({
      date: `${month}-25`,
      description: "Payroll and employer costs",
      moneyIn: 0,
      moneyOut: payroll,
      order: 2,
    });
  }
  for (const [k, v] of Object.entries({ ...a.cogs.lines, ...a.opex.lines })) {
    if (k.toLowerCase().includes("payroll") || v === 0) continue;
    const day = PAYMENT_DAY[k];
    if (day === undefined) throw new Error(`no payment day for ${k}`);
    tx.push({
      date: `${month}-${String(day).padStart(2, "0")}`,
      description: PAYEE[k],
      moneyIn: 0,
      moneyOut: v,
      order: 3,
    });
  }
  tx.sort((x, y) =>
    x.date < y.date
      ? -1
      : x.date > y.date
        ? 1
        : x.order - y.order || (x.description < y.description ? -1 : 1),
  );
  let balance = a.cash.opening;
  for (const t of tx) {
    balance += t.moneyIn - t.moneyOut;
    t.balance = balance;
  }
  return tx;
}

function bankStatement(fx) {
  const C = fx.currency;
  const b = fx.bank;
  const months = actualMonths(fx).filter(
    (m) => m >= b.statementFrom.slice(0, 7) && m <= b.statementTo.slice(0, 7),
  );
  const blocks = [
    h("Account"),
    table(
      ["", ""],
      [
        [
          "Bank",
          `${b.name} (a fictitious institution created for this demonstration)`,
        ],
        ["Account name", b.accountName],
        ["Account number", b.accountMasked],
        ...(b.sortCodeMasked ? [["Sort code", b.sortCodeMasked]] : []),
        ["Currency", C],
        [
          "Statement period",
          `${dateLabel(b.statementFrom)} to ${dateLabel(b.statementTo)}`,
        ],
      ],
      { labelWidth: 120 },
    ),
    h(`Monthly balances, ${actualPeriodLabel(fx)}`),
    table(
      ["Month", "Opening balance", "Money in", "Money out", "Closing balance"],
      fx.actuals.map((a) => [
        monthLabel(a.month),
        amount(a.cash.opening),
        amount(a.cash.receipts + a.cash.fundingReceived),
        amount(a.cash.payments),
        amount(a.cash.closing),
      ]),
      { labelWidth: 70 },
    ),
  ];
  for (const m of months) {
    const a = fx.actuals.find((x) => x.month === m);
    const tx = bankTransactions(fx, m);
    blocks.push(
      h(`Transactions, ${monthLong(m)}`),
      table(
        ["Date", "Description", "Money in", "Money out", "Balance"],
        [
          [
            dateLabel(`${m}-01`),
            "Opening balance",
            "",
            "",
            amount(a.cash.opening),
          ],
          ...tx.map((t) => [
            dateLabel(t.date),
            t.description,
            t.moneyIn ? amount(t.moneyIn) : "",
            t.moneyOut ? amount(t.moneyOut) : "",
            amount(t.balance),
          ]),
          [
            dateLabel(lastDay(m)),
            "Closing balance",
            "",
            "",
            amount(a.cash.closing),
          ],
        ],
        { widths: [60, 230, 70, 70, 85] },
      ),
    );
  }
  return {
    ...docBase(
      fx,
      "bank-statement",
      `Business account statement, ${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}, with monthly balances`,
      "FINANCIAL",
      "pdf",
      { from: fx.periods.firstActualMonth, to: fx.periods.lastActualMonth },
    ),
    blocks,
  };
}

function customerContracts(fx) {
  const last = lastActual(fx);
  const blocks = [
    h("Scope"),
    p(
      {
        tensorgate:
          "Summary of each design-partner and paid agreement. Customer names are withheld under the agreements.",
        halyard:
          "Summary of each customer agreement. Customer names are withheld: public bodies approve their own announcements.",
        nixo: "Summary of each subscription agreement. Customer names are withheld under the agreements; each customer is identified by a letter and its segment.",
      }[fx.key],
    ),
  ];
  for (const c of fx.customers) {
    const rows = [
      ["Segment", c.segment],
      ["Status", c.status.replaceAll("_", " ").toLowerCase()],
    ];
    if (fx.key === "nixo") {
      const C = fx.currency;
      const price = fx.pricing.pricePerSeatPerMonth;
      const seats = c.seatSchedule
        .map((s) => `${amount(s.seats)} from ${monthLabel(s.from)}`)
        .join("; ");
      rows.push(
        ["Design partner since", dateLabel(c.designPartnerSince)],
        ["Contract signed", dateLabel(c.contractSignedOn)],
        [
          "Billing start",
          c.status === "SIGNED_NOT_BILLING"
            ? `${c.contractedSeats} seats contracted, billing from ${dateLabel(c.billingStartOn)}, after planned go-live on ${dateLabel(c.goLiveOn)}`
            : `${dateLabel(c.billingStartOn)} (go-live ${dateLabel(c.goLiveOn)})`,
        ],
        ["Term", `${c.termMonths} months; ${c.renewal.toLowerCase()}`],
        [
          "Price",
          `${C} ${amount(price)} per forward-deployed engineering seat per month, billed monthly in advance`,
        ],
        ["Billed seats", seats === "" ? "None yet" : seats],
        [
          "Onboarding fee",
          `${C} ${amount(c.onboardingFee)}, invoiced at signature, recognised over three months from go-live`,
        ],
        ["Payment pattern", c.paymentPattern],
        [
          "Data handling",
          "Deployment metadata and time records only; no customer end-user data",
        ],
      );
    } else if (fx.key === "tensorgate") {
      rows.push(["Design partner since", dateLabel(c.designPartnerSince)]);
      if (c.contractSignedOn) {
        rows.push(
          ["Contract signed", dateLabel(c.contractSignedOn)],
          [
            "Billing start",
            `${dateLabel(c.billingStartOn)}, after deployment acceptance on ${dateLabel(c.goLiveOn)}`,
          ],
          ["Term", `${c.termMonths} months; ${c.renewal.toLowerCase()}`],
          [
            "Annual platform floor",
            `${fx.currency} ${amount(c.annualFloor)}, billed monthly`,
          ],
          [
            "Included usage",
            `${amount(c.includedRequestsPerYearThousands / 1000)} million requests a year`,
          ],
          [
            "Usage above the floor",
            `${fx.currency} ${amount(c.overagePricePerMillion)} per million requests, billed monthly in arrears`,
          ],
          [
            "Implementation fee",
            c.implementationFee
              ? `${fx.currency} ${amount(c.implementationFee)}`
              : "None",
          ],
          ["Deployment", c.deployment],
          ["Security terms", "Right to audit; 72-hour incident notice"],
        );
      } else {
        rows.push(["Pilot terms", c.pilotTerms]);
      }
    } else {
      rows.push(
        ["Contract signed", dateLabel(c.contractSignedOn)],
        ["Go-live", dateLabel(c.goLiveOn)],
        ["Procurement", c.procurement],
        [
          "Price",
          `${fx.currency} ${c.pricePerUserPerYear} per user per year, billed monthly in arrears`,
        ],
        ["Term", `${c.termMonths} months`],
        [
          `Licensed seats at ${monthLabel(last.month)}`,
          amount(last.kpis.seatsByCustomer[c.id]),
        ],
        [
          "Deployment fee",
          c.deploymentFee
            ? `${fx.currency} ${amount(c.deploymentFee)}, invoiced at signature, recognised at go-live`
            : "Before this period",
        ],
        ["Data protection", c.dataProcessing],
      );
      if (c.licensedUsersAtFullRollout) {
        rows.push(
          [
            "Licensed users at full rollout",
            amount(c.licensedUsersAtFullRollout),
          ],
          ["Rollout", c.rolloutNote],
          ["Go-live support", `${c.goLiveSupportWeeks} weeks included`],
        );
      }
    }
    blocks.push(
      h(customerName(fx, c.id)),
      table(["", ""], rows, { labelWidth: 150 }),
    );
  }
  return {
    ...docBase(
      fx,
      "customer-contracts",
      "Customer contract summary",
      "CUSTOMER",
      "pdf",
      {
        from: fx.periods.firstActualMonth,
        to: fx.periods.lastActualMonth,
      },
    ),
    blocks,
  };
}

function cohorts(fx) {
  const months = actualMonths(fx);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const blocks = [];
  if (fx.key === "tensorgate") {
    blocks.push(
      h("Scope"),
      p(
        "Requests served through the gateway by each design partner and customer, in thousands of requests per month.",
      ),
      ...monthTables(
        months,
        (g) => [
          ...fx.customers.map((c) =>
            row(
              customerName(fx, c.id),
              g.map((m) =>
                amount(get(m).kpis.requestsByCustomerThousands[c.id] ?? 0),
              ),
            ),
          ),
          row(
            "All customers",
            g.map((m) => amount(get(m).kpis.requestsServedInMonthThousands)),
          ),
        ],
        "Requests served (thousands)",
      ),
      h("Design partner to paid contract"),
      table(
        ["Customer", "Partner since", "Contract signed", "Months to convert"],
        fx.customers.map((c) => [
          customerName(fx, c.id),
          dateLabel(c.designPartnerSince),
          c.contractSignedOn ? dateLabel(c.contractSignedOn) : "Not yet",
          c.contractSignedOn
            ? String(monthsBetween(c.designPartnerSince, c.contractSignedOn))
            : "-",
        ]),
        { labelWidth: 170 },
      ),
      p(
        "No design partner or customer has left. Logo retention over the period: 100%.",
      ),
    );
  } else if (fx.key === "nixo") {
    const start = fx.actuals.find((a) => a.month === "2025-10");
    const end = lastActual(fx);
    const cohort = Object.keys(start.kpis.seatsByCustomer);
    const s0 = cohort.reduce((s, id) => s + start.kpis.seatsByCustomer[id], 0);
    const s1 = cohort.reduce((s, id) => s + end.kpis.seatsByCustomer[id], 0);
    blocks.push(
      h("Scope"),
      p(
        "Billed forward-deployed engineering seats by customer and month. Subscription revenue is 1,200 per seat per month.",
      ),
      ...monthTables(
        months,
        (g) => [
          ...fx.customers.map((c) =>
            row(
              customerName(fx, c.id),
              g.map((m) => amount(get(m).kpis.seatsByCustomer[c.id] ?? 0)),
            ),
          ),
          row(
            "Billed seats",
            g.map((m) => amount(get(m).kpis.billedSeats)),
          ),
        ],
        "Billed seats",
      ),
      h("Design partner to paid contract"),
      table(
        ["Customer", "Partner since", "Contract signed", "Months to convert"],
        fx.customers.map((c) => [
          customerName(fx, c.id),
          dateLabel(c.designPartnerSince),
          dateLabel(c.contractSignedOn),
          String(monthsBetween(c.designPartnerSince, c.contractSignedOn)),
        ]),
        { labelWidth: 170 },
      ),
      h("Net seat retention"),
      p(
        `Customers billed at ${monthLabel(start.month)} (${cohort.length}) held ${amount(s0)} seats then and ${amount(s1)} at ${monthLabel(end.month)}: net seat retention ${percent1(s1, s0)}. No customer has left; logo retention 100%.`,
      ),
    );
  } else {
    const start = fx.actuals.find((a) => a.month === "2025-10");
    const end = lastActual(fx);
    const cohort = Object.keys(start.kpis.seatsByCustomer);
    const s0 = cohort.reduce((s, id) => s + start.kpis.seatsByCustomer[id], 0);
    const s1 = cohort.reduce((s, id) => s + end.kpis.seatsByCustomer[id], 0);
    blocks.push(
      h("Scope"),
      p(
        "Licensed seats by customer and month. Licence revenue is 1.00 per seat per month.",
      ),
      ...monthTables(
        months,
        (g) => [
          ...fx.customers.map((c) =>
            row(
              customerName(fx, c.id),
              g.map((m) => amount(get(m).kpis.seatsByCustomer[c.id] ?? 0)),
            ),
          ),
          row(
            "Licensed seats",
            g.map((m) => amount(get(m).kpis.licensedSeats)),
          ),
        ],
        "Licensed seats",
      ),
      h("Net seat retention"),
      p(
        `Customers live at ${monthLabel(start.month)} (${cohort.length}) held ${amount(s0)} seats then and ${amount(s1)} at ${monthLabel(end.month)}: net seat retention ${percent1(s1, s0)}. No customer has left; logo retention 100%.`,
      ),
    );
  }
  return {
    ...docBase(
      fx,
      "cohorts-retention",
      "Customer cohorts and retention",
      "CUSTOMER",
      "pdf",
      {
        from: fx.periods.firstActualMonth,
        to: fx.periods.lastActualMonth,
      },
    ),
    blocks,
  };
}

function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

function concentration(fx) {
  const months = actualMonths(fx);
  const last3 = months.slice(-3);
  const last12 = months.slice(-12);
  const sum = (ms, id) =>
    ms.reduce((s, m) => s + revenueByCustomer(fx, m)[id], 0);
  const total = (ms) =>
    ms.reduce(
      (s, m) => s + fx.actuals.find((a) => a.month === m).revenue.total,
      0,
    );
  const t3 = total(last3);
  const t12 = total(last12);
  const rows = fx.customers
    .map((c) => ({ c, r3: sum(last3, c.id), r12: sum(last12, c.id) }))
    .sort((x, y) => y.r12 - x.r12 || (x.c.id < y.c.id ? -1 : 1))
    .map(({ c, r3, r12 }) => [
      customerName(fx, c.id),
      amount(r3),
      percent1(r3, t3),
      amount(r12),
      percent1(r12, t12),
    ]);
  const top = fx.customers
    .map((c) => ({ id: c.id, r: sum(last12, c.id) }))
    .sort((x, y) => y.r - x.r || (x.id < y.id ? -1 : 1))[0];
  const blocks = [
    h("Revenue share by customer"),
    table(
      [
        "Customer",
        `3 months to ${monthLabel(last3[2])}`,
        "Share",
        `12 months to ${monthLabel(last12[11])}`,
        "Share",
      ],
      [...rows, ["Total", amount(t3), "100.0%", amount(t12), "100.0%"]],
      { labelWidth: 170 },
    ),
    p(
      `Largest customer over the 12 months: ${customerName(fx, top.id)}, ${percent1(top.r, t12)} of recognised revenue.`,
    ),
  ];
  if (fx.key === "halyard") {
    const end = lastActual(fx);
    const [bigId, bigSeats] = Object.entries(end.kpis.seatsByCustomer).sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0];
    blocks.push(
      p(
        `Largest customer by ARR at ${monthLabel(end.month)}: ${customerName(fx, bigId)}, ${amount(bigSeats * 12)} of ${amount(end.kpis.arr)} ARR (${percent1(bigSeats, end.kpis.licensedSeats)}).`,
      ),
    );
  } else if (fx.key === "nixo") {
    const end = lastActual(fx);
    const [bigId, bigSeats] = Object.entries(end.kpis.seatsByCustomer).sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0];
    blocks.push(
      p(
        `Largest customer by billed seats at ${monthLabel(end.month)}: ${customerName(fx, bigId)}, ${amount(bigSeats)} of ${amount(end.kpis.billedSeats)} seats (${percent1(bigSeats, end.kpis.billedSeats)}).`,
      ),
    );
  } else {
    blocks.push(
      p(
        "Until October 2026 one customer produced all recognised revenue. From October 2026 two customers each pay a 180,000 annual floor.",
      ),
    );
  }
  return {
    ...docBase(
      fx,
      "customer-concentration",
      "Customer concentration",
      "COMMERCIAL",
      "pdf",
      {
        from: last12[0],
        to: fx.periods.lastActualMonth,
      },
    ),
    blocks,
  };
}

function fundingHistoryTable(fx) {
  const C = fx.currency;
  return table(
    ["Date", "Round", "Instrument", `Amount (${C})`],
    [...fx.fundingBeforeWindow, ...fx.funding].map((f) => [
      dateLabel(f.receivedOn),
      f.round,
      f.instrument,
      amount(f.amount),
    ]),
    { widths: [62, 160, 220, 75] },
  );
}

function capTable(fx) {
  const ct = fx.capTable;
  const shares = ct.holders.map((x) => x.shares);
  const total = shares.reduce((a, b) => a + b, 0);
  const pct = ownershipHundredths(shares);
  const pro = [
    ...ct.holders.map((x) => ({
      holder: x.holder,
      class: x.class,
      shares: x.shares,
    })),
    ...(ct.proForma.conversions ?? []),
    {
      holder: ct.proForma.newHolder,
      class: "New money at the seed round",
      shares: ct.proForma.newShares,
    },
  ];
  const proTotal = pro.reduce((s, x) => s + x.shares, 0);
  const proPct = ownershipHundredths(pro.map((x) => x.shares));
  const blocks = [
    h(`Capitalisation table at ${dateLabel(ct.asOf)}`),
    p(ct.basis),
    table(
      ["Holder", "Class", "Shares", "Ownership"],
      [
        ...ct.holders.map((x, i) => [
          x.holder,
          x.class,
          amount(x.shares),
          hundredthsLabel(pct[i]),
        ]),
        [
          "Total",
          "",
          amount(total),
          hundredthsLabel(pct.reduce((a, b) => a + b, 0)),
        ],
      ],
      { widths: [150, 170, 90, 90] },
    ),
    h("Funding history"),
    fundingHistoryTable(fx),
    h("Pro forma after the seed round"),
    p(ct.proForma.description),
    p(raiseTermsLine(fx)),
    table(
      ["Holder", "Class", "Shares", "Ownership"],
      [
        ...pro.map((x, i) => [
          x.holder,
          x.class,
          amount(x.shares),
          hundredthsLabel(proPct[i]),
        ]),
        [
          "Total",
          "",
          amount(proTotal),
          hundredthsLabel(proPct.reduce((a, b) => a + b, 0)),
        ],
      ],
      { widths: [150, 170, 90, 90] },
    ),
  ];
  return {
    ...docBase(
      fx,
      "cap-table",
      "Capitalisation table and ownership",
      "CORPORATE",
      "pdf",
      {
        from: ct.asOf.slice(0, 7),
        to: ct.asOf.slice(0, 7),
      },
    ),
    blocks,
  };
}

function raiseTerms(fx) {
  const r = fx.raise;
  const C = r.currency;
  const totalPct = r.useOfFunds.reduce((s, u) => s + u.percent, 0);
  const totalAmt = r.useOfFunds.reduce((s, u) => s + u.amount, 0);
  const blocks = [
    h("Round"),
    p(raiseTermsLine(fx)),
    table(
      ["", ""],
      [
        ["Round", r.roundName],
        ["Amount", `${C} ${amount(r.targetAmount)}`],
        ["Instrument", r.instrument],
        r.valuationCap !== undefined
          ? ["Valuation cap", `${C} ${amount(r.valuationCap)}`]
          : ["Pre-money valuation", `${C} ${amount(r.preMoneyValuation)}`],
        ["Minimum cheque", `${C} ${amount(r.minimumCheque)}`],
        ["Target close", dateLabel(r.targetCloseOn)],
        [
          "Planned net burn after the raise",
          `about ${C} ${amount(r.plannedMonthlyNetBurnPostRaise)} a month`,
        ],
      ],
      { labelWidth: 170 },
    ),
    h("Use of funds"),
    table(
      ["Use", "Share", `Amount (${C})`],
      [
        ...r.useOfFunds.map((u) => [u.line, `${u.percent}%`, amount(u.amount)]),
        ["Total", `${totalPct}%`, amount(totalAmt)],
      ],
      { labelWidth: 300 },
    ),
    h("Previous funding"),
    fundingHistoryTable(fx),
  ];
  return {
    ...docBase(
      fx,
      "raise-terms",
      "Seed round terms and use of funds",
      "CORPORATE",
      "pdf",
      {
        from: fx.periods.projectionFirstMonth,
        to: r.targetCloseOn.slice(0, 7),
      },
    ),
    blocks,
  };
}

function projectionsDoc(fx) {
  const C = fx.currency;
  const pr = fx.projections;
  const months = pr.months.map((x) => x.month);
  const get = (m) => pr.months.find((x) => x.month === m);
  const extra = {
    tensorgate: [["Contracted ARR", (m) => amount(get(m).contractedArr)]],
    halyard: [
      ["Licensed seats", (m) => amount(get(m).licensedSeats)],
      ["ARR", (m) => amount(get(m).arr)],
    ],
    nixo: [
      ["Billed seats", (m) => amount(get(m).billedSeats)],
      ["Subscription ARR", (m) => amount(get(m).arr)],
    ],
  }[fx.key];
  const opening = pr.months[0].cashOpening;
  const y2027 = pr.months.filter((x) => x.month.startsWith("2027"));
  const blocks = [
    h(pr.label),
    p(
      `These are projections for ${projectionPeriodLabel(fx)}. They are not actual results. Actual results to ${monthLabel(fx.periods.lastActualMonth)} are in the management accounts.`,
    ),
    p(
      `Opening cash at ${dateLabel(lastDay(fx.periods.lastActualMonth))} (management accounts): ${C} ${amount(opening)}.`,
    ),
    p(`Assumes the seed round closes as planned. ${raiseTermsLine(fx)}`),
    h("Assumptions"),
    ...pr.assumptions.map((a) => p(`- ${a}`)),
    ...monthTables(
      months,
      (g) => [
        row(
          "Revenue",
          g.map((m) => amount(get(m).revenue)),
        ),
        row(
          "Costs",
          g.map((m) => amount(get(m).costs)),
        ),
        row(
          "Net burn",
          g.map((m) => amount(get(m).netBurn)),
        ),
        row(
          "Funding received",
          g.map((m) => amount(get(m).fundingReceived)),
        ),
        row(
          "Closing cash",
          g.map((m) => amount(get(m).cashClosing)),
        ),
        row(
          "Headcount",
          g.map((m) => String(get(m).headcount)),
        ),
        ...extra.map(([label, f]) => row(label, g.map(f))),
      ],
      "PROJECTION",
      7,
    ),
    h("2027 in total (projection)"),
    table(
      ["", C],
      [
        ["Revenue", amount(y2027.reduce((s, x) => s + x.revenue, 0))],
        ["Costs", amount(y2027.reduce((s, x) => s + x.costs, 0))],
        ["Net burn", amount(y2027.reduce((s, x) => s + x.netBurn, 0))],
        ["Cash at 31 Dec 2027", amount(y2027[y2027.length - 1].cashClosing)],
      ],
      { labelWidth: 200 },
    ),
  ];
  return {
    ...docBase(
      fx,
      "projections-2027",
      "Projections to December 2027, with assumptions",
      "FINANCIAL_MODEL",
      "pdf",
      {
        from: fx.periods.projectionFirstMonth,
        to: fx.periods.projectionLastMonth,
      },
    ),
    pageBanner: "PROJECTION - NOT ACTUAL RESULTS",
    blocks,
  };
}

function kpiPack(fx) {
  const months = actualMonths(fx);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const last = lastActual(fx);
  const C = fx.currency;
  const blocks = [h("Definitions")];
  for (const k of fx.kpiDefinitions) blocks.push(p(`${k.label}.`));
  if (fx.key === "tensorgate") {
    blocks.push(
      ...monthTables(
        months,
        (g) => [
          row(
            "Requests served, cumulative (millions)",
            g.map((m) =>
              oneDecimal(get(m).kpis.requestsServedCumulativeThousands / 1000),
            ),
          ),
          row(
            "Requests in the month (thousands)",
            g.map((m) => amount(get(m).kpis.requestsServedInMonthThousands)),
          ),
          row(
            "Design partners",
            g.map((m) => String(get(m).kpis.designPartners)),
          ),
          row(
            "Paid contracts",
            g.map((m) => String(get(m).kpis.paidContracts)),
          ),
          row(
            `Contracted ARR (${C})`,
            g.map((m) => amount(get(m).kpis.contractedArr)),
          ),
          row(
            "Median enclave overhead (ms)",
            g.map((m) => String(get(m).kpis.medianOverheadMs)),
          ),
        ],
        "Product and commercial metrics",
      ),
      h(`Financial position, ${monthLong(last.month)}`),
      p(
        `Recognised revenue ${C} ${amount(last.revenue.total)} for the month; contracted ARR ${C} ${amount(last.kpis.contractedArr)}. Customer C's floor is billed from 1 Oct 2026, after deployment acceptance on 26 Sep 2026.`,
      ),
      p(
        `Net burn ${C} ${amount(last.netBurn)}; cash ${C} ${amount(last.cash.closing)}; runway ${oneDecimal(last.cash.closing / last.netBurn)} months at this burn.`,
      ),
      p(
        "Median overhead is measured against the same model and hardware outside the enclave.",
      ),
    );
  } else if (fx.key === "nixo") {
    const t12 = trailingTwelve(fx);
    const sm = subscriptionMarginTwelve(fx);
    const f = nixoSignedNotBilling(fx);
    blocks.push(
      ...monthTables(
        months,
        (g) => [
          row(
            "Billed seats",
            g.map((m) => amount(get(m).kpis.billedSeats)),
          ),
          row(
            "Paid contracts",
            g.map((m) => String(get(m).kpis.paidContracts)),
          ),
          row(
            "Design partners",
            g.map((m) => String(get(m).kpis.designPartners)),
          ),
          row(
            `Annualised subscription revenue (${C})`,
            g.map((m) => amount(get(m).kpis.annualisedSubscriptionRevenue)),
          ),
          row(
            `Contracted ARR (${C})`,
            g.map((m) => amount(get(m).kpis.contractedArr)),
          ),
          row(
            "Deployments tracked",
            g.map((m) => amount(get(m).kpis.deploymentsTracked)),
          ),
          row(
            "Employees (month end)",
            g.map((m) => String(get(m).headcount.total)),
          ),
          row(
            "Contract forward-deployed engineers",
            g.map((m) => String(get(m).kpis.contractorsForwardDeployed)),
          ),
        ],
        "Product and commercial metrics",
      ),
      h(`Financial position, ${monthLong(last.month)}`),
      p(
        `Contracted ARR ${C} ${amount(last.kpis.contractedArr)}; annualised subscription revenue ${C} ${amount(last.kpis.annualisedSubscriptionRevenue)}. ${customerName(fx, f.id)} signed on ${dateLabel(f.contractSignedOn)} for ${f.contractedSeats} seats, with billing from ${dateLabel(f.billingStartOn)}.`,
      ),
      p(
        `Gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(t12.revenue - t12.cogs, t12.revenue)} with onboarding delivery in cost of revenue; subscription gross margin ${percent1(sm.revenue - sm.cost, sm.revenue)}.`,
      ),
      p(
        `Net burn ${C} ${amount(last.netBurn)}; cash ${C} ${amount(last.cash.closing)}; runway ${oneDecimal(last.cash.closing / last.netBurn)} months at this burn.`,
      ),
      h("Team"),
      p(
        `${nixoTeamAtSeptember(fx)}. Headcount figures in this pack count employees only.`,
      ),
    );
  } else {
    const t12 = trailingTwelve(fx);
    blocks.push(
      ...monthTables(
        months,
        (g) => [
          row(
            "NHS trusts, health boards and councils",
            g.map((m) => String(get(m).kpis.organisations)),
          ),
          row(
            "Licensed seats",
            g.map((m) => amount(get(m).kpis.licensedSeats)),
          ),
          row(
            "Staff enrolled with passkeys",
            g.map((m) => amount(get(m).kpis.staffEnrolled)),
          ),
          row(
            `ARR (${C})`,
            g.map((m) => amount(get(m).kpis.arr)),
          ),
          row(
            "Phishing takeovers of enrolled accounts",
            g.map((m) => String(get(m).kpis.phishingTakeoversEnrolled)),
          ),
        ],
        "Product and commercial metrics",
      ),
      h(`Financial position, ${monthLong(last.month)}`),
      p(`ARR ${C} ${amount(last.kpis.arr)} (licensed seats x 12).`),
      p(
        `Gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(t12.revenue - t12.cogs, t12.revenue)}, with the deployment team in cost of sales.`,
      ),
      p(
        `Net burn ${C} ${amount(last.netBurn)}; cash ${C} ${amount(last.cash.closing)}; runway ${oneDecimal(last.cash.closing / last.netBurn)} months at this burn.`,
      ),
      p(
        "Phishing takeovers are counted from customer security operations logs and identity-provider sign-in records.",
      ),
    );
  }
  return {
    ...docBase(
      fx,
      "kpi-pack",
      "KPI and product metrics pack",
      "OPERATIONAL",
      "pdf",
      {
        from: fx.periods.firstActualMonth,
        to: fx.periods.lastActualMonth,
      },
    ),
    blocks,
  };
}

function teamDoc(fx) {
  const months = actualMonths(fx);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const fns = Object.keys(fx.actuals[0].headcount).filter((k) => k !== "total");
  const last = lastActual(fx);
  const blocks = [
    h("Founders"),
    ...fx.team.founders.map((f) => p(`${f.name}, ${f.role}. ${f.summary}`)),
    ...(fx.team.keyPeople.length > 0
      ? [
          h("Key people"),
          ...fx.team.keyPeople.map((f) =>
            p(`${f.name}, ${f.role}. ${f.summary}`),
          ),
        ]
      : []),
    ...(fx.key === "nixo"
      ? [
          h("Employees and contractors"),
          p(fx.team.contractorsNote),
          p(
            `${nixoTeamAtSeptember(fx)}; ${last.headcount.total} employees and ${last.kpis.contractorsForwardDeployed} contract forward-deployed engineers at ${dateLabel(lastDay(last.month))}.`,
          ),
        ]
      : []),
    h(`Headcount at ${dateLabel(lastDay(last.month))}`),
    table(
      ["Function", "People"],
      [
        ...fns.map((k) => [HEADCOUNT_LABELS[k], String(last.headcount[k])]),
        ["Total", String(last.headcount.total)],
      ],
      { labelWidth: 150 },
    ),
    ...monthTables(
      months,
      (g) => [
        ...fns.map((k) =>
          row(
            HEADCOUNT_LABELS[k],
            g.map((m) => String(get(m).headcount[k])),
          ),
        ),
        row(
          "Total",
          g.map((m) => String(get(m).headcount.total)),
        ),
      ],
      "Headcount by function",
    ),
    h("Hiring plan funded by the seed round"),
    table(
      ["Role", "Function", "People", "Start by", "Use of funds line"],
      fx.team.hiringPlan.map((x) => [
        x.role,
        x.function,
        String(x.count),
        x.startBy,
        x.fundedBy,
      ]),
      { widths: [140, 70, 45, 50, 210] },
    ),
  ];
  return {
    ...docBase(
      fx,
      "team-hiring-plan",
      "Team and hiring plan",
      "OPERATIONAL",
      "pdf",
      {
        from: fx.periods.firstActualMonth,
        to: fx.periods.projectionLastMonth,
      },
    ),
    blocks,
  };
}

/**
 * Nixo has no deck of its own, so a short text-native deck is generated
 * from the same fixture: one slide per page, every number read from or
 * derived from the fixture, projections labelled as projections.
 */
function pitchDeck(fx) {
  const C = fx.currency;
  const r = fx.raise;
  const last = lastActual(fx);
  const t12 = trailingTwelve(fx);
  const sm = subscriptionMarginTwelve(fx);
  const f = nixoSignedNotBilling(fx);
  const live = fx.customers.filter((c) => c.status === "LIVE");
  const price = fx.pricing.pricePerSeatPerMonth;
  const pr = fx.projections.months;
  const endProjection = pr[pr.length - 1];
  const start = fx.actuals.find((a) => a.month === "2025-10");
  const cohort = Object.keys(start.kpis.seatsByCustomer);
  const s0 = cohort.reduce((s, id) => s + start.kpis.seatsByCustomer[id], 0);
  const s1 = cohort.reduce((s, id) => s + last.kpis.seatsByCustomer[id], 0);
  const quarters = [
    ["Q3 2025", ["2025-07", "2025-08", "2025-09"]],
    ["Q4 2025", ["2025-10", "2025-11", "2025-12"]],
    ["Q1 2026", ["2026-01", "2026-02", "2026-03"]],
    ["Q2 2026", ["2026-04", "2026-05", "2026-06"]],
    ["Q3 2026", ["2026-07", "2026-08", "2026-09"]],
  ];
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const slide = (n, title, ...body) => [
    ...(n > 1 ? [{ kind: "pageBreak" }] : []),
    h(`${n}. ${title}`),
    ...body,
  ];
  const blocks = [
    ...slide(
      1,
      fx.company.name,
      p(fx.company.oneLiner),
      p(
        `Seed round: ${C} ${amount(r.targetAmount)} on a ${r.instrument}. ${fx.company.headquarters}. Founded ${dateLabel(fx.company.foundedOn)}.`,
      ),
      p(`${fx.team.founders.map((x) => `${x.name}, ${x.role}`).join("; ")}.`),
    ),
    ...slide(
      2,
      "The problem",
      p(
        "AI companies win enterprise contracts by sending forward-deployed engineers to make the product work inside each customer.",
      ),
      p(
        "That custom work is rarely priced, tracked or reused, so gross margin drifts toward services levels and leadership cannot see which deployments make money.",
      ),
    ),
    ...slide(
      3,
      "The product",
      p(
        "Nixo is software for forward-deployed engineering teams: scope and price each custom deployment, record engineer time and model-inference cost against it, reuse deployment templates, and report margin by customer and by deployment.",
      ),
      p(
        "Used by forward-deployed engineers day to day, and by finance and leadership for margin reporting.",
      ),
    ),
    ...slide(
      4,
      "Business model",
      table(
        ["", ""],
        [
          [
            "Subscription",
            `${C} ${amount(price)} per forward-deployed engineering seat per month, annual contracts, billed monthly in advance`,
          ],
          [
            "Onboarding",
            "One-off fee of 12,000 to 30,000, invoiced at signature, recognised over three months from go-live",
          ],
        ],
        { labelWidth: 140 },
      ),
    ),
    ...slide(
      5,
      `Traction to ${monthLong(last.month)} (actual)`,
      table(
        ["", monthLabel(last.month)],
        [
          ["Paying customers (live)", String(live.length)],
          ["Billed seats", amount(last.kpis.billedSeats)],
          [
            `Annualised subscription revenue (${C})`,
            amount(last.kpis.annualisedSubscriptionRevenue),
          ],
          [`Contracted ARR (${C})`, amount(last.kpis.contractedArr)],
          ["Deployments tracked", amount(last.kpis.deploymentsTracked)],
        ],
        { labelWidth: 260 },
      ),
      p(
        `Contracted ARR includes ${customerName(fx, f.id)}: ${f.contractedSeats} seats signed on ${dateLabel(f.contractSignedOn)}, billing from ${dateLabel(f.billingStartOn)}.`,
      ),
    ),
    ...slide(
      6,
      "Recognised revenue by quarter (actual)",
      table(
        ["Quarter", `Revenue (${C})`, "Billed seats at quarter end"],
        quarters.map(([label, ms]) => [
          label,
          amount(ms.reduce((s, m) => s + get(m).revenue.total, 0)),
          amount(get(ms[2]).kpis.billedSeats),
        ]),
        { labelWidth: 160 },
      ),
    ),
    ...slide(
      7,
      "Unit economics (actual)",
      p(
        `Gross margin, 12 months to ${monthLabel(t12.to)}: ${percent1(t12.revenue - t12.cogs, t12.revenue)}, with onboarding delivery by contract engineers in cost of revenue.`,
      ),
      p(
        `Subscription gross margin over the same 12 months: ${percent1(sm.revenue - sm.cost, sm.revenue)} after hosting and model inference.`,
      ),
      p(
        `Net seat retention: customers billed at ${monthLabel(start.month)} grew from ${amount(s0)} to ${amount(s1)} seats by ${monthLabel(last.month)} (${percent1(s1, s0)}). No customer has left.`,
      ),
    ),
    ...slide(
      8,
      "Customers",
      p(
        "Names withheld under the agreements; each customer is identified by a letter and its segment.",
      ),
      table(
        ["Customer", "Contract signed", `Seats at ${monthLabel(last.month)}`],
        fx.customers.map((c) => [
          customerName(fx, c.id),
          dateLabel(c.contractSignedOn),
          c.status === "SIGNED_NOT_BILLING"
            ? `${c.contractedSeats} contracted, not yet billed`
            : amount(last.kpis.seatsByCustomer[c.id]),
        ]),
        { widths: [300, 100, 130] },
      ),
    ),
    ...slide(
      9,
      "Team",
      ...fx.team.founders.map((x) => p(`${x.name}, ${x.role}. ${x.summary}`)),
      p(
        `${last.headcount.total} employees and ${last.kpis.contractorsForwardDeployed} contract forward-deployed engineers at ${dateLabel(lastDay(last.month))}.`,
      ),
    ),
    ...slide(
      10,
      `Financial position, ${monthLong(last.month)} (actual)`,
      table(
        ["", C],
        [
          ["Cash at month end", amount(last.cash.closing)],
          ["Net burn in the month", amount(last.netBurn)],
          [
            "Runway at this burn (months)",
            oneDecimal(last.cash.closing / last.netBurn),
          ],
        ],
        { labelWidth: 260 },
      ),
    ),
    ...slide(
      11,
      "Plan to December 2027 (PROJECTION - not actual results)",
      p(
        `Projection: ${amount(endProjection.billedSeats)} billed seats and subscription ARR of ${C} ${amount(endProjection.arr)} at ${monthLabel(endProjection.month)}; ${endProjection.headcount} employees.`,
      ),
      p(
        `Planned net burn after the raise: about ${C} ${amount(r.plannedMonthlyNetBurnPostRaise)} a month. The full projection and its assumptions are in the projections document.`,
      ),
    ),
    ...slide(
      12,
      "The raise",
      p(raiseTermsLine(fx)),
      table(
        ["Use of funds", "Share", `Amount (${C})`],
        r.useOfFunds.map((u) => [u.line, `${u.percent}%`, amount(u.amount)]),
        { labelWidth: 300 },
      ),
    ),
  ];
  return {
    ...docBase(fx, "pitch-deck", "Seed pitch deck", "PITCH_DECK", "pdf", {
      from: fx.periods.firstActualMonth,
      to: fx.periods.lastActualMonth,
    }),
    layout: "slides",
    blocks,
  };
}

/** Every document for one company, in a fixed order. */
export function buildDocuments(fx) {
  return [
    ...(fx.key === "nixo" ? [pitchDeck(fx)] : []),
    managementAccounts(fx),
    monthlyActualsCsv(fx),
    revenueBreakdown(fx),
    invoiceRegisterCsv(fx),
    bankStatement(fx),
    customerContracts(fx),
    cohorts(fx),
    concentration(fx),
    capTable(fx),
    raiseTerms(fx),
    projectionsDoc(fx),
    kpiPack(fx),
    teamDoc(fx),
  ];
}

// ---------------------------------------------------------------- manifest

/** Data-room folder and checklist codes (evidence.data_room_* reference data). */
const PLACEMENT = {
  "pitch-deck": { folder: "fundraising", checklistItem: "pitch_deck" },
  "management-accounts": {
    folder: "financials",
    checklistItem: "management_accounts",
  },
  "monthly-actuals": {
    folder: "financials",
    checklistItem: "monthly_financials_24m",
  },
  "revenue-breakdown": {
    folder: "financials",
    checklistItem: "revenue_by_customer",
  },
  "invoice-register": { folder: "financials", checklistItem: null },
  "bank-statement": { folder: "financials", checklistItem: null },
  "customer-contracts": {
    folder: "commercial",
    checklistItem: "customer_contracts",
  },
  "cohorts-retention": {
    folder: "financials",
    checklistItem: "unit_economics",
  },
  "customer-concentration": { folder: "commercial", checklistItem: null },
  "cap-table": { folder: "cap_table", checklistItem: "cap_table_full" },
  "raise-terms": { folder: "fundraising", checklistItem: "use_of_funds" },
  "projections-2027": {
    folder: "financials",
    checklistItem: "financial_model",
  },
  "kpi-pack": { folder: "fundraising", checklistItem: "key_metrics" },
  "team-hiring-plan": { folder: "team", checklistItem: "team_bios" },
};

/** Which documents each company plans to share with its fictional investor. */
const PLANNED_SHARES = {
  tensorgate: [
    "management-accounts",
    "revenue-breakdown",
    "customer-contracts",
    "customer-concentration",
    "cap-table",
    "raise-terms",
    "projections-2027",
    "kpi-pack",
  ],
  halyard: [
    "management-accounts",
    "cohorts-retention",
    "customer-concentration",
    "cap-table",
    "raise-terms",
    "projections-2027",
    "kpi-pack",
  ],
  nixo: [
    "pitch-deck",
    "management-accounts",
    "revenue-breakdown",
    "customer-contracts",
    "cohorts-retention",
    "customer-concentration",
    "cap-table",
    "raise-terms",
    "projections-2027",
    "kpi-pack",
  ],
};

export function buildManifest(fx, docs) {
  return {
    schemaVersion: 1,
    company: fx.company.name,
    companyKey: fx.key,
    fixture: `scripts/seed/evidence/fixtures/${fx.key}.json`,
    synthetic: true,
    ...(fx.seedSource.companyId === undefined
      ? {}
      : {
          companyId: fx.seedSource.companyId,
          seedAuthority: fx.seedSource.decision,
          inventedFields: fx.assumptions.map((a) => a.field),
        }),
    sensitivityRule:
      "packages/evidence/src/domain/sensitivity.ts defaultDocumentSensitivity: FINANCIAL, MANAGEMENT_ACCOUNTS and FINANCIAL_MODEL are HIGHLY_CONFIDENTIAL; every other type is CONFIDENTIAL.",
    qReadRule:
      "HIGHLY_CONFIDENTIAL documents are held back from Q (packages/q-tools/src/tools/own-records.ts heldBackFromQ) even when shared; an investor's Q cannot read them under current rules.",
    plannedInvestor: fx.sharingPlan.investor,
    plannedInvestorNote: fx.sharingPlan.note,
    documents: docs.map((d) => {
      const slug = d.id.slice(fx.idPrefix.length + 1);
      const sensitivity = defaultSensitivityFor(d.documentType);
      const shared = PLANNED_SHARES[fx.key].includes(slug);
      return {
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        title: d.title,
        documentType: d.documentType,
        defaultSensitivity: sensitivity,
        readableByInvestorQUnderCurrentRules:
          sensitivity !== "HIGHLY_CONFIDENTIAL",
        period: { from: d.period.from, to: d.period.to },
        issuedOn: d.issuedOn,
        version: d.version,
        dataRoomFolder: PLACEMENT[slug].folder,
        checklistItem: PLACEMENT[slug].checklistItem,
        intendedDataRoomLevel: "PRIVATE",
        intendedVisibilityScope: "organisation_private",
        plannedShareWith: shared ? fx.sharingPlan.investor : null,
        plannedGrant: shared
          ? "relationship_shared view grant with an expiry, through the data-room approval or diligence-share workflow"
          : null,
      };
    }),
  };
}

/**
 * CSV text: RFC 4180 quoting, LF line endings, the synthetic notice alone
 * on the first line (no comma, so it is one unquoted field).
 */
export function renderCsv(doc) {
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = [
    SYNTHETIC_HEADER,
    doc.csv.header.map(q).join(","),
    ...doc.csv.rows.map((r) => r.map(q).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}
