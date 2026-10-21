import { describe, expect, it } from "vitest";

import {
  QStageAboutSchema,
  QStageChangedEventSchema,
} from "@capital-q/contracts";

import {
  DOCUMENT_PIPELINE_TOTAL,
  documentStageAbout,
  visibleStageOf,
} from "../src/company/prepare-artifact.js";

/**
 * Round 4 (ux-direction §5.1 WORKING): a document made through the
 * pipeline says its name and the pipeline's real step count; a brief,
 * written without it, has no count.
 */

describe("a document's stage, about its task", () => {
  it("counts the pipeline's four visible steps, in order", () => {
    const steps = (
      ["WRITING", "DESIGNING", "FINDING_ASSETS", "CHECKING", "FIXING"] as const
    ).map((stage) => {
      const visible = visibleStageOf(stage);
      if (visible === null) throw new Error("no visible stage");
      return documentStageAbout({
        stage: visible,
        artifactType: "PITCH_DECK",
        companyName: "Nixo",
        pipelined: true,
      }).task;
    });
    expect(steps.map((task) => task?.step)).toEqual([1, 2, 3, 4, 4]);
    expect(steps.every((task) => task?.of === DOCUMENT_PIPELINE_TOTAL)).toBe(
      true,
    );
    expect(steps[1]).toEqual({ kind: "PITCH_DECK", step: 2, of: 4 });
  });

  it("names the document's subject and passes the contract", () => {
    const about = documentStageAbout({
      stage: "DESIGNING_DOCUMENT",
      artifactType: "ONE_PAGER",
      companyName: "  Nixo  ",
      pipelined: true,
    });
    expect(about.subjects).toEqual(["Nixo"]);
    expect(QStageAboutSchema.safeParse(about).success).toBe(true);
    expect(
      QStageChangedEventSchema.shape.data.safeParse({
        stage: "DESIGNING_DOCUMENT",
        about,
      }).success,
    ).toBe(true);
  });

  it("invents no count for a brief, and no task for an unknown type", () => {
    expect(
      documentStageAbout({
        stage: "PREPARING_DOCUMENT",
        artifactType: "INVESTMENT_BRIEF",
        companyName: "Nixo",
        pipelined: false,
      }),
    ).toEqual({ subjects: ["Nixo"], task: { kind: "INVESTMENT_BRIEF" } });
    expect(
      documentStageAbout({
        stage: "PREPARING_DOCUMENT",
        artifactType: "SOMETHING_ELSE",
        companyName: "Nixo",
        pipelined: true,
      }).task,
    ).toBeUndefined();
  });

  it("refuses a step past its total, or a step without its total", () => {
    expect(
      QStageAboutSchema.safeParse({
        task: { kind: "PITCH_DECK", step: 5, of: 4 },
      }).success,
    ).toBe(false);
    expect(
      QStageAboutSchema.safeParse({ task: { kind: "PITCH_DECK", step: 2 } })
        .success,
    ).toBe(false);
  });
});
