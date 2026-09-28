// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QArtifactIdSchema } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QAnswer, replyParts } = await import("../src/features/q/q-answer");

/**
 * A Q reply as a chat row (founder direction A, 2026-09-28; ADR 0018):
 * the answer as structure, a document Q made inline, and what it rests on
 * behind small chips that start closed, open in place and close again.
 * Collapsed is not removed: the panels are on the page, hidden.
 */

const COMPANY = "c0000000-0000-4000-8000-000000000001";

function turn(
  overrides: Partial<Extract<QTurn, { kind: "Q" }>> = {},
): Extract<QTurn, { kind: "Q" }> {
  return {
    kind: "Q",
    id: "q-1",
    text: "Two things stand out:\n\n- **Revenue** is growing\n- Churn is *not known*",
    streaming: false,
    sourceCount: 2,
    publicSources: [],
    findings: [
      {
        id: "f-1",
        type: "INFERENCE",
        statement: "Growth is likely seasonal.",
        confidence: "LOW",
        sourceCount: 1,
      },
    ],
    uncertainties: [],
    blocks: [
      {
        kind: "COMPANY_REFERENCE",
        companyId: COMPANY,
      },
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: QArtifactIdSchema.parse(
          "a0000000-0000-4000-8000-000000000001",
        ),
        type: "INVESTMENT_BRIEF",
        status: "READY",
        title: "Acme brief",
      },
    ],
    ...overrides,
  };
}

describe("a Q reply in the chat thread", () => {
  it("reads as structure, with no stacked cards and no Q label card", () => {
    const { container } = render(<QAnswer turn={turn()} mark={false} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Revenue");
    expect(screen.queryByText("Answer")).toBeNull();
    expect(screen.queryByText("Show exchange")).toBeNull();
    // A document Q made stays inline, compact.
    expect(screen.getByText("Acme brief")).toBeTruthy();
  });

  it("puts sources and companies behind chips that start closed", () => {
    const { container } = render(<QAnswer turn={turn()} mark={false} />);
    const sources = screen.getByRole("button", {
      name: /^Sources · 2 sources/,
    });
    const companies = screen.getByRole("button", { name: /^Company · 1/ });
    expect(sources.getAttribute("aria-expanded")).toBe("false");
    expect(companies.getAttribute("aria-expanded")).toBe("false");
    const panel = container.querySelector('[data-q-panel="sources"]');
    // Hidden, not removed: the provenance is on the page.
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(panel?.textContent).toContain("Growth is likely seasonal.");
    expect(panel?.textContent).toContain("Inference");
    expect(sources.getAttribute("aria-controls")).toBe(panel?.id);
  });

  it("expands a chip in place and collapses it again", async () => {
    const user = userEvent.setup();
    const { container } = render(<QAnswer turn={turn()} mark={false} />);
    const sources = screen.getByRole("button", { name: /^Sources/ });
    const companies = screen.getByRole("button", { name: /^Company/ });
    const sourcesPanel = container.querySelector('[data-q-panel="sources"]');
    const companiesPanel = container.querySelector(
      '[data-q-panel="companies"]',
    );

    await user.click(sources);
    expect(sources.getAttribute("aria-expanded")).toBe("true");
    expect(sourcesPanel?.hasAttribute("hidden")).toBe(false);

    // One open at a time: opening another closes the first.
    await user.click(companies);
    expect(companies.getAttribute("aria-expanded")).toBe("true");
    expect(sources.getAttribute("aria-expanded")).toBe("false");
    expect(sourcesPanel?.hasAttribute("hidden")).toBe(true);
    expect(companiesPanel?.hasAttribute("hidden")).toBe(false);

    await user.click(companies);
    expect(companies.getAttribute("aria-expanded")).toBe("false");
    expect(companiesPanel?.hasAttribute("hidden")).toBe(true);
  });

  it("shows no chips for an answer with nothing behind it", () => {
    render(
      <QAnswer
        turn={turn({ sourceCount: 0, findings: [], blocks: [] })}
        mark={false}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "About this answer" }),
    ).toBeNull();
  });

  it("fills in as it streams: a list appears item by item", () => {
    const text = "Options:\n\n- First\n- Second";
    const { container, rerender } = render(
      <QAnswer
        turn={turn({
          text: text.slice(0, text.indexOf("- Second")),
          streaming: true,
          blocks: [],
        })}
        mark={false}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(
      container.querySelector("[data-q-answer]")?.getAttribute("data-q-answer"),
    ).toBe("streaming");
    rerender(
      <QAnswer
        turn={turn({ text, streaming: false, blocks: [] })}
        mark={false}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(
      container.querySelector("[data-q-answer]")?.getAttribute("data-q-answer"),
    ).toBe("settled");
  });

  it("keeps what Q made inline and what it named behind a chip", () => {
    const proposal = turn().blocks.map((block) => block.kind);
    expect(proposal).not.toContain("ACTION_PROPOSAL");
    const parts = replyParts(turn().blocks);
    expect(parts.inline.map((block) => block.kind)).toEqual([
      "ARTIFACT_REFERENCE",
    ]);
    expect(parts.companies).toHaveLength(1);
  });
});
