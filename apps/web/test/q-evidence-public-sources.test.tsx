// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import { QEvidence } from "../src/features/q/q-evidence";

/**
 * Public web sources sit behind Sources, closed by default (R23, R38): the
 * answer reads first, and the page, its site and its date are one tap away.
 */
const TURN: Extract<QTurn, { kind: "Q" }> = {
  kind: "Q",
  id: "q-1",
  text: "Public sources say Northstar opened a Kenya hub.",
  streaming: false,
  sourceCount: 0,
  publicSources: [
    {
      url: "https://news.example.com/2026/09/northstar",
      domain: "news.example.com",
      title: "Northstar expands to Kenya",
      publishedOn: "2026-09-02",
      retrievedOn: "2026-09-27",
    },
    {
      url: "https://northstar.example.com/about",
      domain: "northstar.example.com",
      title: "northstar.example.com",
      publishedOn: null,
      retrievedOn: "2026-09-27",
    },
  ],
  findings: [],
  uncertainties: [],
  blocks: [],
};

describe("QEvidence public sources", () => {
  it("lists each page as a card with its site and date, behind a closed Sources, that opens to its link", () => {
    const { container } = render(<QEvidence turn={TURN} />);
    const details = container.querySelector("details[data-q-evidence]");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("2 sources");
    // Each page is a card that opens in place (2026-10-19): closed, its
    // link is out of reach; open, "Open page" goes to it.
    const card = screen.getByRole("button", {
      name: /Northstar expands to Kenya/,
    });
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(
      card.closest("[data-q-public-source]")?.querySelector("[inert]"),
    ).not.toBeNull();
    fireEvent.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("true");
    const opened = card.closest("[data-q-public-source]");
    if (!(opened instanceof HTMLElement)) throw new Error("no card");
    const link = within(opened).getByRole("link", { name: "Open page" });
    expect(link.getAttribute("href")).toBe(
      "https://news.example.com/2026/09/northstar",
    );
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(container.textContent).toContain("news.example.com · 2 Sept 2026");
    expect(container.textContent).toContain(
      "northstar.example.com · read 27 Sept 2026",
    );
    expect(container.textContent).toContain("Public sources, unverified");
  });
});
