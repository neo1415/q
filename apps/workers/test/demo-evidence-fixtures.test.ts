import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DOCUMENT_TYPES } from "@capital-q/contracts";
import { defaultDocumentSensitivity } from "@capital-q/evidence";
import { ParserOutputSchema } from "@capital-q/evidence/contracts";

import {
  amount,
  balanceSheet,
  bankTransactions,
  buildDocuments,
  buildManifest,
  dateLabel,
  FIXTURE_KEYS,
  hundredthsLabel,
  loadFixture,
  MANIFEST_DIR,
  monthLabel,
  oneDecimal,
  ownershipHundredths,
  percent1,
  raiseTermsLine,
  revenueByCustomer,
  SYNTHETIC_HEADER,
  type DocumentModel,
  type Fixture,
} from "../../../scripts/seed/evidence/documents.mjs";
import {
  buildCompactDocuments,
  buildCompactManifest,
  COMPACT_KEYS,
  type CompactFixture,
  derivedFigure,
  expectedReceipts,
  formatValue,
  loadCompactFixture,
  proFormaHolders,
} from "../../../scripts/seed/evidence/compact.mjs";
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
 * Consistency validator for the synthetic demo evidence of Tensorgate,
 * Halyard Security and Nixo (owner directive 2026-11-16, phases 2-3;
 * decision 99 for Nixo).
 *
 * The fixture is the source of truth. These checks hold the arithmetic
 * between the documents (revenue to invoices, cash roll-forward, burn and
 * runway, ownership, dated customer counts, projections apart from
 * actuals, one set of raise terms), tie the fixture to the 6 Oct seed and
 * its claims, and read every generated file back through the workers' own
 * PDF and CSV extractors, so the files are known to be ingestible before
 * anyone uploads them.
 *
 * Tensorgate and Halyard are tied to the 6 Oct tavus-20 seed. Nixo is not in
 * that seed: its fixture carries the profile as recorded in production
 * (`recordedProfile`, read read-only on 16 Nov 2026) and lists every field it
 * had to invent (`assumptions`); the Nixo-only checks hold it to both.
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

async function extractAll(fx: Fixture | CompactFixture): Promise<Extracted[]> {
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
    const companySeed =
      fx.seedSource.file === undefined
        ? undefined
        : seed.find((c) => c.company === fx.seedSource.company);
    if (fx.seedSource.file !== undefined && companySeed === undefined)
      throw new Error(`no seed for ${key}`);
    const recorded = fx.recordedProfile;
    if (companySeed === undefined && recorded === undefined)
      throw new Error(`${key}: neither a seed entry nor a recorded profile`);
    const isSeeded = companySeed !== undefined;
    const price = fx.pricing?.pricePerSeatPerMonth ?? 0;
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

    it.runIf(isSeeded)(
      "keeps the seeded identity, founders, raise and deck figures",
      () => {
        if (companySeed === undefined) throw new Error("unreachable");
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

        expect(fx.deckStatedFigures?.cash).toBe(c.cashPosition.amount);
        expect(fx.deckStatedFigures?.monthlyNetBurn).toBe(
          c.monthlyNetBurn.amount,
        );
        expect(fx.deckStatedFigures?.runwayMonths).toBe(c.runwayMonthsCurrent);
        expect(fx.deckStatedFigures?.headcount).toBe(companySeed.headcount);
      },
    );

    it.runIf(!isSeeded)(
      "keeps every recorded profile field and lists every invented one",
      () => {
        if (recorded === undefined) throw new Error("unreachable");
        expect(fx.seedSource.companyId).toMatch(/^[0-9a-f-]{36}$/);
        expect(fx.seedSource.decision).toContain("decision 99");
        expect(fx.company.name).toBe(recorded.canonicalName);
        expect(fx.company.legalName).toBe(recorded.legalName);
        expect(fx.company.website).toBe(recorded.websiteUrl);
        expect(fx.company.foundedOn).toBe(recorded.foundedDate);
        expect(fx.company.headquarters).toContain(recorded.headquartersCity);
        expect(fx.company.stage).toBe(recorded.stage);
        expect(fx.company.oneLiner).toBe(recorded.shortDescription);
        expect(fx.team.founders.map((f) => f.name)).toEqual([
          recorded.founderName,
        ]);
        expect(fx.team.founders).toHaveLength(recorded.founderCount);

        const r = recorded.raise;
        expect(fx.raise.targetAmount).toBe(r.targetAmount);
        expect(fx.raise.currency).toBe(r.currency);
        expect(fx.currency).toBe(r.currency);
        expect(fx.raise.instrument.toLowerCase()).toContain(r.instrument);
        expect(fx.raise.useOfFunds.map((u) => u.line).join("; ")).toBe(
          r.useOfFundsSummary,
        );
        // Recorded timeframe: 3 to 6 months from 30 Sep 2026.
        expect(fx.raise.targetCloseOn >= "2026-12-30").toBe(true);
        expect(fx.raise.targetCloseOn <= "2027-03-30").toBe(true);

        // Nothing recorded for these, so each must be declared as invented.
        const invented = (fx.assumptions ?? []).map((a) => a.field).join(" | ");
        for (const field of [
          "raise.valuationCap",
          "raise.minimumCheque",
          "raise.targetCloseOn",
          "raise.useOfFunds",
          "customers",
          "invoices",
          "actuals",
          "funding",
          "openingBalances",
          "capTable",
          "bank",
          "projections",
          "hiringPlan",
          "headcount",
          "deck",
        ]) {
          expect(invented, field).toContain(field);
        }
        for (const a of fx.assumptions ?? []) {
          expect(a.value.length, a.field).toBeGreaterThan(0);
          expect(a.note.length, a.field).toBeGreaterThan(5);
        }
        // Customers are invented and anonymous: a letter and a segment only.
        for (const c of fx.customers)
          expect(c.label).toMatch(/^Customer [A-Z]$/);
        expect(fx.team.keyPeople).toHaveLength(0);
      },
    );

    it.runIf(isSeeded)(
      "matches every seeded KPI point (the SELF_REPORTED claims) exactly",
      () => {
        const map = KPI_MAP[key] ?? {};
        for (const point of companySeed?.metrics.points ?? []) {
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
      },
    );

    it.runIf(isSeeded)(
      "keeps the seeded month-end cash close to the deck's figure",
      () => {
        const deck = fx.deckStatedFigures;
        if (deck === undefined) throw new Error("no deck figures");
        const asOf = deck.cashAsOf.slice(0, 7);
        const atDeck = fx.actuals.find((a) => a.month === asOf);
        expect(atDeck).toBeDefined();
        // The deck rounds ("$1.1m", "480k"); the accounts are within 1%.
        const cash = atDeck?.cash.closing ?? 0;
        expect(Math.abs(cash - deck.cash) / deck.cash).toBeLessThan(0.01);
        expect(
          Math.abs((atDeck?.netBurn ?? 0) - deck.monthlyNetBurn) /
            deck.monthlyNetBurn,
        ).toBeLessThan(0.05);
      },
    );

    it.runIf(!isSeeded)(
      "generates a deck whose every figure is the accounts' figure",
      () => {
        const deck = extracted.find(
          (e) => e.doc.id === `${fx.idPrefix}-pitch-deck`,
        );
        expect(deck?.doc.documentType).toBe("PITCH_DECK");
        expect(deck?.doc.layout).toBe("slides");
        expect(deck?.pageCount ?? 0).toBeGreaterThanOrEqual(10);
        expect(deck?.pageCount ?? 0).toBeLessThanOrEqual(12);
        const text = deck?.text ?? "";
        const last = fx.actuals[fx.actuals.length - 1];
        if (last === undefined) throw new Error("no actuals");
        const k = last.kpis;
        for (const figure of [
          amount(last.cash.closing),
          amount(last.netBurn),
          oneDecimal(last.cash.closing / last.netBurn),
          amount(num(k["contractedArr"])),
          amount(num(k["annualisedSubscriptionRevenue"])),
          amount(num(k["billedSeats"])),
        ]) {
          expect(text, figure).toContain(figure);
        }
        // Quarterly revenue on the traction slide sums the monthly actuals.
        const q3 = sum(
          fx.actuals
            .filter((a) => a.month >= "2026-07" && a.month <= "2026-09")
            .map((a) => a.revenue.total),
        );
        expect(text).toContain(`Q3 2026 | ${amount(q3)}`);
        // The plan slide is labelled a projection on the slide itself.
        expect(text).toContain("PROJECTION - not actual results");
        // One slide per page, numbered 1 to n.
        deck?.pageTexts.forEach((page, i) => {
          expect(page).toContain(`${String(i + 1)}. `);
        });
      },
    );

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
        if (key === "nixo") {
          expect(k["designPartners"]).toBe(
            fx.customers.filter((c) => (c.designPartnerSince ?? "9") <= end)
              .length,
          );
          const signed = fx.customers.filter(
            (c) => (c.contractSignedOn ?? "9") <= end,
          );
          expect(k["paidContracts"]).toBe(signed.length);
          const seats = k["seatsByCustomer"] as Record<string, number>;
          expect(sum(Object.values(seats))).toBe(k["billedSeats"]);
          expect(num(k["billedSeats"]) * price).toBe(
            a.revenue.lines["platformSubscriptions"],
          );
          expect(k["annualisedSubscriptionRevenue"]).toBe(
            num(a.revenue.lines["platformSubscriptions"]) * 12,
          );
          for (const c of fx.customers) {
            const billing = (c.billingStartOn ?? "9").slice(0, 7) <= a.month;
            const scheduled = (c.seatSchedule ?? [])
              .filter((x) => x.from <= a.month)
              .reduce((_, x) => x.seats, 0);
            expect(seats[c.id] ?? 0, `${a.month} ${c.id}`).toBe(
              billing ? scheduled : 0,
            );
          }
          const contracted = sum(
            signed.map((c) => seats[c.id] ?? c.contractedSeats ?? 0),
          );
          expect(k["contractedArr"]).toBe(contracted * price * 12);
        } else if (key === "tensorgate") {
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
      if (!isSeeded) {
        // Post-money SAFEs as converted: amount / cap of the fully diluted total.
        const safes = holders.filter((h) => h.class.startsWith("SAFE"));
        const rounds = [...fx.fundingBeforeWindow, ...fx.funding];
        expect(safes).toHaveLength(rounds.length);
        safes.forEach((h, i) => {
          const round = rounds[i] as { amount: number; valuationCap?: number };
          expect(h.shares / total).toBe(
            round.amount / (round.valuationCap ?? Number.NaN),
          );
        });
        const proNew = fx.capTable.proForma.newShares;
        expect(proNew / (total + proNew)).toBe(
          fx.raise.targetAmount / (fx.raise.valuationCap ?? Number.NaN),
        );
        return;
      }
      const summary =
        companySeed?.dataRoom.find((d) => d.title.startsWith("Cap table"))
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
        companySeed?.deck.find((s) => s.section === "financials")?.content ??
        [];
      if (key === "nixo") {
        // No seeded deck: the generated deck states the plan, and the plan is
        // billed seats x price x 12, with Customer F billed from January 2027.
        for (const p of projections) {
          expect(p.arr).toBe((p.billedSeats ?? 0) * price * 12);
          expect(p.revenue).toBe((p.billedSeats ?? 0) * price);
        }
        const end = projections[projections.length - 1];
        const deck =
          extracted.find((e) => e.doc.id === `${fx.idPrefix}-pitch-deck`)
            ?.text ?? "";
        expect(deck).toContain(
          `subscription ARR of USD ${amount(end?.arr ?? 0)} at Dec 2027`,
        );
      } else if (key === "tensorgate") {
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
          ...(isSeeded ? [] : [`${fx.idPrefix}-pitch-deck`]),
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
      if (recorded !== undefined) {
        // The planted team-size gap is the recorded figure against payroll.
        const sep = fx.actuals.find((a) => a.month === "2026-09");
        const employees = sep?.headcount.total ?? 0;
        const contractors = num(sep?.kpis["contractorsForwardDeployed"]);
        expect(recorded.teamSizeRecordedOn).toBe("2026-09-30");
        expect(employees).not.toBe(recorded.teamSize);
        expect(employees + contractors).toBe(recorded.teamSize);
      }
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

/**
 * Compact packs (5-7 documents) for MedTrail, Mizan, Ajopot, Watchly and
 * Maji Loop (directive 2026-11-16, Phase 2 expansion). MedTrail and Mizan are
 * tied to the tavus-20 seed, including every KPI point and the cap table; the
 * other three to the profile recorded in production (`recordedProfile`, read
 * read-only on 17 Nov 2026). Every invented field is listed in `assumptions`.
 */
const SAFE_OR_PRICED: Record<string, string> = {
  safe: "SAFE",
  priced_equity: "Priced equity",
};

describe.each(COMPACT_KEYS.map((key) => [key]))(
  "compact demo evidence · %s",
  (key) => {
    const fx = loadCompactFixture(key);
    const docs = buildCompactDocuments(fx);
    const isSeeded = fx.seedSource.kind === "tavus-20";
    const companySeed = isSeeded
      ? seed.find((c) => c.company === fx.seedSource.company)
      : undefined;
    if (isSeeded && companySeed === undefined)
      throw new Error(`no seed for ${key}`);
    const recorded = fx.recordedProfile;
    if (!isSeeded && recorded === undefined)
      throw new Error(`${key}: no recorded profile`);
    const months = fx.actuals.map((a) => a.month);
    const at = (month: string) => {
      const a = fx.actuals.find((x) => x.month === month);
      if (a === undefined) throw new Error(`${key}: no actual ${month}`);
      return a;
    };
    const kpi = (month: string, k: string): number => num(at(month).kpis[k]);
    let extracted: Extracted[] = [];

    beforeAll(async () => {
      extracted = await extractAll(fx);
    }, 120_000);

    const textOf = (id: string): string => {
      const found = extracted.find((e) => e.doc.id === id);
      if (found === undefined) throw new Error(`no document ${id}`);
      return found.text;
    };

    // ------------------------------------------------ recorded figures kept

    it.runIf(isSeeded)(
      "keeps the seeded identity, team, raise, deck figures, KPI points and cap table",
      () => {
        if (companySeed === undefined) throw new Error("unreachable");
        expect(fx.company.legalName).toBe(companySeed.legalName);
        const names = [...fx.team.founders, ...fx.team.keyPeople].map(
          (x) => x.name,
        );
        expect(names).toContain(companySeed.founderPerson.name);
        for (const t of companySeed.team) expect(names).toContain(t.name);

        const c = companySeed.capital;
        expect(fx.raise.targetAmount).toBe(c.targetRaise.amount);
        expect(fx.raise.currency).toBe(c.targetRaise.currency);
        expect(fx.raise.instrument).toBe(c.instrument);
        expect(fx.raise.valuationCap).toBe(c.valuationCap?.amount);
        expect(fx.raise.preMoneyValuation).toBe(c.preMoneyValuation?.amount);
        expect(fx.raise.targetCloseOn).toBe(c.targetCloseDate);
        expect(fx.raise.minimumCheque).toBe(c.minimumCheque.amount);
        expect(fx.raise.useOfFunds).toEqual(
          c.useOfFunds.map((u) => ({
            line: u.line,
            percent: u.percent,
            amount: u.amount,
          })),
        );

        // Deck cash, burn and runway at 30 Sep 2026, in USD at the stated rate.
        const usd = fx.fx?.usd ?? 1;
        const sep = at(c.cashPosition.asOf.slice(0, 7));
        expect(
          Math.abs(sep.cash.closing / usd - c.cashPosition.amount) /
            c.cashPosition.amount,
        ).toBeLessThan(0.01);
        expect(
          Math.abs(sep.netBurn / usd - c.monthlyNetBurn.amount) /
            c.monthlyNetBurn.amount,
        ).toBeLessThan(0.05);
        expect(Number(oneDecimal(sep.cash.closing / sep.netBurn))).toBe(
          c.runwayMonthsCurrent,
        );
        expect(sep.headcount.total).toBe(companySeed.headcount);

        // Every seeded KPI point (the SELF_REPORTED claims), exactly.
        const byCode = new Map(
          fx.kpiDefinitions.map((k) => [k.seedCode ?? "", k.key]),
        );
        for (const point of companySeed.metrics.points) {
          for (const [code, value] of Object.entries(point.values)) {
            const field = byCode.get(code);
            expect(field, code).toBeDefined();
            expect(
              kpi(point.period, field ?? ""),
              `${point.period} ${code}`,
            ).toBe(value);
          }
        }

        // The seeded cap-table summary ("Name: 48%", "Remaining holders: 4% combined").
        const room = companySeed.dataRoom.find((d) =>
          d.title.startsWith("Cap table"),
        );
        const pct = ownershipHundredths(
          fx.capTable.holders.map((x) => x.shares),
        );
        const named = new Set<string>();
        for (const line of room?.summary ?? []) {
          const m = /^(.*?): ([\d.]+)%/.exec(line);
          if (m === null) continue;
          const label = m[1] ?? "";
          const want = Math.round(Number(m[2] ?? "0") * 100);
          if (label === "Remaining holders") {
            const rest = sum(
              fx.capTable.holders.map((x, i) =>
                named.has(x.name) ? 0 : (pct[i] ?? 0),
              ),
            );
            expect(rest, line).toBe(want);
          } else {
            const bare = label.replace(" (as converted)", "");
            const i = fx.capTable.holders.findIndex((x) => x.name === bare);
            expect(i, line).toBeGreaterThanOrEqual(0);
            named.add(bare);
            expect(pct[i], line).toBe(want);
          }
        }
        expect(named.size).toBeGreaterThanOrEqual(5);
      },
    );

    it.runIf(key === "medtrail")(
      "MedTrail: deck margin definition, revenue formula and the seeded key contract",
      () => {
        const sep = at("2026-09");
        const deckCost =
          num(sep.cogs.lines["hostingAndSms"]) +
          num(sep.cogs.lines["labelsAndConsumables"]);
        expect(percent1(sep.revenue.total - deckCost, sep.revenue.total)).toBe(
          "72.0%",
        );
        const d01 = fx.contracts?.find((c) => c.id === "MT-D01");
        expect(d01?.["warehousesSep2026"]).toBe(9);
        expect(d01?.["startOn"]).toBe("2026-02-01");
        expect(d01?.["termMonths"]).toBe(24);
        const scans = fx.invoices?.find(
          (i) => i.customerId === "MT-D01" && i.serviceMonth === "2026-09",
        )?.scans;
        expect(Math.abs((scans ?? 0) - 420000)).toBeLessThan(4200);
        // The existing management accounts summary: NGN 11.8m to NGN 26.3m.
        expect(at("2025-10").revenue.total).toBe(11800000);
        expect(oneDecimal(sep.revenue.total / 1e6)).toBe("26.3");
      },
    );

    it.runIf(key === "mizan")(
      "Mizan: 80% margin, the seeded partner contract and partner counts from contract dates",
      () => {
        const sep = at("2026-09");
        expect(percent1(sep.grossProfit, sep.revenue.total)).toBe("80.0%");
        const b01 = fx.contracts?.find((c) => c.id === "MZ-B01");
        expect(b01?.["startOn"]).toBe("2024-06-01");
        expect(b01?.["termMonths"]).toBe(36);
        expect(b01?.["feePercent"]).toBe(1.4);
        for (const a of fx.actuals) {
          const live = (fx.contracts ?? []).filter(
            (c) => String(c["startOn"]).slice(0, 7) <= a.month,
          ).length;
          expect(num(a.kpis["bankPartnersLive"]), a.month).toBe(live);
          const split = z
            .record(z.string(), z.number())
            .parse(a.kpis["originatedByPartnerEgpM"]);
          expect(sum(Object.values(split)), a.month).toBe(
            num(a.kpis["originatedMonthEgpM"]),
          );
          expect(num(a.kpis["feeRevenueMonth"])).toBe(
            num(a.revenue.lines["originationFees"]),
          );
        }
      },
    );

    it.runIf(!isSeeded)(
      "keeps every recorded profile field and figure, and lists every invented one",
      () => {
        if (recorded === undefined) throw new Error("unreachable");
        expect(fx.seedSource.companyId).toMatch(/^[0-9a-f-]{36}$/);
        expect(fx.company.name).toBe(recorded.canonicalName);
        expect(fx.company.legalName).toBe(recorded.legalName);
        expect(fx.company.website).toBe(recorded.websiteUrl);
        expect(fx.company.foundedOn).toBe(recorded.foundedDate);
        expect(fx.company.headquarters).toContain(recorded.headquartersCity);
        expect(fx.company.stage).toBe(recorded.stage);
        expect(fx.company.oneLiner).toBe(recorded.shortDescription);
        expect(fx.team.founders).toEqual(recorded.founders);
        expect(fx.team.keyPeople).toEqual(recorded.keyPeople ?? []);
        // Team size recorded in late Sep / mid Oct 2026.
        expect(at("2026-09").headcount.total).toBe(recorded.teamSize);

        const r = recorded.raise;
        expect(fx.raise.targetAmount).toBe(r.targetAmount);
        expect(fx.raise.currency).toBe(r.currency);
        expect(fx.raise.instrument).toContain(
          SAFE_OR_PRICED[r.instrument] ?? "unmapped",
        );
        expect(fx.raise.useOfFunds.map((u) => u.line).join("; ")).toBe(
          r.useOfFundsSummary,
        );
        if (r.targetCloseDate !== null)
          expect(fx.raise.targetCloseOn).toBe(r.targetCloseDate);

        for (const f of recorded.figures) {
          const a = at(f.month ?? "");
          const value =
            f.kpi !== undefined
              ? num(a.kpis[f.kpi])
              : f.field === "cash.closing"
                ? a.cash.closing
                : f.field === "netBurn"
                  ? a.netBurn
                  : Number.NaN;
          expect(value, f.what).toBe(f.value);
        }
        for (const f of recorded.approximateFigures ?? []) {
          const value = kpi(f.month ?? "", f.kpi ?? "");
          expect(
            Math.abs(value - f.value) / f.value,
            f.what,
          ).toBeLessThanOrEqual(f.tolerance ?? 0);
        }
        for (const f of recorded.yearTotals ?? []) {
          const rows = fx.actuals.filter((a) =>
            a.month.startsWith(`${f.year ?? ""}-`),
          );
          expect(rows).toHaveLength(12);
          const total = sum(
            rows.map((a) =>
              f.kpi !== undefined ? num(a.kpis[f.kpi]) : a.revenue.total,
            ),
          );
          expect(total, f.what).toBe(f.value);
        }
        if (recorded.pipelineExport !== undefined) {
          const live = (fx.contracts ?? []).filter((c) => c.status === "LIVE");
          expect(live).toHaveLength(
            recorded.pipelineExport["liveCustomers"] ?? -1,
          );
        }
        if (recorded.octoberRevenueUsd !== undefined) {
          expect(at("2026-10").revenue.total / (fx.fx?.usd ?? 1)).toBe(
            recorded.octoberRevenueUsd,
          );
        }
        if (recorded.deckKiosks !== undefined) {
          expect(kpi("2025-12", "kiosksInstalled")).toBe(
            recorded.deckKiosks["2025"],
          );
        }

        const invented = fx.assumptions.map((a) => a.field).join(" | ");
        for (const field of [
          fx.raise.valuationCap !== undefined
            ? "raise.valuationCap"
            : "raise.preMoneyValuation",
          "raise.minimumCheque",
          "raise.useOfFunds",
          "capTable",
          "funding",
          "bank",
          "headcount",
          "actuals",
        ]) {
          expect(invented, field).toContain(field);
        }
        if (r.targetCloseDate === null)
          expect(invented).toContain("raise.targetCloseOn");
      },
    );

    it("lists each invented field with its value and reason", () => {
      expect(fx.assumptions.length).toBeGreaterThanOrEqual(8);
      for (const a of fx.assumptions) {
        expect(a.value.length, a.field).toBeGreaterThan(0);
        expect(a.note.length, a.field).toBeGreaterThan(5);
      }
    });

    // ------------------------------------------------ arithmetic

    it("covers contiguous months to October 2026 and totals every line", () => {
      expect(months[0]).toBe(fx.periods.firstActualMonth);
      expect(months.at(-1)).toBe("2026-10");
      expect(fx.periods.lastActualMonth).toBe("2026-10");
      for (let i = 1; i < months.length; i++)
        expect(months[i]).toBe(nextMonth(months[i - 1] ?? ""));
      for (const a of fx.actuals) {
        for (const part of [a.revenue, a.cogs, a.opex]) {
          expect(sum(Object.values(part.lines)), a.month).toBe(part.total);
          for (const v of Object.values(part.lines))
            expect(Number.isInteger(v)).toBe(true);
        }
        expect(a.grossProfit).toBe(a.revenue.total - a.cogs.total);
        expect(a.netResult).toBe(a.grossProfit - a.opex.total);
        expect(a.headcount.total).toBe(
          sum(
            Object.entries(a.headcount)
              .filter(([k]) => k !== "total")
              .map(([, v]) => v),
          ),
        );
      }
    });

    it("builds every driven revenue line from its driver and price", () => {
      for (const a of fx.actuals) {
        for (const c of fx.revenueModel.components) {
          const exact = num(a.kpis[c.kpi]) * c.unitPrice;
          expect(Math.abs(exact - Math.round(exact)), a.month).toBeLessThan(
            1e-6,
          );
          expect(a.revenue.lines[c.line], `${a.month} ${c.line}`).toBe(
            Math.round(exact),
          );
        }
      }
      // Cumulative counters roll forward month by month.
      for (const [inMonth, cumulative] of [
        ["packsMonth", "packsCumulative"],
        ["originatedMonthEgpM", "originatedCumulativeEgpM"],
      ] as const) {
        if (fx.actuals[0]?.kpis[cumulative] === undefined) continue;
        for (let i = 1; i < fx.actuals.length; i++) {
          const a = fx.actuals[i];
          const b = fx.actuals[i - 1];
          if (a === undefined || b === undefined) continue;
          expect(num(a.kpis[cumulative]), a.month).toBe(
            num(b.kpis[cumulative]) + num(a.kpis[inMonth]),
          );
        }
      }
    });

    it("rolls cash forward and derives burn and runway from it", () => {
      fx.actuals.forEach((a, i) => {
        const prev = fx.actuals[i - 1];
        if (prev !== undefined) expect(a.cash.opening).toBe(prev.cash.closing);
        expect(a.cash.receipts, a.month).toBe(expectedReceipts(fx, i));
        expect(a.cash.payments, a.month).toBe(
          a.cogs.total + a.opex.total - a.depreciation + a.capex,
        );
        expect(a.cash.closing, a.month).toBe(
          a.cash.opening +
            a.cash.receipts +
            a.cash.fundingReceived -
            a.cash.payments,
        );
        expect(a.cash.closing).toBeGreaterThan(0);
        expect(a.netBurn).toBe(a.cash.payments - a.cash.receipts);
        expect(a.runwayMonths).toBe(
          a.netBurn > 0
            ? Math.round((a.cash.closing / a.netBurn) * 10) / 10
            : null,
        );
        expect(a.receivablesClosing).toBe(
          fx.collection === "same-month" ? 0 : a.revenue.total,
        );
        // Funding received in the month is a listed round of that month.
        const rounds = fx.funding.filter((f) =>
          f.receivedOn.startsWith(a.month),
        );
        expect(a.cash.fundingReceived, a.month).toBe(
          sum(
            rounds.map((f) =>
              f.currency === fx.currency
                ? f.amount
                : f.amount * (fx.fx?.usd ?? 0),
            ),
          ),
        );
      });
    });

    it.runIf(fx.invoices !== undefined)(
      "ties the invoice register to each month's revenue and drivers",
      () => {
        const invoices = fx.invoices ?? [];
        const serviceMonths = [...new Set(invoices.map((i) => i.serviceMonth))];
        expect(serviceMonths.length).toBeGreaterThan(0);
        for (const month of serviceMonths) {
          const list = invoices.filter((i) => i.serviceMonth === month);
          const a = at(month);
          expect(sum(list.map((i) => i.amount)), month).toBe(a.revenue.total);
          if (list[0]?.scans !== undefined) {
            expect(sum(list.map((i) => i.scans ?? 0))).toBe(
              num(a.kpis["packsMonth"]),
            );
            expect(sum(list.map((i) => i.warehouses ?? 0))).toBe(
              num(a.kpis["warehouses"]),
            );
            expect(new Set(list.map((i) => i.customerId)).size).toBe(
              num(a.kpis["distributors"]),
            );
            for (const i of list)
              expect(i.amount).toBe(
                (i.warehouses ?? 0) * 350000 + (i.scans ?? 0) * 3,
              );
          }
          for (const i of list) expect(i.issuedOn > lastDay(month)).toBe(true);
        }
        const csv = textOf(`${fx.idPrefix}-invoice-register`);
        for (const i of invoices) expect(csv).toContain(i.number);
      },
    );

    it("sums ownership to 100.00% now and pro forma, at the round's terms", () => {
      const now = ownershipHundredths(fx.capTable.holders.map((x) => x.shares));
      expect(sum(now)).toBe(10000);
      const after = proFormaHolders(fx);
      const pct = ownershipHundredths(after.map((x) => x.shares));
      expect(sum(pct)).toBe(10000);
      const r = fx.raise;
      const want =
        r.preMoneyValuation !== undefined
          ? r.targetAmount / (r.preMoneyValuation + r.targetAmount)
          : r.targetAmount / (r.valuationCap ?? 1);
      expect(Math.abs((pct.at(-1) ?? 0) / 10000 - want)).toBeLessThan(0.0002);
      const text = textOf(`${fx.idPrefix}-cap-table`);
      const shares = sum(fx.capTable.holders.map((x) => x.shares));
      // The parser's text joins table cells with " | ".
      expect(text).toContain(`Total | ${amount(shares)} | 100.00%`);
      fx.capTable.holders.forEach((x, i) => {
        expect(text).toContain(
          `${x.name} | ${x.class} | ${amount(x.shares)} | ${hundredthsLabel(now[i] ?? 0)}`,
        );
      });
    });

    it("prints identical raise terms wherever the raise is mentioned", () => {
      const line = flat(raiseTermsLine(fx));
      expect(sum(fx.raise.useOfFunds.map((u) => u.amount))).toBe(
        fx.raise.targetAmount,
      );
      expect(sum(fx.raise.useOfFunds.map((u) => u.percent))).toBe(100);
      const mentioning = extracted.filter((e) =>
        e.text.includes("Seed round terms:"),
      );
      expect(mentioning.map((e) => e.doc.id).sort()).toEqual(
        [`${fx.idPrefix}-cap-table`, `${fx.idPrefix}-raise-terms`].sort(),
      );
      for (const e of mentioning) expect(e.text, e.doc.id).toContain(line);
    });

    it("plants exactly one deliberate discrepancy against a deck figure, in exactly the stated documents", () => {
      expect(fx.knownDiscrepancies.filter((d) => d.deliberate)).toHaveLength(1);
      const deckText = JSON.stringify(fx.deckStatedFigures);
      for (const d of fx.knownDiscrepancies) {
        expect(derivedFigure(fx, d.derivation), d.id).toBe(d.accounts);
        expect(d.note, d.id).toContain(d.accounts);
        expect(d.note.length).toBeGreaterThan(40);
        if (d.deliberate) {
          const numbers = (d.deck.match(/\d[\d,]*/g) ?? []).map((x) =>
            x.replaceAll(",", ""),
          );
          expect(
            numbers.some((n) => deckText.includes(n)),
            d.id,
          ).toBe(true);
          expect(d.deck).not.toContain(d.accounts);
        }
        const stated = new Set(d.evidence.map((e) => e.documentId));
        for (const e of d.evidence) {
          expect(d.note).toContain(e.text);
          expect(textOf(e.documentId), `${d.id} in ${e.documentId}`).toContain(
            flat(d.note),
          );
        }
        const present = extracted
          .filter((x) => d.evidence.some((e) => x.text.includes(e.text)))
          .map((x) => x.doc.id);
        expect(new Set(present), d.id).toEqual(stated);
      }
    });

    // ------------------------------------------------ the files themselves

    it("generates 5-7 text-native files, every page marked and readable by the workers' parser", () => {
      expect(extracted.length).toBeGreaterThanOrEqual(5);
      expect(extracted.length).toBeLessThanOrEqual(7);
      for (const e of extracted.filter((x) => x.doc.format === "pdf")) {
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
        });
        expect(e.text).toContain(e.doc.title);
      }
      for (const e of extracted.filter((x) => x.doc.format === "csv")) {
        expect(e.text.startsWith(SYNTHETIC_HEADER)).toBe(true);
        expect(e.parsedText).toContain(SYNTHETIC_HEADER);
        expect(e.parsedText).toContain(e.doc.csv?.header[0] ?? "missing");
      }
      // The management accounts print the last month's key figures.
      const last = fx.actuals.at(-1);
      if (last === undefined) throw new Error("no actuals");
      const ma = textOf(`${fx.idPrefix}-management-accounts`);
      for (const figure of [
        amount(last.revenue.total),
        amount(last.cash.closing),
        amount(last.netBurn),
        oneDecimal(last.cash.closing / last.netBurn),
      ])
        expect(ma, figure).toContain(figure);
      const kp = textOf(`${fx.idPrefix}-kpi-pack`);
      for (const k of fx.kpiDefinitions)
        expect(kp, k.key).toContain(formatValue(num(last.kpis[k.key]), k.unit));
    });

    it("titles carry no '(fictional)' and nothing imitates an official record or a real bank", () => {
      for (const e of extracted) {
        expect(e.doc.title).not.toMatch(/fictional/i);
        expect(e.text).not.toMatch(
          /Companies House|Division of Corporations|Corporate Affairs Commission|Commercial Registry|certified true copy|certificate|\bseal\b|stamped|signed by|signatory|HMRC|\bFIRS\b|Tax Authority/i,
        );
      }
      expect(textOf(`${fx.idPrefix}-management-accounts`)).toContain(
        `${fx.bank.name} (a fictitious institution created for this demonstration), ${fx.bank.accountMasked}`,
      );
    });

    it("keeps months after the last actual out of the actuals documents", () => {
      const after = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
      for (const e of extracted.filter((x) =>
        ["management-accounts", "revenue-breakdown", "kpi-pack"].some(
          (s) => x.doc.id === `${fx.idPrefix}-${s}`,
        ),
      )) {
        const text = e.text.replaceAll(
          `Issued ${dateLabel(fx.documentDefaults.issuedOn)}`,
          "",
        );
        for (const m of after)
          expect(text, e.doc.id).not.toContain(monthLabel(m));
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

    it("has a committed manifest that matches the generator, with real type codes and sensitivity", () => {
      const manifest = buildCompactManifest(fx, docs);
      const committed: unknown = JSON.parse(
        readFileSync(join(MANIFEST_DIR, `${key}.json`), "utf8"),
      );
      expect(committed).toEqual(manifest);
      const types: readonly string[] = DOCUMENT_TYPES;
      for (const d of manifest.documents) {
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
        if (fx.sharingPlan.investor === null)
          expect(d.plannedShareWith).toBeNull();
        // No new decks: nothing here starts deck reading or kind classification.
        expect(["PITCH_DECK", "COMPANY_PROFILE"]).not.toContain(d.documentType);
      }
      expect(new Set(manifest.documents.map((d) => d.id)).size).toBe(
        manifest.documents.length,
      );
      expect(manifest.documents.map((d) => d.id)).toEqual(
        extracted.map((e) => e.doc.id),
      );
    });
  },
);
