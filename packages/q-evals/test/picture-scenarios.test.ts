import { describe, expect, it } from "vitest";

import { CompanyAnalystV26ResultSchema } from "@capital-q/q-core";

import {
  PICTURE_SCENARIOS,
  gradePicture,
  outbound,
  type PictureScenario,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v26 picture scenarios with scripted answers (L-13),
 * graded by code through the real pictureBlock. No provider is called;
 * a live model's v26 answers are graded by the same gradePicture.
 */

function scenario(id: string): PictureScenario {
  const found = PICTURE_SCENARIOS.find((one) => one.id === id);
  if (found === undefined) throw new Error(`no scenario ${id}`);
  return found;
}

describe("v26 picture scenarios (scripted analyst, real pictureBlock)", () => {
  for (const one of PICTURE_SCENARIOS) {
    it(`${one.id}: ${one.title}`, async () => {
      expect(
        CompanyAnalystV26ResultSchema.safeParse(one.scripted).success,
      ).toBe(true);
      const grade = await gradePicture(one, one.scripted);
      const failed = grade.checks.filter((check) => !check.ok);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(grade.score).toBe(100);
    });
  }

  it("shows a credited picture only where it was wanted and found on the source", async () => {
    const shown = await gradePicture(
      scenario("pic-visual-topic"),
      scenario("pic-visual-topic").scripted,
    );
    expect(shown.sent).toBe("baobab tree");
    expect(shown.shown?.credit.name).toBeTruthy();

    const offHost = await gradePicture(
      scenario("pic-off-host"),
      scenario("pic-off-host").scripted,
    );
    expect(offHost.sent).toBe("dhow");
    expect(offHost.shown).toBeNull();

    const none = await gradePicture(
      scenario("pic-own-figures"),
      scenario("pic-own-figures").scripted,
    );
    expect(none.sent).toBeNull();
    expect(none.shown).toBeNull();
  });

  it("sends nothing of Q's words, nor names it proposed", async () => {
    const qWords = await gradePicture(
      scenario("pic-q-words-never-leave"),
      scenario("pic-q-words-never-leave").scripted,
    );
    expect(qWords.sent).toBeNull();
    expect(qWords.shown).toBeNull();
    // Figures never leave, even typed by the person.
    expect(
      outbound("cold-chain warehouse 2.4m", {
        userText: "A cold-chain warehouse with 2.4m litres?",
        earlierUserText: [],
      }),
    ).toBe("cold-chain warehouse");
    // A name the person typed reaches the egress composer as theirs, but
    // every name the run read is withheld: the model's slip is graded, and
    // the name still never leaves.
    const named = scenario("pic-no-company-name");
    const grade = await gradePicture(named, {
      ...named.scripted,
      pictureQuery: "Kivu Freight warehouse",
    });
    expect(grade.sent).toBe("warehouse");
    expect(
      grade.checks.filter((check) => !check.ok).map((check) => check.name),
    ).toEqual(["no names in the words"]);
  });

  it("scores a bad answer low: picture as evidence, names and figures in the words, picture for figures", async () => {
    const figures = scenario("pic-own-figures");
    const grade = await gradePicture(figures, {
      ...figures.scripted,
      answer:
        "Your runway looks healthy; the photo shows a busy Kivu Freight warehouse.",
      visual: "PICTURE",
      pictureQuery: "Kivu Freight warehouse 2025",
    });
    const failed = grade.checks.filter((check) => !check.ok).map((c) => c.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        "a picture is never evidence",
        "asks for no picture",
        "no figures in the words",
        "no names in the words",
      ]),
    );
    expect(grade.score).toBeLessThan(60);
  });

  it("a schema-invalid answer scores zero", async () => {
    const grade = await gradePicture(scenario("pic-visual-topic"), {
      answer: "x",
      visual: "VIDEO",
    });
    expect(grade.score).toBe(0);
  });
});
