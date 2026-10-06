// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Let Q handle this" hands the relationship over in one tap (QA
 * 2026-10-01: it only filled the composer, so nothing happened).
 */
const asked: string[] = [];
const seeded: string[] = [];
const opened: boolean[] = [];
let withSession = true;

vi.mock("../src/features/relationships/errand-actions", () => ({
  readErrandsAction: () => Promise.resolve({ ok: true, value: [] }),
  stopErrandAction: () => Promise.resolve({ ok: true, value: null }),
}));
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({
    askAbout: (seed: string) => seeded.push(seed),
    askNow: (seed: string) => seeded.push(seed),
    setOpen: (open: boolean) => opened.push(open),
  }),
}));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () =>
    withSession
      ? {
          q: {
            ask: (text: string) => {
              asked.push(text);
              return Promise.resolve();
            },
          },
        }
      : null,
}));
vi.mock("../src/features/q-swarm/q-swarm", () => ({ QSwarm: () => null }));

const { RelationshipErrands } =
  await import("../src/features/relationships/relationship-errands");

afterEach(() => {
  cleanup();
  asked.length = 0;
  seeded.length = 0;
  opened.length = 0;
  withSession = true;
});

describe("Let Q handle this", () => {
  it("sends the hand-over to Q and opens it, in one tap", async () => {
    render(
      <RelationshipErrands
        relationshipId="r1"
        counterpart="Kazikit"
        connected={false}
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Let Q handle this",
    });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Look after Kazikit for me");
    expect(opened).toEqual([true]);
    expect(seeded).toEqual([]);
  });

  it("asks Q in one tap when there is no live session", async () => {
    withSession = false;
    render(
      <RelationshipErrands
        relationshipId="r1"
        counterpart="Kazikit"
        connected
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Let Q handle this",
    });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(asked).toEqual([]);
    expect(seeded).toHaveLength(1);
  });
});
