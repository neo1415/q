import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createReadOwnDocumentText } from "../src/application/extraction-use-cases.js";
import { EXTRACTION_SCHEMA_VERSION } from "../src/contracts/extraction.js";

/**
 * ob2 2026-10-16: an unpaged document (a Word or plain-text thesis) has no
 * pages, so its owner's onboarding reads its stored extraction instead,
 * scoped by tenant, document, version and owning organisation.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001";
const FIRM = "c0000000-0000-4000-8000-000000000001";
const OTHER_FIRM = "c0000000-0000-4000-8000-000000000002";
const DOCUMENT = "d0000000-0000-4000-8000-000000000001";
const VERSION = "e0000000-0000-4000-8000-000000000001";

function artifactBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      sourceId: null,
      documentId: DOCUMENT,
      documentVersionId: VERSION,
      processingRunId: "f1000000-0000-4000-8000-000000000001",
      pipelineVersion: "pipeline-test",
      extractorId: "docx",
      extractorVersion: "1",
      extractedAt: "2026-10-16T12:00:00.000Z",
      // A Word file: no block carries a page or a slide.
      blocks: [
        {
          kind: "heading",
          level: 1,
          text: "Fund I thesis",
          locator: { index: 0 },
        },
        {
          kind: "paragraph",
          text: "We invest at seed in fintech across Kenya.",
          locator: { index: 1 },
        },
      ],
      metadata: { parser: "docx", parserVersion: "1" },
      ...overrides,
    }),
  );
}

function world(options: {
  owner?: string | null;
  body?: Buffer;
  recordedSha?: string;
}) {
  const body = options.body ?? artifactBody();
  const opened: string[] = [];
  const extraction = {
    id: "e2000000-0000-4000-8000-000000000001",
    tenantId: TENANT,
    ownerOrganisationId: options.owner === undefined ? FIRM : options.owner,
    documentId: DOCUMENT,
    documentVersionId: VERSION,
    artifactBucket: "private",
    artifactKey: "extractions/thesis.json",
    artifactSha256:
      options.recordedSha ?? createHash("sha256").update(body).digest("hex"),
  };
  const read = createReadOwnDocumentText({
    sql: {} as never,
    transactions: {} as never,
    outbox: {} as never,
    repositories: {
      documentExtractions: {
        listByVersion: () => Promise.resolve([extraction]),
      },
    } as never,
    storage: {
      openObjectStream: (object: { key: string }) => {
        opened.push(object.key);
        return Promise.resolve({
          body: (async function* () {
            // A stream arrives a chunk at a time.
            await Promise.resolve();
            yield new Uint8Array(body);
          })(),
        });
      },
    } as never,
  });
  return { read, opened };
}

const query = {
  tenantId: TENANT,
  documentId: DOCUMENT,
  documentVersionId: VERSION,
  ownerOrganisationId: FIRM,
  maxChars: 12_000,
};

describe("reading an organisation's own unpaged document", () => {
  it("reads a Word thesis's text from its extraction, in block order", async () => {
    const { read, opened } = world({});
    await expect(read(query)).resolves.toBe(
      "Fund I thesis\n\nWe invest at seed in fintech across Kenya.",
    );
    expect(opened).toEqual(["extractions/thesis.json"]);
  });

  it("bounds what it returns", async () => {
    const { read } = world({});
    await expect(read({ ...query, maxChars: 13 })).resolves.toBe(
      "Fund I thesis",
    );
  });

  it.each([
    ["another firm's", OTHER_FIRM],
    ["an unowned", null],
  ])("never opens %s extraction", async (_label, owner) => {
    const { read, opened } = world({ owner });
    await expect(read(query)).resolves.toBe("");
    expect(opened).toEqual([]);
  });

  it("reads nothing from an artifact that names another version", async () => {
    const { read } = world({
      body: artifactBody({
        documentVersionId: "e0000000-0000-4000-8000-000000000009",
      }),
    });
    await expect(read(query)).resolves.toBe("");
  });

  it("refuses an artifact that does not match its recorded hash", async () => {
    const { read } = world({ recordedSha: "0".repeat(64) });
    await expect(read(query)).rejects.toThrow(/hash/);
  });
});
