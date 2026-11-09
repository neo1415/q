import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D86 (owner, 9 Nov, live voice onboarding 12a0275a): the live call is
 * told what Capital Q saved, could not save and asks next, after each
 * reading; the answer cards follow the question Q is asking in voice.
 */
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), "utf8");
const workspace = read(
  "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
);

vi.mock("@/features/q/context", () => ({
  qApiSession: () =>
    Promise.resolve({ baseUrl: "https://q.test/", accessToken: "tok" }),
}));

describe("the live call is steered by Capital Q", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the person's own steer from the Q API, and nothing for a bad id", async () => {
    const { voiceSteerAction } =
      await import("../src/features/onboarding-conversation/voice-steer-action");
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetched.push(url);
        return Promise.resolve(
          Response.json({
            id: "abc",
            text: "Capital Q update: Saved just now: Country: Qatar.",
            askedStepKey: "I1.deployment_status",
          }),
        );
      }),
    );
    const id = "73253301-d6f6-487f-9f30-c60cc3662a6d";
    expect(await voiceSteerAction(id)).toEqual({
      id: "abc",
      text: "Capital Q update: Saved just now: Country: Qatar.",
      askedStepKey: "I1.deployment_status",
    });
    expect(fetched).toEqual([
      `https://q.test/v1/q/voice/onboarding/${id}/steer`,
    ]);
    expect(await voiceSteerAction("not-a-session")).toBeNull();
  });

  it("the workspace hands each new steer to the live call once, then reads the session again", () => {
    const effect = workspace.slice(workspace.indexOf("const steeredId"));
    expect(effect).toContain("voiceSteerAction(steerSessionId)");
    expect(effect).toContain("briefCall.current?.(steer.text) === true");
    expect(effect).toContain("steeredId.current = steer.id");
    expect(effect).toContain("refreshRef.current()");
  });

  it("in a live call the choices follow the step the session says Q is asking", () => {
    expect(workspace).toContain(
      "const voiceAsked = voiceActive ? (view?.askedStep ?? null) : null;",
    );
    expect(workspace).toContain("const askedNow = voiceAsked ?? qAskedStep;");
    expect(workspace).toContain("promptStepOf(view, askedNow)");
    expect(workspace).toContain("chipsBelongTo(prompt.stepKey, chipsAsking)");
  });
});
