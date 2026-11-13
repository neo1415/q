// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
