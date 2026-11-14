import { describe, expect, it } from "vitest";

import { CreateDocumentUploadSessionRequestSchema } from "@capital-q/contracts";

import { storyText } from "../src/dev/fictional-world/accounts.js";
import { FICTIONAL_COMPANIES } from "../src/dev/fictional-world/companies.js";
import {
  applicantPlan,
  assertFictionalEmail,
  assertRunId,
  newRunId,
} from "../src/dev/fictional-world/gateq-applicant-plan.js";

/**
 * The run-scoped GateQ applicant (deterministic; no network). What makes
 * it safe to run again and again: the email is always on the fictional
 * domain, each run is a distinct company, and nothing is borrowed that
 * could be mistaken for a seeded company.
 */
describe("GateQ applicant plan", () => {
  it("names the run-scoped founder on the fictional domain", () => {
    const plan = applicantPlan("ab12cd34");
    expect(plan.email).toBe("founder.gq-ab12cd34@fictional.capitalq.local");
    expect(plan.company.key).toBe("gq-ab12cd34");
  });

  it("refuses any email that is not @fictional.capitalq.local", () => {
    for (const email of [
      "founder@capitalq.com",
      "someone@gmail.com",
      "founder@fictional.capitalq.local.evil.com",
      "founder@notfictional.capitalq.local",
      "",
    ]) {
      expect(() => assertFictionalEmail(email)).toThrow(/fictional/);
    }
    expect(
      assertFictionalEmail("founder.gq-x1y2@fictional.capitalq.local"),
    ).toBe("founder.gq-x1y2@fictional.capitalq.local");
  });

  it("refuses a run id that could change the address", () => {
    for (const id of [
      "",
      "abc",
      "AB12",
      "a@b.com",
      "x".repeat(25),
      "a b c d",
    ]) {
      expect(() => assertRunId(id)).toThrow();
    }
    expect(() => applicantPlan("ev@il.com")).toThrow();
  });

  it("gives each run its own company, clearly fictional", () => {
    const a = applicantPlan("run0001a");
    const b = applicantPlan("run0002b");
    expect(a.company.name).not.toBe(b.company.name);
    const seededNames = new Set(FICTIONAL_COMPANIES.map((c) => c.name));
    expect(seededNames.has(a.company.name)).toBe(false);
    expect(a.company.legalName).toContain("fictional");
    expect(new URL(a.company.website).hostname.endsWith(".example")).toBe(true);
    expect(a.company.shortDescription.length).toBeLessThanOrEqual(400);
    const story = storyText(a.company);
    expect(story.startsWith("Fictional demo company.")).toBe(true);
    // Nothing of the template's own story is carried over.
    const template = FICTIONAL_COMPANIES[0];
    expect(story).not.toContain(template?.name ?? "--");
    expect(a.company.claims).toEqual([]);
  });

  it("uploads one owned document the documents contract accepts", () => {
    const plan = applicantPlan("doc0001x");
    const request = CreateDocumentUploadSessionRequestSchema.parse({
      companyId: "a0000000-0000-4000-8000-000000000001",
      documentType: plan.document.documentType,
      title: plan.document.title,
      filename: plan.document.filename,
      declaredMimeType: plan.document.mimeType,
      declaredSizeBytes: new TextEncoder().encode(plan.document.body)
        .byteLength,
    });
    expect(request.title).toContain("fictional");
    expect(plan.document.body).toContain("FICTIONAL");
  });

  it("makes fresh run ids that pass its own check", () => {
    let n = 0;
    const id = newRunId(() => ((n += 7) % 36) / 36);
    expect(assertRunId(id)).toBe(id);
  });
});
