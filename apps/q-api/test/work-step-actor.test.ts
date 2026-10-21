import { describe, expect, it } from "vitest";

import { QWorkStepDtoSchema } from "@capital-q/contracts";

import {
  instructionStepDto,
  stepActor,
} from "../src/composition/work/actions.js";

/**
 * What Q did (audit trail, owner 2026-10-21): each step says on whose
 * authority it was taken, decided by code from the step's own key -- the
 * work graph writes one key per kind of happening -- never by a model.
 */
describe("who took a delegation step", () => {
  it("reads the other side's acceptance as theirs", () => {
    expect(stepActor("accepted:00000000-0000-4000-8000-000000000001")).toBe(
      "THEM",
    );
  });

  it("reads the person going away or coming back as theirs", () => {
    expect(stepActor("away:2026-10-20T09:00:00Z")).toBe("YOU");
    expect(stepActor("handback:2026-10-20T11:00:00Z")).toBe("YOU");
  });

  it("reads everything else as Q's, under the approved grant", () => {
    for (const key of [
      "sourced",
      "interest:00000000-0000-4000-8000-000000000002",
      "interview-start:x",
      "report:x",
      "booked:x",
      "end:x",
      "something-new",
    ]) {
      expect(stepActor(key)).toBe("Q");
    }
  });

  it("marks a standing instruction's steps as Q's, with no lane", () => {
    const step = QWorkStepDtoSchema.parse(
      instructionStepDto(
        {
          words: "Replied to Tallyloom",
          created_at: new Date("2026-10-20T09:00:00Z"),
          reason_code: null,
          relationship_id: null,
          message_id: null,
        },
        new Date("2026-10-20T10:00:00Z"),
      ),
    );
    expect(step).toMatchObject({ by: "Q", laneId: null });
  });

  it("reads an older server's step as not known", () => {
    expect(
      QWorkStepDtoSchema.parse({ words: "x", at: "2026-10-20T09:00:00Z" }),
    ).toMatchObject({ by: null, laneId: null });
  });
});
