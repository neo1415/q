import { describe, expect, it } from "vitest";

import { sensitivityWithin } from "@capital-q/contracts";
import { SCOPE_CATALOGUE } from "@capital-q/q-firewall";
import { retrievalConstraintsFor } from "@capital-q/q-knowledge";
import { heldBackFromQ } from "@capital-q/q-tools";

import { createLocalFigureStatus } from "../src/composition/local-figures.js";

import { createEvidenceDocumentsPort } from "../src/composition/own-records.js";
import {
  matchConfirmedFigures,
  type ConfirmedFigure,
  type DeckStatedFigure,
} from "../src/composition/workforce/confirmed-figures.js";
import {
  answer,
  buildTurn,
  last,
  offered,
  ok,
  toolCalls,
} from "./q-turn-harness.js";

/**
 * Owner decision 2026-10-28, stress F03 ("review my documents"): the
 * founder's management accounts say $51K MRR for September 2026, their
 * deck $65K. The accounts are highly confidential and never reach a model;
 * the founder confirmed the figure code read from them, and that claim is
 * set against the deck by code. The contradiction reaches Q's answer with
 * both sources, and nothing of the accounts beyond the confirmed value.
 */

const REPORT = "715b9d70-d70e-417e-8677-7b971a147eb4";
const DECK = "4cfdc5e3-cd9b-4926-9558-b1ca6c714375";

const SEPTEMBER = {
  granularity: "MONTH",
  key: "2026-09",
  asOf: null,
  label: "2026-09",
} as const;

const confirmedMrr: ConfirmedFigure = {
  measure: "monthly_revenue",
  period: SEPTEMBER,
  value: { kind: "MONEY", amount: "51000", currency: "USD" },
  documentId: REPORT,
  source:
    "your financial document “LedgerBridge financial report Sept 2026”, page 1, table 1, row 2",
  confirmation: "KEPT",
};

const deckMrr: DeckStatedFigure = {
  section: "TRACTION",
  label: "MRR",
  value: "$65K",
  asOf: "Sep 2026",
  pages: [7],
  confirmed: true,
};

describe("matchConfirmedFigures (claims vs the deck, by code)", () => {
  it("CONTRADICTED: both sources, neither picked", () => {
    const [row] = matchConfirmedFigures([confirmedMrr], [deckMrr]);
    expect(row?.status).toBe("CONTRADICTED");
    expect(row?.documentId).toBe(REPORT);
    expect(row?.line).toContain("Monthly revenue, September 2026");
    expect(row?.line).toContain("USD 51,000");
    expect(row?.line).toContain("LedgerBridge financial report Sept 2026");
    expect(row?.line).toContain("MRR: $65K");
    expect(row?.line).toContain("page 7");
    expect(row?.line).toContain("neither is picked");
  });

  it("CORROBORATED within rounding; UNVERIFIED for another month or currency", () => {
    expect(
      matchConfirmedFigures([confirmedMrr], [{ ...deckMrr, value: "$51K" }])[0]
        ?.status,
    ).toBe("CORROBORATED");
    const august = matchConfirmedFigures(
      [confirmedMrr],
      [{ ...deckMrr, asOf: "Aug 2026" }],
    )[0];
    expect(august?.status).toBe("UNVERIFIED");
    expect(august?.line).toContain("another period or currency");
    expect(
      matchConfirmedFigures([confirmedMrr], [{ ...deckMrr, value: "₦65m" }])[0]
        ?.status,
    ).toBe("UNVERIFIED");
    expect(matchConfirmedFigures([confirmedMrr], [])[0]?.status).toBe(
      "UNVERIFIED",
    );
  });
});

describe("F03: 'review my documents' shows the contradiction, never the accounts", () => {
  it("hands the model the confirmed claim and the deck line only", async () => {
    // The real port, over Evidence's listing and the figures reader.
    const port = createEvidenceDocumentsPort(
      {
        listDocumentsWithVersions: () =>
          Promise.resolve([
            {
              document: {
                id: REPORT,
                title: "LedgerBridge financial report Sept 2026",
                documentType: "MANAGEMENT_ACCOUNTS",
                status: "ACTIVE",
                updatedAt: "2026-10-28T15:35:56.664Z",
                downloadAudience: "ORGANISATION",
                sensitivityClass: "HIGHLY_CONFIDENTIAL",
              },
              currentVersion: { processingStatus: "COMPLETED" },
            },
            {
              document: {
                id: DECK,
                title: "LedgerBridge seed deck",
                documentType: "PITCH_DECK",
                status: "ACTIVE",
                updatedAt: "2026-10-28T15:35:29.817Z",
                downloadAudience: "ORGANISATION",
                sensitivityClass: "CONFIDENTIAL",
              },
              currentVersion: { processingStatus: "COMPLETED" },
            },
          ] as never),
      },
      () => {
        const rows = matchConfirmedFigures([confirmedMrr], [deckMrr]);
        return Promise.resolve(
          new Map([
            [
              REPORT,
              { pending: 0, confirmed: rows.map((row) => row.line) },
            ],
          ]),
        );
      },
    );
    const listed = await port.list({} as never, "company");
    // What list_uploaded_documents hands the model, as the tool shapes it.
    const items = listed.map((item) => {
      const held = heldBackFromQ(item.sensitivityClass, item.figures);
      return {
        documentId: item.documentId,
        title: item.title,
        documentType: item.documentType,
        status: item.status,
        processing: item.processing,
        updatedAt: item.updatedAt,
        ...(held === null ? {} : { qUse: held }),
        ...(held === null || item.figures === undefined
          ? {}
          : { confirmedFigures: [...item.figures.confirmed] }),
      };
    });

    const { seam, request, alpha, stored } = buildTurn({
      said: "Review my documents. Do my numbers line up?",
      script: [
        toolCalls([{ name: "list_uploaded_documents", arguments: {} }]),
        answer(
          "Your deck says MRR is $65K for September 2026, but the figure you confirmed from your management accounts is USD 51,000 for the same month. Both stay on record; which one is current?",
        ),
      ],
      offered: [offered("list_uploaded_documents", "documents.uploaded.list")],
      world: (proposal) =>
        proposal.name === "list_uploaded_documents"
          ? ok(proposal, "documents.uploaded.list", { items })
          : null,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(last(stored).content).toContain("USD 51,000");
    expect(last(stored).content).toContain("$65K");

    // What the model was given after the read: both sides, labelled.
    const seen = JSON.stringify(alpha.calls.slice(1).map((c) => c.request));
    expect(seen).toContain("CONTRADICTED");
    expect(seen).toContain("USD 51,000");
    expect(seen).toContain("MRR: $65K");
    expect(seen).toContain("USER_CLAIM");
    // Nothing else of the accounts: no other row, no other month.
    expect(seen).not.toContain("48,000");
    expect(seen).not.toContain("Payroll");
  });
});

describe("firewall: the accounts' chunks are still never retrieved", () => {
  it("the evidence scope admits nothing above CONFIDENTIAL, even in an own-company run", () => {
    const sensitivity = SCOPE_CATALOGUE.EVIDENCE_DOCUMENTS.ownerSensitivity;
    const [constraint] = retrievalConstraintsFor({
      scopes: [
        {
          kind: "EVIDENCE_DOCUMENTS",
          subject: { kind: "COMPANY", companyId: "c" },
          contextLabel: "founder_private",
          sensitivity,
          layer: "EVIDENCE_DOCUMENTS",
          factCategories: [],
          projection: "FULL",
          rights: {
            canUseForReasoning: true,
            canDiscloseExistence: true,
            canQuote: true,
            canProvideLink: false,
          },
          filter: {
            tenantId: "t",
            companyId: "c",
            contextLabels: ["founder_private"],
          },
          isEvidence: true,
        },
      ],
      // An own-company question may reason up to HIGHLY_CONFIDENTIAL; the
      // evidence scope's own ceiling still wins.
      maxSensitivity: "HIGHLY_CONFIDENTIAL",
      allowedLayers: ["EVIDENCE_DOCUMENTS"],
    } as never);
    expect(constraint?.sensitivityCeiling).toBe("CONFIDENTIAL");
    expect(
      sensitivityWithin(
        "HIGHLY_CONFIDENTIAL",
        constraint?.sensitivityCeiling ?? "PUBLIC",
      ),
    ).toBe(false);
  });

  it("the figures reader reads claims, suggestion refs and the deck reading, never the document", async () => {
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("from core.companies")) {
        return Promise.resolve([{ id: "c" }]);
      }
      if (text.includes("from q_knowledge.objects")) {
        return Promise.resolve([
          {
            structured_value: {
              origin: "DOCUMENT_FIGURE",
              kind: "MONEY",
              amount: "51000",
              currency: "USD",
              measure: "monthly_revenue",
              periodGranularity: "MONTH",
              period: "2026-09",
              documentId: REPORT,
              confirmation: "KEPT",
            },
          },
        ]);
      }
      if (text.includes("from evidence.deck_extractions")) {
        return Promise.resolve([
          {
            confirmed: true,
            sections: [
              {
                section: "TRACTION",
                facts: [
                  {
                    kind: "FIGURE",
                    label: "MRR",
                    value: "$65K",
                    asOf: "Sep 2026",
                    pages: [7],
                  },
                ],
              },
            ],
          },
        ]);
      }
      if (text.includes("from evidence.documents")) {
        return Promise.resolve([
          { id: REPORT, title: "LedgerBridge financial report Sept 2026" },
        ]);
      }
      return Promise.resolve([]);
    }) as never;
    const status = await createLocalFigureStatus(sql)(
      { userId: "u", tenantId: "t", organisationId: "o" } as never,
      "61000000-0000-4000-8000-000000000001",
    );
    expect(status.get(REPORT)?.confirmed[0]).toContain("CONTRADICTED");
    expect(status.get(REPORT)?.confirmed[0]).toContain("USD 51,000");
    expect(status.get(REPORT)?.confirmed[0]).toContain("MRR: $65K");
    expect(queries.join("\n")).not.toMatch(
      /chunks|document_extractions|document_versions|storage/u,
    );
  });
});
