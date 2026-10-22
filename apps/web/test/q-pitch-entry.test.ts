import { describe, expect, it } from "vitest";

import {
  youSectionsFor,
  navigationGroupsFor,
} from "../src/components/app-shell/navigation";
import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";
import { tourOptions } from "@/features/q-pitch/atlas";

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
  it("offers the v7 story only (the v5 tours are retired), with its honest standing", () => {
    const options = tourOptions(NOW);
    expect(options.map((o) => o.href)).toEqual(["/home?qpitch=story&new=1"]);
    const [story] = options;
    expect(story?.scenes).toBeGreaterThan(0);
    expect(story?.certifiedScenes).toBeLessThanOrEqual(story?.scenes ?? 0);
  });
});
