import { describe, expect, it } from "vitest";

import {
  PILOT_CERTIFICATION_LEDGER,
  PILOT_SCRIPT,
  certifyTour,
  type CertificationLedger,
  type GateEnvironment,
  type SceneScript,
  type TourScript,
} from "../src/index.js";

const ENV: GateEnvironment = {
  now: "2026-10-14T09:00:00Z",
  staleFeatureIds: [],
  audience: "INTERNAL_REHEARSAL",
};

function withLedger(
  change: (entries: CertificationLedger) => CertificationLedger,
): CertificationLedger {
  return change(PILOT_CERTIFICATION_LEDGER);
}

function scene(id: string): SceneScript {
  const found = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (found === undefined) throw new Error(id);
  return found;
}

describe("certification gate", () => {
  it("admits the three pilot scenes for an internal rehearsal", () => {
    const result = certifyTour(PILOT_SCRIPT, PILOT_CERTIFICATION_LEDGER, ENV);
    expect(result.decisions.map((d) => d.verdict)).toEqual([
      "ADMITTED",
      "ADMITTED",
      "ADMITTED",
    ]);
    expect(result.scenes.map((s) => s.sceneId)).toEqual([
      "s.pilot.opening",
      "s.pilot.company",
      "s.pilot.compare",
    ]);
    expect(result.rejectedLines).toEqual([]);
  });

  it("suppresses everything for an audience while the script is a DRAFT", () => {
    const result = certifyTour(PILOT_SCRIPT, PILOT_CERTIFICATION_LEDGER, {
      ...ENV,
      audience: "AUDIENCE",
    });
    expect(result.scenes).toEqual([]);
    expect(result.chapters).toEqual([]);
    expect(
      result.decisions.every((d) => d.reasons.includes("SCRIPT_NOT_APPROVED")),
    ).toBe(true);
  });

  it("no entry means no claim: a missing feature suppresses its scene and chapter", () => {
    const ledger = withLedger((l) =>
      l.filter((e) => e.featureId !== "INV-COMPARE-TABLE"),
    );
    const result = certifyTour(PILOT_SCRIPT, ledger, ENV);
    const compare = result.decisions.find(
      (d) => d.sceneId === "s.pilot.compare",
    );
    expect(compare?.verdict).toBe("SUPPRESSED");
    expect(compare?.reasons).toEqual(["NO_ENTRY", "LINE_REJECTED"]);
    expect(result.chapters.map((c) => c.chapterId)).toEqual([
      "ch.pilot.discover",
      "ch.pilot.company",
    ]);
    expect(result.rejectedLines.map((l) => l.claimId).sort()).toEqual([
      "INV-COMPARE-TABLE.c1",
      "INV-COMPARE-TABLE.c2",
    ]);
  });

  it("refuses a status below live verification, an expired entry and a stale one", () => {
    const partial = withLedger((l) =>
      l.map((e) =>
        e.featureId === "INV-DISCOVER-TOP3"
          ? { ...e, status: "PARTIAL" as const }
          : e,
      ),
    );
    expect(
      certifyTour(PILOT_SCRIPT, partial, ENV).decisions[0]?.reasons,
    ).toContain("STATUS_NOT_ACCEPTED");

    const expired = withLedger((l) =>
      l.map((e) =>
        e.featureId === "INV-DISCOVER-TOP3"
          ? { ...e, validUntil: { at: "2026-10-14T08:59:59Z" } }
          : e,
      ),
    );
    expect(
      certifyTour(PILOT_SCRIPT, expired, ENV).decisions[0]?.reasons,
    ).toContain("EXPIRED");

    const stale = certifyTour(PILOT_SCRIPT, PILOT_CERTIFICATION_LEDGER, {
      ...ENV,
      staleFeatureIds: ["INV-RISKS-FOLLOWUP"],
    });
    // One stale feature takes the whole two-feature scene with it.
    expect(stale.decisions[1]).toMatchObject({ verdict: "SUPPRESSED" });
    expect(stale.decisions[1]?.reasons).toContain("STALE");
  });

  it("refuses an entry certified on a different demo actor", () => {
    const other = withLedger((l) =>
      l.map((e) => ({
        ...e,
        actorContext: {
          role: "INVESTOR" as const,
          account: "investor.other@fictional.capitalq.local",
        },
      })),
    );
    const result = certifyTour(PILOT_SCRIPT, other, ENV);
    expect(result.scenes).toEqual([]);
    expect(result.decisions[0]?.reasons).toContain("ACTOR_NOT_CERTIFIED");
  });

  it("rejects a line whose claim id is not certified", () => {
    const opening = scene("s.pilot.opening");
    const tampered: TourScript = {
      ...PILOT_SCRIPT,
      scenes: [
        {
          ...opening,
          approvedClaimIds: [
            ...opening.approvedClaimIds,
            "INV-DISCOVER-TOP3.c9",
          ],
          lines: [
            ...opening.lines,
            {
              lineId: "l.top3.fast",
              kind: "CLAIM",
              text: "That was instant.",
              claimIds: ["INV-DISCOVER-TOP3.c9"],
              timing: "AFTER_ACK",
              source: "test",
            },
          ],
        },
        ...PILOT_SCRIPT.scenes.slice(1),
      ],
    };
    const result = certifyTour(tampered, PILOT_CERTIFICATION_LEDGER, ENV);
    expect(result.rejectedLines).toEqual([
      {
        sceneId: "s.pilot.opening",
        lineId: "l.top3.fast",
        claimId: "INV-DISCOVER-TOP3.c9",
        reason: "UNCERTIFIED_CLAIM",
      },
    ]);
    expect(result.decisions[0]?.verdict).toBe("SUPPRESSED");
  });

  it("rejects a line citing a feature the scene does not demonstrate", () => {
    const compare = scene("s.pilot.compare");
    const tampered: TourScript = {
      ...PILOT_SCRIPT,
      scenes: PILOT_SCRIPT.scenes.map((s) =>
        s.sceneId === compare.sceneId
          ? {
              ...s,
              approvedClaimIds: [...s.approvedClaimIds, "INV-DISCOVER-TOP3.c1"],
              lines: [
                ...s.lines,
                {
                  lineId: "l.compare.borrowed",
                  kind: "CLAIM" as const,
                  text: "These were your top three.",
                  claimIds: ["INV-DISCOVER-TOP3.c1"],
                  timing: "AFTER_ACK" as const,
                  source: "test",
                },
              ],
            }
          : s,
      ),
    };
    const result = certifyTour(tampered, PILOT_CERTIFICATION_LEDGER, ENV);
    expect(result.rejectedLines).toEqual([
      expect.objectContaining({
        lineId: "l.compare.borrowed",
        reason: "FEATURE_NOT_IN_SCENE",
      }),
    ]);
  });

  it("replaces an uncertified scene with its certified fallback, once, in chapter order", () => {
    const tampered: TourScript = {
      ...PILOT_SCRIPT,
      scenes: PILOT_SCRIPT.scenes.map((s) =>
        s.sceneId === "s.pilot.compare"
          ? { ...s, fallbackSceneId: "s.pilot.company" }
          : s,
      ),
    };
    const ledger = withLedger((l) =>
      l.filter((e) => e.featureId !== "INV-COMPARE-TABLE"),
    );
    const result = certifyTour(tampered, ledger, ENV);
    expect(result.decisions[2]).toMatchObject({
      sceneId: "s.pilot.compare",
      verdict: "REPLACED",
      replacedBy: "s.pilot.company",
    });
    // The replacement is already in the tour: it is not played twice.
    expect(result.scenes.map((s) => s.sceneId)).toEqual([
      "s.pilot.opening",
      "s.pilot.company",
    ]);
  });

  it("suppresses when the fallback is itself uncertified, and survives a fallback cycle", () => {
    const tampered: TourScript = {
      ...PILOT_SCRIPT,
      scenes: PILOT_SCRIPT.scenes.map((s) =>
        s.sceneId === "s.pilot.compare"
          ? { ...s, fallbackSceneId: "s.pilot.opening" }
          : s.sceneId === "s.pilot.opening"
            ? { ...s, fallbackSceneId: "s.pilot.compare" }
            : s,
      ),
    };
    const ledger = withLedger((l) =>
      l.filter(
        (e) =>
          e.featureId !== "INV-COMPARE-TABLE" &&
          e.featureId !== "INV-DISCOVER-TOP3",
      ),
    );
    const result = certifyTour(tampered, ledger, ENV);
    expect(result.decisions[0]?.verdict).toBe("SUPPRESSED");
    expect(result.decisions[0]?.reasons).toContain("FALLBACK_UNAVAILABLE");
    expect(result.decisions[2]?.verdict).toBe("SUPPRESSED");
    expect(result.scenes.map((s) => s.sceneId)).toEqual(["s.pilot.company"]);
  });
});
