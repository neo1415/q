import { describe, expect, it } from "vitest";

import {
  ExternalEntityImageSchema,
  ExternalPersonSubjectSchema,
  PersonBriefSchema,
} from "../src/q/external-person.js";

const base = {
  externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
  displayName: "QInvest",
  nameVariants: ["QInvest", "Qatar Investment"],
  profileUrl: null,
  role: null,
  organization: null,
  location: "Doha, Qatar",
  evidenceBundleId: null,
  briefVersion: 0,
  confidence: "STRONG",
};

describe("external entity contract", () => {
  it("defaults to a researched person with no image so W4's existing shape still parses", () => {
    const parsed = ExternalPersonSubjectSchema.parse(base);
    expect(parsed.entityKind).toBe("PERSON");
    expect(parsed.image.status).toBe("NOT_ATTACHED");
    expect(parsed.quotes).toEqual([]);
  });

  it("an organisation or agency carries no personal role", () => {
    expect(
      ExternalPersonSubjectSchema.safeParse({
        ...base,
        entityKind: "ORGANIZATION",
        role: "CEO",
      }).success,
    ).toBe(false);
    expect(
      ExternalPersonSubjectSchema.safeParse({
        ...base,
        entityKind: "GOVERNMENT_AGENCY",
      }).success,
    ).toBe(true);
  });

  it("never hotlinks a third-party profile image and requires attribution when attached", () => {
    const attached = {
      status: "ATTACHED",
      attribution: "Official site",
      licenseNote: "Used with permission",
    };
    expect(
      ExternalEntityImageSchema.safeParse({
        ...attached,
        assetUrl: "https://media.licdn.com/dms/image/x.jpg",
      }).success,
    ).toBe(false);
    expect(
      ExternalEntityImageSchema.safeParse({
        ...attached,
        assetUrl: "https://assets.capitalq.example/entities/x.jpg",
      }).success,
    ).toBe(true);
    expect(
      ExternalEntityImageSchema.safeParse({
        status: "ATTACHED",
        assetUrl: "https://assets.capitalq.example/x.jpg",
        attribution: null,
        licenseNote: null,
      }).success,
    ).toBe(false);
  });

  it("quotes are source quotes only, and an organisation brief has no communication style", () => {
    const brief = {
      externalPersonId: base.externalPersonId,
      entityKind: "ORGANIZATION",
      version: 1,
      builtAt: "2026-10-10T00:00:00Z",
      freshUntil: "2026-10-24T00:00:00Z",
      sources: [],
      assertions: [
        {
          topic: "COMMUNICATION_STYLE",
          text: "x",
          assertionClass: "UNKNOWN",
          sourceRefs: [],
          asOf: null,
        },
      ],
    };
    expect(PersonBriefSchema.safeParse(brief).success).toBe(false);
    expect(
      PersonBriefSchema.safeParse({
        ...brief,
        assertions: [],
        quotes: [
          {
            text: "q",
            sourceId: "S03",
            speaker: "A",
            date: null,
            use: "GENERATED_DIALOGUE",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
