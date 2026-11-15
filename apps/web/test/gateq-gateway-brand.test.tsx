// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AA,
  brandPalette,
  contrastRatio,
} from "@/features/brand-theme/brand-colour";
import {
  GatewayAccentStyle,
  GatewayBrandMark,
  gatewayAccentCss,
} from "@/features/gateq/gateway-brand";
import { isWordmark } from "@/features/gateq/gateway-logo-name";

/** jsdom has no layout: give the image the size a browser draws it at. */
function drawn(image: HTMLElement, width: number, height: number) {
  for (const [key, value] of Object.entries({
    naturalWidth: width,
    naturalHeight: height,
    clientWidth: width,
    clientHeight: height,
  })) {
    Object.defineProperty(image, key, { configurable: true, value });
  }
  fireEvent.load(image);
}

afterEach(cleanup);

describe("B6: the public gateway in the investing organisation's brand", () => {
  it("renders the organisation's name and its public card photo as the mark", () => {
    render(
      <GatewayBrandMark
        gateway={{
          organisationDisplayName: "Northwind Ventures",
          organisationPhotoUrl: "https://storage.example/photo.webp?sig=1",
        }}
      />,
    );
    expect(screen.getByText("Northwind Ventures")).toBeTruthy();
    const logo = screen.getByTestId("gateway-brand-logo");
    expect(logo.getAttribute("src")).toBe(
      "https://storage.example/photo.webp?sig=1",
    );
    // Decorative beside the name: no duplicate announcement.
    expect(logo.getAttribute("alt")).toBe("");
    expect(screen.queryByText("Capital Q")).toBeNull();
  });

  it("brand from website: shows the chosen name and the logo from Capital Q's copy, never the site's URL", () => {
    render(
      <GatewayBrandMark
        gateway={{
          publicId: "gq_0123456789abcdefghjkmnpqrs",
          organisationDisplayName: "Northwind Ventures",
          organisationPhotoUrl: "https://storage.example/photo.webp?sig=1",
          gatewayDisplayName: "Northwind",
          gatewayLogo: {
            assetId: "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            kind: "LOGO",
          },
        }}
      />,
    );
    expect(screen.getByText("Northwind")).toBeTruthy();
    const logo = screen.getByTestId("gateway-brand-logo");
    expect(logo.getAttribute("src")).toBe(
      "/g/gq_0123456789abcdefghjkmnpqrs/logo?v=3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    );
    expect(logo.getAttribute("data-logo-kind")).toBe("LOGO");
    expect(logo.className).toContain("object-contain");
  });

  it("a wordmark logo is not followed by the name it spells; the name is its alt", () => {
    render(
      <GatewayBrandMark
        gateway={{
          publicId: "gq_0123456789abcdefghjkmnpqrs",
          organisationDisplayName: "Payfast Ltd",
          organisationPhotoUrl: null,
          gatewayDisplayName: "Payfast",
          gatewayLogo: {
            assetId: "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            kind: "LOGO",
          },
        }}
      />,
    );
    // Before the image has loaded, the name shows beside it.
    expect(screen.getByText("Payfast")).toBeTruthy();
    // Drawn 77×32 (a 60×25 viewBox at h-8): a wordmark.
    drawn(screen.getByTestId("gateway-brand-logo"), 77, 32);
    expect(screen.queryByText("Payfast")).toBeNull();
    expect(screen.getByRole("img", { name: "Payfast" })).toBeTruthy();
  });

  it("a square or mark-and-name logo keeps the name beside it, image decorative", () => {
    render(
      <GatewayBrandMark
        gateway={{
          publicId: "gq_0123456789abcdefghjkmnpqrs",
          organisationDisplayName: "Northwind Ventures",
          organisationPhotoUrl: null,
          gatewayLogo: {
            assetId: "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
            kind: "LOGO",
          },
        }}
      />,
    );
    const logo = screen.getByTestId("gateway-brand-logo");
    drawn(logo, 48, 32);
    expect(screen.getByText("Northwind Ventures")).toBeTruthy();
    expect(logo.getAttribute("alt")).toBe("");
  });

  it("a wordmark is at least 2.2 times as wide as it is tall", () => {
    expect(isWordmark(60, 25)).toBe(true); // Stripe
    expect(isWordmark(400, 100)).toBe(true); // Linear
    expect(isWordmark(64, 32)).toBe(false);
    expect(isWordmark(32, 32)).toBe(false);
    expect(isWordmark(0, 0)).toBe(false);
  });

  it("falls back to the organisation's initial with no photo", () => {
    render(
      <GatewayBrandMark
        gateway={{
          organisationDisplayName: "northwind",
          organisationPhotoUrl: null,
        }}
      />,
    );
    expect(screen.queryByTestId("gateway-brand-logo")).toBeNull();
    expect(screen.getByText("N")).toBeTruthy();
  });

  it("writes the organisation's accent as AA-safe tokens for light and dark", () => {
    const css = gatewayAccentCss("#facc15");
    expect(css).not.toBeNull();
    expect(css).toContain("--cq-accent:");
    expect(css).toContain(':root[data-theme="dark"]');
    // A pale yellow cannot be text on paper as it is; the derivation moves
    // its lightness until it passes, and the sheet carries that colour.
    const palette = brandPalette("#facc15");
    expect(palette?.light.adjusted).toBe(true);
    expect(palette?.light.textContrast).toBeGreaterThanOrEqual(AA);
    expect(palette?.light.fillContrast).toBeGreaterThanOrEqual(AA);
    expect(palette?.dark.textContrast).toBeGreaterThanOrEqual(AA);
    expect(css).toContain(`--cq-accent:${palette?.light.accent ?? ""};`);
    expect(
      contrastRatio(palette?.light.accent ?? "#000000", "#ffffff"),
    ).toBeGreaterThanOrEqual(AA);
  });

  it("writes nothing with no theme, or with anything that is not a colour", () => {
    expect(gatewayAccentCss(null)).toBeNull();
    expect(gatewayAccentCss(undefined)).toBeNull();
    expect(gatewayAccentCss("red;}body{display:none")).toBeNull();
    const { container } = render(<GatewayAccentStyle hex={null} />);
    expect(container.querySelector("style")).toBeNull();
  });

  it("renders a style element only with a colour", () => {
    const { container } = render(<GatewayAccentStyle hex="#0f766e" />);
    const style = container.querySelector("style[data-cq-gateway-brand]");
    expect(style?.textContent).toContain("--cq-accent:");
  });
});
