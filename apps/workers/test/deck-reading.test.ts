import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createEventRegistry,
  DECK_SECTIONS,
  type DeckSectionReading,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";

import { backfillDeckReadings } from "../src/evidence/deck-reading-backfill.js";
import {
  checkUnreadDecks,
  readyDocumentOf,
  withDeckReadings,
} from "../src/evidence/deck-reading-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Overnight A5: once the pipeline has read a pitch deck, Q reads it into
 * the twelve sections, once per version, from that version's own passages
 * in order with their slides, and nothing else.
 */

const registry = createEventRegistry([...EVIDENCE_EVENTS]);
const DOC = "d0000000-0000-4000-8000-000000000011";
const VERSION = "e0000000-0000-4000-8000-000000000011";
const COMPANY = "c0000000-0000-4000-8000-000000000011";

const ready = (): QueueMessage => ({
  msgId: 9,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: {
    specVersion: "1.0",
    id: randomUUID(),
    type: "evidence.document.ready",
    source: "capitalq://api/evidence",
    time: new Date().toISOString(),
    subject: `document/${DOC}`,
    dataContentType: "application/json",
    eventVersion: 1,
    tenantId: TENANT_A,
    actor: { type: "SYSTEM", id: "workers" },
    correlationId: "cor_c0000000-0000-4000-8000-000000000011",
    aggregate: { type: "document", id: DOC },
    data: {
      documentId: DOC,
      documentVersionId: VERSION,
      processingRunId: "f0000000-0000-4000-8000-000000000011",
      pipelineVersion: "v1",
    },
  },
});

function harness(
  eligible: boolean,
  behaviour: {
    readonly model?: "ok" | "empty";
    readonly insert?: "ok" | "throws";
    readonly spentUsd?: number;
  } = {},
) {
  const logger = createRecordingLogger();
  const stored: unknown[] = [];
  const asked: {
    pages: number | null;
    passages: readonly { content: string; slide: number | null }[];
  }[] = [];
  const fake = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("make_interval")) {
      return Promise.resolve(
        eligible ? [{ document_id: DOC, version_id: VERSION }] : [],
      );
    }
    if (text.includes("from evidence.documents")) {
      expect(text).toContain("d.document_type = 'PITCH_DECK'");
      expect(text).toContain("malware_scan_status <> 'BLOCKED'");
      expect(text).toContain("from evidence.deck_extractions");
      return Promise.resolve(
        eligible
          ? [
              {
                tenant_id: TENANT_A,
                company_id: COMPANY,
                title: "Kora deck",
                version_id: VERSION,
              },
            ]
          : [],
      );
    }
    if (text.includes("from ai_ops.model_usage")) {
      return Promise.resolve([{ usd: String(behaviour.spentUsd ?? 0) }]);
    }
    return Promise.resolve([]);
  };
  const sections: DeckSectionReading[] = DECK_SECTIONS.map((section) => ({
    section,
    status: "NOT_IN_DECK",
    summary: null,
    pages: [],
    facts: [],
    confidence: "LOW",
    criteria: { clear: false, strong: false, exceptional: false, note: null },
  }));
  const handle = withDeckReadings(
    () => Promise.resolve({ kind: "DONE" } as MessageOutcome),
    {
      registry,
      sql: fake as unknown as DatabaseExecutor,
      reader: {
        read: (input) => {
          asked.push({ pages: input.pages, passages: input.passages });
          return Promise.resolve(behaviour.model === "empty" ? null : sections);
        },
      },
      chunks: {
        listActiveByVersion: () =>
          Promise.resolve([
            {
              content: "Traction $41k MRR",
              chunkIndex: 1,
              locator: { slide: 7 },
            },
            {
              content: "Clinics wait 94 days",
              chunkIndex: 0,
              locator: { slide: 2 },
            },
          ]),
      },
      store: {
        insertExtraction: (_e, input) => {
          if (behaviour.insert === "throws") {
            return Promise.reject(
              new Error(
                "violates check constraint deck_extractions_sections_check",
              ),
            );
          }
          stored.push(input);
          return Promise.resolve(true);
        },
      },
      logger,
    },
  );
  const reading = {
    sql: fake as unknown as DatabaseExecutor,
    reader: {
      read: (input: {
        pages: number | null;
        passages: readonly { content: string; slide: number | null }[];
      }) => {
        asked.push({ pages: input.pages, passages: input.passages });
        return Promise.resolve(behaviour.model === "empty" ? null : sections);
      },
    },
    chunks: {
      listActiveByVersion: () =>
        Promise.resolve([
          {
            content: "Clinics wait 94 days",
            chunkIndex: 0,
            locator: { slide: 2 },
          },
        ]),
    },
    store: {
      insertExtraction: (_e: unknown, input: unknown) => {
        stored.push(input);
        return Promise.resolve(true);
      },
    },
    logger,
  };
  return {
    handle,
    stored,
    asked,
    logger,
    reading,
    sql: fake as unknown as DatabaseExecutor,
  };
}

describe("deck readings", () => {
  it("names only a ready document", () => {
    expect(
      readyDocumentOf("evidence.document.ready", { documentId: DOC }),
    ).toBe(DOC);
    expect(
      readyDocumentOf("evidence.document.created", { documentId: DOC }),
    ).toBeNull();
    expect(
      readyDocumentOf("evidence.document.ready", { documentId: "nope" }),
    ).toBeNull();
  });

  it("reads an eligible deck version once, in order, with slides, and stores the twelve", async () => {
    const h = harness(true);
    expect(await h.handle(ready())).toEqual({ kind: "DONE" });
    expect(h.asked).toEqual([
      {
        pages: 7,
        passages: [
          { content: "Clinics wait 94 days", slide: 2 },
          { content: "Traction $41k MRR", slide: 7 },
        ],
      },
    ]);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0]).toMatchObject({
      documentVersionId: VERSION,
      companyId: COMPANY,
      promptVersion: 1,
      pageCount: 7,
    });
  });

  it("reads nothing for a document that is not an eligible deck", async () => {
    const h = harness(false);
    expect(await h.handle(ready())).toEqual({ kind: "DONE" });
    expect(h.asked).toHaveLength(0);
    expect(h.stored).toHaveLength(0);
  });

  it("alerts at error level when the model returns no reading, and stores nothing", async () => {
    const h = harness(true, { model: "empty" });
    expect(await h.handle(ready())).toEqual({ kind: "DONE" });
    expect(h.stored).toHaveLength(0);
    expect(
      h.logger.lines.find((line) => line.level === "error")?.fields,
    ).toMatchObject({
      alert: "DECK_READING_EMPTY",
      documentVersionId: VERSION,
    });
  });

  it("retries and alerts at error level when the reading cannot be stored", async () => {
    // The production failure (Q.08, 2026-10-07): the insert threw on every
    // delivery and only a warning was logged.
    const h = harness(true, { insert: "throws" });
    expect(await h.handle(ready())).toEqual({
      kind: "RETRY",
      errorCode: "DECK_READING_FAILED",
    });
    expect(
      h.logger.lines.find((line) => line.level === "error")?.fields,
    ).toMatchObject({ alert: "DECK_READING_FAILED" });
  });

  it("names ready decks still unread after ten minutes", async () => {
    const h = harness(true);
    expect(await checkUnreadDecks(h.sql, h.logger)).toBe(1);
    expect(h.logger.lines.at(-1)).toMatchObject({
      level: "error",
      fields: { alert: "DECK_READING_MISSING", unread: 1 },
    });
    const quiet = harness(false);
    expect(await checkUnreadDecks(quiet.sql, quiet.logger)).toBe(0);
    expect(quiet.logger.lines).toHaveLength(0);
  });

  it("backfill: a dry run reads nothing", async () => {
    const h = harness(true);
    const result = await backfillDeckReadings({
      reading: h.reading,
      sql: h.sql,
      logger: h.logger,
      apply: false,
      max: 25,
      maxUsd: 1,
      runId: "t1",
    });
    expect(result).toMatchObject({ mode: "DRY_RUN", selected: 1 });
    expect(h.asked).toHaveLength(0);
  });

  it("backfill: reads through the live path and stores the twelve", async () => {
    const h = harness(true);
    const result = await backfillDeckReadings({
      reading: h.reading,
      sql: h.sql,
      logger: h.logger,
      apply: true,
      max: 25,
      maxUsd: 1,
      runId: "t2",
    });
    expect(result.outcomes).toEqual([
      { documentId: DOC, documentVersionId: VERSION, outcome: "READ" },
    ]);
    expect(h.stored).toHaveLength(1);
  });

  it("backfill: stops before reading once the dollar cap is spent", async () => {
    const h = harness(true, { spentUsd: 1.5 });
    const result = await backfillDeckReadings({
      reading: h.reading,
      sql: h.sql,
      logger: h.logger,
      apply: true,
      max: 25,
      maxUsd: 1,
      runId: "t3",
    });
    expect(result.stoppedForBudget).toBe(true);
    expect(result.outcomes[0]?.outcome).toBe("SKIPPED_BUDGET");
    expect(h.asked).toHaveLength(0);
  });
});
