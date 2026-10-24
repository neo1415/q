import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createWordsReaders } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * QA QO-23 (23 Oct 2026): "kiln-payroll-deck.pdf" was filed as management
 * accounts by a file-name word list and never read. Its kind is now read
 * from its opening pages on FAST_CLASSIFICATION. Through the real gateway
 * (request validation, catalogue routing, a scripted provider): a strict
 * request the gateway refuses is an outage, as CALL_PREP's was that day.
 */
function setup(text: string) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [{ kind: "TEXT", text }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog((s) => s)),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const warned: unknown[] = [];
  const readers = createWordsReaders({
    gateway,
    logger: {
      warn: (entry: unknown) => warned.push(entry),
    } as unknown as Parameters<typeof createWordsReaders>[0]["logger"],
  });
  return { alpha, readers, warned };
}

const WHO = { tenantId: TENANT, userId: USER };
// A long deck: the reader sends its opening only, within the class budget.
const OPENING =
  "Kiln Payroll (fictional). Payroll for Nigerian SMEs. The problem: 40% of salaries are paid late. Traction: 320 customers. The raise: $1.5m SAFE. ".repeat(
    80,
  );

describe("an upload's kind, read through the real gateway (QO-23)", () => {
  it("is a valid request, routed and answered: a payroll company's deck is a pitch deck", async () => {
    const { alpha, readers, warned } = setup(
      JSON.stringify({ kind: "PITCH_DECK" }),
    );
    const kind = await readers.documentKind(WHO, {
      filename: "kiln-payroll-deck.pdf",
      opening: OPENING,
    });
    expect(warned).toEqual([]);
    expect(kind).toBe("PITCH_DECK");
    expect(alpha.calls).toHaveLength(1);
    const prompt = (alpha.calls[0]?.request.messages ?? [])
      .map((message) => message.content)
      .join("\n");
    expect(prompt).toContain("TASK: DOCUMENT_KIND_READER");
    expect(prompt).toContain("kiln-payroll-deck.pdf");
  });

  it("an answer outside the kinds is not read (null), never guessed", async () => {
    const { readers } = setup(JSON.stringify({ kind: "PAYROLL" }));
    expect(
      await readers.documentKind(WHO, {
        filename: "kiln-payroll-deck.pdf",
        opening: OPENING,
      }),
    ).toBeNull();
  });

  it("nothing to read is not sent to any model", async () => {
    const { alpha, readers } = setup(JSON.stringify({ kind: "PITCH_DECK" }));
    expect(
      await readers.documentKind(WHO, { filename: "x.pdf", opening: "   " }),
    ).toBeNull();
    expect(alpha.calls).toHaveLength(0);
  });
});
