import { describe, expect, it } from "vitest";

import { DECK_SECTIONS, type DeckSectionReading } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  checkStoredDeckReadings,
  processReadAgain,
  readDeckDocument,
} from "../src/evidence/deck-reading-handler.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * F26: the figure check runs before any reading is stored; "Read again"
 * appends a new reading under the next number, each request once, within
 * a daily cap; readings stored before the check get it at start, as an
 * appended copy (no model).
 */

const DOC = "d0000000-0000-4000-8000-000000000026";
const VERSION = "e0000000-0000-4000-8000-000000000026";
const COMPANY = "c0000000-0000-4000-8000-000000000026";
const REQUEST = "a0000000-0000-4000-8000-000000000026";

const DECK = "Slide 3: 1.4% fee. Slide 8: Fee of 1.4% of each financing.";

const mizan = (): DeckSectionReading[] =>
  DECK_SECTIONS.map((section) => ({
    section,
    status: section === "BUSINESS_MODEL" ? "CONTRADICTORY" : "NOT_IN_DECK",
    summary:
      section === "BUSINESS_MODEL"
        ? "Most slides state a 1.4% financing fee, while slide 8 states 4%."
        : null,
    pages: [],
    facts: [],
    confidence: "LOW",
    criteria: { clear: false, strong: false, exceptional: false, note: null },
  }));

function world() {
  const logger = createRecordingLogger();
  const stored: {
    sections: readonly DeckSectionReading[];
    readingNumber?: number | undefined;
    origin?: string | undefined;
    setAside?: readonly unknown[] | undefined;
  }[] = [];
  const outcomes: string[] = [];
  let reads = 0;
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("from evidence.documents d")) {
      return Promise.resolve([
        {
          tenant_id: TENANT_A,
          company_id: COMPANY,
          title: "Mizan deck",
          version_id: VERSION,
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as DatabaseExecutor;
  const reading = {
    sql,
    reader: {
      read: () => {
        reads += 1;
        return Promise.resolve(mizan());
      },
    },
    chunks: {
      listActiveByVersion: () =>
        Promise.resolve([
          { content: DECK, chunkIndex: 0, locator: { slide: 8 } },
        ]),
    },
    store: {
      insertExtraction: (_e: unknown, input: (typeof stored)[number]) => {
        stored.push(input);
        return Promise.resolve(true);
      },
      nextReadingNumber: () => Promise.resolve(2),
    },
    logger,
  };
  return { reading, stored, outcomes, reads: () => reads, logger };
}

describe("deck readings are checked before they are stored (F26)", () => {
  it("Mizan's 4% never reaches the founder as a contradiction", async () => {
    const { reading, stored } = world();
    await readDeckDocument(reading, DOC, "cor_x");
    const model = stored[0]?.sections.find(
      (s) => s.section === "BUSINESS_MODEL",
    );
    expect(model?.status).toBe("UNCLEAR");
    expect(model?.summary).toBeNull();
    expect(stored[0]?.setAside).toEqual([
      { section: "BUSINESS_MODEL", figures: ["4%"] },
    ]);
    expect(stored[0]?.readingNumber).toBe(1);
  });

  it("Read again appends the next reading, records the outcome once, within the daily cap", async () => {
    const { reading, stored, outcomes, reads } = world();
    const queue = {
      readAgainToday: () => Promise.resolve(0),
      pendingReadAgain: () =>
        Promise.resolve([
          {
            requestId: REQUEST,
            tenantId: TENANT_A,
            documentId: DOC,
            documentVersionId: VERSION,
          },
        ]),
      recordReadAgain: (_e: unknown, input: { outcome: string }) => {
        outcomes.push(input.outcome);
        return Promise.resolve();
      },
    };
    await processReadAgain({
      reading: reading,
      queue,
      perSweep: 1,
      dailyMax: 20,
    });
    expect(stored[0]).toMatchObject({ readingNumber: 2, origin: "READ_AGAIN" });
    expect(outcomes).toEqual(["READ"]);

    // The day's budget is spent: no model reading at all.
    const before = reads();
    await processReadAgain({
      reading: reading,
      queue: { ...queue, readAgainToday: () => Promise.resolve(20) },
      perSweep: 1,
      dailyMax: 20,
    });
    expect(reads()).toBe(before);
  });

  it("an old reading with a false contradiction gets an appended, checked copy at start", async () => {
    const { reading, stored } = world();
    const sql = ((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("?").includes("distinct on (x.document_version_id)")
          ? [
              {
                tenant_id: TENANT_A,
                company_id: COMPANY,
                document_id: DOC,
                document_version_id: VERSION,
                prompt_version: 1,
                schema_version: 1,
                page_count: 12,
                reading_number: 1,
                sections: mizan(),
              },
            ]
          : [],
      )) as unknown as DatabaseExecutor;
    const healed = await checkStoredDeckReadings({
      sql,
      chunks: reading.chunks,
      store: reading.store,
      logger: reading.logger,
      limit: 10,
    });
    expect(healed).toBe(1);
    expect(stored[0]).toMatchObject({
      readingNumber: 2,
      origin: "FIGURE_CHECK",
    });
  });
});
