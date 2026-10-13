// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ context: vi.fn(), gateways: vi.fn() }));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: reads.context,
  apiSession: () =>
    Promise.resolve({
      baseUrl: "https://api.example.test",
      accessToken: "test",
    }),
}));
vi.mock("@capital-q/api-client", () => ({ listGateways: reads.gateways }));
vi.mock("@/components/app-shell/page-container", () => ({
  PageContainer: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/features/gateq/page/gateq-chrome", () => ({
  GateqChrome: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  ErrorBlock: ({ what }: { what: string }) => <p>{what} didn&apos;t load</p>,
}));
vi.mock("@/features/gateq/gateway-controls", () => ({
  OpenGatewayButton: () => <button>Open a new gate</button>,
}));
vi.mock("@/features/gateq/page/investor-views", () => ({
  GateEmpty: ({ onOpen }: { onOpen: ReactNode }) => <div>No gate{onOpen}</div>,
}));
vi.mock("@/features/gateq/page/founder-views", () => ({}));
vi.mock("@/features/gateq/page/inbox-view", () => ({}));
vi.mock("@/features/gateq/policy-editor", () => ({}));
vi.mock("@/features/gateq/public-gateway", () => ({}));
vi.mock("@/features/q-card/public-card-data", () => ({
  appOrigin: () => "https://capitalq.example.test",
}));
vi.mock("@/features/q-card/qr", () => ({}));
vi.mock("@/features/q/q-section", () => ({}));
const { default: GateqPage } = await import("../app/(app)/gateq/page");
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("GateQ distinguishes unavailable authority from an absent gateway", () => {
  it("does not offer creation when the investor's gateway read fails", async () => {
    reads.context.mockResolvedValue({
      kind: "INVESTOR",
      investorOrganisationId: "fund",
    });
    reads.gateways.mockRejectedValue(new Error("transport unavailable"));
    render(await GateqPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Your gate didn't load")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open a new gate" }),
    ).toBeNull();
  });
  it("offers creation when an authorized read confirms no gateway", async () => {
    reads.context.mockResolvedValue({
      kind: "INVESTOR",
      investorOrganisationId: "fund",
    });
    reads.gateways.mockResolvedValue({ gateways: [] });
    render(await GateqPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("button", { name: "Open a new gate" }),
    ).toBeTruthy();
  });
  it("does not recast a failed context read as a founder", async () => {
    reads.context.mockResolvedValue({ kind: "NONE", unavailable: true });
    render(await GateqPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("GateQ didn't load")).toBeTruthy();
    expect(reads.gateways).not.toHaveBeenCalled();
  });
});
