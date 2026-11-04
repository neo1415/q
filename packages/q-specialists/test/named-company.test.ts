import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QAnswerRequest } from "@capital-q/q-runtime";

import { createNamedCompanyPort } from "../src/named-company.js";

/**
 * Acceptance 2026-11-04 (J3): a company named in a document request is
 * read from the Capital Q record the person may open, under a plan the
 * Context Firewall gives for it; nothing is widened.
 */
const COMPANY = "d0000000-0000-4000-8000-00000000000d";

function request(): QAnswerRequest {
  return {
    runId: randomUUID(),
    actor: { userId: randomUUID() },
    correlationId: "cor_test",
    capability: "ANSWER",
    plan: { subjects: [] },
  } as unknown as QAnswerRequest;
}

describe("createNamedCompanyPort", () => {
  it("opens by name through open_page, then plans the record as a subject", async () => {
    const asked: unknown[] = [];
    const port = createNamedCompanyPort({
      open: (_request, target) => {
        asked.push(target);
        return Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: "COMPANY",
          id: COMPANY,
        });
      },
      firewall: {
        plan: (input) => {
          asked.push(input.subjects);
          return Promise.resolve({
            outcome: "AUTHORISED",
            plan: { planned: true },
          } as never);
        },
      },
    });
    const found = await port(request(), "Ledgerline");
    expect(asked).toEqual([
      { page: "COMPANY", name: "Ledgerline" },
      [{ kind: "COMPANY", companyId: COMPANY }],
    ]);
    expect(found).toEqual({
      subject: { kind: "COMPANY", companyId: COMPANY },
      plan: { planned: true },
    });
  });

  it("is null when no record opens, or the firewall does not authorise it", async () => {
    const none = createNamedCompanyPort({
      open: () => Promise.resolve(null),
      firewall: { plan: () => Promise.reject(new Error("not called")) },
    });
    expect(await none(request(), "Nobody")).toBeNull();
    const denied = createNamedCompanyPort({
      open: () =>
        Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: "COMPANY",
          id: COMPANY,
        }),
      firewall: {
        plan: () => Promise.resolve({ outcome: "DENIED" } as never),
      },
    });
    expect(await denied(request(), "Ledgerline")).toBeNull();
  });
});
