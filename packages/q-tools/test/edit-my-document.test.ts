import { describe, expect, it } from "vitest";

import {
  QDocumentToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";

import {
  createOwnWorkTools,
  createQToolExecutor,
  createQToolRegistry,
  type DocumentEditPort,
} from "../src/index.js";
import { actorA, contextFor, planFor } from "./support.js";

/**
 * Q room W5 (R8): `edit_my_document` is authorised to the person's own
 * conversation, hands the port exactly the typed edit and the version on
 * screen, carries the document card (and the slide) on its result, and
 * says a replay and a changed document plainly.
 */

const ARTIFACT = "a1000000-0000-4000-8000-000000000001";

function ownPlan(userId: string = actorA.userId): PermittedContextPlan {
  const plan = planFor(actorA, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

function world(answer: Awaited<ReturnType<DocumentEditPort["edit"]>>) {
  const calls: Parameters<DocumentEditPort["edit"]>[0][] = [];
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createOwnWorkTools({
        documentEdit: {
          edit: (input) => {
            calls.push(input);
            return Promise.resolve(answer);
          },
        },
      }),
    ),
  });
  return { executor, calls };
}

const call = (args: Record<string, unknown>) => ({
  callId: "c-edit",
  name: "edit_my_document",
  arguments: args,
});

const EDITED = {
  status: "EDITED" as const,
  artifactId: ARTIFACT,
  type: "PITCH_DECK",
  artifactStatus: "READY",
  title: "Northstar deck",
  version: 4,
  slide: 3,
};

describe("edit_my_document", () => {
  it("passes the typed edit and the version on screen, and returns the card and slide", async () => {
    const { executor, calls } = world(EDITED);
    const outcome = await executor.execute(
      call({
        artifactId: ARTIFACT,
        version: 3,
        edit: { kind: "SHORTEN", slide: 3 },
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result.ok).toBe(true);
    const read = QDocumentToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(read).toEqual({
      status: "DOCUMENT_UPDATED",
      document: {
        artifactId: ARTIFACT,
        type: "PITCH_DECK",
        status: "READY",
        title: "Northstar deck",
        currentVersion: 4,
      },
      slide: 3,
      replayed: false,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        artifactId: ARTIFACT,
        version: 3,
        edit: { kind: "SHORTEN", slide: 3 },
      }),
    ]);
  });

  it("the same edit again is said as already done, not a second version", async () => {
    const { executor } = world({ ...EDITED, status: "REPLAYED" });
    const outcome = await executor.execute(
      call({
        artifactId: ARTIFACT,
        version: 3,
        edit: { kind: "SHORTEN", slide: 3 },
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(
      (outcome.result as { data: { replayed: boolean } }).data.replayed,
    ).toBe(true);
  });

  it("a document changed since is CHANGED_SINCE; a refusal carries its reason", async () => {
    const stale = await world({ status: "STALE" }).executor.execute(
      call({
        artifactId: ARTIFACT,
        version: 1,
        edit: { kind: "REMOVE_IMAGE", slide: 2 },
      }),
      contextFor(actorA, ownPlan()),
    );
    expect((stale.result as { data: unknown }).data).toEqual({
      status: "CHANGED_SINCE",
    });
    const no = await world({
      status: "NOT_APPLICABLE",
      reason: "The cover stays.",
    }).executor.execute(
      call({ artifactId: ARTIFACT, edit: { kind: "REMOVE_SLIDE", slide: 1 } }),
      contextFor(actorA, ownPlan()),
    );
    expect((no.result as { data: unknown }).data).toEqual({
      status: "NOT_APPLICABLE",
      reason: "The cover stays.",
    });
  });

  it("is refused outside the person's own conversation, and the port is never called", async () => {
    const { executor, calls } = world(EDITED);
    const outcome = await executor.execute(
      call({ artifactId: ARTIFACT, edit: { kind: "SHORTEN", slide: 2 } }),
      contextFor(actorA, ownPlan("b9999999-0000-4000-8000-000000000009")),
    );
    expect(outcome.result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses an edit outside the typed set", async () => {
    const { executor, calls } = world(EDITED);
    const outcome = await executor.execute(
      call({
        artifactId: ARTIFACT,
        edit: { kind: "REWRITE_EVERYTHING", slide: 2 },
      }),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
