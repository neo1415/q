import { describe, expect, it } from "vitest";

import {
  youSectionsFor,
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

describe("Q Pitch out of the sidebar (owner, 17 Oct): Profile links it", () => {
  it("is never a sidebar or More entry, enabled or not", () => {
    for (const scope of [
      "founder_private",
      "investor_private",
      "unset",
    ] as const) {
      expect(hrefs(scope, true)).not.toContain("/q-pitch");
      expect(
        youSectionsFor(scope, { qPitch: true }).map((i) => i.href),
      ).not.toContain("/q-pitch");
    }
  });

  it("is still a registered app route, so Q opens it directly", () => {
    expect(APP_ROUTE_PATTERNS).toContain("/q-pitch");
  });
});

describe("tour entry model", () => {
  it("offers the story, the premiere and the two-minute version as full-load tour links", () => {
    const options = tourOptions(NOW);
    expect(options.map((o) => o.href)).toEqual([
      "/home?qpitch=story&new=1",
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
    // The Atlas lists every chapter, the deeper ones included.
    expect(standing["ch.premiere.privacy"]).toBe("CERTIFIED");
    expect(standing["ch.premiere.mandate"]).toBe("CERTIFIED");
    expect(standing["ch.premiere.rehearsal"]).toBe("INTERNAL_ONLY");
    expect(standing["ch.atlas.risks"]).toBe("CERTIFIED");
    for (const chapter of chapters) {
      expect(chapter.href).toBe(
        `/home?qpitch=atlas&chapter=${encodeURIComponent(chapter.chapterId)}`,
      );
    }
  });
});
