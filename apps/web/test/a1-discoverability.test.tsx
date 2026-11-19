// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RelationshipsEmpty } from "../src/features/relationships/relationships-empty";

const source = (path: string) =>
  readFileSync(join(import.meta.dirname, "..", path), "utf8");

/** Admin design 2026-11-19, slice A1: what each place links to. */
describe("A1 discoverability", () => {
  it("keeps platform-wide operator settings out of personal Settings (D4)", () => {
    const settings = source("src/features/settings/settings-view.tsx");
    expect(settings).not.toContain("/admin/brand");
    expect(settings).not.toContain("/admin/etiquette");
  });

  it("links the Plan page to the public comparison (D5)", () => {
    const plan = source("src/features/billing/plan-view.tsx");
    expect(plan).toContain('href="/pricing"');
    expect(plan).toContain('t("Compare plans")');
  });

  it("offers the import from an empty pipeline (D2)", () => {
    render(
      <RelationshipsEmpty
        sentence="No relationships yet."
        href="/discover"
        action="Open Discover"
        importable
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Import your pipeline" })
        .getAttribute("href"),
    ).toBe("/relationships/import");
  });

  it("offers no import where the empty state does not ask for it", () => {
    render(
      <RelationshipsEmpty
        sentence="Set yours up."
        href="/welcome"
        action="Set up"
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Import your pipeline" }),
    ).toBeNull();
  });
});
