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
let session: unknown = null;
vi.mock("@/features/q/q-session", () => ({
  useQSessionOptional: () => session,
}));

const { useStoryTrigger, storyAskedHref } =
  await import("../src/features/q-pitch/story/story-offer");
const { interceptTyped } = await import("../src/features/q/typed-intercept");
const { interceptHeard } =
  await import("../src/features/voice/heard-intercept");

function Trigger({ active }: { readonly active: boolean }) {
  useStoryTrigger(active);
  return null;
}

afterEach(() => {
  cleanup();
  push.mockReset();
  session = null;
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
    expect(interceptHeard("Hey Q, pitch yourself")).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("takes a spoken ask from a voice line's final transcript (23 Oct)", () => {
    render(<Trigger active />);
    expect(interceptHeard("Hey, cue. Pitch yourself to investors.")).toBe(true);
    expect(String(push.mock.calls[0]?.[0])).toMatch(/&edition=investor&/u);
    expect(interceptHeard("What's in my pitch deck?")).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("ends an open voice line when the story is asked for by typing", () => {
    const end = vi.fn(() => Promise.resolve());
    session = { spoken: [], voice: { active: true, client: { end } } };
    render(<Trigger active />);
    expect(interceptTyped("pitch yourself to founders")).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]?.[0])).toMatch(/&edition=founder&/u);
  });

  it("asks with a new address each time, so a second ask starts it again", () => {
    expect(storyAskedHref()).toContain("qpitch=story");
  });
});
