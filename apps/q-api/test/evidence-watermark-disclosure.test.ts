import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import { createEvidenceWatermark } from "../src/composition/evidence-watermark.js";

/**
 * Replay of scenario D (live 2026-11-16, run d58a4564): Halyard's founder
 * fulfilled Thames Arc's bank-statement request (disclosure policy
 * 1a3a13c5, a fulfilment, a `document_shared` event on relationship
 * d8909e27), and Thames Arc's follow-up 47 s later reused the earlier reads
 * and said the request was "still outstanding". The investor's actor
 * carries its core organisation (7235ce5c), while the relationship names
 * the investor organisation (cfbc217a); the watermark compared the two
 * directly, and the fulfilment's rows live in the company's tenant. The
 * same read-only replay against the hosted database: the old query
 * answered `changed: false` for "since 11:46:30"; this one answers true,
 * and false again from 11:47:30 (nothing changed after the fulfilment).
 *
 * Here the query text and its bound values are checked, since the
 * database is not reachable from a unit test.
 */
function capture() {
  const seen: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    seen.push({ text: strings.join("$"), values });
    return Promise.resolve([{ changed: false }]);
  }) as unknown as DatabaseExecutor;
  return { sql, seen };
}

const investor = {
  tenantId: "47677daa-109b-4b92-add7-a5a94f91ed9c",
  userId: "fd9945d9-a463-4b01-949f-0be1aee9e5c8",
  organisationId: "7235ce5c-3727-4280-84b1-60ef78a8a253",
};

describe("the evidence watermark sees disclosure changes on their relationships", () => {
  it("resolves an investor's relationships through its investor organisation", async () => {
    const { sql, seen } = capture();
    await createEvidenceWatermark(sql)(investor, new Date(0));
    const text = seen[0]?.text ?? "";
    expect(text).toMatch(
      /investor_organisation_id in \(\s*select io\.id from core\.investor_organisations io\s+where io\.organisation_id = \$::uuid/u,
    );
    expect(seen[0]?.values).toContain(investor.organisationId);
  });

  it("counts a share, a fulfilment, a decline, a data-room decision or entry on those relationships", async () => {
    const { sql, seen } = capture();
    await createEvidenceWatermark(sql)(investor, new Date(0));
    const text = seen[0]?.text ?? "";
    for (const table of [
      "permissions.disclosure_policies",
      "network.diligence_requests",
      "network.diligence_fulfilments",
      "network.diligence_request_declines",
      "network.diligence_question_answers",
      "evidence.data_room_request_decisions",
      "evidence.data_room_entries",
    ]) {
      expect(text).toContain(table);
    }
    // Not scoped to the asker's tenant: the company's tenant holds them.
    expect(text).toMatch(
      /disclosure_policies p\s+where p\.recipient_type = 'RELATIONSHIP'\s+and p\.recipient_id in \(select id from mine\)/u,
    );
    expect(text).toContain("p.revoked_at >");
  });

  it("reuses when the database says nothing changed, and never on no answer", async () => {
    const { sql } = capture();
    expect(await createEvidenceWatermark(sql)(investor, new Date(0))).toBe(
      false,
    );
    const empty = (() => Promise.resolve([])) as unknown as DatabaseExecutor;
    expect(await createEvidenceWatermark(empty)(investor, new Date(0))).toBe(
      true,
    );
  });
});
