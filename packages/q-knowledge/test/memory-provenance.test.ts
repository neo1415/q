import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MemoryItemSchema, type MemoryItem } from "../src/memory/contracts.js";
import {
  inferredPresentedAsStated,
  memoryTruthClass,
} from "../src/memory/provenance.js";
import { renderMemoryBundle } from "../src/memory/render.js";

/**
 * Q intelligence step 9, HANDOFF-2026-11-01 defect 1 in memory: the
 * investor said "We back B2B companies with recurring revenue" and Q's
 * mapping ("Invests in B2B SaaS companies") was kept and recalled as what
 * they said. The Write Gate proves the quote is theirs; it never proved
 * the content was. Fakes only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

function item(
  memoryType: MemoryItem["memoryType"],
  content: string,
  quote: string | null,
  writeMode: MemoryItem["writeMode"] = "Q_PROPOSED",
): MemoryItem {
  const now = "2026-10-31T23:02:00.000Z";
  return MemoryItemSchema.parse({
    id: randomUUID(),
    tenantId: TENANT,
    ownerContextType: "user",
    ownerContextId: OWNER,
    subject: null,
    memoryType,
    memoryKey: `${memoryType}.k${randomUUID().slice(0, 6)}`,
    content,
    structuredValue: {},
    quote,
    contentSha256: createHash("sha256").update(content).digest("hex"),
    sourceConversationId: null,
    sourceRunId: null,
    writeMode,
    status: "active",
    supersededBy: null,
    validFrom: now,
    validTo: null,
    lastUsedAt: null,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

const SAID = "We back B2B companies with recurring revenue.";
const mapped = item("fact", "Invests in B2B SaaS companies.", SAID);
const mappedPreference = item(
  "preference",
  "Prefers B2B SaaS business models.",
  SAID,
);
const stated = item("fact", "recurring revenue", SAID);
const confirmed = item(
  "fact",
  "Invests in B2B SaaS companies.",
  "Yes, B2B SaaS is right.",
  "USER_CONFIRMED",
);

const bundle = (person: readonly MemoryItem[]) =>
  renderMemoryBundle({
    person,
    company: [],
    thisConversation: null,
    relevant: [],
    otherConversations: [],
  });

describe("memory provenance (step 9)", () => {
  it("derives who said it from the row, by code", () => {
    expect(memoryTruthClass(mapped)).toBe("Q_INFERENCE");
    expect(memoryTruthClass(mappedPreference)).toBe("Q_INFERENCE");
    expect(memoryTruthClass(stated)).toBe("USER_CLAIM");
    expect(memoryTruthClass(confirmed)).toBe("USER_CLAIM");
    expect(memoryTruthClass(item("fact", "Lives in Lagos", null))).toBe(
      "Q_INFERENCE",
    );
  });

  it("never recalls Q's mapping as what they said or as their preference", () => {
    const text = bundle([mapped, mappedPreference, stated]);
    expect(inferredPresentedAsStated(text, [mapped, mappedPreference])).toEqual(
      [],
    );
    // Q's reading is labelled as Q's, with their own words beside it.
    expect(text).toContain("Q's reading");
    expect(text).toContain(`"${SAID}"`);
    // Their own words are still theirs.
    expect(text).toMatch(/They said \(2026-10-31\): "?recurring revenue/u);
  });

  it("the check catches an inference framed as stated", () => {
    expect(
      inferredPresentedAsStated("You said you invest in B2B SaaS companies.", [
        mapped,
      ]),
    ).toEqual([]);
    expect(
      inferredPresentedAsStated(
        "Your stated preference: invests in B2B SaaS companies.",
        [mapped],
      ),
    ).toEqual([mapped.content]);
    expect(
      inferredPresentedAsStated(
        "- They said (2026-10-31): Invests in B2B SaaS companies.",
        [mapped],
      ),
    ).toEqual([mapped.content]);
  });
});
