import { describe, expect, it } from "vitest";

import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import { callbackCandidates } from "../src/memory/callbacks.js";
import type { MemoryItem } from "../src/memory/contracts.js";

/**
 * HQ-7: what Q may call back to is only what this person said, in this
 * tenant and this run's scope. Never another tenant's memory, never
 * another person's words, never Q's own reading of them.
 */

const TENANT = TenantIdSchema.parse("00000000-0000-4000-8000-0000000000a1");
const OTHER_TENANT = TenantIdSchema.parse(
  "00000000-0000-4000-8000-0000000000b1",
);
const ME = UserIdSchema.parse("00000000-0000-4000-8000-0000000000c1");
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000c2";
const COMPANY = "00000000-0000-4000-8000-0000000000d1";
const OTHER_COMPANY = "00000000-0000-4000-8000-0000000000d2";
const now = "2026-11-21T00:00:00.000Z";

let next = 0;
function item(overrides: Partial<MemoryItem>): MemoryItem {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    tenantId: TENANT,
    ownerContextType: "user",
    ownerContextId: ME,
    subject: null,
    memoryType: "preference",
    memoryKey: `key_${String(next)}`,
    content: "Prefers seed rounds in West African logistics",
    structuredValue: {},
    quote: null,
    contentSha256: "a".repeat(64),
    sourceConversationId: null,
    sourceRunId: null,
    writeMode: "USER_CONFIRMED",
    status: "active",
    supersededBy: null,
    validFrom: now,
    validTo: null,
    lastUsedAt: null,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const scope = {
  actor: { tenantId: TENANT, userId: ME },
  subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
};

describe("memory callbacks: only what this person said, in this scope", () => {
  it("offers their own fact, preference or correction", () => {
    const out = callbackCandidates(
      [
        item({ memoryType: "preference" }),
        item({
          memoryType: "fact",
          content: "Their typical cheque is $250,000",
        }),
        item({
          memoryType: "correction",
          content: "Their name is said Zee-no",
        }),
      ],
      scope,
    );
    expect(out.map((one) => one.memoryType)).toEqual([
      "preference",
      "fact",
      "correction",
    ]);
  });

  it("never another tenant's memory (cross-tenant negative)", () => {
    expect(
      callbackCandidates([item({ tenantId: OTHER_TENANT })], scope),
    ).toEqual([]);
  });

  it("never another person's words, nor an organisation's", () => {
    expect(
      callbackCandidates(
        [
          item({ ownerContextId: SOMEONE_ELSE }),
          item({ ownerContextType: "organisation", ownerContextId: ME }),
        ],
        scope,
      ),
    ).toEqual([]);
  });

  it("never Q's own reading of their words, small talk or episodes", () => {
    expect(
      callbackCandidates(
        [
          item({
            writeMode: "Q_PROPOSED",
            content: "Seems to prefer founders with technical backgrounds",
            quote: "I liked the CTO a lot",
          }),
          item({ memoryType: "episodic" }),
          item({ memoryType: "small_talk" }),
        ],
        scope,
      ),
    ).toEqual([]);
  });

  it("an item about another company never surfaces in this run", () => {
    const about = (companyId: string) =>
      item({ subject: { subjectType: "COMPANY", subjectId: companyId } });
    expect(
      callbackCandidates([about(OTHER_COMPANY)], scope).map((c) => c.content),
    ).toEqual([]);
    expect(callbackCandidates([about(COMPANY)], scope)).toHaveLength(1);
  });

  it("nothing forgotten, revoked or superseded", () => {
    expect(
      callbackCandidates(
        [
          item({ status: "forgotten" }),
          item({ status: "revoked" }),
          item({ status: "superseded" }),
        ],
        scope,
      ),
    ).toEqual([]);
  });
});
