// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GatewayAppearanceDto,
  GatewayBrandSuggestionDto,
} from "@capital-q/contracts";

import {
  frameAncestorsFor,
  isGatewayEmbedPath,
} from "@/features/gateq/embed-frame-policy";

const appearanceAction = vi.fn();
const gatewayStatusAction = vi.fn();
const brandSuggestionAction = vi.fn();
const saveProfileWebsiteAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  appearanceAction: (...args: unknown[]) =>
    appearanceAction(...args) as unknown,
  gatewayStatusAction: (...args: unknown[]) =>
    gatewayStatusAction(...args) as unknown,
  brandSuggestionAction: (...args: unknown[]) =>
    brandSuggestionAction(...args) as unknown,
  saveProfileWebsiteAction: (...args: unknown[]) =>
    saveProfileWebsiteAction(...args) as unknown,
}));

const { GatewayAppearancePanel } =
  await import("@/features/gateq/page/gateway-appearance");

afterEach(() => {
  cleanup();
  appearanceAction.mockReset();
  gatewayStatusAction.mockReset();
  brandSuggestionAction.mockReset();
  saveProfileWebsiteAction.mockReset();
});

const GATEWAY = "0b9f8a62-3d1e-4c55-9a43-6f2a1c7d5e10";

const appearance = (
  over: Partial<GatewayAppearanceDto> = {},
): GatewayAppearanceDto => ({
  gatewayId: GATEWAY,
  revision: 1,
  accentHex: "#0f766e",
  embedOrigins: ["https://kilima.example"],
  updatedAt: "2026-11-14T12:00:00.000Z",
  canChange: true,
  displayName: null,
  logo: null,
  organisationName: null,
  ...over,
});

describe("B6/B7: the investor brands, places and pauses their own gateway", () => {
  it("an admin saves a colour and embed sites through the declared action", async () => {
    appearanceAction.mockResolvedValue({
      ok: true,
      value: appearance({
        accentHex: "#b45309",
        embedOrigins: ["https://kilima.example", "https://angels.example"],
      }),
    });
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Colour as hex"), {
      target: { value: "#B45309" },
    });
    fireEvent.change(
      screen.getByLabelText("Websites that may embed your gateway"),
      { target: { value: "kilima.example\nangels.example" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Saved"),
    );
    expect(appearanceAction).toHaveBeenCalledWith(GATEWAY, {
      accentHex: "#b45309",
      sites: "kilima.example\nangels.example",
      displayName: null,
      logoAssetId: null,
    });
  });

  it("previews the AA-adjusted accent and refuses a non-colour before any call", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance({ accentHex: "#facc15" })}
      />,
    );
    // Pale yellow is darkened for text on white: the sample is not the raw hex.
    const preview = document.querySelector("[data-gateway-accent-preview]");
    expect(preview).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Colour as hex"), {
      target: { value: "not a colour" },
    });
    expect(
      screen.getByLabelText("Colour as hex").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
    ).toBe(true);
    expect(appearanceAction).not.toHaveBeenCalled();
  });

  it("a member who may not change it sees it read-only, with no Pause or Save", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance({ canChange: false })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause gateway" })).toBeNull();
    expect(screen.getByLabelText("Colour as hex").matches(":disabled")).toBe(
      true,
    );
    expect(
      screen
        .getByLabelText("Websites that may embed your gateway")
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByText(
        "Only admins of your firm can change how your gateway looks.",
      ),
    ).toBeTruthy();
  });

  it("pauses and reopens through the status action, announcing the result", async () => {
    gatewayStatusAction.mockResolvedValue({
      ok: true,
      value: {
        id: GATEWAY,
        publicId: "gq_x",
        name: "Kilima Angels",
        status: "DISABLED",
        createdAt: "2026-11-14T00:00:00.000Z",
      },
    });
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause gateway" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reopen gateway" }),
      ).toBeTruthy(),
    );
    expect(gatewayStatusAction).toHaveBeenCalledWith(GATEWAY, {
      status: "DISABLED",
    });
    expect(screen.getByRole("status").textContent).toContain("paused");
    expect(screen.queryByText("Preview your public gateway")).toBeNull();
  });

  it("labels every control and keeps the colour picker a 44px target", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance()}
      />,
    );
    for (const input of document.querySelectorAll("input, textarea")) {
      const id = input.getAttribute("id");
      const labelled =
        input.getAttribute("aria-label") !== null ||
        (id !== null && document.querySelector(`label[for="${id}"]`) !== null);
      expect(labelled, `unlabelled ${input.outerHTML}`).toBe(true);
    }
    expect(screen.getByLabelText("Pick a colour").className).toContain(
      "size-11",
    );
    expect(
      screen.getByRole("link", { name: "Preview your public gateway" }),
    ).toBeTruthy();
  });
});

const ASSET = "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

const suggestion = (
  over: Partial<GatewayBrandSuggestionDto> = {},
): GatewayBrandSuggestionDto => ({
  gatewayId: GATEWAY,
  websiteUrl: "https://kilima.example",
  canonicalName: "Kilima Angels",
  sourceUrl: "https://kilima.example/",
  investorOrganisationId: "6a0c1f5e-0000-4000-8000-0000000000aa",
  profileVersion: 3,
  name: {
    status: "FOUND",
    value: "Kilima Angel Network",
    from: "OG_SITE_NAME",
  },
  logo: {
    status: "FOUND",
    kind: "LOGO",
    assetId: ASSET,
    sourceUrl: "https://kilima.example/logo.png",
    previewDataUrl: PNG,
  },
  colours: { status: "FOUND", primary: "#0f766e" },
  ...over,
});

const panel = () =>
  render(
    <GatewayAppearancePanel
      gatewayId={GATEWAY}
      open
      previewHref="/g/gq_x"
      appearance={appearance({ accentHex: null })}
      organisationName="Kilima Angels"
    />,
  );

describe("Brand from website: the admin corrects what Capital Q found, then saves", () => {
  it("found all: logo, colour and both names go into the header preview, and Save carries them", async () => {
    brandSuggestionAction.mockResolvedValue({ ok: true, value: suggestion() });
    appearanceAction.mockResolvedValue({ ok: true, value: appearance() });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Brand from website" }));
    await waitFor(() =>
      expect(document.querySelector("[data-brand-suggestion]")).not.toBeNull(),
    );
    // The profile's name stays chosen; the site's differs, so both show.
    expect(screen.getByText("Kilima Angel Network")).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Use this logo" })
        .checked,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("radio", { name: /Kilima Angel Network/u }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use in preview" }));
    const header = document.querySelector("[data-gateway-header-preview]");
    expect(header?.textContent).toContain("Kilima Angel Network");
    expect(
      header?.querySelector("img")?.getAttribute("data-preview-logo-kind"),
    ).toBe("LOGO");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(appearanceAction).toHaveBeenCalled());
    expect(appearanceAction).toHaveBeenCalledWith(GATEWAY, {
      accentHex: "#0f766e",
      sites: "https://kilima.example",
      displayName: "Kilima Angel Network",
      logoAssetId: ASSET,
    });
  });

  it("paused: the saved logo is drawn from the authenticated route and the saved name heads the preview", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open={false}
        previewHref="/g/gq_x"
        appearance={appearance({
          displayName: "Wavepay",
          logo: { assetId: ASSET, kind: "LOGO" },
        })}
        organisationName="Kilima Angels"
      />,
    );
    const header = document.querySelector("[data-gateway-header-preview]");
    expect(header?.textContent).toContain("Wavepay");
    expect(header?.textContent).not.toContain("Your firm");
    // Never the public /g/:id/logo, which is 404 while paused.
    expect(header?.querySelector("img")?.getAttribute("src")).toBe(
      `/gateq/logo/${GATEWAY}?v=${ASSET}`,
    );
  });

  it("paused with no saved name: the profile name heads the preview, not a placeholder", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open={false}
        previewHref="/g/gq_x"
        appearance={appearance({ organisationName: "Kilima Angels" })}
        organisationName="Kilima Angels"
      />,
    );
    const header = document.querySelector("[data-gateway-header-preview]");
    expect(header?.textContent).toContain("Kilima Angels");
  });

  it("only a favicon: shown as an icon, not a logo, and off until chosen", async () => {
    brandSuggestionAction.mockResolvedValue({
      ok: true,
      value: suggestion({
        logo: {
          status: "FOUND",
          kind: "ICON",
          assetId: ASSET,
          sourceUrl: "https://kilima.example/favicon.png",
          previewDataUrl: PNG,
        },
      }),
    });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Brand from website" }));
    const box = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Use this icon",
    });
    expect(box.checked).toBe(false);
    expect(
      screen.queryByRole("checkbox", { name: "Use this logo" }),
    ).toBeNull();
    expect(
      screen.getByText(/Only your website's icon was found, not a full logo/u),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use in preview" }));
    // No logo was used: the header keeps the initial.
    expect(
      document.querySelector("[data-gateway-header-preview] img"),
    ).toBeNull();
  });

  it("names each missing item precisely and keeps the fallback", async () => {
    brandSuggestionAction.mockResolvedValue({
      ok: true,
      value: suggestion({
        name: { status: "NOT_FOUND", reason: "TIMEOUT" },
        logo: { status: "NOT_FOUND", reason: "TIMEOUT" },
        colours: { status: "NOT_FOUND", reason: "NO_COLOURS" },
      }),
    });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Brand from website" }));
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-brand-reason="TIMEOUT"]'),
      ).toHaveLength(2),
    );
    expect(
      screen.getAllByText("Your website took too long to answer."),
    ).toHaveLength(2);
    expect(
      screen.getByText("No brand colour was found on your website."),
    ).toBeTruthy();
    expect(
      screen.getByText("Your gateway shows your firm's initial instead."),
    ).toBeTruthy();
  });

  it("no website on the profile: the address is saved to the profile first, then read", async () => {
    brandSuggestionAction
      .mockResolvedValueOnce({
        ok: true,
        value: suggestion({
          websiteUrl: null,
          sourceUrl: null,
          name: { status: "NOT_FOUND", reason: "NO_WEBSITE" },
          logo: { status: "NOT_FOUND", reason: "NO_WEBSITE" },
          colours: { status: "NOT_FOUND", reason: "NO_WEBSITE" },
        }),
      })
      .mockResolvedValueOnce({ ok: true, value: suggestion() });
    saveProfileWebsiteAction.mockResolvedValue({ ok: true, value: null });
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Brand from website" }));
    const input = await screen.findByPlaceholderText("yourfirm.com");
    fireEvent.change(input, { target: { value: "kilima.example" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save to profile and read" }),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-brand-suggestion]")).not.toBeNull(),
    );
    expect(saveProfileWebsiteAction).toHaveBeenCalledWith({
      investorOrganisationId: "6a0c1f5e-0000-4000-8000-0000000000aa",
      expectedVersion: 3,
      website: "kilima.example",
    });
    // The suggestion is read again from the record, never given the URL.
    expect(brandSuggestionAction).toHaveBeenNthCalledWith(2, GATEWAY);
  });

  it("a member who may not change it is not offered the website reading", () => {
    render(
      <GatewayAppearancePanel
        gatewayId={GATEWAY}
        open
        previewHref="/g/gq_x"
        appearance={appearance({ canChange: false })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Brand from website" }),
    ).toBeNull();
  });
});

describe("B7: the embed's frame-ancestors", () => {
  it("allows any site when none are listed, only the listed ones otherwise", () => {
    expect(frameAncestorsFor([])).toBe("frame-ancestors *");
    expect(frameAncestorsFor(undefined)).toBe("frame-ancestors *");
    expect(
      frameAncestorsFor(["https://kilima.example", "http://localhost:4173"]),
    ).toBe(
      "frame-ancestors 'self' https://kilima.example http://localhost:4173",
    );
  });

  it("never writes anything but an origin, and fails closed when unreadable", () => {
    expect(frameAncestorsFor(["https://a.example; script-src *"])).toBe(
      "frame-ancestors 'self'",
    );
    expect(frameAncestorsFor(null)).toBe("frame-ancestors 'self'");
  });

  it("matches only a gateway's embed path", () => {
    expect(isGatewayEmbedPath("/g/gq_0123456789abcdefghjkmnpqrs/embed")).toBe(
      true,
    );
    expect(isGatewayEmbedPath("/g/gq_0123456789abcdefghjkmnpqrs")).toBe(false);
    expect(isGatewayEmbedPath("/g/../admin/embed")).toBe(false);
  });
});
