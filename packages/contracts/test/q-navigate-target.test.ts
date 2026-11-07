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
  QClientActionIntentSchema,
  Q_CLIENT_ACTION_TOOLS,
  Q_SCREEN_ROUTES,
  QScreenContextSchema,
  QUiActReceiptSchema,
  Q_UI_ACT_STATUSES,
  legacyUiActStatus,
  Q_UI_INTENT_KINDS,
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

describe("W1.5 LAYOUT_SET (contract owned by W3)", () => {
  const LegacyClientAction = QClientActionIntentSchema.options.filter(
    (option) => option.shape.kind.value !== "LAYOUT_SET",
  );
  const legacyParses = (value: unknown) =>
    LegacyClientAction.some((option) => option.safeParse(value).success);

  it.each([
    [{ kind: "LAYOUT_SET", pagePane: "collapsed" }],
    [{ kind: "LAYOUT_SET", qPane: "open" }],
    [{ kind: "LAYOUT_SET", qPane: "collapsed", pagePane: "open" }],
  ])("parses %o as a UI intent, a client action and a block", (intent) => {
    expect(QUiIntentSchema.parse(intent)).toEqual(intent);
    expect(QClientActionIntentSchema.parse(intent)).toEqual(intent);
    expect(
      QResultBlockSchema.safeParse({ kind: "UI_INTENT", intent }).success,
    ).toBe(true);
    // A pre-W1.5 browser does not know it (why it is flag-gated).
    expect(legacyParses(intent)).toBe(false);
  });

  it.each([
    [{ kind: "LAYOUT_SET" }],
    [{ kind: "LAYOUT_SET", qPane: "hidden" }],
    [{ kind: "LAYOUT_SET", pagePane: "open", width: 400 }],
  ])("refuses %o", (intent) => {
    expect(QUiIntentSchema.safeParse(intent).success).toBe(false);
    expect(QClientActionIntentSchema.safeParse(intent).success).toBe(false);
  });

  it("every client action from before W1.5 still parses", () => {
    for (const intent of [
      { kind: "SET_THEME", theme: "dark" },
      { kind: "RELOAD_PAGE" },
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY },
    ]) {
      expect(QClientActionIntentSchema.safeParse(intent).success).toBe(true);
      expect(legacyParses(intent)).toBe(true);
    }
    expect(Q_UI_INTENT_KINDS).toContain("LAYOUT_SET");
  });
});

describe("Q Workspace screen context and set_layout (W1/W4 via W3)", () => {
  const route = Q_SCREEN_ROUTES[0];
  const LegacyScreen = QScreenContextSchema.omit({ workspace: true }).strict();

  it("a screen without the workspace parses in both the new and the old shape", () => {
    const screen = { route };
    expect(QScreenContextSchema.parse(screen)).toEqual(screen);
    expect(LegacyScreen.parse(screen)).toEqual(screen);
  });

  it("a workspace screen parses in the new shape; the old one refuses it (sent only with the flag on)", () => {
    const screen = {
      route,
      workspace: {
        pagePane: "open",
        qPane: "open",
        at: "/relationships?view=capital",
        previous: "/home",
        dirty: false,
        busy: true,
      },
    };
    expect(QScreenContextSchema.parse(screen)).toEqual(screen);
    expect(LegacyScreen.safeParse(screen).success).toBe(false);
    expect(
      QScreenContextSchema.safeParse({
        route,
        workspace: { pagePane: "collapsed", qPane: "open" },
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ pagePane: "open" }],
    [{ pagePane: "open", qPane: "hidden" }],
    [{ pagePane: "open", qPane: "open", at: "x".repeat(513) }],
    [{ pagePane: "open", qPane: "open", authority: "admin" }],
  ])("refuses the workspace %o", (workspace) => {
    expect(QScreenContextSchema.safeParse({ route, workspace }).success).toBe(
      false,
    );
  });

  it("set_layout is a client-action tool, right after operate_screen", () => {
    const tools: readonly string[] = Q_CLIENT_ACTION_TOOLS;
    expect(tools.indexOf("set_layout")).toBe(
      tools.indexOf("operate_screen") + 1,
    );
  });
});

describe("W3 gaps for W4: sub, and the founders tab as a target", () => {
  it("a target names a part of its tab by key", () => {
    const intent = navigateTargetToIntent({
      page: "COMPANY",
      recordId: COMPANY,
      tab: "overview",
      sub: "financials",
    });
    expect(intent).toEqual({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: COMPANY,
      tab: "overview",
      target: { sub: "financials" },
    });
    expect(
      QNavigateIntentSchema.safeParse({
        kind: "NAVIGATE",
        destination: "OWN_DECK",
        target: { sub: "use_of_funds" },
      }).success,
    ).toBe(true);
  });

  it.each([["Financials"], ["a b"], ["../x"], ["x".repeat(49)]])(
    "refuses the sub %s",
    (sub) => {
      expect(
        QNavigateTargetSchema.safeParse({ page: "OWN_DECK", sub }).success,
      ).toBe(false);
    },
  );

  it("sub never stands beside the intent's own section or sub-tab", () => {
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: COMPANY,
        tab: "overview",
        section: "raise",
        target: { sub: "financials" },
      }).success,
    ).toBe(false);
  });

  it("founders' Discover is DISCOVER at its founders tab; RESULTS still parses", () => {
    expect(
      navigateTargetToIntent({ page: "DISCOVER", tab: "founders" }),
    ).toEqual({
      kind: "NAVIGATE",
      destination: "DISCOVER",
      target: { tab: "founders" },
    });
    for (const destination of ["DISCOVER", "RESULTS"]) {
      expect(
        QNavigateIntentSchema.safeParse({ kind: "NAVIGATE", destination })
          .success,
      ).toBe(true);
    }
  });
});

describe("W5 AWAITING_APPROVAL receipt status (contract owned by W3)", () => {
  const actId = "uia_receipt0001";
  const LegacyStatus = z.enum([
    "DONE",
    "TARGET_MISSING",
    "NOT_APPLICABLE",
    "FAILED",
  ]);
  const LegacyReceipt = QUiActReceiptSchema.extend({
    status: LegacyStatus,
  }).strict();

  it("a prepared act's receipt parses; a pre-W5 reader refuses it", () => {
    const receipt = { actId, status: "AWAITING_APPROVAL", seq: 3 };
    expect(QUiActReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(LegacyReceipt.safeParse(receipt).success).toBe(false);
  });

  it("every receipt from before W5 still parses, and the legacy form is NOT_APPLICABLE", () => {
    for (const status of LegacyStatus.options) {
      expect(QUiActReceiptSchema.safeParse({ actId, status }).success).toBe(
        true,
      );
      expect(legacyUiActStatus(status)).toBe(status);
    }
    const legacy = legacyUiActStatus("AWAITING_APPROVAL");
    expect(legacy).toBe("NOT_APPLICABLE");
    expect(LegacyReceipt.safeParse({ actId, status: legacy }).success).toBe(
      true,
    );
    expect(Q_UI_ACT_STATUSES).toContain("AWAITING_APPROVAL");
  });
});
