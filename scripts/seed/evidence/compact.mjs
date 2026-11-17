// Compact synthetic evidence packs (5-7 documents) for the fictional demo
// companies investors meet most after the three showcase companies: MedTrail,
// Mizan, Ajopot, Watchly and Maji Loop (owner directive 2026-11-16, Phase 2:
// "then expand to the other existing demo companies ... smaller packages based
// on their importance").
//
// Same rules as documents.mjs: pure and deterministic (no clock, randomness,
// network or model), one fixture per company as the single source of truth,
// the same synthetic header, watermark and footer (render.mjs), fictitious
// banks only, no imitation of official records. The fixture keeps every figure
// production records for the company (read read-only on 17 Nov 2026) and lists
// every invented field under `assumptions`. The validator
// (apps/workers/test/demo-evidence-fixtures.test.ts) checks the arithmetic and
// the recorded figures.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  amount,
  dateLabel,
  defaultSensitivityFor,
  FIXTURE_DIR,
  hundredthsLabel,
  monthLabel,
  monthLong,
  oneDecimal,
  ownershipHundredths,
  percent1,
  raiseTermsLine,
} from "./documents.mjs";

export const COMPACT_KEYS = [
  "medtrail",
  "mizan",
  "ajopot",
  "watchly",
  "maji-loop",
];

export function loadCompactFixture(key) {
  if (!COMPACT_KEYS.includes(key)) throw new Error(`unknown fixture ${key}`);
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${key}.json`), "utf8"));
}

// ---------------------------------------------------------------- helpers

const h = (text) => ({ kind: "heading", text });
const p = (text) => ({ kind: "paragraph", text });
const table = (columns, rows, options = {}) => ({
  kind: "table",
  columns,
  rows,
  labelWidth: options.labelWidth ?? 150,
  ...(options.widths ? { widths: options.widths } : {}),
});

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Reads `a.b` from an object. */
export function pathValue(obj, path) {
  return path.split(".").reduce((o, k) => (o === undefined ? o : o[k]), obj);
}

/** A KPI or table value as printed: whole numbers with separators, decimals to one place. */
export function formatValue(value, unit) {
  if (unit === "percent" || unit === "decimal") return oneDecimal(value);
  return amount(value);
}

export function lineLabel(fx, key) {
  const label = fx.lineLabels[key];
  if (label === undefined) throw new Error(`${fx.key}: no label for ${key}`);
  return label;
}

/** Receipts rule: same-month collection, or the previous month's revenue. */
export function expectedReceipts(fx, index) {
  if (fx.collection === "same-month") return fx.actuals[index].revenue.total;
  return index === 0
    ? fx.openingReceivable
    : fx.actuals[index - 1].revenue.total;
}

/** The figure a known discrepancy's derivation points at, as printed. */
export function derivedFigure(fx, derivation) {
  const a = fx.actuals.find((x) => x.month === derivation.month);
  if (a === undefined) throw new Error(`no actual ${derivation.month}`);
  if (derivation.kind === "grossMargin")
    return percent1(a.grossProfit, a.revenue.total);
  if (derivation.kind === "runway")
    return oneDecimal(a.cash.closing / a.netBurn);
  if (derivation.kind === "kpi") {
    const def = fx.kpiDefinitions.find((k) => k.key === derivation.key);
    return formatValue(a.kpis[derivation.key], def?.unit ?? "count");
  }
  throw new Error(`unknown derivation ${derivation.kind}`);
}

function usd(fx, value) {
  return fx.fx ? `USD ${amount(Math.round(value / fx.fx.usd))}` : "";
}

function lastActual(fx) {
  return fx.actuals[fx.actuals.length - 1];
}

function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function docBase(fx, slug, title, documentType, format, period) {
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
  };
}

function fullPeriod(fx) {
  return { from: fx.periods.firstActualMonth, to: fx.periods.lastActualMonth };
}

/** The discrepancy notes a document prints, in fixture order. */
function discrepancyBlocks(fx, id) {
  const notes = fx.knownDiscrepancies.filter((d) =>
    d.evidence.some((e) => e.documentId === id),
  );
  if (notes.length === 0) return [];
  return [
    h("Figures that differ from the deck"),
    ...notes.map((d) => p(d.note)),
  ];
}

function monthTables(months, rowsFor, title) {
  const blocks = [];
  for (const group of chunk(months, 6)) {
    blocks.push(
      h(
        `${title}: ${monthLabel(group[0])} to ${monthLabel(group[group.length - 1])}`,
      ),
    );
    blocks.push(table(["", ...group.map(monthLabel)], rowsFor(group)));
  }
  return blocks;
}

function fundingTable(fx) {
  return table(
    ["Received", "Round", "Instrument", "Amount", "Investors"],
    fx.funding.map((f) => [
      dateLabel(f.receivedOn),
      f.round,
      f.instrument,
      `${f.currency} ${amount(f.amount)}`,
      f.investors,
    ]),
    { widths: [70, 80, 90, 90, 170] },
  );
}

// ---------------------------------------------------------------- documents

function managementAccounts(fx) {
  const C = fx.currency;
  const months = fx.actuals.map((a) => a.month);
  const last = lastActual(fx);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const keys = (part) => Object.keys(fx.actuals[0][part].lines);
  const doc = docBase(
    fx,
    "management-accounts",
    `Management accounts, ${monthLabel(months[0])} to ${monthLabel(last.month)}`,
    "MANAGEMENT_ACCOUNTS",
    "pdf",
    fullPeriod(fx),
  );
  const window = fx.actuals.slice(-12);
  const revenue = window.reduce((s, a) => s + a.revenue.total, 0);
  const cogs = window.reduce((s, a) => s + a.cogs.total, 0);
  const withUsd = fx.fx !== null;
  const summaryRow = (label, value) =>
    withUsd ? [label, amount(value), usd(fx, value)] : [label, amount(value)];
  const blocks = [
    h("Basis of preparation"),
    p(
      `${fx.documentDefaults.preparedBy}. Accrual basis. Amounts in ${C}, whole units.${withUsd ? ` ${fx.fx.note}` : ""}`,
    ),
    ...fx.basis.map(p),
    p(
      `Cash is held at ${fx.bank.name} (a fictitious institution created for this demonstration), ${fx.bank.accountMasked}.`,
    ),
    h(`Summary for ${monthLong(last.month)}`),
    table(
      withUsd ? ["", C, "USD equivalent"] : ["", C],
      [
        summaryRow("Revenue", last.revenue.total),
        summaryRow("Gross profit", last.grossProfit),
        summaryRow("Net result for the month", last.netResult),
        summaryRow("Cash at month end", last.cash.closing),
        summaryRow("Net burn (payments less customer receipts)", last.netBurn),
        [
          "Runway at this month's net burn (months)",
          oneDecimal(last.cash.closing / last.netBurn),
          ...(withUsd ? [""] : []),
        ],
        [
          "Headcount at month end",
          String(last.headcount.total),
          ...(withUsd ? [""] : []),
        ],
      ],
      { labelWidth: 240 },
    ),
    p(
      revenue - cogs > 0
        ? `Gross margin, ${String(window.length)} months to ${monthLabel(last.month)}: ${percent1(revenue - cogs, revenue)} (revenue ${amount(revenue)}, cost of revenue ${amount(cogs)}).`
        : `Gross margin is not meaningful yet: over the ${String(window.length)} months to ${monthLabel(last.month)}, cost of revenue (${amount(cogs)}) exceeded revenue (${amount(revenue)}).`,
    ),
    ...discrepancyBlocks(fx, doc.id),
  ];
  const hasCapex = fx.actuals.some((a) => a.capex > 0 || a.depreciation > 0);
  blocks.push(
    ...monthTables(
      months,
      (g) => [
        ...keys("revenue").map((k) => [
          lineLabel(fx, k),
          ...g.map((m) => amount(get(m).revenue.lines[k])),
        ]),
        ["Total revenue", ...g.map((m) => amount(get(m).revenue.total))],
        ...keys("cogs").map((k) => [
          lineLabel(fx, k),
          ...g.map((m) => amount(get(m).cogs.lines[k])),
        ]),
        ["Total cost of revenue", ...g.map((m) => amount(get(m).cogs.total))],
        ["Gross profit", ...g.map((m) => amount(get(m).grossProfit))],
        ...keys("opex").map((k) => [
          lineLabel(fx, k),
          ...g.map((m) => amount(get(m).opex.lines[k])),
        ]),
        ["Total operating costs", ...g.map((m) => amount(get(m).opex.total))],
        ["Net result", ...g.map((m) => amount(get(m).netResult))],
      ],
      "Profit and loss",
    ),
    ...monthTables(
      months,
      (g) => [
        ["Opening cash", ...g.map((m) => amount(get(m).cash.opening))],
        ["Customer receipts", ...g.map((m) => amount(get(m).cash.receipts))],
        [
          "Funding received",
          ...g.map((m) => amount(get(m).cash.fundingReceived)),
        ],
        [
          "Payments (operating and capital)",
          ...g.map((m) => amount(get(m).cash.payments)),
        ],
        ...(hasCapex
          ? [
              [
                "of which capital expenditure",
                ...g.map((m) => amount(get(m).capex)),
              ],
              [
                "Depreciation (non-cash, not a payment)",
                ...g.map((m) => amount(get(m).depreciation)),
              ],
            ]
          : []),
        ["Closing cash", ...g.map((m) => amount(get(m).cash.closing))],
        ["Net burn", ...g.map((m) => amount(get(m).netBurn))],
        [
          "Runway (months)",
          ...g.map((m) =>
            get(m).netBurn > 0
              ? oneDecimal(get(m).cash.closing / get(m).netBurn)
              : "n/a",
          ),
        ],
        ["Headcount", ...g.map((m) => String(get(m).headcount.total))],
      ],
      "Cash flow and runway",
    ),
  );
  return { ...doc, blocks };
}

function revenueBreakdown(fx) {
  const months = fx.actuals.map((a) => a.month);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const model = fx.revenueModel;
  const defs = new Map(fx.kpiDefinitions.map((k) => [k.key, k]));
  const driven = new Set(model.components.map((c) => c.line));
  const booked = Object.keys(fx.actuals[0].revenue.lines).filter(
    (k) => !driven.has(k),
  );
  const doc = docBase(
    fx,
    "revenue-breakdown",
    model.byPartner
      ? "Monthly revenue build by bank partner"
      : "Monthly revenue build",
    "FINANCIAL",
    "pdf",
    fullPeriod(fx),
  );
  const blocks = [
    h("How revenue is built"),
    p(
      `Each driven line is the month's driver times its price, from the company's own records. Amounts in ${fx.currency}.`,
    ),
    ...fx.basis.slice(0, 1).map(p),
    ...discrepancyBlocks(fx, doc.id),
    ...monthTables(
      months,
      (g) => [
        ...model.components.flatMap((c) => [
          [
            defs.get(c.kpi)?.label ?? c.kpi,
            ...g.map((m) =>
              formatValue(get(m).kpis[c.kpi], defs.get(c.kpi)?.unit ?? "count"),
            ),
          ],
          [
            `${lineLabel(fx, c.line)} (${c.label})`,
            ...g.map((m) => amount(get(m).revenue.lines[c.line])),
          ],
        ]),
        ...booked.map((k) => [
          `${lineLabel(fx, k)} (as booked)`,
          ...g.map((m) => amount(get(m).revenue.lines[k])),
        ]),
        ["Total revenue", ...g.map((m) => amount(get(m).revenue.total))],
      ],
      "Revenue build",
    ),
  ];
  if (model.byPartner) {
    const partners = fx.contracts;
    blocks.push(
      ...monthTables(
        months,
        (g) =>
          partners.flatMap((c) => [
            [
              `${c.label}: originated (EGP millions)`,
              ...g.map((m) =>
                amount(get(m).kpis[model.byPartner.kpi][c.id] ?? 0),
              ),
            ],
            [
              `${c.label}: fees`,
              ...g.map((m) =>
                amount(
                  (get(m).kpis[model.byPartner.kpi][c.id] ?? 0) *
                    model.byPartner.unitPrice,
                ),
              ),
            ],
          ]),
        "Originations and fees by bank partner",
      ),
    );
  }
  return { ...doc, blocks };
}

function invoiceRegisterCsv(fx) {
  const months = [...new Set(fx.invoices.map((i) => i.serviceMonth))].sort();
  const extras = ["warehouses", "scans", "subscription", "scanFees"].filter(
    (k) => fx.invoices[0][k] !== undefined,
  );
  const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return {
    ...docBase(fx, "invoice-register", "Invoice register", "FINANCIAL", "csv", {
      from: months[0],
      to: months[months.length - 1],
    }),
    csv: {
      header: [
        "invoice_number",
        "customer",
        "service_month",
        "issued_on",
        "due_on",
        ...extras.map(snake),
        `amount_${fx.currency.toLowerCase()}`,
      ],
      rows: fx.invoices.map((i) => [
        i.number,
        i.customerId,
        i.serviceMonth,
        i.issuedOn,
        i.dueOn,
        ...extras.map((k) => String(i[k])),
        String(i.amount),
      ]),
    },
  };
}

function payoutLedgerCsv(fx) {
  return {
    ...docBase(
      fx,
      "payout-ledger",
      "Monthly payouts and fee ledger",
      "FINANCIAL",
      "csv",
      fullPeriod(fx),
    ),
    csv: {
      header: [
        "month",
        "registered_users",
        "contributing_members",
        "circles",
        "contributions_ngn",
        "payouts_ngn",
        "fee_rate",
        "payout_fees_ngn",
        "missed_contributions_pct",
      ],
      rows: fx.actuals.map((a) => [
        a.month,
        String(a.kpis.registeredUsers),
        String(a.kpis.contributingMembers),
        String(a.kpis.circlesActive),
        String(a.kpis.contributions),
        String(a.kpis.payouts),
        "0.01",
        String(a.revenue.lines.payoutFees),
        oneDecimal(a.kpis.missedContributionPercent),
      ]),
    },
  };
}

function customerContracts(fx) {
  const doc = docBase(
    fx,
    "customer-contracts",
    fx.contractsTitle,
    fx.contractsDocumentType,
    "pdf",
    fullPeriod(fx),
  );
  const cols = fx.contractColumns ?? [];
  const blocks = [
    h("Contracts"),
    p(
      "Counterparties are anonymised; names are withheld. Status is as at the last day of the period.",
    ),
    table(
      [
        "Counterparty",
        "Segment",
        "Status",
        "Signed",
        "Starts",
        "Term (months)",
        ...cols.map((c) => c.label),
      ],
      fx.contracts.map((c) => [
        c.label,
        c.segment,
        c.status,
        dateLabel(c.signedOn),
        c.startOn ? dateLabel(c.startOn) : "",
        c.termMonths === null ? "" : String(c.termMonths),
        ...cols.map((col) =>
          c[col.key] === undefined
            ? ""
            : formatValue(c[col.key], col.format ?? "count"),
        ),
      ]),
      { widths: [90, 120, 45, 60, 60, 45, ...cols.map(() => 60)] },
    ),
    h("Terms"),
    ...fx.contractNotes.map(p),
    ...discrepancyBlocks(fx, doc.id),
  ];
  return { ...doc, blocks };
}

/** Holders after the round: priced at the pre-money, or a post-money SAFE at its cap. */
export function proFormaHolders(fx) {
  const holders = fx.capTable.holders;
  const total = holders.reduce((s, x) => s + x.shares, 0);
  const r = fx.raise;
  const newShares =
    r.preMoneyValuation !== undefined
      ? Math.floor((total * r.targetAmount) / r.preMoneyValuation)
      : Math.floor(
          (total * r.targetAmount) / (r.valuationCap - r.targetAmount),
        );
  return [
    ...holders,
    { name: "New seed investors", class: "Seed", shares: newShares },
  ];
}

function holderRows(holders) {
  const pct = ownershipHundredths(holders.map((x) => x.shares));
  const total = holders.reduce((s, x) => s + x.shares, 0);
  return [
    ...holders.map((x, i) => [
      x.name,
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
  ];
}

function capTable(fx) {
  const asOf = fx.capTable.asOf;
  const doc = docBase(
    fx,
    "cap-table",
    "Capitalisation table and ownership",
    "CORPORATE",
    "pdf",
    { from: asOf.slice(0, 7), to: asOf.slice(0, 7) },
  );
  const priced = fx.raise.preMoneyValuation !== undefined;
  const blocks = [
    h(`Fully diluted ownership at ${dateLabel(asOf)}`),
    p(fx.capTable.basis),
    table(
      ["Holder", "Class", "Shares", "Ownership"],
      holderRows(fx.capTable.holders),
      {
        widths: [170, 140, 90, 80],
      },
    ),
    h("Funding to date"),
    fundingTable(fx),
    h(
      priced
        ? "Pro forma after the seed round (at the pre-money valuation)"
        : "Illustrative pro forma after the seed round (at the valuation cap)",
    ),
    p(raiseTermsLine(fx)),
    table(
      ["Holder", "Class", "Shares", "Ownership"],
      holderRows(proFormaHolders(fx)),
      {
        widths: [170, 140, 90, 80],
      },
    ),
  ];
  return { ...doc, blocks };
}

function raiseTerms(fx) {
  const r = fx.raise;
  const last = lastActual(fx);
  const doc = docBase(
    fx,
    "raise-terms",
    "Seed round terms and use of funds",
    "CORPORATE",
    "pdf",
    { from: nextMonth(last.month), to: r.targetCloseOn.slice(0, 7) },
  );
  const blocks = [
    h("Terms"),
    p(raiseTermsLine(fx)),
    h("Use of funds"),
    table(
      ["Use", "Share", `Amount (${r.currency})`],
      [
        ...r.useOfFunds.map((u) => [
          u.line,
          `${String(u.percent)}%`,
          amount(u.amount),
        ]),
        ["Total", "100%", amount(r.targetAmount)],
      ],
      { widths: [260, 60, 110] },
    ),
    h(`Position at ${monthLong(last.month)} (actual)`),
    p(
      `Cash at month end ${fx.currency} ${amount(last.cash.closing)}${fx.fx ? ` (${usd(fx, last.cash.closing)})` : ""}; net burn ${fx.currency} ${amount(last.netBurn)}${fx.fx ? ` (${usd(fx, last.netBurn)})` : ""}; runway at that burn ${oneDecimal(last.cash.closing / last.netBurn)} months.`,
    ),
  ];
  if (r.plannedMonthlyNetBurnPostRaise !== undefined) {
    blocks.push(
      h("After the round (plan, not actual)"),
      p(
        `Planned net burn after the raise: about ${r.currency} ${amount(r.plannedMonthlyNetBurnPostRaise)} a month; runway after the raise about ${oneDecimal(r.runwayMonthsPostRaise)} months, as stated in the deck.`,
      ),
    );
  }
  blocks.push(
    h("Funding to date"),
    fundingTable(fx),
    ...discrepancyBlocks(fx, doc.id),
  );
  return { ...doc, blocks };
}

function kpiPack(fx) {
  const months = fx.actuals.map((a) => a.month);
  const get = (m) => fx.actuals.find((a) => a.month === m);
  const doc = docBase(
    fx,
    "kpi-pack",
    "KPI and operating metrics pack",
    "OPERATIONAL",
    "pdf",
    fullPeriod(fx),
  );
  const blocks = [
    h("Definitions"),
    p(
      "Every figure is from the company's own systems at month end, unaudited. Counts are at the last day of the month unless the label says 'in month'.",
    ),
    table(
      ["Metric", "Unit"],
      fx.kpiDefinitions.map((k) => [k.label, k.unit]),
      { widths: [320, 120] },
    ),
    ...discrepancyBlocks(fx, doc.id),
    ...monthTables(
      months,
      (g) =>
        fx.kpiDefinitions.map((k) => [
          k.label,
          ...g.map((m) => formatValue(get(m).kpis[k.key], k.unit)),
        ]),
      "Metrics",
    ),
  ];
  return { ...doc, blocks };
}

const BUILDERS = {
  "management-accounts": managementAccounts,
  "revenue-breakdown": revenueBreakdown,
  "invoice-register": invoiceRegisterCsv,
  "payout-ledger": payoutLedgerCsv,
  "customer-contracts": customerContracts,
  "cap-table": capTable,
  "raise-terms": raiseTerms,
  "kpi-pack": kpiPack,
};

export function buildCompactDocuments(fx) {
  return fx.documents.map((slug) => {
    const build = BUILDERS[slug];
    if (build === undefined)
      throw new Error(`${fx.key}: unknown document ${slug}`);
    return build(fx);
  });
}

// ---------------------------------------------------------------- manifest

const PLACEMENT = {
  "management-accounts": {
    folder: "financials",
    checklistItem: "management_accounts",
  },
  "revenue-breakdown": {
    folder: "financials",
    checklistItem: "revenue_by_customer",
  },
  "invoice-register": { folder: "financials", checklistItem: null },
  "payout-ledger": { folder: "financials", checklistItem: null },
  "customer-contracts": {
    folder: "commercial",
    checklistItem: "customer_contracts",
  },
  "cap-table": { folder: "cap_table", checklistItem: "cap_table_full" },
  "raise-terms": { folder: "fundraising", checklistItem: "use_of_funds" },
  "kpi-pack": { folder: "fundraising", checklistItem: "key_metrics" },
};

/** Ledger-level files stay with the founder; the rest are planned for the investor. */
const NOT_PLANNED_FOR_SHARING = new Set(["invoice-register", "payout-ledger"]);

export function buildCompactManifest(fx, docs) {
  return {
    schemaVersion: 1,
    company: fx.company.name,
    companyKey: fx.key,
    fixture: `scripts/seed/evidence/fixtures/${fx.key}.json`,
    synthetic: true,
    pack: "compact",
    companyId: fx.seedSource.companyId,
    seedSource: fx.seedSource.kind,
    inventedFields: fx.assumptions.map((a) => a.field),
    sensitivityRule:
      "packages/evidence/src/domain/sensitivity.ts defaultDocumentSensitivity: FINANCIAL, MANAGEMENT_ACCOUNTS and FINANCIAL_MODEL are HIGHLY_CONFIDENTIAL; every other type is CONFIDENTIAL.",
    qReadRule:
      "HIGHLY_CONFIDENTIAL documents are held back from an investor's Q (packages/q-tools/src/tools/own-records.ts heldBackFromQ) even when shared; the founder's own Q may read them (decision 100).",
    plannedInvestor: fx.sharingPlan.investor,
    plannedInvestorNote: fx.sharingPlan.note,
    documents: docs.map((d) => {
      const slug = d.id.slice(fx.idPrefix.length + 1);
      const sensitivity = defaultSensitivityFor(d.documentType);
      const shared =
        fx.sharingPlan.investor !== null && !NOT_PLANNED_FOR_SHARING.has(slug);
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
