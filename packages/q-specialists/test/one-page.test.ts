import { describe, expect, it } from "vitest";

import { QArtifactIdSchema } from "@capital-q/contracts";
import {
  documentFromArtifact,
  documentPageCount,
} from "@capital-q/deck-render";

import {
  aboutTheDocumentItself,
  composeAnswerDocument,
} from "../src/answer-document.js";
import { fitToOnePage } from "../src/company/one-page.js";

/**
 * live6 2026-11-04 (production 7b9a267ce, receipt memo.pdf): "Write me a
 * one-page memo on Ledgerline" printed on two pages and ended "The memo
 * text is ready for review." The answer below is that memo as Q wrote it.
 */
const MEMO = `# Ledgerline — One-Page Investment Memo

## Overview
Ledgerline is a Lagos-based, seed-stage company building VAT compliance software for Nigerian small and medium businesses. It connects with existing invoicing and accounting tools, validates invoices when they are created, and prepares and files monthly VAT returns.

## Business Model and Traction
Ledgerline charges monthly subscription fees per legal entity. The company reports 1,140 paying businesses, approximately ₦38 million in monthly recurring revenue and 96% six-month logo retention as of September 2026. Its pitch deck reports growth from 590 paying businesses in September 2025 and MRR growth from ₦19.6 million in October 2025 to ₦38 million in September 2026. These are self-reported claims.

## Financial Profile and Raise
The deck states current monthly net burn of approximately $39,000, planned post-raise burn near $85,000, and cash of $410,000 as of September 30, 2026. It projects revenue of ₦780 million in FY2027, ₦1.65 billion in FY2028 and ₦3.1 billion in FY2029, with break-even planned for Q3 2028.

Ledgerline says it is raising $1.8 million through a post-money SAFE with a $14 million valuation cap and a $50,000 minimum cheque. The stated use of funds is engineering and FIRS integration, sales and partner channels, customer success, compliance reserve and working capital.

## Team
The company page lists Tobenna Okafor, Funmilayo Adebayo, Emeka Chukwu and Zainab Lawal. Tobenna is described as a chartered accountant with seven years in a Big Four tax practice in Lagos. The available material provides limited background on the other team members.

## Investor Assessment
Ledgerline matches your declared seed-stage focus on African fintech and enterprise software, with reported early revenue and enterprise-oriented recurring software. The reported customer growth and retention are relevant positives, but the figures have not been independently verified.

The immediate underwriting question is whether paying customers, pricing, MRR, retention and costs reconcile. The planned increase in burn also needs to be tied to customer acquisition, product delivery, cash runway and the path to break-even.

## Key Gaps and Risks
- Customer count, pricing and reported MRR need a detailed reconciliation.
- Cohort retention, churn reasons, customer concentration, gross margin, acquisition cost and payback are not established in the available material.
- Runway under current and planned burn requires a 24-month cash-flow bridge.
- The FIRS e-invoicing rollout is central to the positioning, but its timing, scope and commercial effect are not independently established here.
- Revenue is in naira while the raise is in US dollars, creating currency and inflation exposure that should be modelled explicitly.

## Initial View
Ledgerline merits focused diligence against your mandate, but the available evidence does not yet support a stronger underwriting view. The next step is to request the monthly revenue bridge, customer cohorts, pricing mix, gross-margin calculation, acquisition economics and a 24-month cash-flow model, then test whether the planned burn and break-even assumptions reconcile.

The memo text is ready for review.`;

const QUESTION = "Write me a one-page memo on Ledgerline";

async function pages(
  type: string,
  doc: {
    title: string;
    summary: string;
    content: Parameters<typeof fitToOnePage>[1];
  },
): Promise<number> {
  return documentPageCount(
    documentFromArtifact({
      type,
      version: {
        artifactId: QArtifactIdSchema.parse(
          "00000000-0000-4000-8000-000000000001",
        ),
        version: 1,
        title: doc.title,
        summary: doc.summary,
        content: doc.content,
        createdAt: new Date().toISOString(),
      },
    }),
    { title: doc.title },
  );
}

describe("live6: a status sentence about the memo is not the memo", () => {
  it("is recognised, and ordinary sentences are not", () => {
    expect(aboutTheDocumentItself("The memo text is ready for review.")).toBe(
      true,
    );
    expect(aboutTheDocumentItself("This memo is attached below.")).toBe(true);
    expect(aboutTheDocumentItself("The draft is ready.")).toBe(true);
    expect(
      aboutTheDocumentItself(
        "The memo market in Lagos is growing at 20% a year.",
      ),
    ).toBe(false);
    expect(
      aboutTheDocumentItself("Revenue is in naira while the raise is in USD."),
    ).toBe(false);
  });

  it("is never filed in the document", () => {
    const document = composeAnswerDocument({
      answer: MEMO,
      question: QUESTION,
    });
    const text = JSON.stringify(document?.content);
    expect(text).not.toContain("ready for review");
    expect(text).toContain("24-month cash-flow model");
  });
});

describe("live6: a one-page memo prints on one page", () => {
  it("the memo as written prints on two; fitted, it prints on one", async () => {
    const document = composeAnswerDocument({
      answer: MEMO,
      question: QUESTION,
    });
    if (document === null) throw new Error("no document");
    expect(await pages("Q_REPORT", document)).toBeGreaterThan(1);
    const fitted = await fitToOnePage(
      { type: "Q_REPORT", title: document.title, summary: document.summary },
      document.content,
    );
    expect(await pages("Q_REPORT", { ...document, content: fitted })).toBe(1);
    // The opening section stays, and what remains is Q's own words.
    expect(fitted.sections[0]?.heading).toBe(
      document.content.sections[0]?.heading,
    );
    for (const section of fitted.sections) {
      const original = document.content.sections.find(
        (one) => one.heading === section.heading,
      );
      expect(original?.body.startsWith(section.body)).toBe(true);
    }
  });

  it("a document that already fits is left exactly as it is", async () => {
    const short = composeAnswerDocument({
      answer: "## Overview\nLedgerline sells VAT software in Lagos.",
      question: QUESTION,
    });
    if (short === null) throw new Error("no document");
    const fitted = await fitToOnePage(
      { type: "Q_REPORT", title: short.title, summary: short.summary },
      short.content,
    );
    expect(fitted).toBe(short.content);
  });
});
