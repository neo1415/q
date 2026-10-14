import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_PREFERENCES,
  pipelineStorageKey,
  readPipelinePreferences,
  writePipelinePreferences,
} from "@/features/relationships/pipeline-preferences";
describe("personal Hub preferences", () => {
  it("isolates users, active organisations and roles", () => {
    const keys = [
      pipelineStorageKey("u1", "INVESTOR", "o1"),
      pipelineStorageKey("u2", "INVESTOR", "o1"),
      pipelineStorageKey("u1", "INVESTOR", "o2"),
      pipelineStorageKey("u1", "COMPANY", "o1"),
    ];
    expect(new Set(keys).size).toBe(4);
  });
  it("fails malformed/foreign schema to safe defaults", () => {
    expect(
      readPipelinePreferences("a", { getItem: () => '{"stage":"HOT_DEAL"}' }),
    ).toEqual(DEFAULT_PIPELINE_PREFERENCES);
    expect(readPipelinePreferences("a", { getItem: () => "bad" })).toEqual(
      DEFAULT_PIPELINE_PREFERENCES,
    );
  });
  it("persists no canonical IDs or cursor authority and handles disabled storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    expect(
      writePipelinePreferences(
        "u:org",
        { ...DEFAULT_PIPELINE_PREFERENCES, columns: ["state"] },
        storage,
      ),
    ).toBe(true);
    expect(readPipelinePreferences("u:org", storage).columns).toEqual([
      "state",
    ]);
    expect(readPipelinePreferences("other:org", storage)).toEqual(
      DEFAULT_PIPELINE_PREFERENCES,
    );
    expect(
      writePipelinePreferences("u:org", DEFAULT_PIPELINE_PREFERENCES, null),
    ).toBe(false);
  });
});
