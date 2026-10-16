import { describe, expect, it } from "vitest";

import { createPostgresDocumentPageTextReader } from "../src/infrastructure/postgres-extraction-repository.js";

/**
 * ob2 2026-10-16: an investor's fund deck is read from its own extracted
 * pages. The read names the owning organisation on the extraction and on
 * the pages, so another organisation's document reads nothing.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001";
const FIRM = "c0000000-0000-4000-8000-000000000001";
const DOCUMENT = "d0000000-0000-4000-8000-000000000001";
const VERSION = "e0000000-0000-4000-8000-000000000001";

function recordingExecutor(rows: readonly unknown[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const executor = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join("$"), values });
    return Promise.resolve(rows);
  };
  return { executor: executor as never, calls };
}

describe("document page text reader", () => {
  it("reads the newest extraction's pages, scoped by tenant, document, version and owner", async () => {
    const { executor, calls } = recordingExecutor([
      { text: "Page one" },
      { text: "Page two" },
    ]);
    const pages = await createPostgresDocumentPageTextReader().listByVersion(
      executor,
      TENANT,
      {
        documentId: DOCUMENT,
        documentVersionId: VERSION,
        ownerOrganisationId: FIRM,
      },
    );
    expect(pages).toEqual([{ text: "Page one" }, { text: "Page two" }]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    const sql = (call?.sql ?? "").replace(/\s+/g, " ");
    // The owner is a predicate on the extraction and on the pages alike.
    expect(sql).toContain("x.owner_organisation_id = $");
    expect(sql).toContain("p.owner_organisation_id = $");
    expect(sql).toContain("x.tenant_id = $");
    expect(sql).toContain("p.tenant_id = $");
    expect(sql).toContain("x.document_version_id = $");
    expect(sql).toContain("limit 1");
    expect(sql).not.toContain("q_knowledge");
    expect(call?.values.filter((value) => value === FIRM)).toHaveLength(2);
    expect(call?.values.filter((value) => value === TENANT)).toHaveLength(2);
  });

  it("rejects a row that is not page text", async () => {
    const { executor } = recordingExecutor([{ content: "a passage" }]);
    await expect(
      createPostgresDocumentPageTextReader().listByVersion(executor, TENANT, {
        documentId: DOCUMENT,
        documentVersionId: VERSION,
        ownerOrganisationId: FIRM,
      }),
    ).rejects.toThrow();
  });
});
