import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readBackBlocks } from "../src/features/onboarding-conversation/conversation";

// Live 2026-10-29 (shots 25, 56): the read-back was one run-on paragraph in
// heading type, about two screens tall at 390.
describe("the setup read-back is a grouped list in body type", () => {
  const reply =
    "Here's what I have saved:\n\nCompany\nCompany name: Ajali Health\nCountry: Kenya\n\nTeam\nYour role: CEO\n\nIs that all right? Say yes and I'll finish, or tell me what to change.";

  it("parts the reply into its blocks and lines", () => {
    expect(readBackBlocks(reply)).toEqual([
      ["Here's what I have saved:"],
      ["Company", "Company name: Ajali Health", "Country: Kenya"],
      ["Team", "Your role: CEO"],
      [
        "Is that all right? Say yes and I'll finish, or tell me what to change.",
      ],
    ]);
    expect(readBackBlocks("Are the founders all full-time?")).toEqual([
      ["Are the founders all full-time?"],
    ]);
  });

  it("renders a multi-line heading in body type with a list per group", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
      ),
      "utf8",
    );
    const readBack = source.slice(
      source.indexOf("data-read-back"),
      source.indexOf("  if (heading) {"),
    );
    expect(readBack).toContain('<h2 className="cq-body');
    expect(readBack).toContain("<ul");
    expect(readBack).not.toContain("cq-title");
  });
});
