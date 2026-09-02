import { z } from "zod";
import { describe, expect, it } from "vitest";

import { defineEvent, isTenantOwnedEvent } from "../src/events/definition.js";

const base = {
  name: "test.fixture.created",
  version: 1,
  owner: "test",
  producer: "capitalq://api/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z.object({}),
  description: "Test fixture created.",
} as const;

describe("event tenancy", () => {
  it("is tenant-owned unless the definition opts out explicitly", () => {
    expect(isTenantOwnedEvent(defineEvent(base))).toBe(true);
    expect(
      isTenantOwnedEvent(defineEvent({ ...base, tenancy: "TENANT_OWNED" })),
    ).toBe(true);
    expect(
      isTenantOwnedEvent(defineEvent({ ...base, tenancy: "PLATFORM" })),
    ).toBe(false);
  });

  it("rejects an invented tenancy", () => {
    expect(() =>
      defineEvent({ ...base, tenancy: "GLOBAL" as unknown as "PLATFORM" }),
    ).toThrow();
  });
});
