import { describe, expect, it } from "vitest";

import {
  EVIDENCE_STATUSES,
  LIFECYCLE_STATUSES,
  RELIABILITY_CLASSES,
  TRUTH_CLASSES,
} from "@capital-q/contracts";

import {
  createEvidenceSubjectResolverRegistry,
  DOCUMENT_TYPES,
  DocumentLocatorSchema,
  EVIDENCE_SOURCE_TYPES,
  EvidenceLocatorSchema,
  MeetingLocatorSchema,
  OriginalFilenameSchema,
  PipelineVersionSchema,
  Sha256Schema,
  SourceMetadataSchema,
  StorageKeySchema,
  defaultDocumentSensitivity,
  isAtLeastAsSensitive,
  strongestSensitivity,
} from "../src/index.js";
import { CreateClaimInputSchema } from "../src/application/claim-use-cases.js";
import { EVIDENCE_EVENTS } from "../src/events/index.js";

const VERSION = "8d7f8a4e-1d5c-4b1b-9b0a-2f8f1c5f8a11";

describe("ADR-001 vocabulary is the only truth model", () => {
  it("exposes exactly the three axes with their canonical values", () => {
    expect(TRUTH_CLASSES).toEqual([
      "VERIFIED",
      "USER_CLAIM",
      "ESTIMATE",
      "Q_INFERENCE",
      "UNKNOWN",
    ]);
    expect(EVIDENCE_STATUSES).toEqual([
      "NO_EVIDENCE",
      "SELF_REPORTED",
      "DOCUMENT_SUPPORTED",
      "MULTI_SOURCE_SUPPORTED",
      "EXTERNALLY_VERIFIED",
      "PLATFORM_VERIFIED",
    ]);
    expect(LIFECYCLE_STATUSES).toEqual([
      "CURRENT",
      "HISTORICAL",
      "SUPERSEDED",
      "DISPUTED",
      "CONTRADICTORY",
      "STALE",
    ]);
    expect(RELIABILITY_CLASSES).toContain("UNKNOWN");
  });

  it("never lets the superseded doc-13 vocabulary into a public contract", () => {
    const legacy = ["unverified", "truth_state", "verification_state"];
    const surface = JSON.stringify({
      TRUTH_CLASSES,
      EVIDENCE_STATUSES,
      LIFECYCLE_STATUSES,
      keys: Object.keys(CreateClaimInputSchema.shape),
    });
    for (const term of legacy) {
      expect(surface).not.toContain(term);
    }
  });

  it("uses canonical, provider-agnostic source types", () => {
    expect(EVIDENCE_SOURCE_TYPES).toEqual([
      "USER_STATEMENT",
      "DOCUMENT",
      "MEETING",
      "CONVERSATION",
      "PLATFORM_EVENT",
      "INTEGRATION",
      "PUBLIC_WEB",
      "REGULATORY_RECORD",
      "ADMIN_VERIFICATION",
    ]);
    expect(DOCUMENT_TYPES).toContain("PITCH_DECK");
    expect(DOCUMENT_TYPES).toContain("UNCLASSIFIED");
  });
});

describe("evidence locators", () => {
  it("accepts a document locator with page and paragraph", () => {
    expect(
      EvidenceLocatorSchema.parse({
        kind: "document",
        documentVersionId: VERSION,
        page: 12,
        paragraph: 3,
      }),
    ).toMatchObject({ kind: "document", page: 12 });
  });

  it("refuses a negative or zero page", () => {
    expect(
      DocumentLocatorSchema.safeParse({
        kind: "document",
        documentVersionId: VERSION,
        page: -1,
      }).success,
    ).toBe(false);
    expect(
      DocumentLocatorSchema.safeParse({
        kind: "document",
        documentVersionId: VERSION,
        page: 0,
      }).success,
    ).toBe(false);
  });

  it("refuses unknown fields, so a storage key or path can never ride along", () => {
    expect(
      DocumentLocatorSchema.safeParse({
        kind: "document",
        documentVersionId: VERSION,
        storageKey: "company-private/x",
      }).success,
    ).toBe(false);
    expect(
      EvidenceLocatorSchema.safeParse({ kind: "file", path: "../etc/passwd" })
        .success,
    ).toBe(false);
  });

  it("accepts a meeting locator and refuses an inverted range", () => {
    expect(
      MeetingLocatorSchema.parse({
        kind: "meeting",
        meetingId: VERSION,
        startSeconds: 423,
        endSeconds: 451,
      }).endSeconds,
    ).toBe(451);
    expect(
      MeetingLocatorSchema.safeParse({
        kind: "meeting",
        meetingId: VERSION,
        startSeconds: 451,
        endSeconds: 423,
      }).success,
    ).toBe(false);
  });
});

describe("storage identity and provenance metadata", () => {
  it("storage keys never traverse and filenames are names, not paths", () => {
    expect(
      StorageKeySchema.safeParse("company-private/ab12/cd34.pdf").success,
    ).toBe(true);
    expect(StorageKeySchema.safeParse("a/../b").success).toBe(false);
    expect(StorageKeySchema.safeParse("/absolute").success).toBe(false);
    expect(OriginalFilenameSchema.safeParse("deck.pdf").success).toBe(true);
    expect(OriginalFilenameSchema.safeParse("../deck.pdf").success).toBe(false);
    expect(OriginalFilenameSchema.safeParse("a\\b.pdf").success).toBe(false);
    expect(OriginalFilenameSchema.safeParse("..").success).toBe(false);
  });

  it("requires lowercase sha256 hex and a versioned pipeline identity", () => {
    expect(Sha256Schema.safeParse("a".repeat(64)).success).toBe(true);
    expect(Sha256Schema.safeParse("A".repeat(64)).success).toBe(false);
    expect(PipelineVersionSchema.safeParse("evidence-v1").success).toBe(true);
    expect(PipelineVersionSchema.safeParse("evidence").success).toBe(false);
  });

  it("refuses secrets, prompts and oversized blobs in source metadata", () => {
    expect(
      SourceMetadataSchema.safeParse({ pages: 12, externalId: "x" }).success,
    ).toBe(true);
    expect(SourceMetadataSchema.safeParse({ apiKey: "sk-1" }).success).toBe(
      false,
    );
    expect(
      SourceMetadataSchema.safeParse({ promptText: "ignore rules" }).success,
    ).toBe(false);
    expect(
      SourceMetadataSchema.safeParse({ blob: "x".repeat(5000) }).success,
    ).toBe(false);
  });
});

describe("sensitivity", () => {
  it("orders classes and inherits the strongest", () => {
    expect(isAtLeastAsSensitive("HIGHLY_CONFIDENTIAL", "CONFIDENTIAL")).toBe(
      true,
    );
    expect(isAtLeastAsSensitive("INTERNAL", "CONFIDENTIAL")).toBe(false);
    expect(strongestSensitivity("CONFIDENTIAL", "RESTRICTED", "PUBLIC")).toBe(
      "RESTRICTED",
    );
  });

  it("defaults business documents conservatively", () => {
    expect(defaultDocumentSensitivity("PITCH_DECK")).toBe("CONFIDENTIAL");
    expect(defaultDocumentSensitivity("FINANCIAL_MODEL")).toBe(
      "HIGHLY_CONFIDENTIAL",
    );
    expect(defaultDocumentSensitivity("UNCLASSIFIED")).toBe("CONFIDENTIAL");
  });
});

describe("subject resolver registry", () => {
  it("rejects duplicate resolvers and returns null for an unregistered type", async () => {
    const resolver = {
      subjectType: "COMPANY" as const,
      resolve: () => Promise.resolve(null),
    };
    expect(() =>
      createEvidenceSubjectResolverRegistry([resolver, resolver]),
    ).toThrow(/duplicate/);
    const registry = createEvidenceSubjectResolverRegistry([]);
    expect(registry.get("COMPANY")).toBeUndefined();
    await expect(
      registry.resolve(
        {
          userId: VERSION,
          tenantId: VERSION,
          actorType: "HUMAN",
        } as never,
        { subjectType: "COMPANY", subjectId: VERSION },
      ),
    ).resolves.toBeNull();
  });
});

describe("events", () => {
  it("declares five confidential, replay-safe events whose payloads carry no content", () => {
    expect(EVIDENCE_EVENTS.map((e) => e.name)).toEqual([
      "evidence.source.registered",
      "evidence.document.created",
      "evidence.document.version_created",
      "evidence.claim.changed",
      "evidence.evidence_item.created",
    ]);
    for (const event of EVIDENCE_EVENTS) {
      expect(event.sensitivity).toBe("CONFIDENTIAL");
      const shape = JSON.stringify(event.dataSchema);
      for (const forbidden of [
        "statement",
        "summary",
        "title",
        "filename",
        "storageKey",
        "sourceUrl",
      ]) {
        expect(shape).not.toContain(forbidden);
      }
    }
  });
});
