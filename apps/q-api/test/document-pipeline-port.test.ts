import { describe, expect, it } from "vitest";

import type { QDocumentPipelineStage } from "@capital-q/contracts";
import type {
  ArtifactService,
  DocumentJobProgress,
} from "@capital-q/q-artifacts";

import { createDocumentPipelinePort } from "../src/composition/artifacts.js";

/**
 * Q room W5 (R8): the run follows the worker's job as the person, says
 * each new stage once, returns the filed card when the job is done, and
 * gives up quietly (null: still being made) when the wait ends.
 */

const ACTOR = {
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as never;
const ID = "a1000000-0000-4000-8000-000000000001";

function service(progress: (DocumentJobProgress | null)[]): ArtifactService {
  let at = 0;
  return {
    documentProgress: () =>
      Promise.resolve(progress[Math.min(at++, progress.length - 1)] ?? null),
    read: () =>
      Promise.resolve({
        artifact: { artifactId: ID, status: "READY", title: "Deck" },
      } as never),
  } as unknown as ArtifactService;
}

const step = (
  stage: QDocumentPipelineStage,
  status: DocumentJobProgress["status"] = "RUNNING",
) => ({
  artifactId: ID,
  stage,
  status,
  updatedAt: "2026-10-07T00:00:00.000Z",
});

describe("following a document job", () => {
  it("says each new stage once and returns the filed card", async () => {
    let clock = 0;
    const said: QDocumentPipelineStage[] = [];
    const port = createDocumentPipelinePort(
      service([
        step("QUEUED", "QUEUED"),
        step("DESIGNING"),
        step("DESIGNING"),
        step("CHECKING"),
        step("READY", "DONE"),
      ]),
      {
        waitMs: 60_000,
        pollMs: 1_000,
        now: () => clock,
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
      },
    );
    const card = await port.wait({
      actor: ACTOR,
      artifactId: ID,
      onStage: (stage) => {
        said.push(stage);
        return Promise.resolve();
      },
    });
    expect(card).toMatchObject({ status: "READY" });
    expect(said).toEqual(["QUEUED", "DESIGNING", "CHECKING", "READY"]);
  });

  it("still being made when the wait ends: null, never a failure", async () => {
    let clock = 0;
    const port = createDocumentPipelinePort(service([step("FINDING_ASSETS")]), {
      waitMs: 5_000,
      pollMs: 1_000,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });
    expect(
      await port.wait({
        actor: ACTOR,
        artifactId: ID,
        onStage: () => Promise.resolve(),
      }),
    ).toBeNull();
  });

  it("not their job (or none): null at once", async () => {
    const port = createDocumentPipelinePort(service([null]), {
      waitMs: 5_000,
      pollMs: 1_000,
    });
    expect(
      await port.wait({
        actor: ACTOR,
        artifactId: ID,
        onStage: () => Promise.resolve(),
      }),
    ).toBeNull();
  });
});
