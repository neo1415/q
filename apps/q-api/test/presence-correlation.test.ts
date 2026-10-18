import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";

import { presenceCorrelationId } from "../src/composition/presence.js";

describe("presenceCorrelationId", () => {
  it("produces a valid cor_<uuid> correlation id, fresh each call", () => {
    const first = presenceCorrelationId();
    const second = presenceCorrelationId();
    expect(first).toMatch(/^cor_/);
    expect(CorrelationIdSchema.safeParse(first).success).toBe(true);
    expect(second).not.toBe(first);
  });
});
