import { describe, expect, it } from "vitest";

import {
  moreSectionsFor,
  navigationGroupsFor,
} from "../src/components/app-shell/navigation";
import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";
import { atlasChapters, tourOptions } from "@/features/q-pitch/atlas";

const NOW = "2026-10-15T12:00:00Z";
const hrefs = (
  scope: "founder_private" | "investor_private" | "unset",
  qPitch?: boolean,
) =>
  navigationGroupsFor(scope, { qPitch }).flatMap((g) =>
    g.items.map((i) => i.href),
  );

describe("Q Pitch in the sidebar (owner request, 15 Oct)", () => {
  it("is listed only when the server enabled it", () => {
    expect(hrefs("investor_private")).not.toContain("/q-pitch");
    expect(hrefs("investor_private", false)).not.toContain("/q-pitch");
    expect(hrefs("investor_private", true)).toContain("/q-pitch");
  });

  it("is role-aware: a founder or investor workspace, never an unset one", () => {
    expect(hrefs("founder_private", true)).toContain("/q-pitch");
    expect(hrefs("unset", true)).not.toContain("/q-pitch");
  });

  it("sits in Workspace, and the phone's More sheet lists it too", () => {
    const workspace = navigationGroupsFor("investor_private", {
      qPitch: true,
    }).find((g) => g.label === "Workspace");
    expect(workspace?.items.map((i) => i.href)).toContain("/q-pitch");
    expect(
      moreSectionsFor("investor_private", { qPitch: true }).map((i) => i.href),
    ).toContain("/q-pitch");
  });

  it("is a registered app route", () => {
    expect(APP_ROUTE_PATTERNS).toContain("/q-pitch");
  });
});

describe("tour entry model", () => {
  it("offers the premiere and the two-minute version as full-load tour links", () => {
    const options = tourOptions(NOW);
    expect(options.map((o) => o.href)).toEqual([
      "/home?qpitch=premiere",
      "/home?qpitch=short",
    ]);
    const short = options.find((o) => o.key === "short");
    expect(short?.certifiedScenes).toBe(short?.scenes);
    const premiere = options.find((o) => o.key === "premiere");
    expect(premiere?.certifiedScenes).toBeLessThan(premiere?.scenes ?? 0);
  });

  it("lists every premiere chapter with its honest standing", () => {
    const chapters = atlasChapters(NOW);
    const standing = Object.fromEntries(
      chapters.map((c) => [c.chapterId, c.standing]),
    );
    expect(standing["ch.premiere.gateq"]).toBe("CERTIFIED");
    expect(standing["ch.premiere.privacy"]).toBe("CERTIFIED");
    expect(standing["ch.premiere.rehearsal"]).toBe("INTERNAL_ONLY");
    for (const chapter of chapters) {
      expect(chapter.href).toBe(
        `/home?qpitch=premiere&chapter=${encodeURIComponent(chapter.chapterId)}`,
      );
    }
  });
});
