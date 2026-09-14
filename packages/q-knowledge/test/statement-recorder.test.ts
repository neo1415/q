import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import type { KnowledgeWriteResult } from "../src/knowledge/contracts.js";
import type { KnowledgeWriteCommand } from "../src/knowledge/write-gate.js";
import {
  createConversationStatementRecorder,
  quoteOccursIn,
  type ConversationStatement,
  type StatementEvidencePort,
} from "../src/q/statement-recorder.js";

/**
 * A person's clarification in a Q conversation becomes their recorded claim
 * (CQ-Q-RESEARCH-001 §20-§23, §40): only when the quoted words are theirs,
 * only through the Evidence owner and the Knowledge Write Gate, and never
 * as anything stronger than USER_CLAIM.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const RUN = "90000000-0000-4000-8000-000000000001";

const actor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const USER_TEXT =
  "Good catch — Kenya was only a pilot and ended last year. We are live in Nigeria and Ghana.";

const STATEMENT: ConversationStatement = {
  quote: "Kenya was only a pilot and ended last year",
  statement: "Kenya was a pilot market only; operations there ended in 2025.",
  knowledgeKey: "operations.market.kenya",
  validFrom: "2025-12-31",
};

function accepted(command: KnowledgeWriteCommand): KnowledgeWriteResult {
  return {
    outcome: "ACCEPTED",
    reason: "RECORDED",
    knowledgeKey: command.candidate.knowledgeKey,
    objectId: "k-1",
    status: "ACTIVE",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidenceClass: "LOW",
    visibilityScope: "founder_private",
    sensitivityClass: "CONFIDENTIAL",
    revisionNumber: 1,
    supportingSourceCount: 1,
    contradictionSetId: null,
    comparison: null,
  };
}

function harness(
  options: {
    readonly evidenceThrows?: boolean;
    readonly gateRejects?: boolean;
  } = {},
) {
  const sources: unknown[] = [];
  const items: unknown[] = [];
  const submitted: KnowledgeWriteCommand[] = [];
  const evidence: StatementEvidencePort = {
    registerStatementSource: (_actor, input) => {
      if (options.evidenceThrows === true) {
        return Promise.reject(new Error("PRIVATE-ERROR-DETAIL-DO-NOT-LEAK"));
      }
      sources.push(input);
      return Promise.resolve({ id: "src-1" });
    },
    createStatementItem: (_actor, input) => {
      items.push(input);
      return Promise.resolve({ id: "item-1" });
    },
  };
  const logs: string[] = [];
  const logger = {
    debug: (c: unknown, m: string) => logs.push(JSON.stringify([c, m])),
    info: (c: unknown, m: string) => logs.push(JSON.stringify([c, m])),
    warn: (c: unknown, m: string) => logs.push(JSON.stringify([c, m])),
    error: (c: unknown, m: string) => logs.push(JSON.stringify([c, m])),
    child: () => logger,
  };
  const recorder = createConversationStatementRecorder({
    evidence,
    gate: {
      submit: (command) => {
        submitted.push(command);
        const rejected: KnowledgeWriteResult = {
          ...accepted(command),
          outcome: "REJECTED",
          reason: "SCOPE_NOT_PERMITTED",
          objectId: null,
          status: null,
        };
        return Promise.resolve(
          options.gateRejects === true ? rejected : accepted(command),
        );
      },
    },
    clock: () => new Date("2026-09-14T10:00:00.000Z"),
    logger,
  });
  return { recorder, sources, items, submitted, logs };
}

const command = (statement = STATEMENT, userText = USER_TEXT) => ({
  actor,
  companyId: COMPANY,
  runId: RUN,
  userText,
  statement,
  correlationId: "cor_test" as const,
});

describe("quoteOccursIn", () => {
  it("matches the person's words regardless of case, spacing and curly apostrophes", () => {
    expect(quoteOccursIn("kenya was ONLY a pilot", USER_TEXT)).toBe(true);
    expect(quoteOccursIn("we’re live", "We're live in Ghana")).toBe(true);
    expect(quoteOccursIn("Kenya   was only", USER_TEXT)).toBe(true);
  });

  it("rejects a paraphrase, a fragment too short to mean anything, and an over-long quote", () => {
    expect(quoteOccursIn("Kenya operations ceased in 2025", USER_TEXT)).toBe(
      false,
    );
    expect(quoteOccursIn("K", USER_TEXT)).toBe(false);
    expect(quoteOccursIn("x".repeat(401), "x".repeat(500))).toBe(false);
  });
});

describe("conversation statement recorder", () => {
  it("records the person's own words as USER_STATEMENT evidence and a USER_CLAIM candidate through the gate", async () => {
    const h = harness();
    const outcome = await h.recorder.record(command());
    expect(outcome.recorded).toBe(true);
    expect(h.sources).toEqual([
      {
        companyId: COMPANY,
        title: "Clarification in a Q conversation",
        externalReference: `q-run:${RUN}`,
      },
    ]);
    expect(h.items).toEqual([
      {
        sourceId: "src-1",
        evidenceType: "statement.operations.market.kenya",
        summary: STATEMENT.quote,
        validFrom: "2025-12-31T00:00:00.000Z",
      },
    ]);
    expect(h.submitted).toHaveLength(1);
    const submitted = h.submitted[0];
    expect(submitted?.automatic).toBe(true);
    expect(submitted?.candidate).toMatchObject({
      subject: { subjectType: "COMPANY", subjectId: COMPANY },
      knowledgeType: "fact",
      knowledgeKey: "operations.market.kenya",
      statement: STATEMENT.statement,
      truthClassProposal: "USER_CLAIM",
      supportingEvidenceItemIds: ["item-1"],
      supportingSourceIds: ["src-1"],
      validFrom: "2025-12-31T00:00:00.000Z",
      validTo: null,
      reason: "USER_CLARIFIED_IN_CONVERSATION",
    });
    // Never proposed as anything verified.
    expect(submitted?.candidate.truthClassProposal).not.toBe("VERIFIED");
  });

  it("records nothing when the quote is not in the person's message", async () => {
    const h = harness();
    const outcome = await h.recorder.record(
      command({ ...STATEMENT, quote: "Kenya operations ceased in 2025" }),
    );
    expect(outcome).toEqual({
      recorded: false,
      reason: "QUOTE_NOT_IN_MESSAGE",
    });
    expect(h.sources).toHaveLength(0);
    expect(h.submitted).toHaveLength(0);
  });

  it("refuses a malformed key, an empty statement or an unparseable date before touching evidence", async () => {
    const h = harness();
    for (const bad of [
      { ...STATEMENT, knowledgeKey: "Operations.Market" },
      { ...STATEMENT, knowledgeKey: "drop table;" },
      { ...STATEMENT, statement: "   " },
      { ...STATEMENT, validFrom: "last year" },
    ]) {
      const outcome = await h.recorder.record(command(bad));
      expect(outcome).toEqual({ recorded: false, reason: "INVALID_STATEMENT" });
    }
    expect(h.sources).toHaveLength(0);
    expect(h.submitted).toHaveLength(0);
  });

  it("degrades an evidence refusal to a reason code and never logs the error detail", async () => {
    const h = harness({ evidenceThrows: true });
    const outcome = await h.recorder.record(command());
    expect(outcome).toEqual({ recorded: false, reason: "EVIDENCE_REFUSED" });
    expect(h.submitted).toHaveLength(0);
    expect(h.logs.join("\n")).not.toContain("PRIVATE-ERROR-DETAIL");
  });

  it("reports a gate rejection as KNOWLEDGE_REFUSED with the gate's result", async () => {
    const h = harness({ gateRejects: true });
    const outcome = await h.recorder.record(command());
    expect(outcome.recorded).toBe(false);
    if (outcome.recorded) {
      throw new Error("unreachable");
    }
    expect(outcome.reason).toBe("KNOWLEDGE_REFUSED");
    expect(outcome.result?.outcome).toBe("REJECTED");
  });

  it("dates a current statement at the clock when no period is given", async () => {
    const h = harness();
    await h.recorder.record(command({ ...STATEMENT, validFrom: null }));
    expect(h.submitted[0]?.candidate.validFrom).toBe(
      "2026-09-14T10:00:00.000Z",
    );
    expect(h.items[0]).toMatchObject({ validFrom: null });
  });
});
