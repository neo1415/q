// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  context: vi.fn(),
  gateways: vi.fn(),
  inbox: vi.fn(),
  item: vi.fn(),
}));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: reads.context,
  apiSession: () =>
    Promise.resolve({ baseUrl: "https://api.example.test", accessToken: "t" }),
}));
vi.mock("@capital-q/api-client", () => ({
  listGateways: reads.gateways,
  getGateqInbox: reads.inbox,
  getGateqInboxItem: reads.item,
}));
vi.mock("@/components/app-shell/page-container", () => ({
  PageContainer: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/features/gateq/page/gateq-chrome", () => ({
  GateqChrome: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  ErrorBlock: () => null,
}));
vi.mock("@/features/gateq/gateway-controls", () => ({
  OpenGatewayButton: () => null,
}));
vi.mock("@/features/gateq/page/investor-views", () => ({}));
vi.mock("@/features/gateq/page/founder-views", () => ({}));
vi.mock("@/features/gateq/page/inbox-view", () => ({
  CopyLink: () => null,
  InboxView: (props: {
    inbox: { view: string } | null;
    initialDetail: { item: { applicationId: string } } | null;
    missingItem?: boolean;
  }) => (
    <p data-testid="inbox">
      {`view=${props.inbox?.view ?? "none"} open=${props.initialDetail?.item.applicationId ?? "none"} missing=${String(props.missingItem ?? false)}`}
    </p>
  ),
}));
vi.mock("@/features/gateq/policy-editor", () => ({}));
vi.mock("@/features/gateq/public-gateway", () => ({}));
vi.mock("@/features/q-card/public-card-data", () => ({
  appOrigin: () => "https://capitalq.example.test",
}));
vi.mock("@/features/q-card/qr", () => ({}));
vi.mock("@/features/q/q-section", () => ({
  QSection: () => null,
  QPageState: () => null,
}));
const { default: GateqPage } = await import("../app/(app)/gateq/page");

const ARCHIVED = "00000000-0000-4000-8000-0000000000a1";
const NEWEST = "00000000-0000-4000-8000-0000000000a2";
const FOREIGN = "00000000-0000-4000-8000-0000000000a9";
const detail = (id: string, folder: string) => ({
  item: { applicationId: id, folder },
});

function investor() {
  reads.context.mockResolvedValue({
    kind: "INVESTOR",
    investorOrganisationId: "fund",
    label: "Fund",
  });
  reads.gateways.mockResolvedValue({
    gateways: [{ id: "gw", status: "ACTIVE", publicId: "gq_x" }],
  });
  reads.inbox.mockImplementation((_s: unknown, _g: string, view: string) =>
    Promise.resolve({
      view,
      items:
        view === "ARCHIVED"
          ? [{ applicationId: ARCHIVED }]
          : [{ applicationId: NEWEST }],
      counts: { INBOX: 1 },
    }),
  );
  reads.item.mockImplementation((_s: unknown, _g: string, id: string) =>
    id === ARCHIVED
      ? Promise.resolve(detail(ARCHIVED, "ARCHIVED"))
      : id === NEWEST
        ? Promise.resolve(detail(NEWEST, "INBOX"))
        : Promise.reject(Object.assign(new Error("nf"), { status: 404 })),
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("GateQ ?item= deep links (CRM record links)", () => {
  it("opens an archived application in its own folder, not the newest", async () => {
    investor();
    render(
      await GateqPage({
        searchParams: Promise.resolve({ tab: "inbox", item: ARCHIVED }),
      }),
    );
    expect(screen.getByTestId("inbox").textContent).toBe(
      `view=ARCHIVED open=${ARCHIVED} missing=false`,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the linked item's folder wins over a stale view parameter", async () => {
    investor();
    render(
      await GateqPage({
        searchParams: Promise.resolve({
          tab: "inbox",
          view: "INBOX",
          item: ARCHIVED,
        }),
      }),
    );
    expect(screen.getByTestId("inbox").textContent).toContain("view=ARCHIVED");
  });

  it("an application they cannot see says so and opens nothing in its place", async () => {
    investor();
    for (const item of [FOREIGN, "not-an-id"]) {
      render(
        await GateqPage({
          searchParams: Promise.resolve({ tab: "inbox", item }),
        }),
      );
      expect(screen.getByRole("alert").textContent).toMatch(
        /isn.t in your GateQ inbox/,
      );
      expect(screen.getByTestId("inbox").textContent).toBe(
        "view=INBOX open=none missing=true",
      );
      cleanup();
    }
    // A malformed id is never sent to the API.
    expect(reads.item.mock.calls.map((call) => String(call[2]))).toEqual([
      FOREIGN,
    ]);
  });

  it("without ?item= the newest application opens, as before", async () => {
    investor();
    render(
      await GateqPage({ searchParams: Promise.resolve({ tab: "inbox" }) }),
    );
    expect(screen.getByTestId("inbox").textContent).toBe(
      `view=INBOX open=${NEWEST} missing=false`,
    );
  });
});
