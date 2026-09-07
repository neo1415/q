import { describe, expect, it } from "vitest";

import {
  Q_CONFIDENCE_LABELS,
  Q_CONFIDENCE_LEVELS,
  qConfidenceLabel,
  QConfidenceLevelSchema,
} from "../src/q/confidence.js";
import {
  Q_EVIDENCE_REF_KINDS,
  Q_EVIDENCE_REFS_MAX,
  QEvidenceRefSchema,
  QEvidenceRefsSchema,
} from "../src/q/evidence-ref.js";
import {
  Q_FINDING_TYPES,
  QInternalFindingSchema,
  QPublicFindingSchema,
} from "../src/q/finding.js";
import {
  Q_RESULT_BLOCK_KINDS,
  Q_RESULT_BLOCKS_MAX,
  QResultBlockSchema,
  QResultBlocksSchema,
} from "../src/q/result-block.js";
import { Q_UI_INTENT_KINDS, QUiIntentSchema } from "../src/q/ui-intent.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const NOW = "2026-09-05T10:00:00Z";

const evidenceRef = { kind: "DOCUMENT", documentId: UUID, page: 3 };

const publicFinding = {
  findingId: UUID,
  type: "FACT",
  statement: "ARR was reported as GBP 1.2m in the March management accounts.",
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
  confidence: "MODERATE",
  evidenceRefs: [evidenceRef],
  subjects: [{ kind: "COMPANY", companyId: UUID }],
};

const proposal = {
  contractVersion: 1,
  proposalId: UUID,
  runId: UUID_2,
  actionType: "message.send",
  actionClass: "CONFIRM_REQUIRED",
  targets: [{ kind: "INVESTOR_ORGANISATION", investorOrganisationId: UUID_2 }],
  summary: "Send an introduction to Northgate Capital.",
  approval: { required: true },
  status: "PROPOSED",
  createdAt: NOW,
};

/** One valid fixture per block kind. The test below proves this covers the union. */
const BLOCK_FIXTURES: Readonly<Record<string, unknown>> = {
  TEXT: { kind: "TEXT", text: "Runway is approximately 14 months." },
  COMPANY_REFERENCE: { kind: "COMPANY_REFERENCE", companyId: UUID },
  INVESTOR_REFERENCE: {
    kind: "INVESTOR_REFERENCE",
    investorOrganisationId: UUID_2,
  },
  COMPARISON: {
    kind: "COMPARISON",
    subjects: [
      { kind: "COMPANY", companyId: UUID },
      { kind: "COMPANY", companyId: UUID_2 },
    ],
    rows: [
      { label: "Stage", values: ["Seed", "Series A"] },
      { label: "Runway", values: ["14 months", ""] },
    ],
  },
  EVIDENCE: { kind: "EVIDENCE", evidenceRefs: [evidenceRef] },
  FINDING: { kind: "FINDING", finding: publicFinding },
  UNCERTAINTY: {
    kind: "UNCERTAINTY",
    statement: "I could not establish current monthly burn.",
    confidence: "INSUFFICIENT_EVIDENCE",
    missing: ["Recent management accounts"],
  },
  CLARIFICATION_REQUEST: {
    kind: "CLARIFICATION_REQUEST",
    question: "Which Apex do you mean?",
    options: ["Apex Robotics", "Apex Health"],
  },
  ACTION_PROPOSAL: { kind: "ACTION_PROPOSAL", proposal },
  UI_INTENT: {
    kind: "UI_INTENT",
    intent: { kind: "OPEN_COMPANY", companyId: UUID },
  },
};

describe("QResultBlock", () => {
  it("has a fixture for every kind, and every fixture parses", () => {
    expect(Object.keys(BLOCK_FIXTURES).sort()).toEqual(
      [...Q_RESULT_BLOCK_KINDS].sort(),
    );
    for (const [kind, fixture] of Object.entries(BLOCK_FIXTURES)) {
      const result = QResultBlockSchema.safeParse(fixture);
      expect(result.success, kind).toBe(true);
    }
  });

  it("rejects a malformed or unknown member of the union", () => {
    expect(
      QResultBlockSchema.safeParse({ text: "no discriminator" }).success,
    ).toBe(false);
    expect(
      QResultBlockSchema.safeParse({ kind: "HTML", html: "<b>x</b>" }).success,
    ).toBe(false);
    expect(
      QResultBlockSchema.safeParse({ kind: "COMPONENT", name: "Card" }).success,
    ).toBe(false);
    expect(
      QResultBlockSchema.safeParse({
        kind: "TEXT",
        text: "x",
        html: "<b>x</b>",
      }).success,
    ).toBe(false);
    expect(
      QResultBlockSchema.safeParse({ kind: "TEXT", text: "x", format: "html" })
        .success,
    ).toBe(false);
  });

  it("treats script-looking text as text, with no executable kind", () => {
    const parsed = QResultBlockSchema.parse({
      kind: "TEXT",
      text: '<script>alert("x")</script>',
    });
    expect(parsed.kind).toBe("TEXT");
    for (const kind of Q_RESULT_BLOCK_KINDS) {
      expect(kind).not.toMatch(/HTML|SCRIPT|COMPONENT|MARKUP|CODE/);
    }
  });

  it("requires one comparison value per subject in every row", () => {
    expect(
      QResultBlockSchema.safeParse({
        kind: "COMPARISON",
        subjects: [
          { kind: "COMPANY", companyId: UUID },
          { kind: "COMPANY", companyId: UUID_2 },
        ],
        rows: [{ label: "Stage", values: ["Seed"] }],
      }).success,
    ).toBe(false);
    expect(
      QResultBlockSchema.safeParse({
        kind: "COMPARISON",
        subjects: [{ kind: "COMPANY", companyId: UUID }],
        rows: [],
      }).success,
    ).toBe(false);
  });

  it("refuses an uncertainty block that claims high confidence", () => {
    expect(
      QResultBlockSchema.safeParse({
        kind: "UNCERTAINTY",
        statement: "Not sure.",
        confidence: "HIGH",
      }).success,
    ).toBe(false);
  });

  it("bounds the number of blocks", () => {
    const blocks = Array.from({ length: Q_RESULT_BLOCKS_MAX + 1 }, () => ({
      kind: "TEXT",
      text: "x",
    }));
    expect(QResultBlocksSchema.safeParse(blocks).success).toBe(false);
  });
});

describe("QUiIntent", () => {
  const INTENT_FIXTURES: Readonly<Record<string, unknown>> = {
    OPEN_COMPANY: { kind: "OPEN_COMPANY", companyId: UUID },
    SHOW_COMPARISON: { kind: "SHOW_COMPARISON", companyIds: [UUID, UUID_2] },
    FOCUS_SECTION: {
      kind: "FOCUS_SECTION",
      companyId: UUID,
      section: "FINANCIALS",
    },
    SHOW_EVIDENCE: { kind: "SHOW_EVIDENCE", evidenceRefs: [evidenceRef] },
  };

  it("parses every supported intent", () => {
    expect(Object.keys(INTENT_FIXTURES).sort()).toEqual(
      [...Q_UI_INTENT_KINDS].sort(),
    );
    for (const [kind, fixture] of Object.entries(INTENT_FIXTURES)) {
      expect(QUiIntentSchema.safeParse(fixture).success, kind).toBe(true);
    }
  });

  it("has no intent that could run code or reach an arbitrary destination", () => {
    for (const intent of [
      { kind: "OPEN_URL", url: "https://evil.example" },
      { kind: "EXECUTE_JAVASCRIPT", script: "alert(1)" },
      { kind: "RUN_COMMAND", command: "rm -rf /" },
      { kind: "SET_RAW_HTML", html: "<b>x</b>" },
      { kind: "CALL_API", path: "/v1/companies" },
      { kind: "NAVIGATE", href: "/anything" },
    ]) {
      expect(QUiIntentSchema.safeParse(intent).success).toBe(false);
    }
  });

  it("bounds intent parameters to identifiers and known sections", () => {
    expect(
      QUiIntentSchema.safeParse({
        kind: "FOCUS_SECTION",
        companyId: UUID,
        section: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      QUiIntentSchema.safeParse({ kind: "SHOW_COMPARISON", companyIds: [UUID] })
        .success,
    ).toBe(false);
    expect(
      QUiIntentSchema.safeParse({
        kind: "OPEN_COMPANY",
        companyId: UUID,
        url: "https://evil.example",
      }).success,
    ).toBe(false);
  });
});

describe("QEvidenceRef", () => {
  const REF_FIXTURES: Readonly<Record<string, unknown>> = {
    EVIDENCE_ITEM: { kind: "EVIDENCE_ITEM", evidenceItemId: UUID },
    CLAIM: { kind: "CLAIM", claimId: UUID },
    DOCUMENT: {
      kind: "DOCUMENT",
      documentId: UUID,
      documentVersionId: UUID_2,
      page: 2,
    },
    SOURCE: { kind: "SOURCE", sourceId: UUID },
  };

  it("parses every reference kind", () => {
    expect(Object.keys(REF_FIXTURES).sort()).toEqual(
      [...Q_EVIDENCE_REF_KINDS].sort(),
    );
    for (const [kind, fixture] of Object.entries(REF_FIXTURES)) {
      expect(QEvidenceRefSchema.safeParse(fixture).success, kind).toBe(true);
    }
  });

  it("rejects malformed references", () => {
    expect(
      QEvidenceRefSchema.safeParse({ kind: "DOCUMENT", documentId: "x" })
        .success,
    ).toBe(false);
    expect(
      QEvidenceRefSchema.safeParse({
        kind: "DOCUMENT",
        documentId: UUID,
        page: 0,
      }).success,
    ).toBe(false);
    expect(
      QEvidenceRefSchema.safeParse({ kind: "URL", url: "https://x" }).success,
    ).toBe(false);
    expect(QEvidenceRefSchema.safeParse({ evidenceItemId: UUID }).success).toBe(
      false,
    );
  });

  it("cannot carry evidence content or private source detail", () => {
    for (const leak of [
      { excerpt: "Cash at bank: 40,000" },
      { content: "..." },
      { text: "..." },
      { title: "Cash Crisis.xlsx" },
      { filename: "Cash Crisis.xlsx" },
      { sourceUrl: "https://drive.example/private" },
      { storageKey: "tenant/doc.pdf" },
      { signedUrl: "https://storage.example/?sig=..." },
      { metadata: { confidential: true } },
    ]) {
      expect(
        QEvidenceRefSchema.safeParse({
          ...(REF_FIXTURES.DOCUMENT as object),
          ...leak,
        }).success,
      ).toBe(false);
    }
  });

  it("bounds the number of references", () => {
    const refs = Array.from(
      { length: Q_EVIDENCE_REFS_MAX + 1 },
      () => evidenceRef,
    );
    expect(QEvidenceRefsSchema.safeParse(refs).success).toBe(false);
  });
});

describe("QFinding", () => {
  it("parses a public finding on the four independent axes", () => {
    const parsed = QPublicFindingSchema.parse(publicFinding);
    expect(parsed.truthClass).toBe("USER_CLAIM");
    expect(parsed.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
    expect(parsed.confidence).toBe("MODERATE");
  });

  it.each(Q_FINDING_TYPES)("accepts the finding type %s", (type) => {
    expect(
      QPublicFindingSchema.safeParse({ ...publicFinding, type }).success,
    ).toBe(true);
  });

  it("can express not knowing without a score", () => {
    expect(
      QPublicFindingSchema.safeParse({
        ...publicFinding,
        type: "UNCERTAINTY",
        statement: "Current burn could not be established.",
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
        confidence: "INSUFFICIENT_EVIDENCE",
        evidenceRefs: [],
      }).success,
    ).toBe(true);
    expect(
      QPublicFindingSchema.safeParse({ ...publicFinding, score: 42 }).success,
    ).toBe(false);
    expect(
      QPublicFindingSchema.safeParse({ ...publicFinding, confidence: 0.93 })
        .success,
    ).toBe(false);
  });

  it("keeps classification on the internal shape only", () => {
    const internal = {
      ...publicFinding,
      runId: UUID_2,
      sensitivity: "CONFIDENTIAL",
      visibilityScope: "founder_private",
    };
    expect(QInternalFindingSchema.safeParse(internal).success).toBe(true);
    expect(QPublicFindingSchema.safeParse(internal).success).toBe(false);
    expect(QInternalFindingSchema.safeParse(publicFinding).success).toBe(false);
  });

  it("has no field for reasoning", () => {
    for (const extra of [
      { reasoning: "..." },
      { chainOfThought: "..." },
      { scratchpad: "..." },
      { specialist: "founder" },
    ]) {
      expect(
        QPublicFindingSchema.safeParse({ ...publicFinding, ...extra }).success,
      ).toBe(false);
    }
  });
});

describe("QConfidenceLevel", () => {
  it("is the five-word vocabulary, each with a plain label", () => {
    expect([...Q_CONFIDENCE_LEVELS]).toEqual([
      "HIGH",
      "MODERATE",
      "LOW",
      "INSUFFICIENT_EVIDENCE",
      "CONFLICTING_EVIDENCE",
    ]);
    for (const level of Q_CONFIDENCE_LEVELS) {
      expect(qConfidenceLabel(level)).toBe(Q_CONFIDENCE_LABELS[level]);
      expect(qConfidenceLabel(level)).not.toMatch(/_|%|\d/);
    }
  });

  it("is never a number", () => {
    expect(QConfidenceLevelSchema.safeParse(93).success).toBe(false);
    expect(QConfidenceLevelSchema.safeParse("93%").success).toBe(false);
  });
});
