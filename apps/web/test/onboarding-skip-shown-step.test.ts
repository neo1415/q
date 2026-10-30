import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import { createFixtureRuntimePort } from "../src/features/founder-onboarding/adapters/fixture-port";
import { createRuntimeFounderClient } from "../src/features/founder-onboarding/adapters/runtime-port";
import { GROUPS } from "../src/features/founder-onboarding/models/journey";

/**
 * Live 2026-10-30 (founder v8, typed path): the session pointer sat on the
 * review step while Q asked the optional revenue trend. Skip sent the
 * pointer's screen, so the server was asked to set aside the review (a
 * required step) and refused nine times; "I don't know" worked because the
 * conversation names the step it asked. Skip now names the shown step.
 */
describe("Skip sets aside the question shown, not the pointer's screen", () => {
  const SOURCE = { adapter: "test", synthetic: true };

  function rawOf(session: {
    readonly raw?: OnboardingSessionView | undefined;
  }): OnboardingSessionView {
    if (session.raw === undefined) throw new Error("no runtime view");
    return session.raw;
  }

  async function pointerOnReviewWithALaterOptionalOpen() {
    const port = createFixtureRuntimePort({ storage: null, seed: "review" });
    const client = createRuntimeFounderClient(port, SOURCE);
    const session = await client.getSession();
    const view = rawOf(session);
    const pointer = view.currentStep;
    expect(pointer?.required).toBe(true);
    const keysOf = (keys: readonly string[]) => keys;
    const pointerKeys =
      GROUPS.map((g) => keysOf(g.stepKeys)).find((keys) =>
        keys.includes(pointer?.stepKey ?? ""),
      ) ?? [];
    // A later optional question the conversation can ask before the
    // pointer reaches it (the revenue trend, live).
    const later = view.progress.eligibleSteps.find(
      (step) =>
        step.stepKey !== pointer?.stepKey &&
        !step.required &&
        step.status !== "COMPLETED" &&
        step.status !== "SKIPPED" &&
        !pointerKeys.includes(step.stepKey),
    );
    expect(later).toBeDefined();
    return {
      port,
      client,
      session,
      pointerKey: pointer?.stepKey ?? "",
      laterKey: later?.stepKey ?? "",
    };
  }

  it("skipping the pointer's screen is what the live Skip did, and it is refused", async () => {
    const { client, session } = await pointerOnReviewWithALaterOptionalOpen();
    await expect(
      client.skipStep({ stepId: session.currentStepId ?? "" }),
    ).rejects.toThrow();
  });

  it("names the shown optional step and sets exactly that one aside", async () => {
    const { client, session, pointerKey, laterKey } =
      await pointerOnReviewWithALaterOptionalOpen();
    const after = await client.skipStep({
      stepId: session.currentStepId ?? "",
      stepKey: laterKey,
    });
    const status = (key: string) =>
      rawOf(after).progress.eligibleSteps.find((s) => s.stepKey === key)
        ?.status;
    expect(status(laterKey)).toBe("SKIPPED");
    // The required review is untouched: still open, never set aside.
    expect(status(pointerKey)).not.toBe("SKIPPED");
    expect(status(pointerKey)).not.toBe("COMPLETED");
  });

  it("a Skip made on a version the session has since left is made again, not dropped (live 2026-10-30, Hydrolume)", async () => {
    const { port, client, session, laterKey } =
      await pointerOnReviewWithALaterOptionalOpen();
    // Q's reading saves something else between the screen's last read and
    // the Skip: the session moves on without this browser knowing.
    const before = rawOf(session);
    const other = before.progress.eligibleSteps.find(
      (step) =>
        step.stepKey !== laterKey &&
        !step.required &&
        step.status !== "COMPLETED" &&
        step.status !== "SKIPPED",
    );
    expect(other).toBeDefined();
    await port.skip({
      sessionId: before.session.id,
      stepKey: other?.stepKey ?? "",
      expectedSessionVersion: before.session.version,
      idempotencyKey: crypto.randomUUID(),
    });
    const after = await client.skipStep({
      stepId: session.currentStepId ?? "",
      stepKey: laterKey,
    });
    expect(
      rawOf(after).progress.eligibleSteps.find((s) => s.stepKey === laterKey)
        ?.status,
    ).toBe("SKIPPED");
  });

  it("a second Skip of the same question is a no-op, not an error", async () => {
    const { client, session, laterKey } =
      await pointerOnReviewWithALaterOptionalOpen();
    await client.skipStep({
      stepId: session.currentStepId ?? "",
      stepKey: laterKey,
    });
    const again = await client.skipStep({
      stepId: session.currentStepId ?? "",
      stepKey: laterKey,
    });
    expect(
      rawOf(again).progress.eligibleSteps.find((s) => s.stepKey === laterKey)
        ?.status,
    ).toBe("SKIPPED");
  });
});
