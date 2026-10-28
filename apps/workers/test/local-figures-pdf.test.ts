import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import type { PrivateDocumentStorageProvider } from "@capital-q/evidence";
import {
  ParserOutputSchema,
  type ParserOutput,
} from "@capital-q/evidence/contracts";
import {
  createLocalFigureOffers,
  extractLocalFigures,
  type LocalFigureOfferDependencies,
} from "@capital-q/founder-onboarding";

import {
  createDocumentProcessingPipeline,
  type LocalFiguresPort,
} from "../src/documents/pipeline.js";
import {
  createPdfExtractor,
  type ExtractionContext,
} from "../src/parser/extractors.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";
import type { ParserSandbox } from "../src/parser/sandbox.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import {
  createFakeEvidence,
  createRecordingLogger,
  makeDocument,
  makeVersion,
  TENANT_A,
} from "./support/fakes.js";
import { buildPlacedPdf, type PlacedText } from "./support/pdf.js";

/**
 * Owner decision 2026-10-28: a founder's management accounts are read by
 * code in the worker, never by a model. The PDFs here are real files read
 * by the real pdf.js extractor (synthetic, deterministic content); the
 * figures come out of the blocks it produces.
 */

const PIPELINE_VERSION = "evidence-processing-v1";
const context: ExtractionContext = { limits: EXTRACTION_PARSER_LIMITS };

async function extractPdf(
  pages: readonly (readonly PlacedText[])[],
): Promise<ParserOutput> {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs: unknown = await import(specifier);
  const getDocument = (pdfjs as { getDocument: (o: unknown) => unknown })
    .getDocument;
  const extractor = createPdfExtractor(async (bytes) => {
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
  const output = await extractor.extract(buildPlacedPdf(pages), context);
  expect(ParserOutputSchema.safeParse(output).success).toBe(true);
  return output;
}

/** A table row: cells far enough apart to stay cells (pdf-layout). */
const row = (y: number, cells: readonly string[]): PlacedText[] =>
  cells.map((text, at) => ({ x: 72 + at * 150, y, text }));

const ACCOUNTS_PAGE: PlacedText[] = [
  { x: 72, y: 740, text: "Management accounts - September 2026", size: 18 },
  { x: 72, y: 710, text: "All figures in USD." },
  ...row(680, ["Metric", "Aug 2026", "Sep 2026"]),
  ...row(662, ["MRR", "48,000", "51,000"]),
  ...row(644, ["Annualised MRR", "576,000", "612,000"]),
  ...row(626, ["Net burn", "(61,000)", "(65,000)"]),
  ...row(608, ["Closing cash", "375,000", "310,000"]),
  ...row(590, ["Payroll", "40,000", "42,000"]),
];

describe("local figures from a real management-accounts PDF", () => {
  it("reads MRR, cash and burn for September 2026 in USD, and annualised MRR as annual", async () => {
    const output = await extractPdf([ACCOUNTS_PAGE]);
    const started = performance.now();
    const { candidates } = extractLocalFigures(output.blocks);
    const elapsed = performance.now() - started;
    const by = new Map(candidates.map((c) => [c.measure, c]));
    expect(by.get("monthly_revenue")).toMatchObject({
      value: { kind: "MONEY", amount: "51000", currency: "USD" },
      period: { granularity: "MONTH", key: "2026-09" },
      cell: "51,000",
      quote: "MRR | Sep 2026 | 51,000",
      confidence: "HIGH",
      locator: { page: 1, table: 1, row: 2, column: 3 },
    });
    expect(by.get("annual_revenue")?.value).toMatchObject({
      amount: "612000",
      currency: "USD",
    });
    expect(by.get("net_burn")?.value).toMatchObject({ amount: "65000" });
    expect(by.get("cash_balance")?.value).toMatchObject({ amount: "310000" });
    // Exactly the four measures the table states; payroll is not one.
    expect([...by.keys()].sort()).toEqual([
      "annual_revenue",
      "cash_balance",
      "monthly_revenue",
      "net_burn",
    ]);
    // Pure code over a page of blocks: well inside a millisecond budget.
    expect(elapsed).toBeLessThan(50);
  });

  it("reads a naira table with decimal commas exactly", async () => {
    const output = await extractPdf([
      [
        { x: 72, y: 740, text: "Monthly report", size: 18 },
        ...row(700, ["Indicator", "Aug 2026", "Sep 2026"]),
        ...row(682, ["MRR (NGN)", "40.100.000,00", "45.250.000,50"]),
        ...row(664, ["Cash balance (NGN)", "380.000.000,00", "352.500.000,00"]),
        ...row(646, ["Gross margin", "55,5%", "57,25%"]),
      ],
    ]);
    const by = new Map(
      extractLocalFigures(output.blocks).candidates.map((c) => [c.measure, c]),
    );
    expect(by.get("monthly_revenue")?.value).toEqual({
      kind: "MONEY",
      amount: "45250000.5",
      currency: "NGN",
      currencyCertain: true,
    });
    expect(by.get("cash_balance")?.value).toMatchObject({
      amount: "352500000",
      currency: "NGN",
    });
    expect(by.get("gross_margin")?.value).toEqual({
      kind: "PERCENT",
      value: "57.25",
    });
  });

  it("offers nothing from an ambiguous table", async () => {
    const output = await extractPdf([
      [
        { x: 72, y: 740, text: "Key numbers", size: 18 },
        // No period anywhere, and no currency.
        ...row(700, ["Metric", "Value"]),
        ...row(682, ["MRR", "51,000"]),
        ...row(664, ["Cash", "310,000"]),
        { x: 72, y: 620, text: "Forecast", size: 18 },
        // Two columns for one month, neither marked actual.
        ...row(580, ["Metric", "Sep 2026", "Sep 2026"]),
        ...row(562, ["Burn (USD)", "65,000", "55,000"]),
      ],
    ]);
    expect(extractLocalFigures(output.blocks).candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The worker hook, inside the processing pipeline
// ---------------------------------------------------------------------------

function jobMessage(documentVersionId: string): QueueMessage {
  return {
    msgId: 1,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      id: randomUUID(),
      type: "evidence.document.process",
      jobVersion: 1,
      tenantId: TENANT_A,
      createdAt: new Date().toISOString(),
      data: { documentVersionId, pipelineVersion: PIPELINE_VERSION },
    },
  };
}

function storage(sizeBytes: number): PrivateDocumentStorageProvider {
  return {
    createUploadAuthorization: () => {
      throw new Error("not used");
    },
    statObject: () =>
      Promise.resolve({ sizeBytes, declaredContentType: "application/pdf" }),
    openObjectStream: () =>
      Promise.resolve({
        body: Readable.from([new TextEncoder().encode("%PDF")]),
      }),
    putObject: () => Promise.resolve(),
    deleteObject: () => Promise.resolve(),
  };
}

describe("the worker hook", () => {
  const COMPANY = "61000000-0000-4000-8000-000000000001";

  async function harness() {
    const output = await extractPdf([ACCOUNTS_PAGE]);
    const sandbox: ParserSandbox = {
      run: () =>
        Promise.resolve({
          ok: true,
          extractorId: "pdf",
          extractorVersion: "1",
          durationMs: 5,
          output,
        }),
    };
    // One founder's suggestions, shared across deliveries of the job.
    const suggestions: {
      stepKey: string;
      sourceRefs: readonly { sourceType: string; sourceId: string }[];
    }[] = [];
    const deps: LocalFigureOfferDependencies = {
      sql: {} as never,
      // A founder who finished setup (every real customer): no open
      // journey, their completed one for this company.
      sessions: {
        findActive: () => Promise.resolve(null),
        findLatest: () =>
          Promise.resolve({
            id: "s-1",
            status: "COMPLETED",
            subject: { subjectType: "COMPANY", subjectId: COMPANY },
          } as never),
      },
      responses: { listCurrent: () => Promise.resolve([]) },
      offeredFromVersion: (_sql, _session, versionId) =>
        Promise.resolve(
          new Set(
            suggestions
              .filter(
                (s) =>
                  s.sourceRefs.some((r) => r.sourceId === versionId) &&
                  s.sourceRefs.some((r) => r.sourceType === "LOCAL_FIGURE"),
              )
              .map((s) => s.stepKey),
          ),
        ),
      createSuggestion: (command) => {
        suggestions.push(command);
        return Promise.resolve({});
      },
    };
    const offers = createLocalFigureOffers(deps);
    const seen: { readonly documentType: string }[] = [];
    const localFigures: LocalFiguresPort = ({ blocks, ...document }) => {
      seen.push(document);
      return offers.onDocumentProcessed({ document, blocks });
    };
    const version = makeVersion();
    const run = async (port: LocalFiguresPort = localFigures) => {
      const evidence = createFakeEvidence({
        version,
        document: makeDocument(version, {
          documentType: "MANAGEMENT_ACCOUNTS",
          sensitivityClass: "HIGHLY_CONFIDENTIAL",
          companyId: COMPANY,
          title: "Q3 management accounts",
        }),
        pipelineVersion: PIPELINE_VERSION,
      });
      const logger = createRecordingLogger();
      const asked: string[] = [];
      const handle = createDocumentProcessingPipeline({
        evidence: evidence.service,
        storage: storage(version.sizeBytes),
        scanner: {
          id: "stub",
          scan: () =>
            Promise.resolve({
              status: "CLEAN",
              scannerId: "stub",
              scannerVersion: "1",
            }),
        },
        malwarePolicy: "REQUIRE_CLEAN",
        sandbox,
        pipelineVersion: PIPELINE_VERSION,
        maxDocumentBytes: 1_000_000,
        localFigures: port,
        // No model reads a highly confidential document's text.
        documentKind: (input) => {
          asked.push(input.opening);
          return Promise.resolve(null);
        },
        logger,
      });
      const outcome = await handle(jobMessage(version.id));
      return { outcome, logger, evidence, asked };
    };
    return { run, suggestions, seen };
  }

  it("offers the figures once per document version, in the worker, with no model", async () => {
    const { run, suggestions, seen } = await harness();
    const first = await run();
    expect(first.outcome).toEqual({ kind: "DONE" });
    expect(seen).toHaveLength(1);
    expect(suggestions.map((s) => s.stepKey)).toEqual([
      "F5.fin_currency",
      "F5.monthly_revenue",
      "F5.monthly_burn",
      "F5.cash",
    ]);
    const line = first.logger.lines.find(
      (l) => l.message === "local figures read",
    );
    expect(line?.fields).toMatchObject({ localFigures: "OFFERED", offered: 4 });
    expect(typeof line?.fields["localFiguresDurationMs"]).toBe("number");
    // Counts and codes only: no figure in the log.
    expect(JSON.stringify(first.logger.lines)).not.toContain("51,000");
    expect(first.asked).toEqual([]);

    // A retried job reads the same version again: nothing new is offered.
    const second = await run();
    expect(second.outcome).toEqual({ kind: "DONE" });
    expect(suggestions).toHaveLength(4);
  });

  it("never fails the job when the hook fails", async () => {
    const { run } = await harness();
    const failed = await run(() => Promise.reject(new Error("db down")));
    expect(failed.outcome).toEqual({ kind: "DONE" });
    expect(failed.evidence.calls.map((c) => c.name)).toContain(
      "completeDocumentProcessing",
    );
    expect(
      failed.logger.lines.some(
        (l) => l.message === "local figures not offered",
      ),
    ).toBe(true);
  });
});
