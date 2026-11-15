import { describe, expect, it } from "vitest";

import {
  CorrelationIdSchema,
  type GatewayBrandSuggestionDto,
} from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  type AppActionPorts,
  type GateqGatewayAdminPort,
} from "../src/index.js";

/**
 * GateQ brand from website through Q (live defect 2026-11-14: the card
 * carried only the colour). "Brand my gateway from our website" proposes
 * the site's name, logo and colour together; the approval card names all
 * three and the approval binds to exactly that payload.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const context = {
  actor,
  idempotencyKey: "q:run-1:step",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
  surface: "Q" as const,
};
const GATEWAY = "a0000000-0000-4000-8000-000000000001";
const ASSET = "f0000000-0000-4000-8000-000000000001";

const suggestion = (
  overrides: Partial<GatewayBrandSuggestionDto> = {},
): GatewayBrandSuggestionDto => ({
  gatewayId: GATEWAY,
  websiteUrl: "https://wavepay.example",
  canonicalName: "Kilima Angel Network (fictional)",
  sourceUrl: "https://wavepay.example/us/",
  investorOrganisationId: "a1000000-0000-4000-8000-000000000001",
  profileVersion: 3,
  name: { status: "FOUND", value: "Wavepay", from: "TITLE" },
  logo: {
    status: "FOUND",
    kind: "LOGO",
    assetId: ASSET,
    sourceUrl: "https://wavepay.example/logo.svg",
    previewDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  },
  colours: { status: "FOUND", primary: "#262c55" },
  ...overrides,
});

function portsWith(found: GatewayBrandSuggestionDto): AppActionPorts {
  const admin: GateqGatewayAdminPort = {
    ownGateway: () => Promise.resolve({ id: GATEWAY, status: "DISABLED" }),
    appearance: () =>
      Promise.resolve({
        ok: true,
        value: {
          gatewayId: GATEWAY,
          revision: 2,
          accentHex: null,
          embedOrigins: [],
          updatedAt: null,
          displayName: null,
          logo: null,
          canChange: true,
        },
      }),
    setAppearance: () => Promise.resolve({ ok: false }),
    suggestBrand: () => Promise.resolve({ ok: true, value: found }),
    setStatus: () => Promise.resolve({ ok: false }),
  };
  return { gateqGatewayAdmin: admin } as unknown as AppActionPorts;
}

const action = APP_ACTIONS.find((a) => a.name === "gateway.appearance.set");
const tool = action?.tool;

describe("Q brands the gateway from the website: name, logo and colour", () => {
  it("proposes all three found on the site, and the card names all three", async () => {
    if (action === undefined || tool === undefined) throw new Error("no tool");
    const said = tool.input.parse({ fromWebsite: true });
    const canonical = await tool.toCanonical(
      said,
      context,
      portsWith(suggestion()),
    );
    expect(canonical).toEqual({
      gatewayId: GATEWAY,
      organisationId: actor.organisationId,
      input: {
        accentHex: "#262c55",
        embedOrigins: [],
        displayName: "Wavepay",
        logoAssetId: ASSET,
      },
    });
    const card = action.card(canonical as Parameters<typeof action.card>[0]);
    expect(card.summary).toBe(
      "Brand your gateway #262c55, with the logo from your website",
    );
    expect(card.preview).toContain("Shown as Wavepay.");
  });

  it("a site icon is not proposed as a logo; the name and colour still are", async () => {
    if (tool === undefined) throw new Error("no tool");
    const canonical = await tool.toCanonical(
      tool.input.parse({ fromWebsite: true }),
      context,
      portsWith(
        suggestion({
          logo: {
            status: "FOUND",
            kind: "ICON",
            assetId: ASSET,
            sourceUrl: "https://wavepay.example/apple-touch-icon.png",
            previewDataUrl: "data:image/png;base64,iVBORw0KGgo=",
          },
        }),
      ),
    );
    expect(canonical).toMatchObject({
      input: { accentHex: "#262c55", displayName: "Wavepay" },
    });
    expect(
      (canonical as { input: Record<string, unknown> }).input,
    ).not.toHaveProperty("logoAssetId");
  });

  it("a name alone is still a proposal; nothing found is a plain refusal", async () => {
    if (tool === undefined) throw new Error("no tool");
    const said = tool.input.parse({ fromWebsite: true });
    const nameOnly = await tool.toCanonical(
      said,
      context,
      portsWith(
        suggestion({
          logo: { status: "NOT_FOUND", reason: "NO_LOGO" },
          colours: { status: "NOT_FOUND", reason: "NO_COLOURS" },
        }),
      ),
    );
    expect(nameOnly).toMatchObject({ input: { displayName: "Wavepay" } });

    const nothing = await tool.toCanonical(
      said,
      context,
      portsWith(
        suggestion({
          name: { status: "NOT_FOUND", reason: "NAME_NOT_CREDIBLE" },
          logo: { status: "NOT_FOUND", reason: "NO_LOGO" },
          colours: { status: "NOT_FOUND", reason: "NO_COLOURS" },
        }),
      ),
    );
    expect(nothing).toEqual({
      refused:
        "I couldn't find a name, logo or brand colour on https://wavepay.example. You can set them on the Gate tab.",
    });
  });
});
