import { describe, expect, it } from "vitest";

import type { RuntimePort } from "../src/features/founder-onboarding/adapters/runtime-port";
import {
  createFixtureRuntimePort,
  FIXTURE_STORAGE_KEY,
} from "../src/features/founder-onboarding/adapters/fixture-port";
import { createRuntimeFounderClient } from "../src/features/founder-onboarding/adapters/runtime-port";

/**
 * Live recheck 2026-10-30 (session 89f6fd0b): Q's reading saved the
 * company's categories at 03:21:23 (responses/batch 200); the browser then
 * sent the upload's answer on the version before, got 409 at 03:21:27, and
 * dropped it. The documents step stayed open and Q asked for documents
 * twice. A session's writes are sequenced: one step's whole answer is made
 * again on the version the session moved to, and the browser's own writes
 * go one at a time.
 */
const SOURCE = { adapter: "fixture", synthetic: true } as const;

function sharedStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function twoWriters() {
  const storage = sharedStorage();
  // The browser and Q's own saves (the server reader) on one session.
  const browser = createFixtureRuntimePort({ storage, seed: "reset" });
  const reader = createFixtureRuntimePort({ storage });
  const sent: { stepKey: string; version: number }[] = [];
  const spied: RuntimePort = {
    ...browser,
    submit: (input) => {
      sent.push({
        stepKey: input.stepKey,
        version: input.expectedSessionVersion,
      });
      return browser.submit(input);
    },
  };
  return {
    client: createRuntimeFounderClient(spied, SOURCE),
    reader,
    storage,
    sent,
  };
}

/** Stands for the upload's answer: one step's whole value from the browser. */
const UPLOAD_ANSWER = {
  stepKey: "F1.company_name",
  value: { type: "TEXT", text: "Lumenvault (fictional)" },
} as const;
/** Stands for Q's categories save: another step, saved on the server. */
const READER_SAVE = {
  stepKey: "F0.intent",
  value: { type: "SINGLE_SELECT", optionKey: "raising_now" },
} as const;

describe("one session's writes are sequenced", () => {
  it("the upload's answer survives Q's categories save landing first", async () => {
    const { client, reader, storage, sent } = twoWriters();
    await client.getSession();
    const submitValue = client.submitValue;
    if (submitValue === undefined) throw new Error("no submitValue");
    // Q's reading saves first, on the version the browser also holds.
    const view = await reader.current();
    if (view === null) throw new Error("no session");
    const [browserWrite] = await Promise.all([
      submitValue(UPLOAD_ANSWER),
      reader.submit({
        sessionId: view.session.id,
        ...READER_SAVE,
        expectedSessionVersion: view.session.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    ]);
    // The browser's first attempt was on the stale version, then made again.
    expect(sent.length).toBe(2);
    expect(sent[1]?.version).toBeGreaterThan(sent[0]?.version ?? 0);
    const stored = JSON.parse(storage.getItem(FIXTURE_STORAGE_KEY) ?? "{}") as {
      responses: Record<string, unknown>;
    };
    expect(stored.responses["F1.company_name"]).toEqual(UPLOAD_ANSWER.value);
    expect(stored.responses["F0.intent"]).toEqual(READER_SAVE.value);
    expect(browserWrite.raw.responses.map((r) => r.stepKey)).toContain(
      "F1.company_name",
    );
  });

  it("two of the browser's own writes go one after the other", async () => {
    const { client, sent } = twoWriters();
    await client.getSession();
    const submitValue = client.submitValue;
    if (submitValue === undefined) throw new Error("no submitValue");
    await Promise.all([submitValue(READER_SAVE), submitValue(UPLOAD_ANSWER)]);
    // In order, each on the version the one before returned: no conflict.
    expect(sent.map((s) => s.stepKey)).toEqual([
      "F0.intent",
      "F1.company_name",
    ]);
    expect(sent[1]?.version).toBe((sent[0]?.version ?? 0) + 1);
  });
});
