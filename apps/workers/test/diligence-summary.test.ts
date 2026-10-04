import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  disclosureGrantedEvent,
  PERMISSIONS_EVENTS,
} from "@capital-q/permissions/events";
import type { DisclosurePolicy } from "@capital-q/permissions";

import {
  diligenceDocumentOf,
  pagesOf,
  withDiligenceSummaries,
} from "../src/network/diligence-summary-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * 2026-10-04: Q reads a document once it is both shared in diligence and
 * read by the pipeline, and writes the requester one line, once per
 * version, from that version's own passages only.
 */

const registry = createEventRegistry([...PERMISSIONS_EVENTS]);
const DOC = "d0000000-0000-4000-8000-000000000001";
const VERSION = "e0000000-0000-4000-8000-000000000001";

const granted = (resourceType: string, scopeType: string) =>
  disclosureGrantedEvent({
    tenantId: TENANT_A,
    organisationId: undefined,
    actorUserId: "b0000000-0000-4000-8000-000000000001",
    correlationId: "cor_c0000000-0000-4000-8000-000000000001" as CorrelationId,
    policy: {
      id: "f0000000-0000-4000-8000-000000000001",
      resource: { type: resourceType, id: DOC },
      scopeType,
      accessLevel: "view",
    } as unknown as DisclosurePolicy,
  });
const message = (event: unknown): QueueMessage => ({
  msgId: 7,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});

function harness(options: { readonly eligible: boolean }) {
  const inserted: unknown[][] = [];
  const asked: {
    title: string;
    pages: number | null;
    passages: readonly string[];
  }[] = [];
  const fake = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("insert into network.diligence_document_summaries")) {
      inserted.push(values);
      return Promise.resolve([]);
    }
    if (text.includes("from evidence.documents")) {
      // The eligibility (shared, processed, unblocked, unsummarised) is the
      // query's own; the fake answers as the database would.
      expect(text).toContain("p.revoked_at is null");
      expect(text).toContain("malware_scan_status <> 'BLOCKED'");
      return Promise.resolve(
        options.eligible
          ? [
              {
                tenant_id: TENANT_A,
                title: "Pitch deck v3",
                version_id: VERSION,
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  const handle = withDiligenceSummaries(
    (): Promise<MessageOutcome> => Promise.resolve({ kind: "ACK" } as never),
    {
      registry,
      sql: fake as unknown as DatabaseExecutor,
      summariser: {
        summarise: (input) => {
          asked.push(input);
          return Promise.resolve(
            "Pitch deck · 14 slides · ARR $84k (self-reported)",
          );
        },
      },
      chunks: {
        listActiveByVersion: () =>
          Promise.resolve([
            { content: "Slide two", chunkIndex: 1, locator: { slide: 14 } },
            {
              content: "Ajopot — savings for markets",
              chunkIndex: 0,
              locator: { slide: 1 },
            },
          ]),
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, inserted, asked };
}

describe("diligence summaries", () => {
  it("reads only document shares made to a relationship", () => {
    expect(
      diligenceDocumentOf("permissions.disclosure.granted", {
        resourceType: "document",
        scopeType: "relationship_shared",
        resourceId: DOC,
      }),
    ).toBe(DOC);
    expect(
      diligenceDocumentOf("permissions.disclosure.granted", {
        resourceType: "document",
        scopeType: "network_visible",
        resourceId: DOC,
      }),
    ).toBeNull();
    expect(
      diligenceDocumentOf("evidence.document.ready", { documentId: "nope" }),
    ).toBeNull();
    expect(
      pagesOf([{ locator: { slide: 3 } }, { locator: { pageEnd: 9 } }]),
    ).toBe(9);
    expect(pagesOf([{ locator: {} }])).toBeNull();
  });

  it("summarises a shared, read version once, from its own passages in order", async () => {
    const h = harness({ eligible: true });
    await h.handle(message(granted("document", "relationship_shared")));
    expect(h.asked).toEqual([
      {
        title: "Pitch deck v3",
        pages: 14,
        passages: ["Ajopot — savings for markets", "Slide two"],
        attribution: expect.objectContaining({ tenantId: TENANT_A }) as unknown,
      },
    ]);
    expect(h.inserted).toEqual([
      [
        VERSION,
        TENANT_A,
        DOC,
        "Pitch deck · 14 slides · ARR $84k (self-reported)",
        1,
      ],
    ]);
  });

  it("writes nothing for a document that is not eligible", async () => {
    const h = harness({ eligible: false });
    await h.handle(message(granted("document", "relationship_shared")));
    expect(h.asked).toEqual([]);
    expect(h.inserted).toEqual([]);
  });
});
