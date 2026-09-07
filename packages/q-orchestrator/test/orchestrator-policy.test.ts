import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { QRunIdSchema } from "@capital-q/contracts";
import { QOrchestrationVersionError } from "@capital-q/q-runtime";

import {
  assertResumableOrchestrationVersion,
  isResumableOrchestrationVersion,
  Q_CHECKPOINT_NAMESPACE,
  Q_GRAPH_STATE_FIELDS,
  Q_ORCHESTRATION_VERSION,
  Q_RESUMABLE_ORCHESTRATION_VERSIONS,
  QGraphStateSchema,
  threadIdForRun,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");

const RUN_ID = QRunIdSchema.parse("123e4567-e89b-12d3-a456-426614174000");

const STATE = {
  runId: RUN_ID,
  tenantId: "223e4567-e89b-12d3-a456-426614174000",
  actorUserId: "323e4567-e89b-12d3-a456-426614174000",
  actorOrganisationId: null,
  actorMembershipId: null,
  conversationId: "423e4567-e89b-12d3-a456-426614174000",
  capability: "INVESTIGATE",
  subjects: [],
  orchestrationVersion: Q_ORCHESTRATION_VERSION,
  correlationId: "cor_523e4567-e89b-12d3-a456-426614174000",
  preflight: null,
  context: null,
  contextPlan: null,
  retrieval: null,
  answer: null,
  answerFailure: null,
  modelPolicyVersion: null,
  promptBundleVersion: null,
  action: null,
  actionId: null,
  approvalId: null,
  actionFailure: null,
};

describe("orchestration version policy", () => {
  it("is a real, stable identifier the runs table accepts", () => {
    expect(Q_ORCHESTRATION_VERSION).toBe("q-orchestrator-v5");
    expect(Q_ORCHESTRATION_VERSION).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    );
    expect(Q_ORCHESTRATION_VERSION).not.toMatch(/latest/i);
  });

  it("resumes only versions it lists, and refuses the rest without guessing", () => {
    expect(
      Q_RESUMABLE_ORCHESTRATION_VERSIONS.has(Q_ORCHESTRATION_VERSION),
    ).toBe(true);
    expect(isResumableOrchestrationVersion(Q_ORCHESTRATION_VERSION)).toBe(true);
    expect(isResumableOrchestrationVersion("q-orchestrator-v1")).toBe(false);
    expect(isResumableOrchestrationVersion("q-orchestrator-v4")).toBe(false);
    expect(isResumableOrchestrationVersion("q-orchestrator-v6")).toBe(false);
    expect(isResumableOrchestrationVersion(null)).toBe(false);
    expect(() => assertResumableOrchestrationVersion(null)).toThrow(
      QOrchestrationVersionError,
    );
    try {
      assertResumableOrchestrationVersion("q-orchestrator-v0");
    } catch (error) {
      const versionError = error as QOrchestrationVersionError;
      expect(versionError.orchestrationVersion).toBe("q-orchestrator-v0");
      // The public sentence names no version, framework or status word.
      expect(versionError.message).not.toMatch(
        /v0|langgraph|checkpoint|AWAITING/i,
      );
    }
  });
});

describe("thread identity", () => {
  it("maps a run to its own id: unique, bounded, never user-chosen", () => {
    const threadId = threadIdForRun(RUN_ID);
    expect(String(threadId)).toBe(RUN_ID);
    expect(String(threadId).length).toBeLessThan(255);
    expect(Q_CHECKPOINT_NAMESPACE).toBe("");
  });
});

describe("graph state", () => {
  it("is identifiers, subjects and coded outcomes, nothing else", () => {
    expect(QGraphStateSchema.safeParse(STATE).success).toBe(true);
    expect([...Q_GRAPH_STATE_FIELDS].sort()).toEqual(
      [
        "action",
        "actionFailure",
        "actionId",
        "actorMembershipId",
        "actorOrganisationId",
        "actorUserId",
        "answer",
        "answerFailure",
        "approvalId",
        "modelPolicyVersion",
        "promptBundleVersion",
        "capability",
        "context",
        "contextPlan",
        "conversationId",
        "correlationId",
        "orchestrationVersion",
        "preflight",
        "retrieval",
        "runId",
        "subjects",
        "tenantId",
      ].sort(),
    );
  });

  it.each([
    ["the objective text", { objective: "How much runway does Apex have?" }],
    ["a message body", { messages: [{ role: "user", content: "x" }] }],
    ["a system prompt", { systemPrompt: "you are Q" }],
    ["a token", { accessToken: "eyJ..." }],
    ["a credential", { serviceRoleKey: "sb_secret" }],
    ["a provider response", { providerResponse: { choices: [] } }],
    ["a reasoning trace", { reasoning: "first I will..." }],
    ["a document", { document: { text: "confidential" } }],
    ["a model name", { model: "some-model" }],
  ])("has no place for %s", (_label, extra) => {
    expect(QGraphStateSchema.safeParse({ ...STATE, ...extra }).success).toBe(
      false,
    );
  });

  it("only records coded outcomes for the seams", () => {
    expect(
      QGraphStateSchema.safeParse({ ...STATE, answer: "Hello, I'm Q" }).success,
    ).toBe(false);
    expect(
      QGraphStateSchema.safeParse({ ...STATE, retrieval: "found 3 documents" })
        .success,
    ).toBe(false);
  });
});

describe("framework isolation", () => {
  it("keeps LangGraph out of every package but the adapter", () => {
    const packages = [
      "packages/contracts/package.json",
      "packages/q-runtime/package.json",
      "packages/companies/package.json",
      "packages/evidence/package.json",
      "packages/permissions/package.json",
      "apps/web/package.json",
    ];
    for (const file of packages) {
      const manifest = readFileSync(join(repo, file), "utf8");
      expect(manifest, file).not.toMatch(/langgraph|langchain/i);
    }
    const adapter = readFileSync(
      join(repo, "packages/q-orchestrator/package.json"),
      "utf8",
    );
    expect(adapter).toMatch(/@langchain\/langgraph"/);
    // No model SDK rides in with the engine.
    expect(adapter).not.toMatch(
      /anthropic|openai|google|groq|deepseek|openrouter/i,
    );
  });

  it("exposes no engine type from the port package's public surface", () => {
    const runtimeIndex = readFileSync(
      join(repo, "packages/q-runtime/src/application/orchestration.ts"),
      "utf8",
    );
    // Engine identifiers, not prose: the port may explain what it is not.
    expect(runtimeIndex).not.toMatch(
      /StateGraph|Command\(|interrupt\(|checkpoint_ns|thread_id|@langchain|BaseCheckpointSaver/,
    );
  });
});
