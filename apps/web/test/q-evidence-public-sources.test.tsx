// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
  it("lists each page as a link with its site and date, behind a closed Sources", () => {
    const { container } = render(<QEvidence turn={TURN} />);
    const details = container.querySelector("details[data-q-evidence]");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("2 sources");
    const link = screen.getByRole("link", {
      name: "Northstar expands to Kenya",
    });
    expect(link.getAttribute("href")).toBe(
      "https://news.example.com/2026/09/northstar",
    );
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("news.example.com · 2 Sept 2026");
    expect(container.textContent).toContain(
      "northstar.example.com · read 27 Sept 2026",
    );
    expect(container.textContent).toContain("Public sources, unverified");
  });
});
