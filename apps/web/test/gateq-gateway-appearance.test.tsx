// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayAppearanceDto } from "@capital-q/contracts";

import {
  frameAncestorsFor,
  isGatewayEmbedPath,
} from "@/features/gateq/embed-frame-policy";

const appearanceAction = vi.fn();
const gatewayStatusAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  appearanceAction: (...args: unknown[]) =>
    appearanceAction(...args) as unknown,
  gatewayStatusAction: (...args: unknown[]) =>
    gatewayStatusAction(...args) as unknown,
}));

const { GatewayAppearancePanel } =
  await import("@/features/gateq/page/gateway-appearance");

afterEach(() => {
  cleanup();
  appearanceAction.mockReset();
  gatewayStatusAction.mockReset();
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
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
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
