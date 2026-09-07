import { describe, expect, it } from "vitest";

import {
  QActionBindingEnvelopeSchema,
  type QActionBindingEnvelope,
} from "@capital-q/contracts";

import {
  bindingEnvelope,
  hashBindingEnvelope,
  hashesMatch,
} from "../src/index.js";

/**
 * Exact-payload binding (CQ-Q-008 §23-§30, §117). What an approval binds to
 * is every field whose change alters the consequence — and nothing
 * volatile. Same meaning, same fingerprint; any material change, a
 * different one.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const ACTION = "44444444-4444-4444-8444-444444444444";
const COMPANY = "55555555-5555-4555-8555-555555555555";
const SARAH = "66666666-6666-4666-8666-666666666666";
const MARKER = "APPROVAL-PAYLOAD-PRIVATE-DO-NOT-LEAK";

function envelope(
  overrides: Partial<QActionBindingEnvelope> = {},
): QActionBindingEnvelope {
  return bindingEnvelope({
    bindingVersion: 1,
    tenantId: TENANT,
    organisationId: ORG,
    runId: RUN as QActionBindingEnvelope["runId"],
    actionId: ACTION as QActionBindingEnvelope["actionId"],
    actionType: "message.send",
    actionVersion: 1,
    actionClass: "CONFIRM_REQUIRED",
    targets: [
      { kind: "COMPANY", companyId: COMPANY },
      { kind: "USER", userId: SARAH },
    ],
    payload: {
      recipient: "sarah@example.test",
      subject: "Meeting",
      body: `Hi Sarah, we'd like to arrange a meeting. ${MARKER}`,
      attachments: ["doc-1"],
    },
    ...overrides,
  });
}

describe("payload binding hash", () => {
  it("is a sha256 fingerprint that never contains the payload", () => {
    const hash = hashBindingEnvelope(envelope());
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).not.toContain(MARKER);
    expect(hash).not.toContain("Sarah");
  });

  it("does not depend on property insertion order", () => {
    const reordered = envelope({
      payload: {
        attachments: ["doc-1"],
        body: `Hi Sarah, we'd like to arrange a meeting. ${MARKER}`,
        subject: "Meeting",
        recipient: "sarah@example.test",
      },
    });
    expect(hashBindingEnvelope(reordered)).toBe(
      hashBindingEnvelope(envelope()),
    );
  });

  it("changes when the recipient, body, attachments, targets, version, class, organisation or tenant change", () => {
    const original = hashBindingEnvelope(envelope());
    const changes: Partial<QActionBindingEnvelope>[] = [
      { payload: { ...envelope().payload, recipient: "mallory@example.test" } },
      {
        payload: {
          ...envelope().payload,
          body: "Here is our confidential cap table.",
        },
      },
      {
        payload: { ...envelope().payload, attachments: ["doc-1", "cap-table"] },
      },
      { targets: [{ kind: "COMPANY", companyId: COMPANY }] },
      {
        targets: [
          {
            kind: "COMPANY",
            companyId: "77777777-7777-4777-8777-777777777777",
          },
          { kind: "USER", userId: SARAH },
        ],
      },
      { actionVersion: 2 },
      { actionType: "email.send" },
      { actionClass: "RESTRICTED" },
      { organisationId: null },
      { tenantId: "99999999-9999-4999-8999-999999999999" },
      {
        runId:
          "88888888-8888-4888-8888-888888888888" as QActionBindingEnvelope["runId"],
      },
    ];
    const seen = new Set<string>([original]);
    for (const change of changes) {
      const hash = hashBindingEnvelope(envelope(change));
      expect(hash, JSON.stringify(change)).not.toBe(original);
      expect(seen.has(hash), JSON.stringify(change)).toBe(false);
      seen.add(hash);
    }
  });

  it("refuses volatile or unknown envelope fields, so timestamps and trace ids can never enter the binding", () => {
    expect(
      QActionBindingEnvelopeSchema.safeParse({
        ...envelope(),
        createdAt: "2026-09-05T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      QActionBindingEnvelopeSchema.safeParse({
        ...envelope(),
        requestId: "req_1",
      }).success,
    ).toBe(false);
    expect(
      QActionBindingEnvelopeSchema.safeParse({ ...envelope(), targets: [] })
        .success,
    ).toBe(false);
    expect(
      QActionBindingEnvelopeSchema.safeParse({
        ...envelope(),
        bindingVersion: 2,
      }).success,
    ).toBe(false);
  });

  it("compares fingerprints without leaking length information as a match", () => {
    const a = hashBindingEnvelope(envelope());
    expect(hashesMatch(a, a)).toBe(true);
    expect(
      hashesMatch(a, hashBindingEnvelope(envelope({ actionVersion: 2 }))),
    ).toBe(false);
    expect(hashesMatch(a, a.slice(0, -1))).toBe(false);
    expect(hashesMatch(a, "")).toBe(false);
  });
});
