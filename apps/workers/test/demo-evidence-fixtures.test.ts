import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DOCUMENT_TYPES } from "@capital-q/contracts";
import { defaultDocumentSensitivity } from "@capital-q/evidence";
import { ParserOutputSchema } from "@capital-q/evidence/contracts";

import {
  balanceSheet,
  bankTransactions,
  buildDocuments,
  buildManifest,
  dateLabel,
  FIXTURE_KEYS,
  loadFixture,
  MANIFEST_DIR,
  monthLabel,
  ownershipHundredths,
  raiseTermsLine,
  revenueByCustomer,
  SYNTHETIC_HEADER,
  type DocumentModel,
  type Fixture,
} from "../../../scripts/seed/evidence/documents.mjs";
import {
  loadPdfLib,
  renderCompany,
} from "../../../scripts/seed/evidence/render.mjs";
import {
  createPdfExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import { createCsvExtractor } from "../src/parser/spreadsheets.js";

/**
 * Consistency validator for the synthetic demo evidence of Tensorgate and
 * Halyard Security (owner directive 2026-11-16, phases 2-3).
 *
 * The fixture is the source of truth. These checks hold the arithmetic
 * between the documents (revenue to invoices, cash roll-forward, burn and
 * runway, ownership, dated customer counts, projections apart from
 * actuals, one set of raise terms), tie the fixture to the 6 Oct seed and
 * its claims, and read every generated file back through the workers' own
 * PDF and CSV extractors, so the files are known to be ingestible before
 * anyone uploads them.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

const SeedSchema = z.array(
  z
    .object({
      company: z.string(),
      legalName: z.string(),
      founderPerson: z.object({ name: z.string() }).passthrough(),
      team: z.array(z.object({ name: z.string() }).passthrough()),
      capital: z
        .object({
          targetRaise: z.object({ amount: z.number(), currency: z.string() }),
          instrument: z.string(),
          valuationCap: z.object({ amount: z.number() }).optional(),
          preMoneyValuation: z.object({ amount: z.number() }).optional(),
          targetCloseDate: z.string(),
          minimumCheque: z.object({ amount: z.number() }),
          useOfFunds: z.array(
            z.object({
              line: z.string(),
              percent: z.number(),
              amount: z.number(),
            }),
          ),
          cashPosition: z.object({ amount: z.number(), asOf: z.string() }),
          monthlyNetBurn: z.object({ amount: z.number() }),
          runwayMonthsCurrent: z.number(),
        })
        .passthrough(),
      headcount: z.number(),
      metrics: z.object({
        points: z.array(
          z.object({
            period: z.string(),
            values: z.record(z.string(), z.number()),
          }),
        ),
      }),
      deck: z.array(
        z.object({ section: z.string(), content: z.array(z.string()) }),
      ),
      dataRoom: z.array(
        z.object({ title: z.string(), summary: z.array(z.string()) }),
      ),
    })
    .passthrough(),
);
const seed = SeedSchema.parse(
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "docs", "seed", "tavus-20", "companies-full.json"),
      "utf8",
    ),
  ),
);

/** Seed KPI code -> how the fixture records it, for the claim points. */
const KPI_MAP: Record<string, Record<string, (v: number) => number>> = {
  tensorgate: {
    requests_served_m: (v) => Math.round(v * 1000),
    design_partners: (v) => v,
    paid_contracts: (v) => v,
    contracted_arr: (v) => v,
    median_overhead_ms: (v) => v,
  },
  halyard: {
    organisations: (v) => v,
    staff_enrolled: (v) => v,
    licensed_seats: (v) => v,
    arr: (v) => v,
    phishing_takeovers_enrolled: (v) => v,
  },
};
const KPI_FIELD: Record<string, string> = {
  requests_served_m: "requestsServedCumulativeThousands",
  design_partners: "designPartners",
  paid_contracts: "paidContracts",
  contracted_arr: "contractedArr",
  median_overhead_ms: "medianOverheadMs",
  organisations: "organisations",
  staff_enrolled: "staffEnrolled",
  licensed_seats: "licensedSeats",
  arr: "arr",
  phishing_takeovers_enrolled: "phishingTakeoversEnrolled",
};

/** Ownership the seeded cap-table summary states, grouped as it groups it. */
const SEED_OWNERSHIP: Record<string, Record<string, readonly string[]>> = {
  tensorgate: {
    "Daniel Park: 36%": ["Daniel Park"],
    "Laura Bennett: 36%": ["Laura Bennett"],
    "Employee option pool: 12%": ["Employee option pool"],
    "Bastion Hill Ventures: 11%": ["Bastion Hill Ventures"],
    "Angels: 5%": ["Lone Oak Angels", "Two security founders (angels)"],
  },
  halyard: {
    "Callum Reid: 38%": ["Callum Reid"],
    "Eilidh MacLeod: 34%": ["Eilidh MacLeod"],
    "Employee option pool (EMI): 10%": ["EMI option pool"],
    "Leith Shore Angels: 13%": ["Leith Shore Angels"],
    "Scottish founder angels: 5%": ["Scottish founder angels"],
  },
};

const sum = (values: readonly number[]): number =>
  values.reduce((a, b) => a + b, 0);
const lastDay = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 0, m ?? 0, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, "0")}`;
};
const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  const yy = (y ?? 0) + ((m ?? 0) === 12 ? 1 : 0);
  const mm = (m ?? 0) === 12 ? 1 : (m ?? 0) + 1;
  return `${String(yy)}-${String(mm).padStart(2, "0")}`;
};
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
const num = (value: unknown): number => {
  if (typeof value !== "number") throw new Error("not a number");
  return value;
};

type Extracted = {
  readonly doc: DocumentModel;
  readonly sha256: string;
  readonly text: string;
  readonly pageTexts: readonly string[];
  readonly pageCount: number;
  readonly lowTextPages: number;
  /** What the workers' extractor read, block by block. */
  readonly parsedText: string;
};

async function pdfExtractor() {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs: unknown = await import(specifier);
  const getDocument = (pdfjs as { getDocument: (o: unknown) => unknown })
    .getDocument;
  return createPdfExtractor(async (bytes) => {
    const task = getDocument({
      data: bytes,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    }) as { promise: Promise<never>; destroy: () => Promise<void> };
    const document = (await task.promise) as unknown as {
      numPages: number;
      getPage: (n: number) => Promise<never>;
    };
    return {
      numPages: document.numPages,
      getPage: (n: number) => document.getPage(n),
      destroy: () => task.destroy(),
    };
  });
}

async function extractAll(fx: Fixture): Promise<Extracted[]> {
  const pdfLib = await loadPdfLib();
  const { files } = await renderCompany(fx, pdfLib);
  const pdf = await pdfExtractor();
  const csv = createCsvExtractor();
  const out: Extracted[] = [];
  for (const { doc, bytes } of files) {
    const output = await (doc.format === "pdf" ? pdf : csv).extract(
      Buffer.from(bytes),
      context,
    );
    expect(ParserOutputSchema.safeParse(output).success).toBe(true);
    const pageCount =
      typeof output.metadata["pageCount"] === "number"
        ? output.metadata["pageCount"]
        : 1;
    const pageTexts: string[] = Array.from({ length: pageCount }, () => "");
    const parts: string[] = [];
    for (const block of output.blocks) {
      const text = "text" in block ? String(block.text) : "";
      const rows =
        "rows" in block && Array.isArray(block.rows)
          ? (block.rows as unknown[]).map((r) =>
              Array.isArray(r) ? r.map(String).join(" ") : String(r),
            )
          : [];
      const content = [text, ...rows].join(" ");
      parts.push(content);
      const locator = block.locator as { page?: unknown };
      const page = typeof locator.page === "number" ? locator.page : 1;
      pageTexts[page - 1] = `${pageTexts[page - 1] ?? ""} ${content}`;
    }
    const low = output.metadata["lowTextPages"];
    out.push({
      doc,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      text: flat(
        doc.format === "csv"
          ? new TextDecoder().decode(bytes)
          : parts.join(" "),
      ),
      pageTexts: pageTexts.map(flat),
      pageCount,
      lowTextPages: Array.isArray(low) ? low.length : 0,
      parsedText: flat(parts.join(" ")),
    });
  }
  return out;
}

describe.each(FIXTURE_KEYS.map((key) => [key]))(
  "synthetic demo evidence · %s",
  (key) => {
    const fx = loadFixture(key);
    const docs = buildDocuments(fx);
    const companySeed = seed.find((c) => c.company === fx.seedSource.company);
    if (companySeed === undefined) throw new Error(`no seed for ${key}`);
    const months = fx.actuals.map((a) => a.month);
    let extracted: Extracted[] = [];

    beforeAll(async () => {
      extracted = await extractAll(fx);
    }, 120_000);

    const textOf = (id: string): string => {
      const found = extracted.find((e) => e.doc.id === id);
      if (found === undefined) throw new Error(`no document ${id}`);
      return found.text;
    };

    // ------------------------------------------------ the seed is preserved

    it("keeps the seeded identity, founders, raise and deck figures", () => {
      expect(fx.company.legalName).toBe(companySeed.legalName);
      const names = [...fx.team.founders, ...fx.team.keyPeople].map(
        (p) => p.name,
      );
      expect(names).toContain(companySeed.founderPerson.name);
      for (const t of companySeed.team) expect(names).toContain(t.name);

      const c = companySeed.capital;
      expect(fx.raise.targetAmount).toBe(c.targetRaise.amount);
      expect(fx.raise.currency).toBe(c.targetRaise.currency);
      expect(fx.currency).toBe(c.targetRaise.currency);
      expect(fx.raise.instrument).toBe(c.instrument);
      expect(fx.raise.valuationCap).toBe(c.valuationCap?.amount);
      expect(fx.raise.preMoneyValuation).toBe(c.preMoneyValuation?.amount);
      expect(fx.raise.targetCloseOn).toBe(c.targetCloseDate);
      expect(fx.raise.minimumCheque).toBe(c.minimumCheque.amount);
      expect(fx.raise.useOfFunds).toEqual(c.useOfFunds);

      expect(fx.deckStatedFigures.cash).toBe(c.cashPosition.amount);
      expect(fx.deckStatedFigures.monthlyNetBurn).toBe(c.monthlyNetBurn.amount);
      expect(fx.deckStatedFigures.runwayMonths).toBe(c.runwayMonthsCurrent);
      expect(fx.deckStatedFigures.headcount).toBe(companySeed.headcount);
    });

    it("matches every seeded KPI point (the SELF_REPORTED claims) exactly", () => {
      const map = KPI_MAP[key] ?? {};
      for (const point of companySeed.metrics.points) {
        const actual = fx.actuals.find((a) => a.month === point.period);
        expect(actual, point.period).toBeDefined();
        for (const [code, value] of Object.entries(point.values)) {
          const field = KPI_FIELD[code];
          const convert = map[code];
          if (field === undefined || convert === undefined) {
            throw new Error(`unmapped KPI ${code}`);
          }
          expect(actual?.kpis[field], `${point.period} ${code}`).toBe(
            convert(value),
          );
        }
      }
    });

    it("keeps the seeded month-end cash close to the deck's figure", () => {
      const asOf = fx.deckStatedFigures.cashAsOf.slice(0, 7);
      const atDeck = fx.actuals.find((a) => a.month === asOf);
      expect(atDeck).toBeDefined();
      // The deck rounds ("$1.1m", "480k"); the accounts are within 1%.
      const cash = atDeck?.cash.closing ?? 0;
      expect(
        Math.abs(cash - fx.deckStatedFigures.cash) / fx.deckStatedFigures.cash,
      ).toBeLessThan(0.01);
      expect(
        Math.abs((atDeck?.netBurn ?? 0) - fx.deckStatedFigures.monthlyNetBurn) /
          fx.deckStatedFigures.monthlyNetBurn,
      ).toBeLessThan(0.05);
    });

    // ------------------------------------------------ arithmetic

    it("covers eighteen contiguous months of actuals to October 2026", () => {
      expect(months).toHaveLength(18);
      expect(months[0]).toBe(fx.periods.firstActualMonth);
      expect(months[months.length - 1]).toBe("2026-10");
      months.slice(1).forEach((m, i) => {
        expect(m).toBe(nextMonth(months[i] ?? ""));
      });
    });

    it("totals every revenue, cost and result line", () => {
      for (const a of fx.actuals) {
        expect(sum(Object.values(a.revenue.lines))).toBe(a.revenue.total);
        expect(sum(Object.values(a.cogs.lines))).toBe(a.cogs.total);
        expect(sum(Object.values(a.opex.lines))).toBe(a.opex.total);
        expect(a.grossProfit).toBe(a.revenue.total - a.cogs.total);
        expect(a.netResult).toBe(a.grossProfit - a.opex.total);
        const fns = Object.entries(a.headcount).filter(([k]) => k !== "total");
        expect(sum(fns.map(([, v]) => v))).toBe(a.headcount.total);
      }
    });

    it("ties monthly revenue to the invoices of the month plus documented reconciling items", () => {
      for (const a of fx.actuals) {
        const invoiced = sum(
          fx.invoices
            .filter((i) => i.issuedOn.slice(0, 7) === a.month)
            .map((i) => i.amount),
        );
        const reconciling = sum(a.reconcilingItems.map((r) => r.amount));
        expect(invoiced + reconciling, a.month).toBe(a.revenue.total);
        for (const r of a.reconcilingItems) {
          expect(r.description.length).toBeGreaterThan(10);
        }
        expect(sum(Object.values(revenueByCustomer(fx, a.month)))).toBe(
          a.revenue.total,
        );
      }
      // Deferred items unwind completely: nothing is invented or lost.
      expect(
        sum(fx.actuals.flatMap((a) => a.reconcilingItems.map((r) => r.amount))),
      ).toBe(
        fx.openingBalances.deferredRevenue -
          (fx.actuals[fx.actuals.length - 1]?.deferredRevenueClosing ?? 0),
      );
    });

    it("keeps invoices well formed", () => {
      const numbers = new Set(fx.invoices.map((i) => i.number));
      expect(numbers.size).toBe(fx.invoices.length);
      const ids = new Set(fx.customers.map((c) => c.id));
      for (const i of fx.invoices) {
        expect(ids.has(i.customerId)).toBe(true);
        expect(Number.isInteger(i.amount) && i.amount > 0).toBe(true);
        expect(i.paidOn >= i.issuedOn).toBe(true);
        expect(i.dueOn >= i.issuedOn).toBe(true);
      }
    });

    it("rolls cash forward: closing = opening + inflows - outflows, every month", () => {
      let opening = fx.openingBalances.cash;
      for (const a of fx.actuals) {
        expect(a.cash.opening, a.month).toBe(opening);
        const receipts = sum(
          fx.invoices
            .filter((i) => i.paidOn.slice(0, 7) === a.month)
            .map((i) => i.amount),
        );
        const funding = sum(
          fx.funding
            .filter((f) => f.receivedOn.slice(0, 7) === a.month)
            .map((f) => f.amount),
        );
        expect(a.cash.receipts, a.month).toBe(receipts);
        expect(a.cash.fundingReceived, a.month).toBe(funding);
        expect(a.cash.payments).toBe(a.cogs.total + a.opex.total);
        expect(a.cash.closing).toBe(
          a.cash.opening +
            a.cash.receipts +
            a.cash.fundingReceived -
            a.cash.payments,
        );
        expect(a.cash.closing).toBeGreaterThan(0);
        opening = a.cash.closing;
      }
    });

    it("computes burn and runway from the cash flow", () => {
      for (const a of fx.actuals) {
        expect(a.netBurn).toBe(a.cash.payments - a.cash.receipts);
        expect(a.netBurn).toBeGreaterThan(0);
        expect(a.runwayMonths).toBe(
          Math.round((a.cash.closing / a.netBurn) * 10) / 10,
        );
      }
    });

    it("balances the balance sheet and its movement equals the period's results", () => {
      for (const a of fx.actuals) {
        const end = lastDay(a.month);
        expect(a.receivablesClosing, a.month).toBe(
          sum(
            fx.invoices
              .filter((i) => i.issuedOn <= end && i.paidOn > end)
              .map((i) => i.amount),
          ),
        );
      }
      const bs = balanceSheet(fx);
      expect(bs.totalAssets - bs.totalLiabilities).toBe(bs.netAssets);
      expect(bs.capitalRaised + bs.accumulatedLosses).toBe(bs.netAssets);
      const ob = fx.openingBalances;
      const openingLosses =
        ob.cash +
        ob.receivables -
        ob.deferredRevenue -
        ob.otherPayablesAndAccruals -
        ob.capitalRaisedToDate;
      expect(bs.accumulatedLosses - openingLosses).toBe(
        sum(fx.actuals.map((a) => a.netResult)),
      );
    });

    it("reconciles the bank statement to the cash flow", () => {
      const from = fx.bank.statementFrom.slice(0, 7);
      const to = fx.bank.statementTo.slice(0, 7);
      expect(fx.bank.fictitious).toBe(true);
      for (const a of fx.actuals.filter(
        (x) => x.month >= from && x.month <= to,
      )) {
        const tx = bankTransactions(fx, a.month);
        expect(sum(tx.map((t) => t.moneyIn))).toBe(
          a.cash.receipts + a.cash.fundingReceived,
        );
        expect(sum(tx.map((t) => t.moneyOut))).toBe(a.cash.payments);
        expect(tx[tx.length - 1]?.balance).toBe(a.cash.closing);
        for (const t of tx) expect(t.date.slice(0, 7)).toBe(a.month);
      }
    });

    it("dates every customer count and derives it from the customer records", () => {
      for (const a of fx.actuals) {
        const end = lastDay(a.month);
        const k = a.kpis;
        if (key === "tensorgate") {
          expect(k["designPartners"]).toBe(
            fx.customers.filter((c) => (c.designPartnerSince ?? "9") <= end)
              .length,
          );
          const signed = fx.customers.filter(
            (c) => (c.contractSignedOn ?? "9") <= end,
          );
          expect(k["paidContracts"]).toBe(signed.length);
          expect(k["contractedArr"]).toBe(
            sum(signed.map((c) => c.annualFloor ?? 0)),
          );
        } else {
          expect(k["organisations"]).toBe(
            fx.customers.filter((c) => (c.goLiveOn ?? "9") <= end).length,
          );
          const seats = k["seatsByCustomer"] as Record<string, number>;
          expect(sum(Object.values(seats))).toBe(k["licensedSeats"]);
          expect(k["arr"]).toBe(num(k["licensedSeats"]) * 12);
          expect(num(k["staffEnrolled"])).toBeLessThanOrEqual(
            num(k["licensedSeats"]),
          );
          for (const id of Object.keys(seats)) {
            const c = fx.customers.find((x) => x.id === id);
            expect((c?.goLiveOn ?? "9") <= end).toBe(true);
          }
        }
      }
    });

    it("sums ownership to 100.00% in the current and pro forma tables, as the seed states", () => {
      const holders = fx.capTable.holders;
      const pct = ownershipHundredths(holders.map((h) => h.shares));
      expect(sum(pct)).toBe(10000);
      const pro = [
        ...holders.map((h) => h.shares),
        ...(fx.capTable.proForma.conversions ?? []).map((h) => h.shares),
        fx.capTable.proForma.newShares,
      ];
      expect(sum(ownershipHundredths(pro))).toBe(10000);
      const total = sum(holders.map((h) => h.shares));
      const summary =
        companySeed.dataRoom.find((d) => d.title.startsWith("Cap table"))
          ?.summary ?? [];
      for (const [line, names] of Object.entries(SEED_OWNERSHIP[key] ?? {})) {
        expect(summary).toContain(line);
        const want = Number(/: (\d+)%$/.exec(line)?.[1]);
        const shares = sum(
          holders.filter((h) => names.includes(h.holder)).map((h) => h.shares),
        );
        expect((shares * 100) / total, line).toBe(want);
      }
    });

    it("keeps projections out of the actual periods and on the deck's targets", () => {
      const projections = fx.projections.months;
      const last = fx.periods.lastActualMonth;
      expect(projections[0]?.month).toBe(nextMonth(last));
      expect(projections[projections.length - 1]?.month).toBe(
        fx.periods.projectionLastMonth,
      );
      let opening = fx.actuals[fx.actuals.length - 1]?.cash.closing ?? 0;
      projections.forEach((p, i) => {
        expect(p.month > last).toBe(true);
        if (i > 0)
          expect(p.month).toBe(nextMonth(projections[i - 1]?.month ?? ""));
        expect(p.netBurn).toBe(p.costs - p.revenue);
        expect(p.cashOpening).toBe(opening);
        expect(p.cashClosing).toBe(
          p.cashOpening + p.fundingReceived - p.netBurn,
        );
        opening = p.cashClosing;
      });
      // The raise lands once, in the target close month, for its target.
      const funded = projections.filter((p) => p.fundingReceived > 0);
      expect(funded.map((p) => p.month)).toEqual([
        fx.raise.targetCloseOn.slice(0, 7),
      ]);
      expect(funded[0]?.fundingReceived).toBe(fx.raise.targetAmount);
      const deckFinancials =
        companySeed.deck.find((s) => s.section === "financials")?.content ?? [];
      if (key === "tensorgate") {
        expect(deckFinancials[0]).toContain("$1.4m in 2027");
        expect(
          sum(
            projections
              .filter((p) => p.month.startsWith("2027"))
              .map((p) => p.revenue),
          ),
        ).toBe(1_400_000);
      } else {
        expect(deckFinancials[0]).toContain("£1.9m end-2027");
        const arr = projections[projections.length - 1]?.arr ?? 0;
        expect(Math.abs(arr - 1_900_000)).toBeLessThan(1_900_000 * 0.0001);
      }
    });

    it("prints identical raise terms in every document that mentions the raise", () => {
      const line = flat(raiseTermsLine(fx));
      expect(sum(fx.raise.useOfFunds.map((u) => u.amount))).toBe(
        fx.raise.targetAmount,
      );
      expect(sum(fx.raise.useOfFunds.map((u) => u.percent))).toBe(100);
      const mentioning = extracted.filter((e) =>
        e.text.includes("Seed round terms:"),
      );
      expect(mentioning.map((e) => e.doc.id).sort()).toEqual(
        [
          `${fx.idPrefix}-cap-table`,
          `${fx.idPrefix}-projections-2027`,
          `${fx.idPrefix}-raise-terms`,
        ].sort(),
      );
      for (const e of mentioning) {
        const sentences = e.text
          .split("Seed round terms:")
          .slice(1)
          .map((rest) => flat(`Seed round terms:${rest.split(".")[0] ?? ""}.`));
        expect(sentences.length).toBeGreaterThan(0);
        for (const s of sentences) expect(s, e.doc.id).toBe(line);
        expect(e.text).toContain(line);
      }
    });

    it("plants each known discrepancy in exactly the stated documents", () => {
      expect(fx.knownDiscrepancies.filter((d) => d.deliberate).length).toBe(2);
      for (const d of fx.knownDiscrepancies) {
        expect(d.reason.length).toBeGreaterThan(40);
        const stated = new Set(d.evidence.map((e) => e.documentId));
        for (const e of d.evidence) {
          expect(textOf(e.documentId), `${d.id} in ${e.documentId}`).toContain(
            e.text,
          );
        }
        const present = extracted
          .filter((x) => d.evidence.some((e) => x.text.includes(e.text)))
          .map((x) => x.doc.id);
        expect(new Set(present), d.id).toEqual(stated);
      }
    });

    // ------------------------------------------------ the files themselves

    it("generates 8-12 text-native PDFs plus CSVs, every page marked and readable by the workers' parser", () => {
      const pdfs = extracted.filter((e) => e.doc.format === "pdf");
      expect(pdfs.length).toBeGreaterThanOrEqual(8);
      expect(pdfs.length).toBeLessThanOrEqual(12);
      for (const e of pdfs) {
        expect(e.pageCount, e.doc.id).toBeGreaterThan(0);
        expect(e.lowTextPages, e.doc.id).toBe(0);
        e.pageTexts.forEach((page, i) => {
          expect(page, `${e.doc.id} page ${String(i + 1)}`).toContain(
            SYNTHETIC_HEADER,
          );
          expect(page).toContain(
            `Page ${String(i + 1)}/${String(e.pageCount)}`,
          );
          expect(page).toContain(fx.company.legalName);
          expect(page).toContain(`Version ${e.doc.version}`);
          expect(page).toContain(`Issued ${dateLabel(e.doc.issuedOn)}`);
          expect(page).toContain("SYNTHETIC DEMO DOCUMENT");
          if (e.doc.pageBanner !== undefined) {
            expect(page).toContain(e.doc.pageBanner);
          }
        });
        expect(e.text).toContain(e.doc.title);
      }
      for (const e of extracted.filter((x) => x.doc.format === "csv")) {
        expect(e.text.startsWith(SYNTHETIC_HEADER)).toBe(true);
        expect(e.parsedText).toContain(SYNTHETIC_HEADER);
        expect(e.parsedText).toContain(e.doc.csv?.header[0] ?? "missing");
      }
    });

    it("titles carry no '(fictional)' and nothing imitates an official record or a real bank", () => {
      for (const e of extracted) {
        expect(e.doc.title).not.toMatch(/fictional/i);
        expect(e.text).not.toMatch(
          /Companies House|Division of Corporations|certified true copy|\bseal\b|signed by|signatory|HMRC/i,
        );
      }
      expect(textOf(`${fx.idPrefix}-bank-statement`)).toContain(
        `${fx.bank.name} (a fictitious institution created for this demonstration)`,
      );
      expect(textOf(`${fx.idPrefix}-bank-statement`)).toContain(
        fx.bank.accountMasked,
      );
    });

    it("keeps projection months out of the actuals documents and actual months out of the projection tables", () => {
      const projectionLabels = fx.projections.months.map((p) =>
        monthLabel(p.month),
      );
      for (const id of [
        "management-accounts",
        "revenue-breakdown",
        "bank-statement",
        "customer-concentration",
      ]) {
        const doc = extracted.find((e) => e.doc.id === `${fx.idPrefix}-${id}`);
        const text = (doc?.text ?? "").replaceAll(
          `Issued ${dateLabel(fx.documentDefaults.issuedOn)}`,
          "",
        );
        for (const label of projectionLabels) {
          expect(text, `${id} has ${label}`).not.toContain(label);
        }
      }
      const actualLabels = new Set(months.map(monthLabel));
      const proj = docs.find((d) => d.id === `${fx.idPrefix}-projections-2027`);
      for (const block of proj?.blocks ?? []) {
        if (block.kind !== "table") continue;
        for (const column of block.columns) {
          expect(actualLabels.has(column), column).toBe(false);
        }
      }
    });

    it("renders byte-identical files from the same fixture", async () => {
      const again = await renderCompany(fx, await loadPdfLib());
      expect(
        again.files.map((f) =>
          createHash("sha256").update(f.bytes).digest("hex"),
        ),
      ).toEqual(extracted.map((e) => e.sha256));
    }, 60_000);

    // ------------------------------------------------ manifest

    it("has a committed manifest that matches the generator, with real type codes and sensitivity", () => {
      const manifest = buildManifest(fx, docs);
      const committed: unknown = JSON.parse(
        readFileSync(join(MANIFEST_DIR, `${key}.json`), "utf8"),
      );
      expect(committed).toEqual(manifest);
      const types: readonly string[] = DOCUMENT_TYPES;
      const ids = new Set<string>();
      for (const d of manifest.documents) {
        expect(ids.has(d.id)).toBe(false);
        ids.add(d.id);
        expect(types).toContain(d.documentType);
        expect(d.defaultSensitivity).toBe(
          defaultDocumentSensitivity(
            d.documentType as Parameters<typeof defaultDocumentSensitivity>[0],
          ),
        );
        expect(d.readableByInvestorQUnderCurrentRules).toBe(
          d.defaultSensitivity !== "HIGHLY_CONFIDENTIAL",
        );
        expect(d.intendedDataRoomLevel).toBe("PRIVATE");
        expect(d.intendedVisibilityScope).toBe("organisation_private");
        expect(d.period.from <= d.period.to).toBe(true);
      }
      expect(manifest.documents.map((d) => d.id)).toEqual(
        extracted.map((e) => e.doc.id),
      );
    });
  },
);
