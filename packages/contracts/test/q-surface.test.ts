import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.js";
import * as q from "../src/q/index.js";
import {
  Q_RESULT_BLOCK_KINDS,
  QResultBlockSchema,
  type QResultBlock,
} from "../src/q/result-block.js";
import { QRunSummarySchema } from "../src/q/run.js";
import { QStreamEventSchema } from "../src/q/stream.js";
import { type QSubjectRef } from "../src/q/subject.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const NOW = "2026-09-05T10:00:00Z";
const MARKER = "PRIVATE-Q-DIAGNOSTIC-DO-NOT-EMIT";

/**
 * Keys that name an implementation concept or a private payload. No public
 * Q schema may accept any of them, at any depth.
 */
const FORBIDDEN_KEYS = [
  "langgraphNode",
  "node",
  "graphState",
  "checkpoint",
  "checkpointId",
  "threadId",
  "providerThreadId",
  "agentName",
  "specialist",
  "internalPromptId",
  "promptId",
  "prompt",
  "systemPrompt",
  "chainOfThought",
  "reasoning",
  "scratchpad",
  "thinking",
  "model",
  "provider",
  "providerResponse",
  "rawResponse",
  "stack",
  "sql",
  "apiKey",
  "serviceRoleKey",
  "payload",
  "arguments",
  "metadata",
  "tenantId",
  "sensitivity",
  "visibilityScope",
  "diagnosticCode",
  "detail",
];

function collectKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
  return into;
}

/** A complete public run: every block kind, so every public path is exercised. */
const completedRun = {
  runId: UUID,
  conversationId: UUID_2,
  capability: "INVESTIGATE",
  status: "COMPLETED",
  visibleStage: null,
  subjects: [{ kind: "COMPANY", companyId: UUID }],
  results: [
    { kind: "TEXT", text: "Runway is approximately 14 months." },
    { kind: "COMPANY_REFERENCE", companyId: UUID },
    { kind: "INVESTOR_REFERENCE", investorOrganisationId: UUID_2 },
    {
      kind: "COMPARISON",
      subjects: [
        { kind: "COMPANY", companyId: UUID },
        { kind: "COMPANY", companyId: UUID_2 },
      ],
      rows: [{ label: "Stage", values: ["Seed", "Series A"] }],
    },
    {
      kind: "EVIDENCE",
      evidenceRefs: [{ kind: "DOCUMENT", documentId: UUID, page: 3 }],
    },
    {
      kind: "FINDING",
      finding: {
        findingId: UUID,
        type: "FACT",
        statement: "ARR was reported as GBP 1.2m.",
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        confidence: "MODERATE",
        evidenceRefs: [{ kind: "CLAIM", claimId: UUID }],
        subjects: [{ kind: "COMPANY", companyId: UUID }],
      },
    },
    {
      kind: "UNCERTAINTY",
      statement: "Current burn could not be established.",
      confidence: "INSUFFICIENT_EVIDENCE",
    },
    { kind: "CLARIFICATION_REQUEST", question: "Which Apex do you mean?" },
    {
      kind: "ACTION_PROPOSAL",
      proposal: {
        contractVersion: 1,
        proposalId: UUID,
        runId: UUID,
        actionType: "message.send",
        actionClass: "CONFIRM_REQUIRED",
        targets: [
          { kind: "INVESTOR_ORGANISATION", investorOrganisationId: UUID_2 },
        ],
        summary: "Send an introduction to Northgate Capital.",
        approval: { required: true },
        status: "PROPOSED",
        createdAt: NOW,
      },
    },
    { kind: "UI_INTENT", intent: { kind: "OPEN_COMPANY", companyId: UUID } },
  ],
  createdAt: NOW,
  startedAt: NOW,
  completedAt: NOW,
};

describe("public Q surface", () => {
  it("is exported from the package root and from the q entrypoint alike", () => {
    for (const name of [
      "CreateQRunRequestSchema",
      "QRequestContextSchema",
      "QRequestEnvelopeSchema",
      "QRunStatusSchema",
      "QVisibleStageSchema",
      "QMessageSchema",
      "QResultBlockSchema",
      "QEvidenceRefSchema",
      "QPublicFindingSchema",
      "QUiIntentSchema",
      "QActionProposalSchema",
      "QApprovalRefSchema",
      "QStreamEventSchema",
      "QPublicFailureSchema",
      "toPublicQFailure",
      "QRunHandleSchema",
      "QRunSummarySchema",
      "QSubjectRefSchema",
      "Q_CONTRACT_VERSION",
    ]) {
      expect(name in contracts, name).toBe(true);
      expect(name in q, name).toBe(true);
    }
  });

  it("serialises a complete public run with no implementation or private key", () => {
    const parsed = QRunSummarySchema.parse(completedRun);
    const keys = collectKeys(JSON.parse(JSON.stringify(parsed)), new Set());

    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    // And the fixture really did exercise every block kind.
    const kinds = new Set(parsed.results?.map((block) => block.kind));
    expect([...kinds].sort()).toEqual([...Q_RESULT_BLOCK_KINDS].sort());
  });

  it("rejects the private marker wherever a client could try to smuggle it in", () => {
    // Every public schema is strict, so an unknown key carrying the marker
    // fails; and no known public field is a free-form bag that would accept it.
    for (const poisoned of [
      { ...completedRun, detail: MARKER },
      { ...completedRun, metadata: { note: MARKER } },
      {
        ...completedRun,
        results: [{ kind: "TEXT", text: "ok", debug: MARKER }],
      },
      {
        ...completedRun,
        subjects: [{ kind: "COMPANY", companyId: UUID, note: MARKER }],
      },
    ]) {
      expect(QRunSummarySchema.safeParse(poisoned).success).toBe(false);
    }
  });

  it("carries no provider, framework or model vocabulary in its public event stream", () => {
    const event = QStreamEventSchema.parse({
      contractVersion: 1,
      eventId: UUID,
      runId: UUID_2,
      sequence: 7,
      occurredAt: NOW,
      type: "q.run.failed",
      data: {
        status: "FAILED",
        failure: q.toPublicQFailure(
          {
            diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE",
            detail: MARKER,
            occurredAt: NOW,
          },
          { runId: UUID_2 },
        ),
      },
    });

    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain(MARKER);
    expect(serialised).not.toMatch(
      /langgraph|openai|anthropic|gemini|claude|gpt/i,
    );
    expect(
      collectKeys(JSON.parse(serialised), new Set()).has("diagnosticCode"),
    ).toBe(false);
  });

  it("keeps the enum vocabularies free of internal names", () => {
    for (const value of [
      ...q.Q_CAPABILITIES,
      ...q.Q_VISIBLE_STAGES,
      ...q.Q_RESULT_BLOCK_KINDS,
      ...q.Q_STREAM_EVENT_TYPES,
      ...q.Q_PUBLIC_FAILURE_CODES,
      ...q.Q_UI_INTENT_KINDS,
    ]) {
      expect(value).not.toMatch(
        /agent|langgraph|node|prompt|openai|anthropic|specialist|thought/i,
      );
    }
  });
});

describe("type-level guarantees", () => {
  it("discriminates the result block union exhaustively", () => {
    const kindOf = (block: QResultBlock): string => {
      switch (block.kind) {
        case "TEXT":
          return block.text;
        case "COMPANY_REFERENCE":
          return block.companyId;
        case "INVESTOR_REFERENCE":
          return block.investorOrganisationId;
        case "COMPARISON":
          return String(block.rows.length);
        case "EVIDENCE":
          return String(block.evidenceRefs.length);
        case "FINDING":
          return block.finding.findingId;
        case "UNCERTAINTY":
          return block.confidence;
        case "CLARIFICATION_REQUEST":
          return block.question;
        case "ACTION_PROPOSAL":
          return block.proposal.proposalId;
        case "UI_INTENT":
          return block.intent.kind;
        default: {
          const unreachable: never = block;
          return unreachable;
        }
      }
    };

    expect(kindOf(QResultBlockSchema.parse({ kind: "TEXT", text: "x" }))).toBe(
      "x",
    );
  });

  it("types subject references by kind and field together", () => {
    const company: QSubjectRef = { kind: "COMPANY", companyId: UUID };

    const mismatched = {
      kind: "COMPANY" as const,
      investorOrganisationId: UUID,
    };

    // @ts-expect-error a COMPANY subject carries companyId, never an investor id
    const wrong: QSubjectRef = mismatched;

    expect(company.kind).toBe("COMPANY");
    expect(wrong.kind).toBe("COMPANY");
  });
});
