// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { InvestorGateFitDto } from "@capital-q/contracts";
import { FOUNDER_V6_SCRIPT, buildStepGraph } from "@capital-q/q-pitch";

import { DraftFill } from "@/features/q-pitch/founder/draft-fill";
import {
  MATCH_ANCHORS,
  closestMatches,
} from "@/features/q-pitch/founder/matches";
import { lightSection, unlightAll } from "@/features/q-pitch/section-light";

afterEach(cleanup);

const WEB = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) ? [readFileSync(path, "utf8")] : [];
  });
}

describe("founder track anchors (v6)", () => {
  const code = [
    ...sources(join(WEB, "src")),
    ...sources(join(WEB, "app")),
  ].join("\n");
  const anchors = buildStepGraph(FOUNDER_V6_SCRIPT).steps.flatMap(
    (step) => step.anchors,
  );

  it("every section the founder track talks about is marked on its page", () => {
    expect(anchors.length).toBeGreaterThan(40);
    for (const anchor of anchors) {
      // The pitch board marks its sections from the pitch content itself.
      if (anchor.startsWith("fdr.02.pitch.")) continue;
      expect(code.includes(anchor), anchor).toBe(true);
    }
    expect(code).toContain("data-qp-anchor={pitchSectionAnchor(section.key)}");
  });
});

function gate(
  id: string,
  standings: readonly ("MET" | "NOT_MET" | "UNKNOWN")[],
  required: readonly boolean[] = [],
): InvestorGateFitDto {
  return {
    investorOrganisationId: id,
    publicId: `g-${id}`,
    title: "Gate",
    acceptingApplications: true,
    criteria: standings.map((standing, index) => ({
      label: `c${String(index)}`,
      requiredness: required[index] === true ? "REQUIRED" : "PREFERRED",
      dimension: "TAXONOMY",
      standing,
    })),
  };
}

describe("the three closest matches (code, from published gates only)", () => {
  it("ranks by required misses, then share met, and skips no-gate or nothing-met", () => {
    const gates = new Map([
      ["a", gate("a", ["MET", "NOT_MET"], [false, true])],
      ["b", gate("b", ["MET", "MET", "UNKNOWN"])],
      ["c", gate("c", ["MET", "MET", "MET"])],
      ["d", gate("d", ["NOT_MET", "UNKNOWN"])],
      ["e", gate("e", ["MET", "NOT_MET"])],
    ]);
    const matches = closestMatches(["a", "b", "c", "d", "e", "f"], gates);
    expect([...matches.entries()]).toEqual([
      ["c", MATCH_ANCHORS[0]],
      ["b", MATCH_ANCHORS[1]],
      ["e", MATCH_ANCHORS[2]],
    ]);
  });
});

describe("the GateQ draft fills field by field while lit", () => {
  it("hides unfilled fields only while the tour lights the draft", async () => {
    const { container } = render(
      <DraftFill id="apply" labelledBy="h" className="">
        <dl>
          <div data-qp-fill data-qp-anchor="fdr.09.gateq.field-company">
            <dt>Company</dt>
            <dd>Harbourline</dd>
          </div>
          <div data-qp-fill data-qp-anchor="fdr.09.gateq.field-line">
            <dt>One line</dt>
            <dd>Trucking</dd>
          </div>
        </dl>
        <div data-qp-anchor="fdr.09.gateq.send">Review and send</div>
      </DraftFill>,
    );
    const section = container.querySelector("[data-qp-draft]");
    const fields = [...container.querySelectorAll("[data-qp-fill]")];
    const signal = new AbortController().signal;
    const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

    await lightSection("fdr.09.gateq.draft", {}, signal);
    await settle();
    expect(section?.hasAttribute("data-qp-filling")).toBe(true);
    expect(fields.map((f) => f.hasAttribute("data-qp-filled"))).toEqual([
      false,
      false,
    ]);

    await lightSection("fdr.09.gateq.field-company", {}, signal);
    await settle();
    expect(fields.map((f) => f.hasAttribute("data-qp-filled"))).toEqual([
      true,
      false,
    ]);

    await lightSection("fdr.09.gateq.send", {}, signal);
    await settle();
    expect(fields.every((f) => f.hasAttribute("data-qp-filled"))).toBe(true);

    unlightAll();
    await settle();
    expect(section?.hasAttribute("data-qp-filling")).toBe(false);
    expect(fields.some((f) => f.hasAttribute("data-qp-filled"))).toBe(false);
  });
});
