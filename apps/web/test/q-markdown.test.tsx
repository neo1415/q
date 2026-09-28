// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  parseMarkdown,
  plainFromMarkdown,
  QMarkdown,
  safeHref,
} from "../src/features/q/markdown";

/**
 * Q's answers as structure (founder direction D, 2026-09-28): a small
 * Markdown subset rendered as React text nodes only -- never HTML, never a
 * link that is not http(s) -- and readable while it is still arriving.
 */

function html(text: string, streaming = false): HTMLElement {
  const { container } = render(<QMarkdown text={text} streaming={streaming} />);
  const root = container.querySelector("[data-q-markdown]");
  if (!(root instanceof HTMLElement)) throw new Error("no markdown root");
  return root;
}

describe("Q markdown safety", () => {
  it("never interprets HTML: a script is characters, not an element", () => {
    const root = html(
      'Look <script>alert(1)</script> and <img src=x onerror="alert(2)"> **bold <b>x</b>**',
    );
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.textContent).toContain("<b>x</b>");
    expect(root.querySelector("strong")?.textContent).toBe("bold <b>x</b>");
  });

  it("drops javascript:, data: and relative links but keeps their words", () => {
    const root = html(
      "[one](javascript:alert(1)) [two](data:text/html,hi) [three](/admin) [four](JaVaScRiPt:void(0)) [five](https://example.com/a?b=1)",
    );
    const links = [...root.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/a?b=1");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(root.textContent).toContain("one two three four five");
    expect(root.innerHTML).not.toMatch(/javascript:|data:text/i);
  });

  it("accepts only absolute http(s) URLs", () => {
    expect(safeHref("https://a.example")).toBe("https://a.example/");
    expect(safeHref("http://a.example/x")).toBe("http://a.example/x");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" java\tscript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("mailto:a@b.c")).toBeNull();
  });

  it("gives an answer no raw-HTML path: attributes never come from the text", () => {
    const root = html(
      '| a | b |\n|---|---|\n| <a href="javascript:x">c</a> | d |',
    );
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("td")?.textContent).toBe("d");
  });
});

describe("Q markdown structure", () => {
  it("renders lists, headings, tables and emphasis as real elements", () => {
    const root = html(
      [
        "## Two options",
        "",
        "- **Acme** leads on revenue",
        "- *Beta* leads on growth",
        "  - nested detail",
        "",
        "1. First",
        "2. Second",
        "",
        "| Metric | Acme | Beta |",
        "|:--|--:|:-:|",
        "| ARR | $1.2m | |",
      ].join("\n"),
    );
    expect(root.querySelector("h3")?.textContent).toBe("Two options");
    const bullets = root.querySelector("ul");
    expect(bullets?.children).toHaveLength(2);
    expect(bullets?.querySelector("strong")?.textContent).toBe("Acme");
    expect(bullets?.querySelector("em")?.textContent).toBe("Beta");
    expect(bullets?.querySelector("li ul li")?.textContent).toBe(
      "nested detail",
    );
    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
    const table = root.querySelector("table");
    expect(
      [...(table?.querySelectorAll("thead th") ?? [])].map(
        (th) => th.textContent,
      ),
    ).toEqual(["Metric", "Acme", "Beta"]);
    // An empty cell is unknown, never a zero.
    expect(table?.querySelector("tbody")?.textContent).toContain("Not known");
    expect(table?.querySelector("td")?.className).toContain("text-right");
  });

  it("lays a list of labelled values out as a key-value card", () => {
    const root = html(
      "- **Stage:** Seed\n- **Raise:** $2m\n- **Runway:** 14 months",
    );
    const card = root.querySelector("[data-md-kv]");
    expect(card?.querySelectorAll("dt")).toHaveLength(3);
    expect(card?.querySelector("dt")?.textContent).toBe("Stage");
    expect(card?.querySelector("dd")?.textContent).toBe("Seed");
  });

  it("colours a callout by meaning and always says the meaning in words", () => {
    const root = html("> [!RISK]\n> Customer concentration is high.");
    const callout = root.querySelector("[data-md-callout]");
    expect(callout?.getAttribute("data-md-callout")).toBe("danger");
    expect(callout?.textContent).toContain("Risk");
    expect(callout?.textContent).toContain("Customer concentration is high.");
    expect(callout?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});

describe("Q markdown while it streams", () => {
  it("shows an unclosed bold as bold, not as asterisks", () => {
    const root = html("Acme is **the stronger", true);
    expect(root.querySelector("strong")?.textContent).toBe("the stronger");
    expect(root.textContent).not.toContain("**");
    // Settled, an unmatched marker is simply what was written.
    expect(html("a **b").textContent).toContain("**b");
  });

  it("shows a link's words before its target arrives", () => {
    const root = html("See [the filing](https://exa", true);
    expect(root.textContent).toBe("See the filing");
    expect(root.querySelector("a")).toBeNull();
  });

  it("holds a table back until its separator arrives, then fills it in row by row", () => {
    const text =
      "Side by side:\n\n| Metric | Acme | Beta |\n|---|---|---|\n| ARR | $1m | $2m |\n| Growth | 10% | 20% |";
    const cut = text.indexOf("|---");
    const header = html(text.slice(0, cut + 4), true);
    expect(header.textContent).toBe("Side by side:");
    expect(header.textContent).not.toContain("|");

    const steps = [
      text.indexOf("| ARR"),
      text.indexOf("| Growth"),
      text.length,
    ];
    const rows = steps.map(
      (end) =>
        html(text.slice(0, end), true).querySelectorAll("tbody tr").length,
    );
    expect(rows).toEqual([0, 1, 2]);
  });

  it("parses every prefix of an answer without throwing", () => {
    const text =
      "## Head\n\n- **a** [x](https://e.x) `c`\n  1. n\n\n> [!NOTE]\n> hi\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n```\ncode\n```";
    for (let end = 0; end <= text.length; end += 1) {
      expect(() => parseMarkdown(text.slice(0, end), true)).not.toThrow();
      expect(() => html(text.slice(0, end), true)).not.toThrow();
    }
  });
});

describe("Q markdown aloud", () => {
  it("speaks the words and none of the syntax", () => {
    const spoken = plainFromMarkdown(
      "## Summary\n\n- **Acme** leads, see [filing](https://e.x)\n- `ARR` is *up*\n\n| Metric | Acme |\n|---|---|\n| ARR | $1m |\n\n> [!RISK]\n> Churn is high.",
    );
    expect(spoken).not.toMatch(/[*#`|[\]>]/);
    expect(spoken).toContain("Summary");
    expect(spoken).toContain("Acme leads, see filing");
    expect(spoken).toContain("ARR is up");
    expect(spoken).toContain("ARR, $1m");
    expect(spoken).toContain("Churn is high.");
    expect(spoken).not.toContain("https://");
  });
});
