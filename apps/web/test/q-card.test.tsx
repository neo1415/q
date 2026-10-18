// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QCardDto } from "@capital-q/contracts";

/**
 * The Q Card on the web (BIZ-004): the vCard is RFC 2426 3.0 and escapes
 * what it must; values read in words, never codes; the card never carries
 * a field it was not handed; the profile panel claims through the server
 * action, shows refusals beside the field, and saves field scopes with the
 * version it read.
 */

type ActionResult =
  { ok: true; card: QCardDto } | { ok: false; message: string };

const claimHandleAction =
  vi.fn<(subject: unknown, handle: string) => Promise<ActionResult>>();
const updateQCardAction =
  vi.fn<(subject: unknown, input: unknown) => Promise<ActionResult>>();
const askAbout = vi.fn<(seed: string) => void>();
const refresh = vi.fn();

vi.mock("../src/features/q-card/q-card-actions", () => ({
  claimHandleAction: (subject: unknown, handle: string) =>
    claimHandleAction(subject, handle),
  updateQCardAction: (subject: unknown, input: unknown) =>
    updateQCardAction(subject, input),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: vi.fn(), askAbout }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { buildVCard, escapeVCardText } =
  await import("../src/features/q-card/vcard");
const { cardFieldValue, cardTagline, suggestHandle } =
  await import("../src/features/q-card/card-content");
const { QCard } = await import("../src/features/q-card/q-card");
const { QCardPanel } = await import("../src/features/q-card/q-card-panel");

configure({ asyncUtilTimeout: 10_000 });

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const CARD: QCardDto = {
  subjectType: "COMPANY",
  subjectId: COMPANY,
  handle: "kivu",
  publicCode: "abcdefgh23",
  fieldScopes: {
    canonicalName: "public_external",
    shortDescription: "public_external",
    currentStageCode: "network_visible",
  },
  indexable: false,
  scansLast30Days: 3,
  version: 4,
  updatedAt: "2026-09-26T10:00:00.000Z",
};

beforeEach(() => {
  claimHandleAction.mockReset();
  updateQCardAction.mockReset();
  askAbout.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("vCard 3.0", () => {
  it("escapes backslash, comma, semicolon and newlines, and ends lines in CRLF", () => {
    expect(escapeVCardText("A, B; C\\D\nE")).toBe("A\\, B\\; C\\\\D\\nE");
    const card = buildVCard({
      name: "Kivu Freight, Ltd",
      cardUrl: "https://capitalq.example/@kivu",
      websiteUrl: "https://kivu.example",
      note: "Freight; booked.",
    });
    expect(card.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(card).toContain("FN:Kivu Freight\\, Ltd\r\n");
    expect(card).toContain("URL;TYPE=WORK:https://capitalq.example/@kivu\r\n");
    expect(card).toContain("NOTE:Freight\\; booked.\r\n");
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
    // No personal contact fields exist without an opt-in.
    expect(card).not.toMatch(/^(EMAIL|TEL)/m);
  });
});

describe("card content", () => {
  it("reads values in words, never codes", () => {
    expect(
      cardFieldValue({
        key: "currentStageCode",
        value: "seed",
        scope: "network_visible",
      }),
    ).toBe("Seed");
    expect(
      cardFieldValue({
        key: "headquartersCountry",
        value: "KE",
        scope: "public_external",
      }),
    ).toBe("Kenya");
    expect(
      cardFieldValue({
        key: "investorType",
        value: "VC",
        scope: "public_external",
      }),
    ).toBe("Venture capital firm");
  });

  it("suggests a handle that fits the rules", () => {
    expect(suggestHandle("Northstar Logistics (dev)")).toBe(
      "northstar-logistics",
    );
    expect(suggestHandle("Café Ünïcode & Co.")).toBe("cafe-unicode-co");
    expect(suggestHandle("Q")).toMatch(/^[a-z0-9-]{3,}$/);
    expect(
      suggestHandle("A very long company name that keeps going on"),
    ).toHaveLength(29);
  });

  it("uses only the tagline field it was handed", () => {
    expect(cardTagline("COMPANY", [])).toBeNull();
    expect(
      cardTagline("COMPANY", [
        {
          key: "shortDescription",
          value: "Freight.",
          scope: "public_external",
        },
      ]),
    ).toBe("Freight.");
  });
});

describe("the card", () => {
  it("shows the name, the company line, the handle as a link to the public page, and an accessible QR", () => {
    render(
      <QCard
        name="Kivu Freight"
        descriptor="Seed · Nairobi, Kenya"
        tagline="Cross-border freight booking."
        handle="kivu"
        displayUrl="capitalq.example/@kivu"
        qrSvg='<svg viewBox="0 0 10 10"></svg>'
      />,
    );
    const card = screen.getByRole("figure", {
      name: "Q Card for Kivu Freight",
    });
    expect(
      within(card).getByRole("link", { name: /kivu/ }).getAttribute("href"),
    ).toBe("https://capitalq.example/@kivu");
    expect(within(card).getByText("Seed · Nairobi, Kenya")).toBeTruthy();
    // The founder's card design carries no tagline line.
    expect(
      within(card).queryByText("Cross-border freight booking."),
    ).toBeNull();
    expect(
      within(card).getByRole("img", {
        name: "QR code linking to capitalq.example/@kivu",
      }),
    ).toBeTruthy();
  });
});

describe("the profile panel", () => {
  function renderPanel(card: QCardDto | null) {
    return render(
      <QCardPanel
        subjectType="COMPANY"
        subjectId={COMPANY}
        name="Kivu Freight"
        suggestedHandle="kivu-freight"
        card={card}
        cardUrl={card === null ? null : "https://capitalq.example/@kivu"}
        preview={<p>preview</p>}
        fields={[
          { key: "shortDescription", label: "In one line" },
          { key: "currentStageCode", label: "Stage" },
          { key: "websiteUrl", label: "Website" },
        ]}
      />,
    );
  }

  it("creates the card with the suggested handle through the server action", async () => {
    claimHandleAction.mockResolvedValue({ ok: true, card: CARD });
    renderPanel(null);
    const input = screen.getByRole("textbox", {
      name: "Handle for Kivu Freight",
    });
    expect((input as HTMLInputElement).value).toBe("kivu-freight");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(claimHandleAction).toHaveBeenCalledWith(
      { subjectType: "COMPANY", subjectId: COMPANY },
      "kivu-freight",
    );
  });

  it("shows a refusal beside the handle and sends nothing else", async () => {
    claimHandleAction.mockResolvedValue({
      ok: false,
      message: "That handle is reserved and can't be claimed.",
    });
    renderPanel(null);
    const input = screen.getByRole("textbox", {
      name: "Handle for Kivu Freight",
    });
    fireEvent.change(input, { target: { value: "support" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "reserved",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers Q as the other way in", () => {
    renderPanel(null);
    fireEvent.click(screen.getByRole("button", { name: "Ask Q to make it" }));
    expect(askAbout).toHaveBeenCalledWith(
      "Make a Q Card for Kivu Freight with the handle ",
    );
  });

  it("saves field scopes with the version it read, removing a field taken off the card", async () => {
    updateQCardAction.mockResolvedValue({
      ok: true,
      card: { ...CARD, version: 5 },
    });
    renderPanel(CARD);
    expect(screen.getByText(/3 scans of your QR/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Who sees stage" }), {
      target: { value: "hidden" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Who sees website" }),
      { target: { value: "public_external" } },
    );
    // Making a field public says so before anything is saved.
    expect(
      document.querySelector("[data-public-warning]")?.textContent,
    ).toContain("Website becomes public");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Let search engines list the public page/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save card" }));
    await waitFor(() => expect(updateQCardAction).toHaveBeenCalled());
    expect(updateQCardAction).toHaveBeenCalledWith(
      { subjectType: "COMPANY", subjectId: COMPANY },
      {
        expectedVersion: 4,
        fieldScopes: {
          canonicalName: "public_external",
          shortDescription: "public_external",
          websiteUrl: "public_external",
        },
        indexable: true,
      },
    );
    // Success is visible, not only announced.
    expect((await screen.findByRole("status")).textContent).toContain("Saved.");
    expect(refresh).toHaveBeenCalled();
  });

  it("one dropdown per field: off is Nobody, and members-only says nothing public", () => {
    renderPanel({ ...CARD, fieldScopes: { canonicalName: "public_external" } });
    const audience = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Who sees in one line",
    });
    expect(audience.value).toBe("hidden");
    fireEvent.change(audience, { target: { value: "network_visible" } });
    expect(audience.value).toBe("network_visible");
    expect(document.querySelector("[data-public-warning]")).toBeNull();
  });

  it("says the change was not saved when the action itself throws, instead of hanging", async () => {
    updateQCardAction.mockRejectedValue(
      new Error("Failed to find Server Action"),
    );
    renderPanel(CARD);
    fireEvent.click(screen.getByRole("button", { name: "Save card" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "wasn't saved",
    );
    expect(
      screen
        .getByRole("button", { name: "Save card" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
