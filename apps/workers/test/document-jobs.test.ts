import { describe, expect, it } from "vitest";

import type { QDocumentPipelineStage } from "@capital-q/contracts";
import type {
  ClaimedDocumentJob,
  ComposedArtifact,
  DocumentJobRepository,
} from "@capital-q/q-artifacts";

import { createDocumentJobRunner } from "../src/documents/document-jobs.js";

/**
 * Q room W5 (R8): the document worker takes one job, says each stage,
 * files version 1, and on failure retries once then rests the artifact at
 * FAILED. Fakes only: no database, no provider.
 */

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function job(attempts = 1): ClaimedDocumentJob {
  return {
    id: "f0000000-0000-4000-8000-0000000000b1",
    tenantId: "c0000000-0000-4000-8000-000000000001",
    organisationId: "d0000000-0000-4000-8000-000000000001",
    artifactId: "a1000000-0000-4000-8000-000000000001",
    userId: "b0000000-0000-4000-8000-000000000001",
    runId: "22222222-0000-4000-8000-000000000001",
    kind: "PITCH_DECK",
    attempts,
    input: {
      title: "Northstar Logistics — investor deck",
      summary: "Freight between Lagos and Abuja.",
      content: {
        sections: [
          {
            heading: "Summary",
            body: "Freight between Lagos and Abuja.",
            findings: [],
          },
        ],
        gaps: ["Traction"],
        deck: {
          slides: [
            {
              layout: "TITLE",
              title: "Northstar Logistics",
              bullets: [],
              bulletsRight: [],
              section: 0,
            },
            {
              layout: "BULLETS",
              title: "What we do",
              bullets: ["Freight between Lagos and Abuja."],
              bulletsRight: [],
              section: 0,
            },
          ],
          direction: "MINIMAL_INSTITUTIONAL",
          markIsDraft: false,
        },
      },
      grounding: ["Freight between Lagos and Abuja."],
      sectorCodes: [],
      directionChosen: false,
      brand: null,
      sensitivity: "CONFIDENTIAL",
    },
  };
}

function fakes(claimed: ClaimedDocumentJob | null, fail = false) {
  const stages: QDocumentPipelineStage[] = [];
  const finished: [string, string | undefined][] = [];
  const filed: ComposedArtifact[] = [];
  let released = 0;
  let failedArtifacts = 0;
  let taken = false;
  const jobs: DocumentJobRepository = {
    enqueue: () => Promise.resolve(),
    progress: () => Promise.resolve(null),
    claim: () => {
      if (taken) return Promise.resolve(null);
      taken = true;
      return Promise.resolve(claimed);
    },
    setStage: (_id, stage) => {
      stages.push(stage);
      return Promise.resolve();
    },
    finish: (_id, outcome, code) => {
      finished.push([outcome, code]);
      return Promise.resolve();
    },
    release: () => {
      released += 1;
      return Promise.resolve();
    },
  };
  const runner = createDocumentJobRunner({
    jobs,
    artifacts: {
      completeDocumentJob: (_job, composed) => {
        if (fail) return Promise.reject(new Error("db down"));
        filed.push(composed);
        return Promise.resolve({} as never);
      },
      failDocumentJob: () => {
        failedArtifacts += 1;
        return Promise.resolve();
      },
    },
    logger,
  });
  return {
    runner,
    stages,
    finished,
    filed,
    released: () => released,
    failedArtifacts: () => failedArtifacts,
  };
}

describe("the document worker", () => {
  it("says each stage, files version 1 with its audit, and finishes", async () => {
    const world = fakes(job());
    expect(await world.runner.runOnce()).toBe(true);
    expect(world.stages).toEqual([
      "WRITING",
      "DESIGNING",
      "FINDING_ASSETS",
      "CHECKING",
    ]);
    expect(world.filed).toHaveLength(1);
    expect(world.filed[0]?.content.audit?.rubric).toBeDefined();
    // The gap became a marked placeholder, not a number.
    expect(
      world.filed[0]?.content.deck?.slides.find(
        (slide) => slide.title === "Traction",
      )?.placeholder?.kind,
    ).toBe("TEXT");
    expect(world.finished).toEqual([["DONE", undefined]]);
  });

  it("nothing waiting: nothing done", async () => {
    const world = fakes(null);
    expect(await world.runner.runOnce()).toBe(false);
  });

  it("a first failure goes back to the queue; a second rests the artifact at FAILED", async () => {
    const first = fakes(job(1), true);
    await first.runner.runOnce();
    expect(first.released()).toBe(1);
    expect(first.finished).toEqual([]);
    const second = fakes(job(2), true);
    await second.runner.runOnce();
    expect(second.released()).toBe(0);
    expect(second.failedArtifacts()).toBe(1);
    expect(second.finished).toEqual([["FAILED", "PIPELINE_FAILED"]]);
  });
});
