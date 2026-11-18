import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  importSiteMarkdown,
  parseSiteBlocks,
  publicSiteBlocks,
  resolveSitePlaceholders,
  type SiteBlock,
  type SiteSettings,
} from "@capital-q/contracts";

import {
  landingCopyFrom,
  DEFAULT_LANDING_COPY,
} from "../src/features/landing/landing-copy";
import { SiteBlocks } from "../src/features/site-content/site-blocks";
import { SitePageView } from "../src/features/site-content/site-page-view";

/**
 * Decision 107: the site content renderer and the default content. What a
 * visitor gets is text nodes from structured blocks -- a script typed into
 * a block is shown as characters, an unsafe link is never an href, and a
 * lawyer note never leaves the editor.
 */

const DEFAULTS = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "content",
  "defaults",
);
const FILES = readdirSync(DEFAULTS).filter(
  (f) => f.endsWith(".md") && f !== "README.md",
);
const SETTINGS: SiteSettings = {
  companyName: "Northwind",
  legalEntity: "Northwind Intelligence Ltd",
  registeredAddress: null,
  contactEmail: "privacy@example.invalid",
  governingLawCity: "Lagos",
};
const page = (file: string) =>
  importSiteMarkdown(readFileSync(join(DEFAULTS, file), "utf8"));

describe("the default content imports into valid blocks", () => {
  it.each(FILES)("%s", (file) => {
    const imported = page(file);
    expect(imported.slug).toMatch(/^[a-z0-9-]+$/u);
    expect(imported.blocks.length).toBeGreaterThan(0);
    // Deterministic: a second import is identical (the seed relies on it).
    expect(page(file)).toEqual(imported);
    if (imported.kind === "legal") {
      expect(imported.status).toBe("DRAFT_PENDING_LEGAL_REVIEW");
    }
  });

  it("keeps lawyer notes, the summary box, FAQ groups and both pricing tables", () => {
    const terms = page("terms-of-service.md");
    expect(terms.blocks[0]?.type).toBe("summary");
    expect(
      terms.blocks.some(
        (b) =>
          b.type === "legalClause" && (b.lawyerNote ?? "").includes("FCCPA"),
      ),
    ).toBe(true);
    const faq = page("faq.md");
    expect(faq.blocks.every((b) => b.type === "faq")).toBe(true);
    const pricing = page("pricing.md");
    const tables = pricing.blocks.filter((b) => b.type === "pricing");
    expect(tables).toHaveLength(2);
    const founder = tables[0]?.type === "pricing" ? tables[0] : null;
    expect(founder?.plans.map((p) => [p.name, p.monthly, p.annual])).toEqual([
      ["Founder Free", "0", "0"],
      ["Founder Pro", "29", "290"],
      ["Founder Premium", "99", "990"],
    ]);
  });
});

describe("rendering", () => {
  it("shows a script typed into text as characters, never as markup", () => {
    const blocks: SiteBlock[] = parseSiteBlocks([
      {
        type: "richText",
        id: "r",
        content: [
          { kind: "paragraph", spans: [{ text: "<script>alert(1)</script>" }] },
        ],
      },
      {
        type: "heading",
        id: "h",
        level: 2,
        text: "<img src=x onerror=alert(1)>",
      },
    ]);
    const html = renderToStaticMarkup(<SiteBlocks blocks={blocks} />);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("never renders an unsafe link, even one handed to it directly", () => {
    const html = renderToStaticMarkup(
      <SiteBlocks
        blocks={[
          {
            type: "richText",
            id: "r",
            content: [
              {
                kind: "paragraph",
                spans: [
                  { text: "bad", href: "javascript:alert(1)" },
                  { text: "good", href: "/legal/terms" },
                ],
              },
            ],
          },
        ]}
      />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="/legal/terms"');
  });

  it("refuses a javascript: button and drops a javascript: span link at the boundary", () => {
    expect(() =>
      parseSiteBlocks([
        {
          type: "button",
          id: "b",
          label: "Go",
          href: "javascript:alert(1)",
          variant: "primary",
        },
      ]),
    ).toThrow();
    expect(
      parseSiteBlocks([
        {
          type: "richText",
          id: "r",
          content: [
            {
              kind: "paragraph",
              spans: [{ text: "x", href: "javascript:void(0)" }],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        type: "richText",
        id: "r",
        content: [{ kind: "paragraph", spans: [{ text: "x" }] }],
      },
    ]);
  });

  it("a published legal page carries no lawyer note and no raw placeholder", () => {
    const terms = page("terms-of-service.md");
    const html = renderToStaticMarkup(
      <SitePageView
        page={{
          kind: "legal",
          title: terms.title,
          summary: resolveSitePlaceholders(terms.summary, SETTINGS),
          effectiveDate: terms.effectiveDate,
          versionNumber: 1,
          blocks: publicSiteBlocks(terms.blocks, SETTINGS),
        }}
      />,
    );
    expect(html).not.toContain("FCCPA");
    expect(html).not.toContain("Lawyer note");
    expect(html).not.toContain("{{");
    expect(html).toContain("Northwind Intelligence Ltd");
    expect(html).toContain("[Registered office address]");
    expect(html).toContain('aria-label="Contents"');
    expect(html).toContain("Effective 18 November 2026, version 1");
  });

  it("renders the pricing plans with their prices and perks", () => {
    const pricing = page("pricing.md");
    const html = renderToStaticMarkup(
      <SiteBlocks blocks={publicSiteBlocks(pricing.blocks, SETTINGS)} />,
    );
    expect(html).toContain("Founder Pro");
    expect(html).toContain("$29");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Questions about limits");
  });
});

describe("the landing page reads the CMS, with today's copy as the fallback", () => {
  it("falls back entirely when nothing is published or the API is away", () => {
    expect(landingCopyFrom(null)).toBe(DEFAULT_LANDING_COPY);
    expect(landingCopyFrom({ sections: [] })).toBe(DEFAULT_LANDING_COPY);
  });

  it("takes the published hero and keeps the rest", () => {
    const copy = landingCopyFrom({
      sections: [
        {
          slug: "landing-hero",
          order: 1,
          anchor: "hero",
          title: "Hero",
          blocks: parseSiteBlocks([
            { type: "heading", id: "h", level: 1, text: "Evidence first." },
            {
              type: "richText",
              id: "r",
              content: [
                { kind: "paragraph", spans: [{ text: "A new lede." }] },
              ],
            },
            {
              type: "button",
              id: "b",
              label: "Start",
              href: "/auth/sign-up",
              variant: "primary",
            },
          ]),
        },
      ],
    });
    expect(copy.hero.title).toBe("Evidence first.");
    expect(copy.hero.lede).toBe("A new lede.");
    expect(copy.hero.primary).toEqual({
      label: "Start",
      href: "/auth/sign-up",
    });
    expect(copy.hero.secondary).toEqual(DEFAULT_LANDING_COPY.hero.secondary);
    expect(copy.final).toEqual(DEFAULT_LANDING_COPY.final);
  });

  it("the seeded landing sections give today's words back", () => {
    const sections = FILES.filter((f) => f.startsWith("landing-")).map((f) => {
      const imported = page(f);
      return {
        slug: imported.slug,
        order: imported.order,
        anchor: imported.anchor,
        title: imported.title,
        blocks: publicSiteBlocks(imported.blocks, {
          ...SETTINGS,
          companyName: "Capital Q",
        }),
      };
    });
    const copy = landingCopyFrom({ sections });
    expect(copy.hero.title).toBe(DEFAULT_LANDING_COPY.hero.title);
    expect(copy.hero.lede).toBe(DEFAULT_LANDING_COPY.hero.lede);
    expect(copy.final.title).toBe(DEFAULT_LANDING_COPY.final.title);
    expect(copy.questions.items.length).toBeGreaterThan(0);
  });
});
