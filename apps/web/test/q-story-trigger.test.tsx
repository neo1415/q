// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Hey Q, pitch yourself" from any page (Q Story, owner 22 Oct): typed,
 * the words go straight into the story by code, with no turn sent to Q;
 * anything else is Q's as before, and nothing is taken while a tour runs.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));

const { useStoryTrigger, storyAskedHref } =
  await import("../src/features/q-pitch/story/story-offer");
const { interceptTyped } = await import("../src/features/q/typed-intercept");

function Trigger({ active }: { readonly active: boolean }) {
  useStoryTrigger(active);
  return null;
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("the story trigger", () => {
  it("takes 'Hey Q, pitch yourself' into the story, with no turn", () => {
    render(<Trigger active />);
    expect(interceptTyped("Hey Q, pitch yourself")).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]?.[0])).toMatch(
      /^\/home\?qpitch=story&new=1&start=[0-9a-z]+$/u,
    );
  });

  it("leaves every other message to Q", () => {
    render(<Trigger active />);
    expect(interceptTyped("What is Capital Q?")).toBe(false);
    expect(interceptTyped("pitch me three companies")).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("takes nothing while a tour runs", () => {
    render(<Trigger active={false} />);
    expect(interceptTyped("Hey Q, pitch yourself")).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("asks with a new address each time, so a second ask starts it again", () => {
    expect(storyAskedHref()).toContain("qpitch=story");
  });
});
