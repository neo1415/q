import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  DeckSectionCodeSchema,
  intentToNavigateTarget,
  navigateTargetToIntent,
  QNavigateDestinationSchema,
  QNavigateIntentSchema,
  QNavigateTargetSchema,
  QNavigationOfferBlockSchema,
  QOpenRecordPageIntentSchema,
  QProfileSectionKeySchema,
  QRecordPageSchema,
  QRecordTabSchema,
  QResultBlockSchema,
  QUiIntentSchema,
  withoutNavigateTarget,
} from "../src/index.js";

const COMPANY = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const DOC = "0f0e7f5c-6d9e-4a49-9b8c-0a3c1f1b2c3d";
const MESSAGE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/**
 * The NAVIGATE and OPEN_RECORD_PAGE shapes as a browser bundle from before
 * W3.1 parses them (frozen copies; strict, so an unknown field fails).
 */
const LegacyNavigate = z
  .object({
    kind: z.literal("NAVIGATE"),
    destination: QNavigateDestinationSchema,
  })
  .strict();
const LegacyOpenRecordPage = z
  .object({
    kind: z.literal("OPEN_RECORD_PAGE"),
    page: QRecordPageSchema,
    id: z.uuid(),
    companyId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    tab: QRecordTabSchema.optional(),
    subTab: DeckSectionCodeSchema.optional(),
    section: QProfileSectionKeySchema.optional(),
    viewer: z.literal("OPEN").optional(),
    anchor: z
      .string()
      .regex(/^(?:story|section)-[A-Za-z0-9_-]{1,64}$/u)
      .optional(),
  })
  .strict();

describe("W3.1 navigate target: old payloads parse in the new contract", () => {
  const old = [
    { kind: "NAVIGATE", destination: "CAPITAL" },
    {
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
      tab: "deck",
      viewer: "OPEN",
    },
    {
      kind: "OPEN_RECORD_PAGE",
      page: "DATA_ROOM_DOCUMENT",
      id: DOC,
      companyId: COMPANY,
    },
  ] as const;
  it.each(old)("%o", (intent) => {
    expect(QUiIntentSchema.parse(intent)).toEqual(intent);
    expect(QResultBlockSchema.parse({ kind: "UI_INTENT", intent }).kind).toBe(
      "UI_INTENT",
    );
  });

  it("a NAVIGATION_OFFER from before W3.1 still parses", () => {
    const offer = {
      kind: "NAVIGATION_OFFER",
      intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
      place: "Relationships",
      openLabel: "Open pipeline",
    };
    expect(QNavigationOfferBlockSchema.parse(offer)).toEqual(offer);
  });
});

describe("W3.1 navigate target: new payloads reach old browsers", () => {
  const navigate = {
    kind: "NAVIGATE",
    destination: "MANDATE",
    target: { sectionId: "mandate-sectors", position: "section" },
  } as const;
  const record = {
    kind: "OPEN_RECORD_PAGE",
    page: "RELATIONSHIP_COMPANY_MESSAGES",
    id: COMPANY,
    target: { messageId: MESSAGE, position: "latest" },
  } as const;

  it("parse in the new contract, target and all", () => {
    expect(QNavigateIntentSchema.parse(navigate)).toEqual(navigate);
    expect(QOpenRecordPageIntentSchema.parse(record)).toEqual(record);
    expect(
      QNavigationOfferBlockSchema.parse({
        kind: "NAVIGATION_OFFER",
        intent: record,
        place: "Messages",
        openLabel: "Open the thread",
      }).intent,
    ).toEqual(record);
  });

  it("an intent with no target is byte-for-byte the old shape", () => {
    expect(
      LegacyNavigate.parse({ kind: "NAVIGATE", destination: "MANDATE" }),
    ).toBeTruthy();
    const plain = navigateTargetToIntent({ page: "CAPITAL" });
    expect(plain).toEqual({ kind: "NAVIGATE", destination: "CAPITAL" });
    expect(LegacyNavigate.safeParse(plain).success).toBe(true);
  });

  it("withoutNavigateTarget gives the shape an old browser accepts", () => {
    // The raw new payload is refused by an old (strict) bundle...
    expect(LegacyNavigate.safeParse(navigate).success).toBe(false);
    expect(LegacyOpenRecordPage.safeParse(record).success).toBe(false);
    // ...and its legacy form lands on the same page.
    expect(LegacyNavigate.parse(withoutNavigateTarget(navigate))).toEqual({
      kind: "NAVIGATE",
      destination: "MANDATE",
    });
    expect(LegacyOpenRecordPage.parse(withoutNavigateTarget(record))).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "RELATIONSHIP_COMPANY_MESSAGES",
      id: COMPANY,
    });
  });
});

describe("W3.1 navigate target: bounds", () => {
  it.each([
    [{ sectionId: "Not A Slug" }],
    [{ sectionId: "../settings" }],
    [{ tab: "a path/with/slashes" }],
    [{ slide: 0 }],
    [{ slide: 1.5 }],
    [{ documentId: "not-a-uuid" }],
    [{ position: "bottom" }],
    [{ position: "section" }],
    [{ selector: "#danger" }],
  ])("refuses %o", (target) => {
    expect(
      QNavigateIntentSchema.safeParse({
        kind: "NAVIGATE",
        destination: "BOARD",
        target,
      }).success,
    ).toBe(false);
  });

  it("a record page's own tab is `tab`, never `target.tab`", () => {
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: COMPANY,
        target: { tab: "dataroom" },
      }).success,
    ).toBe(false);
    // An investor's page has its own tabs, which are not record tabs.
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "INVESTOR",
        id: COMPANY,
        target: { tab: "looks-for" },
      }).success,
    ).toBe(true);
  });

  it("a standalone target names its record exactly when it is a record page", () => {
    expect(QNavigateTargetSchema.safeParse({ page: "COMPANY" }).success).toBe(
      false,
    );
    expect(
      QNavigateTargetSchema.safeParse({ page: "CAPITAL", recordId: COMPANY })
        .success,
    ).toBe(false);
    expect(QNavigateTargetSchema.safeParse({ page: "BOARD" }).success).toBe(
      true,
    );
  });
});

describe("W3.1 navigate target: target ⇄ intent", () => {
  it.each([
    [{ page: "BOARD", itemId: DOC }],
    [{ page: "MANDATE", sectionId: "mandate-sectors", position: "section" }],
    [{ page: "COMPANY", recordId: COMPANY, tab: "dataroom", documentId: DOC }],
    [{ page: "COMPANY", recordId: COMPANY, tab: "deck", slide: 4 }],
    [{ page: "INVESTOR", recordId: COMPANY, tab: "gate" }],
    [
      {
        page: "RELATIONSHIP_INVESTOR_MESSAGES",
        recordId: COMPANY,
        messageId: MESSAGE,
        position: "latest",
      },
    ],
  ] as const)("%o round-trips", (target) => {
    const intent = navigateTargetToIntent(target);
    expect(QUiIntentSchema.safeParse(intent).success).toBe(true);
    expect(intentToNavigateTarget(intent)).toEqual(target);
  });

  it("a company's data-room tab lands on the record's own `tab`", () => {
    expect(
      navigateTargetToIntent({
        page: "COMPANY",
        recordId: COMPANY,
        tab: "dataroom",
        documentId: DOC,
      }),
    ).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
      tab: "dataroom",
      target: { documentId: DOC },
    });
  });

  it("refuses a record tab the page does not have", () => {
    expect(() =>
      navigateTargetToIntent({
        page: "COMPANY",
        recordId: COMPANY,
        tab: "messages",
      }),
    ).toThrow();
  });
});
